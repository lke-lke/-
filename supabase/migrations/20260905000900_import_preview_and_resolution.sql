-- 权威导入预览与行级人工解决：正式任务只在 commit RPC 中产生。

create or replace function public.resolve_task_import_payload_v2(
  p_normalized jsonb,
  p_manual jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  relation_row public.task_relations;
  relation_count integer := 0;
  relation_match text := 'unmatched';
  input_name text;
  person_record record;
  person_match_count integer;
  people jsonb := '[]'::jsonb;
  participant_names text[] := '{}';
  participant_ids uuid[] := '{}';
  team_ids uuid[] := '{}';
  primary_name text := nullif(p_manual ->> 'primary_assignee', '');
  team_id uuid;
  team_name text;
  ordinary_count integer := 0;
  issues jsonb := '[]'::jsonb;
  effective_date date := coalesce(nullif(p_normalized ->> 'dispatchedAt', '')::date, current_date);
  existing_task_id uuid;
  row_action text := 'create';
  row_status text;
begin
  if nullif(p_manual ->> 'relation_id', '') is not null then
    select * into relation_row from public.task_relations
    where id = (p_manual ->> 'relation_id')::uuid and active;
    relation_match := case when found then 'manual' else 'unmatched' end;
  else
    select count(*) into relation_count from public.resolve_task_relation_name(p_normalized ->> 'ownership', p_normalized ->> 'taskGroup');
    if relation_count = 1 then
      select tr.* into relation_row
      from public.resolve_task_relation_name(p_normalized ->> 'ownership', p_normalized ->> 'taskGroup') rr
      join public.task_relations tr on tr.id = rr.relation_id limit 1;
      relation_match := 'exact';
    elsif relation_count > 1 then
      relation_match := 'ambiguous';
    elsif coalesce(public.normalize_lookup_text(p_normalized ->> 'ownership'), '') = '' then
      select count(*) into relation_count from public.task_relations
      where active and public.normalize_lookup_text(linked_task) = public.normalize_lookup_text(p_normalized ->> 'taskGroup');
      if relation_count = 1 then
        select * into relation_row from public.task_relations
        where active and public.normalize_lookup_text(linked_task) = public.normalize_lookup_text(p_normalized ->> 'taskGroup') limit 1;
        relation_match := 'unique_inferred';
      elsif relation_count > 1 then
        relation_match := 'ambiguous';
      end if;
    end if;
  end if;

  if relation_row.id is null then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', case when relation_match = 'ambiguous' then 'RELATION_AMBIGUOUS' else 'RELATION_UNMATCHED' end,
      'field', '任务分组', 'level', 'error',
      'message', case when relation_match = 'ambiguous' then '任务分组存在多个候选，请人工选择' else '未匹配到有效任务关系；不会自动归入临时任务' end
    ));
  end if;

  for input_name in
    select value from jsonb_array_elements_text(
      case when jsonb_array_length(coalesce(p_manual -> 'participants', '[]'::jsonb)) > 0
        then p_manual -> 'participants' else coalesce(p_normalized -> 'acceptancePeople', '[]'::jsonb) end
    )
  loop
    select count(*) into person_match_count from public.resolve_person_name(input_name, effective_date);
    if person_match_count <> 1 then
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', case when person_match_count = 0 then 'PERSON_UNMATCHED' else 'PERSON_AMBIGUOUS' end,
        'field', '对应验收同学', 'level', 'error',
        'message', case when person_match_count = 0 then '未识别人员：' else '人员姓名存在多个候选：' end || input_name
      ));
      continue;
    end if;
    select * into person_record from public.resolve_person_name(input_name, effective_date) limit 1;
    if person_record.user_status <> 'active' or person_record.team_id is null then
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'PERSON_INACTIVE_OR_NO_TEAM', 'field', '对应验收同学', 'level', 'error', 'message', '人员已停用或无有效小组：' || input_name
      ));
      continue;
    end if;
    if not (person_record.user_id = any(participant_ids)) then
      participant_ids := array_append(participant_ids, person_record.user_id);
      participant_names := array_append(participant_names, person_record.canonical_name);
      team_ids := array_append(team_ids, person_record.team_id);
      people := people || jsonb_build_array(jsonb_build_object(
        'source', input_name, 'canonical', person_record.canonical_name,
        'user_id', person_record.user_id, 'team_id', person_record.team_id,
        'team', person_record.team_name, 'is_leader', person_record.is_leader,
        'match', person_record.match_type, 'team_resolution', person_record.team_resolution
      ));
      if not person_record.is_leader then ordinary_count := ordinary_count + 1; end if;
    end if;
  end loop;

  select count(distinct value::text) into relation_count from unnest(team_ids) value;
  if relation_count = 1 then
    team_id := team_ids[1];
    select name into team_name from public.teams where id = team_id;
  elsif relation_count > 1 then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'CROSS_TEAM_PEOPLE', 'field', '对应验收同学', 'level', 'error', 'message', '验收同学跨组，请人工处理'
    ));
  else
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'TEAM_REQUIRED', 'field', '对应验收同学', 'level', 'error', 'message', '无法根据验收同学识别小组'
    ));
  end if;

  if primary_name is null and ordinary_count = 1 then
    select item ->> 'canonical' into primary_name
    from jsonb_array_elements(people) item where not coalesce((item ->> 'is_leader')::boolean, false) limit 1;
  end if;
  if primary_name is not null and not (primary_name = any(participant_names)) then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'PRIMARY_NOT_PARTICIPANT', 'field', '主负责人', 'level', 'error', 'message', '主负责人必须是当前参与人'
    ));
  elsif primary_name is not null and exists (
    select 1 from jsonb_array_elements(people) item where item ->> 'canonical' = primary_name and coalesce((item ->> 'is_leader')::boolean, false)
  ) then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'PRIMARY_MUST_BE_MEMBER', 'field', '主负责人', 'level', 'error', 'message', '组长只能用于识别小组，主负责人必须选择普通组员'
    ));
  elsif primary_name is null then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'PRIMARY_ASSIGNEE_REQUIRED', 'field', '主负责人', 'level', 'warning', 'message', '需组长确认主负责人'
    ));
  end if;
  if nullif(p_normalized ->> 'expectedDeadline', '') is null then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'EXPECTED_DEADLINE_REQUIRED', 'field', '预计截止时间', 'level', 'warning', 'message', '需组长补充预计截止时间'
    ));
  end if;
  if nullif(p_normalized ->> 'difficulty', '') is null then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'DIFFICULTY_REQUIRED', 'field', '下发难度', 'level', 'warning', 'message', '需组长填写下发难度'
    ));
  elsif (p_normalized ->> 'difficulty')::integer not between 1 and 5 then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'INVALID_DIFFICULTY', 'field', '下发难度', 'level', 'error', 'message', '难度星级必须是 1-5'
    ));
  end if;

  select id into existing_task_id from public.tasks where source_type = 'excel' and (
    (nullif(p_normalized ->> 'externalTaskId', '') is not null and external_task_id = p_normalized ->> 'externalTaskId')
    or source_dedupe_key = encode(extensions.digest(
      public.normalize_lookup_text(p_normalized ->> 'name') || '|' || coalesce(p_normalized ->> 'dispatchedAt', '') || '|' || coalesce(relation_row.id::text, ''), 'sha256'
    ), 'hex')
  ) order by created_at limit 1;
  if existing_task_id is not null then row_action := 'update'; end if;

  if exists (select 1 from jsonb_array_elements(issues) issue where issue ->> 'level' = 'error') then
    row_status := 'conflict';
  elsif jsonb_array_length(issues) > 0 then row_status := 'needs_completion';
  else row_status := 'ready'; end if;

  return jsonb_build_object(
    'status', row_status, 'issues', issues,
    'resolution', jsonb_build_object(
      'relation_id', relation_row.id, 'relation_match', relation_match,
      'ownership', relation_row.ownership, 'main_task', relation_row.main_task,
      'task_group', relation_row.linked_task, 'team_id', team_id, 'team', team_name,
      'participants', to_jsonb(participant_names), 'participant_ids', to_jsonb(participant_ids),
      'primary_assignee', primary_name, 'matched_people', people,
      'existing_task_id', existing_task_id, 'action', row_action
    )
  );
end;
$$;

create or replace function public.preview_task_ledger_import_v2(
  p_filename text,
  p_rows jsonb,
  p_source_hash text default null,
  p_source_version text default 'task-ledger-v2',
  p_request_id text default null,
  p_idempotency_key text default null
)
returns public.import_batches
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  batch public.import_batches;
  item jsonb;
  result jsonb;
  item_index integer := 0;
  ready_count integer := 0;
  completion_count integer := 0;
  conflict_count integer := 0;
  error_count integer := 0;
  effective_key text;
begin
  if not (public.has_app_role('admin') or public.has_app_role('leader')) then raise exception 'IMPORT_FORBIDDEN'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'IMPORT_ROWS_MUST_BE_ARRAY'; end if;
  effective_key := coalesce(nullif(p_idempotency_key, ''), encode(extensions.digest(coalesce(p_filename, '') || '|' || p_rows::text, 'sha256'), 'hex'));
  select * into batch from public.import_batches where source_system = 'excel-preview' and idempotency_key = effective_key;
  if found then return batch; end if;

  insert into public.import_batches(
    source_type, source_system, original_filename, status, total_rows, source_hash,
    source_version, request_id, idempotency_key, created_by
  ) values (
    'task_ledger', 'excel-preview', p_filename, 'previewing', jsonb_array_length(p_rows),
    p_source_hash, p_source_version, p_request_id, effective_key, public.current_app_user_id()
  ) returning * into batch;

  for item in select value from jsonb_array_elements(p_rows) loop
    item_index := item_index + 1;
    begin
      result := public.resolve_task_import_payload_v2(coalesce(item -> 'normalized_data', '{}'::jsonb));
      insert into public.import_rows(
        batch_id, row_key, source_sheet, source_row, raw_data, normalized_data,
        resolved_data, issues, status, action
      ) values (
        batch.id, coalesce(nullif(item ->> 'row_key', ''), '任务台账:' || item_index),
        coalesce(nullif(item ->> 'source_sheet', ''), '任务台账'),
        coalesce(nullif(item ->> 'source_row', '')::integer, item_index),
        coalesce(item -> 'raw_data', '{}'::jsonb), coalesce(item -> 'normalized_data', '{}'::jsonb),
        result -> 'resolution', result -> 'issues', result ->> 'status', result -> 'resolution' ->> 'action'
      );
      case result ->> 'status'
        when 'ready' then ready_count := ready_count + 1;
        when 'needs_completion' then completion_count := completion_count + 1;
        when 'conflict' then conflict_count := conflict_count + 1;
        else error_count := error_count + 1;
      end case;
    exception when others then
      insert into public.import_rows(batch_id, row_key, source_sheet, source_row, raw_data, normalized_data, issues, status, error_message)
      values (batch.id, coalesce(nullif(item ->> 'row_key', ''), '任务台账:' || item_index),
        coalesce(nullif(item ->> 'source_sheet', ''), '任务台账'), coalesce(nullif(item ->> 'source_row', '')::integer, item_index),
        coalesce(item -> 'raw_data', '{}'::jsonb), coalesce(item -> 'normalized_data', '{}'::jsonb),
        jsonb_build_array(jsonb_build_object('code','ROW_PREVIEW_ERROR','field','整行','level','error','message',sqlerrm)), 'error', sqlerrm);
      error_count := error_count + 1;
    end;
  end loop;

  update public.import_batches set status = 'previewed', ready_rows = ready_count,
    needs_completion_rows = completion_count, conflict_rows = conflict_count, error_rows = error_count
  where id = batch.id returning * into batch;
  return batch;
end;
$$;

create or replace function public.resolve_import_row_v2(
  p_import_row_id uuid,
  p_relation_id uuid,
  p_participant_names text[],
  p_primary_assignee text default null
)
returns public.import_rows
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target public.import_rows;
  result jsonb;
  manual jsonb;
begin
  if not (public.has_app_role('admin') or public.has_app_role('leader')) then raise exception 'IMPORT_RESOLVE_FORBIDDEN'; end if;
  select ir.* into target from public.import_rows ir join public.import_batches ib on ib.id = ir.batch_id
  where ir.id = p_import_row_id and ib.source_type = 'task_ledger' for update of ir;
  if not found then raise exception 'IMPORT_ROW_NOT_FOUND'; end if;
  manual := jsonb_build_object('relation_id', p_relation_id, 'participants', to_jsonb(coalesce(p_participant_names, '{}')), 'primary_assignee', p_primary_assignee);
  result := public.resolve_task_import_payload_v2(target.normalized_data, manual);
  if public.has_app_role('leader') and not public.has_app_role('admin')
    and nullif(result -> 'resolution' ->> 'team_id', '')::uuid not in (select public.current_leader_team_ids()) then
    raise exception 'LEADER_CANNOT_RESOLVE_OTHER_TEAM';
  end if;
  update public.import_rows set resolved_data = result -> 'resolution', issues = result -> 'issues',
    status = result ->> 'status', action = result -> 'resolution' ->> 'action',
    resolved_by = public.current_app_user_id(), resolved_at = now(), error_message = null
  where id = target.id returning * into target;
  return target;
end;
$$;

revoke all on function public.resolve_task_import_payload_v2(jsonb, jsonb) from public;
revoke all on function public.preview_task_ledger_import_v2(text, jsonb, text, text, text, text) from public;
revoke all on function public.resolve_import_row_v2(uuid, uuid, text[], text) from public;
grant execute on function public.preview_task_ledger_import_v2(text, jsonb, text, text, text, text) to authenticated;
grant execute on function public.resolve_import_row_v2(uuid, uuid, text[], text) to authenticated;
