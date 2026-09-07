-- 组长完善任务：统一校验、人工锁、来源留痕、参与人和待办闭环。

create or replace function public.complete_task_setup(
  p_task_id uuid, p_relation_id uuid, p_primary_assignee text,
  p_expected_deadline timestamptz, p_data_volume integer, p_difficulty smallint,
  p_request_id text default null, p_expected_version bigint default null
)
returns public.tasks language plpgsql security definer set search_path = public, auth as $$
declare
  current_task public.tasks;
  result_task public.tasks;
  relation_row public.task_relations;
  person_row record;
  person_match_count integer;
  old_values jsonb;
begin
  select * into current_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  if not (public.has_app_role('admin') or public.can_lead_task(p_task_id)) then raise exception 'TASK_SETUP_FORBIDDEN'; end if;
  if p_expected_version is not null and current_task.row_version <> p_expected_version then raise exception 'TASK_VERSION_CONFLICT'; end if;
  if p_expected_deadline is null then raise exception 'EXPECTED_DEADLINE_REQUIRED'; end if;
  if p_difficulty is null or p_difficulty not between 1 and 5 then raise exception 'INVALID_DIFFICULTY'; end if;
  if p_data_volume is null or p_data_volume < 0 then raise exception 'INVALID_DATA_VOLUME'; end if;
  select * into relation_row from public.task_relations where id = p_relation_id and active;
  if not found then raise exception 'ACTIVE_TASK_RELATION_NOT_FOUND'; end if;
  select count(*) into person_match_count from public.resolve_person_name(p_primary_assignee, coalesce(current_task.dispatched_at::date, current_date));
  if person_match_count <> 1 then raise exception 'PRIMARY_ASSIGNEE_AMBIGUOUS_OR_NOT_FOUND'; end if;
  select * into person_row from public.resolve_person_name(p_primary_assignee, coalesce(current_task.dispatched_at::date, current_date)) limit 1;
  if person_row.user_status <> 'active' or person_row.is_leader then raise exception 'PRIMARY_ASSIGNEE_MUST_BE_ACTIVE_MEMBER'; end if;
  if current_task.team_id is not null and person_row.team_id <> current_task.team_id then raise exception 'PRIMARY_ASSIGNEE_TEAM_MISMATCH'; end if;

  old_values := jsonb_build_object('relation_id', current_task.relation_id, 'primary_assignee', current_task.assignee,
    'expected_deadline', current_task.expected_deadline, 'data_volume', current_task.data_volume,
    'difficulty', current_task.difficulty, 'status', current_task.status);
  perform set_config('app.allow_task_status_transition', 'on', true);
  update public.tasks set relation_id = relation_row.id,
    ownership = relation_row.ownership, task_group = relation_row.linked_task,
    assignee = person_row.canonical_name, assignee_user_id = person_row.user_id,
    team = person_row.team_name, team_id = person_row.team_id,
    participant_names = case when person_row.canonical_name = any(participant_names) then participant_names else array_append(participant_names, person_row.canonical_name) end,
    expected_deadline = p_expected_deadline, data_volume = p_data_volume, difficulty = p_difficulty,
    mapping_status = 'complete', status = case when status = '待完善' then '待开始' else status end,
    updated_at = now()
  where id = p_task_id returning * into result_task;

  update public.task_participants set responsibility = '协作人'
  where task_id = p_task_id and left_at is null and responsibility = '主负责人';
  insert into public.task_participants(task_id, user_id, responsibility, joined_at, left_at, created_by, source_type, source_ref,
    team_id_snapshot, team_name_snapshot, user_name_snapshot, is_leader_snapshot)
  values (p_task_id, person_row.user_id, '主负责人', now(), null, public.current_app_user_id(), 'manual', p_request_id,
    person_row.team_id, person_row.team_name, person_row.canonical_name, person_row.is_leader)
  on conflict (task_id, user_id) do update set responsibility = '主负责人', left_at = null, source_type = 'manual', source_ref = excluded.source_ref;

  insert into public.task_field_provenance(task_id, field_name, source_type, source_ref, source_value,
    manually_locked, locked_by, locked_at, updated_by)
  select p_task_id, source.field_name, 'manual', p_request_id, source.field_value, true,
    public.current_app_user_id(), now(), public.current_app_user_id()
  from jsonb_each(jsonb_build_object('relation_id', to_jsonb(p_relation_id), 'participants', to_jsonb(p_primary_assignee),
    'expected_deadline', to_jsonb(p_expected_deadline), 'data_volume', to_jsonb(p_data_volume), 'difficulty', to_jsonb(p_difficulty))) source(field_name, field_value)
  on conflict (task_id, field_name) do update set source_type = 'manual', source_ref = excluded.source_ref,
    source_value = excluded.source_value, manually_locked = true, locked_by = excluded.locked_by,
    locked_at = excluded.locked_at, updated_by = excluded.updated_by;

  insert into public.task_field_changes(task_id, field, before_value, after_value, changed_by, changed_by_user_id)
  select p_task_id, source.key, old_values -> source.key, source.value, coalesce(public.current_actor_name(), ''), public.current_app_user_id()
  from jsonb_each(jsonb_build_object('relation_id', to_jsonb(p_relation_id), 'primary_assignee', to_jsonb(p_primary_assignee),
    'expected_deadline', to_jsonb(p_expected_deadline), 'data_volume', to_jsonb(p_data_volume),
    'difficulty', to_jsonb(p_difficulty), 'status', to_jsonb(result_task.status))) source(key, value)
  where old_values -> source.key is distinct from source.value;

  update public.todos set status = 'completed', completed_by = public.current_app_user_id(), completed_at = now()
  where task_id = p_task_id and todo_type = 'task_completion' and status = 'open';
  insert into public.todos(todo_type, title, description, task_id, assignee_user_id, assignee_role, dedupe_key, created_by)
  values ('task_assigned', '你已加入任务：' || result_task.name, '任务已完成字段确认，请查看任务要求和预计截止时间。',
    p_task_id, person_row.user_id, 'member', 'task-assigned:' || p_task_id || ':' || person_row.user_id, public.current_app_user_id())
  on conflict (dedupe_key) where status = 'open' do nothing;

  insert into public.task_events(task_id, event_type, from_status, to_status, actor_id, actor_name, actor_role, reason, detail, request_id)
  values (p_task_id, 'task_setup_completed', current_task.status, result_task.status, public.current_app_user_id(),
    coalesce(public.current_actor_name(), ''), public.current_actor_role_label(), '组长完成任务字段确认',
    jsonb_build_object('before', old_values, 'after', to_jsonb(result_task)), p_request_id)
  on conflict (task_id, request_id, event_type) where request_id is not null do nothing;
  insert into public.audit_logs(actor_id, actor_role, entity_type, entity_id, action, before_value, after_value, request_id)
  values (public.current_app_user_id(), public.current_actor_role_label(), 'task', p_task_id,
    'complete_task_setup', old_values, to_jsonb(result_task), p_request_id);
  return result_task;
end;
$$;

revoke all on function public.complete_task_setup(uuid, uuid, text, timestamptz, integer, smallint, text, bigint) from public;
grant execute on function public.complete_task_setup(uuid, uuid, text, timestamptz, integer, smallint, text, bigint) to authenticated;
