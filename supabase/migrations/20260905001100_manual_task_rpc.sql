-- 手工建单复用与导入相同的关系、人员、来源、事件和待办契约。

create or replace function public.create_manual_task_v2(
  p_payload jsonb,
  p_request_id text default null
)
returns public.tasks
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  relation_row public.task_relations;
  result_task public.tasks;
  person_name text;
  person_row record;
  participant_ids uuid[] := '{}';
  participant_names text[] := '{}';
  resolved_team_id uuid;
  resolved_team_name text;
  primary_user_id uuid;
  person_match_count integer;
  primary_name text := nullif(p_payload ->> 'assignee', '');
begin
  if not (public.has_app_role('admin') or public.has_app_role('leader')) then raise exception 'MANUAL_TASK_FORBIDDEN'; end if;
  if nullif(trim(p_payload ->> 'name'), '') is null then raise exception 'TASK_NAME_REQUIRED'; end if;
  if nullif(p_payload ->> 'deadline', '') is not null then raise exception 'ACTUAL_DEADLINE_ONLY_ALLOWED_AT_SETTLEMENT'; end if;
  if nullif(p_payload ->> 'expectedDeadline', '') is null then raise exception 'EXPECTED_DEADLINE_REQUIRED'; end if;
  if coalesce((p_payload ->> 'difficulty')::integer, 0) not between 1 and 5 then raise exception 'DIFFICULTY_REQUIRED'; end if;
  select * into relation_row from public.task_relations where id = nullif(p_payload ->> 'relationId', '')::uuid and active;
  if not found then raise exception 'ACTIVE_TASK_RELATION_NOT_FOUND'; end if;

  for person_name in select value from jsonb_array_elements_text(coalesce(p_payload -> 'participantNames', '[]'::jsonb)) loop
    select count(*) into person_match_count from public.resolve_person_name(person_name, current_date);
    if person_match_count <> 1 then raise exception 'PARTICIPANT_AMBIGUOUS_OR_UNRESOLVED:%', person_name; end if;
    select * into person_row from public.resolve_person_name(person_name, current_date) limit 1;
    if person_row.user_status <> 'active' or person_row.team_id is null then
      raise exception 'PARTICIPANT_NOT_RESOLVED:%', person_name;
    end if;
    if resolved_team_id is null then resolved_team_id := person_row.team_id; resolved_team_name := person_row.team_name;
    elsif resolved_team_id <> person_row.team_id then raise exception 'PARTICIPANTS_CROSS_TEAM'; end if;
    if not (person_row.user_id = any(participant_ids)) then
      participant_ids := array_append(participant_ids, person_row.user_id);
      participant_names := array_append(participant_names, person_row.canonical_name);
    end if;
    if person_row.canonical_name = primary_name and not person_row.is_leader then primary_user_id := person_row.user_id; end if;
  end loop;
  if resolved_team_id is null or primary_user_id is null then raise exception 'PRIMARY_ASSIGNEE_MUST_BE_ACTIVE_PARTICIPANT'; end if;
  if public.has_app_role('leader') and not public.has_app_role('admin') and not public.is_local_demo_session()
    and resolved_team_id not in (select public.current_leader_team_ids()) then raise exception 'LEADER_CAN_ONLY_CREATE_OWN_TEAM_TASK'; end if;

  insert into public.tasks(
    name, ownership, relation_id, task_group, work_nature, task_type, assignee,
    assignee_user_id, participant_names, team, team_id, team_leader, data_reporter,
    reviewer, data_volume, workforce, dispatched_at, expected_deadline, status,
    mapping_status, platform_task_id, rule_doc_link, difficulty, remark, source_type,
    source_payload, source_version, created_by
  ) values (
    p_payload ->> 'name', relation_row.ownership, relation_row.id, relation_row.linked_task,
    coalesce(nullif(p_payload ->> 'workNature', ''), '首次交付'),
    coalesce(nullif(p_payload ->> 'taskType', ''), '模型评测'), primary_name,
    primary_user_id, participant_names, resolved_team_name, resolved_team_id,
    coalesce((select u.name from public.team_memberships tm join public.app_users u on u.id = tm.user_id
      where tm.team_id = resolved_team_id and tm.is_leader and tm.effective_from <= current_date
        and (tm.effective_to is null or tm.effective_to >= current_date) limit 1), ''),
    '', '', coalesce((p_payload ->> 'dataVolume')::integer, 0), coalesce((p_payload ->> 'workforce')::integer, 0),
    coalesce(nullif(p_payload ->> 'dispatchedAt', '')::timestamptz, now()),
    (p_payload ->> 'expectedDeadline')::timestamptz, '待开始', 'complete',
    nullif(p_payload ->> 'platformTaskId', ''), null,
    (p_payload ->> 'difficulty')::smallint, nullif(p_payload ->> 'remark', ''), 'manual',
    '{}'::jsonb, 'manual-v2', public.current_app_user_id()
  ) returning * into result_task;

  for person_name in select unnest(participant_names) loop
    select * into person_row from public.resolve_person_name(person_name, current_date);
    insert into public.task_participants(task_id, user_id, responsibility, created_by, source_type,
      team_id_snapshot, team_name_snapshot, user_name_snapshot, is_leader_snapshot)
    values (result_task.id, person_row.user_id, case when person_row.user_id = primary_user_id then '主负责人' else '协作人' end,
      public.current_app_user_id(), 'manual', resolved_team_id, resolved_team_name, person_row.canonical_name, person_row.is_leader);
    insert into public.todos(todo_type, title, description, task_id, assignee_user_id, assignee_role, dedupe_key, created_by)
    values ('task_assigned', '你已加入任务：' || result_task.name, '请查看任务要求和预计截止时间。', result_task.id,
      person_row.user_id, 'member', 'task-assigned:' || result_task.id || ':' || person_row.user_id, public.current_app_user_id())
    on conflict (dedupe_key) where status = 'open' do nothing;
  end loop;

  insert into public.task_field_provenance(task_id, field_name, source_type, source_ref, source_value,
    manually_locked, locked_by, locked_at, updated_by)
  select result_task.id, field.key, 'manual', p_request_id, field.value, true,
    public.current_app_user_id(), now(), public.current_app_user_id()
  from jsonb_each(jsonb_build_object(
    'name', to_jsonb(result_task.name), 'relation_id', to_jsonb(result_task.relation_id),
    'participants', to_jsonb(participant_names), 'expected_deadline', to_jsonb(result_task.expected_deadline),
    'data_volume', to_jsonb(result_task.data_volume), 'difficulty', to_jsonb(result_task.difficulty)
  )) field;
  insert into public.task_events(task_id, event_type, to_status, actor_id, actor_name, actor_role, detail, request_id)
  values (result_task.id, 'manual_created', result_task.status, public.current_app_user_id(), public.current_actor_name(),
    public.current_actor_role_label(), jsonb_build_object('task', to_jsonb(result_task)), p_request_id);
  insert into public.audit_logs(actor_id, actor_role, entity_type, entity_id, action, after_value, request_id)
  values (public.current_app_user_id(), public.current_actor_role_label(), 'task', result_task.id, 'create_manual_task_v2', to_jsonb(result_task), p_request_id);
  return result_task;
end;
$$;

revoke all on function public.create_manual_task_v2(jsonb, text) from public;
grant execute on function public.create_manual_task_v2(jsonb, text) to authenticated;
