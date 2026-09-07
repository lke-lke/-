-- 台账全链路：逐行、幂等、可部分成功的任务提交。
-- 前端预览仅用于交互；本 RPC 会在事务中重新校验关系、人员和小组。

create or replace function public.task_field_is_manually_locked(p_task_id uuid, p_field_name text)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select coalesce((select manually_locked from public.task_field_provenance
    where task_id = p_task_id and field_name = p_field_name), false);
$$;

create or replace function public.commit_task_ledger_import_v2(
  p_filename text,
  p_rows jsonb,
  p_storage_key text default null,
  p_idempotency_key text default null,
  p_batch_id uuid default null
)
returns public.import_batches
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  batch public.import_batches;
  item jsonb;
  normalized jsonb;
  supplied_resolution jsonb;
  row_issues jsonb;
  imported_row public.import_rows;
  relation_row public.task_relations;
  person_name text;
  person_record record;
  participant_user_ids uuid[];
  resolved_participant_names text[];
  participant_leader_flags boolean[];
  resolved_team_id uuid;
  resolved_team_name text;
  primary_user_id uuid;
  primary_name text;
  task_row public.tasks;
  existing_task public.tasks;
  dedupe_key text;
  mapping_state text;
  row_state text;
  row_action text;
  issue_message text;
  created_count integer := 0;
  updated_count integer := 0;
  skipped_count integer := 0;
  conflict_count integer := 0;
  error_count integer := 0;
  completion_count integer := 0;
  ready_count integer := 0;
  item_index integer := 0;
  participant_index integer;
  person_match_count integer;
  effective_date date;
  effective_idempotency_key text;
begin
  if not (public.has_app_role('admin') or public.has_app_role('leader')) then raise exception 'IMPORT_FORBIDDEN'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'IMPORT_ROWS_MUST_BE_ARRAY'; end if;

  effective_idempotency_key := coalesce(nullif(trim(p_idempotency_key), ''),
    encode(extensions.digest(coalesce(p_filename, '') || '|' || p_rows::text, 'sha256'), 'hex'));

  if p_batch_id is not null then
    select * into batch from public.import_batches where id = p_batch_id for update;
    if not found or batch.source_type <> 'task_ledger' then raise exception 'IMPORT_BATCH_NOT_FOUND'; end if;
    if batch.status in ('succeeded', 'committed') then return batch; end if;
  else
    select * into batch from public.import_batches
    where source_system = 'excel' and idempotency_key = effective_idempotency_key
    for update;
  end if;
  if found and batch.status in ('succeeded', 'partial', 'committed') then return batch; end if;

  if batch.id is null then
    insert into public.import_batches(
      source_type, source_system, original_filename, storage_key, status, total_rows,
      source_hash, idempotency_key, created_by
    ) values (
      'task_ledger', 'excel', p_filename, p_storage_key, 'committing', jsonb_array_length(p_rows),
      encode(extensions.digest(p_rows::text, 'sha256'), 'hex'), effective_idempotency_key,
      public.current_app_user_id()
    ) returning * into batch;
  else
    update public.import_batches set status = 'committing', error_summary = '{}'::jsonb
    where id = batch.id returning * into batch;
  end if;

  for item in select value from jsonb_array_elements(p_rows) loop
    item_index := item_index + 1;
    normalized := coalesce(item -> 'normalized_data', '{}'::jsonb);
    supplied_resolution := coalesce(item -> 'resolved_data', '{}'::jsonb);
    row_issues := coalesce(item -> 'issues', '[]'::jsonb);
    row_state := coalesce(nullif(item ->> 'status', ''), 'error');
    row_action := null;
    issue_message := null;
    participant_user_ids := '{}';
    resolved_participant_names := '{}';
    participant_leader_flags := '{}';
    resolved_team_id := null;
    resolved_team_name := null;
    primary_user_id := null;
    primary_name := null;
    existing_task := null;
    task_row := null;

    insert into public.import_rows(
      batch_id, row_key, source_sheet, source_row, raw_data, normalized_data,
      resolved_data, issues, status
    ) values (
      batch.id, coalesce(nullif(item ->> 'row_key', ''), coalesce(item ->> 'source_sheet', '任务台账') || ':' || item_index),
      coalesce(nullif(item ->> 'source_sheet', ''), '任务台账'),
      coalesce(nullif(item ->> 'source_row', '')::integer, item_index),
      coalesce(item -> 'raw_data', '{}'::jsonb), normalized, supplied_resolution, row_issues,
      case when row_state in ('ready', 'needs_completion', 'conflict', 'error') then row_state else 'error' end
    ) on conflict (batch_id, row_key) do update set
      raw_data = excluded.raw_data, normalized_data = excluded.normalized_data,
      resolved_data = excluded.resolved_data, issues = excluded.issues, status = excluded.status
    returning * into imported_row;

    if row_state in ('conflict', 'error') then
      if row_state = 'conflict' then conflict_count := conflict_count + 1; else error_count := error_count + 1; end if;
      continue;
    end if;
    if coalesce(trim(normalized ->> 'name'), '') = '' then
      update public.import_rows set status = 'error', error_message = '任务名称为空',
        issues = issues || jsonb_build_array(jsonb_build_object('code','MISSING_NAME','field','任务名称','level','error','message','任务名称为空'))
      where id = imported_row.id;
      error_count := error_count + 1;
      continue;
    end if;

    select * into relation_row from public.task_relations
    where id = nullif(supplied_resolution ->> 'relation_id', '')::uuid and active;
    if not found then
      update public.import_rows set status = 'conflict', error_message = '任务关系已失效，请重新预览',
        issues = issues || jsonb_build_array(jsonb_build_object('code','RELATION_STALE','field','任务分组','level','error','message','任务关系已失效，请重新预览'))
      where id = imported_row.id;
      conflict_count := conflict_count + 1;
      continue;
    end if;

    effective_date := coalesce(nullif(normalized ->> 'dispatchedAt', '')::date, current_date);
    for person_name in select jsonb_array_elements_text(coalesce(supplied_resolution -> 'participants', '[]'::jsonb)) loop
      select count(*) into person_match_count from public.resolve_person_name(person_name, effective_date);
      if person_match_count <> 1 then
        issue_message := case when person_match_count = 0 then '人员已失效或未匹配：' else '人员存在多个候选：' end || person_name;
        exit;
      end if;
      select * into person_record from public.resolve_person_name(person_name, effective_date) limit 1;
      if person_record.user_status <> 'active' or person_record.team_id is null then issue_message := '人员或历史小组已失效：' || person_name; exit; end if;
      if resolved_team_id is null then
        resolved_team_id := person_record.team_id; resolved_team_name := person_record.team_name;
      elsif resolved_team_id <> person_record.team_id then
        issue_message := '参与人跨组，不能自动提交'; exit;
      end if;
      if not (person_record.user_id = any(participant_user_ids)) then
        participant_user_ids := array_append(participant_user_ids, person_record.user_id);
        resolved_participant_names := array_append(resolved_participant_names, person_record.canonical_name);
        participant_leader_flags := array_append(participant_leader_flags, person_record.is_leader);
      end if;
      if person_record.canonical_name = supplied_resolution ->> 'primary_assignee' and not person_record.is_leader then
        primary_user_id := person_record.user_id; primary_name := person_record.canonical_name;
      end if;
    end loop;

    if issue_message is not null or resolved_team_id is null then
      update public.import_rows set status = 'conflict', error_message = coalesce(issue_message, '未解析到小组'),
        issues = issues || jsonb_build_array(jsonb_build_object('code','PEOPLE_STALE','field','对应验收同学','level','error','message',coalesce(issue_message, '未解析到小组')))
      where id = imported_row.id;
      conflict_count := conflict_count + 1;
      continue;
    end if;
    if public.has_app_role('leader') and not public.has_app_role('admin')
      and resolved_team_id not in (select public.current_leader_team_ids()) then
      update public.import_rows set status = 'conflict', error_message = '组长只能提交本组任务'
      where id = imported_row.id;
      conflict_count := conflict_count + 1;
      continue;
    end if;

    dedupe_key := coalesce(nullif(normalized ->> 'externalTaskId', ''), encode(extensions.digest(
      public.normalize_lookup_text(normalized ->> 'name') || '|' || coalesce(normalized ->> 'dispatchedAt', '') || '|' || relation_row.id::text,
      'sha256'), 'hex'));
    perform pg_advisory_xact_lock(hashtextextended('task-import:' || dedupe_key, 0));
    select * into existing_task from public.tasks where source_type = 'excel' and (
      (nullif(normalized ->> 'externalTaskId', '') is not null and external_task_id = normalized ->> 'externalTaskId')
      or source_dedupe_key = dedupe_key
    ) order by created_at limit 1 for update;

    mapping_state := case
      when primary_user_id is null or nullif(normalized ->> 'expectedDeadline', '') is null
        or nullif(normalized ->> 'difficulty', '') is null then 'needs_completion'
      else 'complete' end;

    if existing_task.id is null then
      insert into public.tasks(
        name, ownership, relation_id, task_group, work_nature, task_type,
        assignee, assignee_user_id, participant_names, team, team_id, team_leader,
        data_volume, workforce, dispatched_at, expected_deadline, deadline,
        status, mapping_status, platform_task_id, difficulty, source_type, external_task_id,
        source_dedupe_key, source_updated_at, source_payload, source_version,
        imported_batch_id, created_by
      ) values (
        normalized ->> 'name', relation_row.ownership, relation_row.id, relation_row.linked_task,
        coalesce(nullif(normalized ->> 'workNature', ''), '首次交付'), '模型评测',
        coalesce(primary_name, ''), primary_user_id, resolved_participant_names, resolved_team_name, resolved_team_id,
        coalesce((select u.name from public.team_memberships tm join public.app_users u on u.id = tm.user_id
          where tm.team_id = resolved_team_id and tm.is_leader and tm.effective_from <= effective_date
            and (tm.effective_to is null or tm.effective_to >= effective_date) order by tm.effective_from desc limit 1), ''),
        coalesce(nullif(normalized ->> 'dataVolume', '')::integer, 0),
        coalesce(nullif(normalized ->> 'workforce', '')::integer, 0),
        nullif(normalized ->> 'dispatchedAt', '')::timestamptz,
        nullif(normalized ->> 'expectedDeadline', '')::timestamptz, null,
        case when mapping_state = 'complete' then '待开始' else '待完善' end, mapping_state,
        nullif(normalized ->> 'externalTaskId', ''), nullif(normalized ->> 'difficulty', '')::smallint, 'excel',
        nullif(normalized ->> 'externalTaskId', ''), dedupe_key, now(),
        coalesce(item -> 'raw_data', '{}'::jsonb), 'task-ledger-v2', batch.id, public.current_app_user_id()
      ) returning * into task_row;
      row_action := 'create'; created_count := created_count + 1;
    else
      if (public.task_field_is_manually_locked(existing_task.id, 'name')
          and to_jsonb(existing_task.name) is distinct from to_jsonb(normalized ->> 'name'))
        or (public.task_field_is_manually_locked(existing_task.id, 'relation_id')
          and to_jsonb(existing_task.relation_id) is distinct from to_jsonb(relation_row.id))
        or (public.task_field_is_manually_locked(existing_task.id, 'expected_deadline')
          and to_jsonb(existing_task.expected_deadline) is distinct from to_jsonb(nullif(normalized ->> 'expectedDeadline', '')::timestamptz))
        or (public.task_field_is_manually_locked(existing_task.id, 'data_volume')
          and to_jsonb(existing_task.data_volume) is distinct from to_jsonb(coalesce(nullif(normalized ->> 'dataVolume', '')::integer, existing_task.data_volume)))
        or (public.task_field_is_manually_locked(existing_task.id, 'difficulty')
          and to_jsonb(existing_task.difficulty) is distinct from to_jsonb(coalesce(nullif(normalized ->> 'difficulty', '')::smallint, existing_task.difficulty)))
      then
        update public.import_rows set status = 'conflict', error_message = '台账值与人工锁定字段冲突，未覆盖任务',
          issues = issues || jsonb_build_array(jsonb_build_object('code','MANUAL_LOCK_CONFLICT','field','任务字段','level','error','message','台账值与人工锁定字段冲突，未覆盖任务'))
        where id = imported_row.id;
        conflict_count := conflict_count + 1;
        continue;
      end if;
      perform set_config('app.allow_task_status_transition', 'on', true);
      update public.tasks set
        name = case when public.task_field_is_manually_locked(id, 'name') then name else normalized ->> 'name' end,
        relation_id = case when public.task_field_is_manually_locked(id, 'relation_id') then relation_id else relation_row.id end,
        ownership = case when public.task_field_is_manually_locked(id, 'relation_id') then ownership else relation_row.ownership end,
        task_group = case when public.task_field_is_manually_locked(id, 'relation_id') then task_group else relation_row.linked_task end,
        work_nature = case when public.task_field_is_manually_locked(id, 'work_nature') then work_nature else coalesce(nullif(normalized ->> 'workNature', ''), work_nature) end,
        data_volume = case when public.task_field_is_manually_locked(id, 'data_volume') then data_volume else coalesce(nullif(normalized ->> 'dataVolume', '')::integer, data_volume) end,
        workforce = case when public.task_field_is_manually_locked(id, 'workforce') then workforce else coalesce(nullif(normalized ->> 'workforce', '')::integer, workforce) end,
        dispatched_at = case when public.task_field_is_manually_locked(id, 'dispatched_at') then dispatched_at else coalesce(nullif(normalized ->> 'dispatchedAt', '')::timestamptz, dispatched_at) end,
        expected_deadline = case when public.task_field_is_manually_locked(id, 'expected_deadline') then expected_deadline else coalesce(nullif(normalized ->> 'expectedDeadline', '')::timestamptz, expected_deadline) end,
        difficulty = case when public.task_field_is_manually_locked(id, 'difficulty') then difficulty else coalesce(nullif(normalized ->> 'difficulty', '')::smallint, difficulty) end,
        assignee = case when public.task_field_is_manually_locked(id, 'participants') then assignee else coalesce(primary_name, '') end,
        assignee_user_id = case when public.task_field_is_manually_locked(id, 'participants') then assignee_user_id else primary_user_id end,
        participant_names = case when public.task_field_is_manually_locked(id, 'participants') then tasks.participant_names else resolved_participant_names end,
        team = case when public.task_field_is_manually_locked(id, 'participants') then team else resolved_team_name end,
        team_id = case when public.task_field_is_manually_locked(id, 'participants') then team_id else resolved_team_id end,
        team_leader = case when public.task_field_is_manually_locked(id, 'participants') then team_leader else coalesce((
          select u.name from public.team_memberships tm join public.app_users u on u.id = tm.user_id
          where tm.team_id = resolved_team_id and tm.is_leader and tm.effective_from <= effective_date
            and (tm.effective_to is null or tm.effective_to >= effective_date)
          order by tm.effective_from desc limit 1
        ), '') end,
        mapping_status = case when public.task_field_is_manually_locked(id, 'participants') then mapping_status else mapping_state end,
        status = case when status = '待完善' and mapping_state = 'complete' then '待开始' else status end,
        source_updated_at = now(), source_payload = coalesce(item -> 'raw_data', source_payload),
        imported_batch_id = batch.id, updated_at = now()
      where id = existing_task.id returning * into task_row;
      row_action := 'update'; updated_count := updated_count + 1;
    end if;

    if not public.task_field_is_manually_locked(task_row.id, 'participants') then
      update public.task_participants set responsibility = '协作人'
      where task_id = task_row.id and left_at is null and responsibility = '主负责人';
      update public.task_participants set left_at = now()
      where task_id = task_row.id and left_at is null and not (user_id = any(participant_user_ids));
      for participant_index in 1..coalesce(array_length(participant_user_ids, 1), 0) loop
        insert into public.task_participants(
          task_id, user_id, responsibility, joined_at, left_at, created_by, source_type, source_ref,
          team_id_snapshot, team_name_snapshot, user_name_snapshot, is_leader_snapshot
        ) values (
          task_row.id, participant_user_ids[participant_index],
          case when participant_user_ids[participant_index] = primary_user_id then '主负责人' else '协作人' end,
          now(), null, public.current_app_user_id(), 'excel', imported_row.id::text,
          resolved_team_id, resolved_team_name, resolved_participant_names[participant_index], participant_leader_flags[participant_index]
        ) on conflict (task_id, user_id) do update set
          responsibility = excluded.responsibility, left_at = null, source_type = 'excel', source_ref = excluded.source_ref,
          team_id_snapshot = excluded.team_id_snapshot, team_name_snapshot = excluded.team_name_snapshot,
          user_name_snapshot = excluded.user_name_snapshot, is_leader_snapshot = excluded.is_leader_snapshot;
      end loop;
    end if;

    insert into public.task_field_provenance(task_id, field_name, source_type, source_ref, source_value, updated_by)
    select task_row.id, field_name, 'excel', imported_row.id::text, field_value, public.current_app_user_id()
    from jsonb_each(jsonb_build_object(
      'name', to_jsonb(normalized ->> 'name'), 'relation_id', to_jsonb(relation_row.id),
      'data_volume', normalized -> 'dataVolume', 'workforce', normalized -> 'workforce',
      'dispatched_at', normalized -> 'dispatchedAt', 'expected_deadline', normalized -> 'expectedDeadline', 'difficulty', normalized -> 'difficulty',
      'participants', to_jsonb(resolved_participant_names)
    )) as source(field_name, field_value)
    on conflict (task_id, field_name) do update set
      source_type = excluded.source_type, source_ref = excluded.source_ref,
      source_value = excluded.source_value, updated_by = excluded.updated_by
    where not public.task_field_provenance.manually_locked;

    insert into public.task_events(task_id, event_type, to_status, actor_id, actor_name, actor_role, detail, request_id, source_type)
    values (task_row.id, 'ledger_' || row_action, task_row.status, public.current_app_user_id(),
      coalesce(public.current_actor_name(), ''), public.current_actor_role_label(),
      jsonb_build_object('batch_id', batch.id, 'import_row_id', imported_row.id),
      effective_idempotency_key || ':' || imported_row.row_key, 'excel')
    on conflict (task_id, request_id, event_type) where request_id is not null do nothing;

    if mapping_state = 'needs_completion' then
      insert into public.todos(todo_type, title, description, task_id, assignee_team_id, assignee_role, priority, dedupe_key, detail, created_by)
      values ('task_completion', '完善任务字段：' || task_row.name,
        '请确认任务挂链、主负责人、预计截止时间和下发难度。', task_row.id,
        resolved_team_id, 'leader', 'high', 'task-completion:' || task_row.id,
        jsonb_build_object('batch_id', batch.id, 'missing_primary', primary_user_id is null,
          'missing_expected_deadline', task_row.expected_deadline is null, 'missing_difficulty', task_row.difficulty is null),
        public.current_app_user_id())
      on conflict (dedupe_key) where status = 'open' do update set detail = excluded.detail, updated_at = now();
    else
      update public.todos set status = 'completed', completed_by = public.current_app_user_id(), completed_at = now()
      where task_id = task_row.id and todo_type = 'task_completion' and status = 'open';
    end if;

    update public.import_rows set status = case row_action when 'create' then 'created' else 'updated' end,
      action = row_action, task_id = task_row.id, resolved_at = now(), resolved_by = public.current_app_user_id(), error_message = null
    where id = imported_row.id;
    if mapping_state = 'needs_completion' then completion_count := completion_count + 1;
    else ready_count := ready_count + 1; end if;
  end loop;

  update public.import_batches set
    status = case when error_count + conflict_count > 0 and created_count + updated_count > 0 then 'partial'
      when error_count + conflict_count > 0 then 'failed' else 'succeeded' end,
    committed_rows = created_count + updated_count,
    ready_rows = ready_count,
    needs_completion_rows = completion_count,
    conflict_rows = conflict_count,
    error_rows = error_count,
    created_rows = created_count,
    updated_rows = updated_count,
    skipped_rows = skipped_count,
    committed_at = now(),
    error_summary = jsonb_build_object('conflict', conflict_count, 'error', error_count)
  where id = batch.id returning * into batch;

  insert into public.audit_logs(actor_id, actor_role, entity_type, entity_id, action, after_value, request_id)
  values (public.current_app_user_id(), public.current_actor_role_label(), 'import_batch', batch.id,
    'commit_task_ledger_v2', to_jsonb(batch), effective_idempotency_key);
  return batch;
exception when others then
  if batch.id is not null then
    update public.import_batches set status = 'failed', error_summary = jsonb_build_object('fatal', sqlerrm) where id = batch.id;
  end if;
  raise;
end;
$$;

revoke all on function public.task_field_is_manually_locked(uuid, text) from public;
revoke all on function public.commit_task_ledger_import_v2(text, jsonb, text, text, uuid) from public;
grant execute on function public.commit_task_ledger_import_v2(text, jsonb, text, text, uuid) to authenticated;
