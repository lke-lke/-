-- 台账全链路：统一五阶段任务状态及受控流转。

alter table public.tasks drop constraint if exists tasks_status_check;

update public.tasks set status = case status
  when '数据完成' then '待确认'
  when '待交付' then '待确认'
  when '待验收' then '待确认'
  else status
end;

alter table public.tasks add constraint tasks_status_check
  check (status in ('待完善', '待开始', '进行中', '待确认', '已完成'));

update public.tasks set completed_at = coalesce(completed_at, settled_at, updated_at)
where status = '已完成' and completed_at is null;

insert into public.task_events(task_id, event_type, to_status, actor_name, actor_role, reason, source_type, created_at)
select id, 'status_history_initialized', status, '系统', 'system', '五阶段状态迁移初始化', 'system', updated_at
from public.tasks;

create or replace function public.transition_task_status(
  p_task_id uuid,
  p_to_status text,
  p_reason text default null,
  p_expected_version bigint default null,
  p_request_id text default null
)
returns public.tasks language plpgsql security definer set search_path = public, auth as $$
declare
  current_task public.tasks;
  result_task public.tasks;
  old_status text;
  allowed boolean := false;
begin
  select * into current_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  if not (public.has_app_role('admin') or public.can_lead_task(p_task_id)) then raise exception 'TASK_TRANSITION_FORBIDDEN'; end if;
  if p_expected_version is not null and current_task.row_version <> p_expected_version then raise exception 'TASK_VERSION_CONFLICT'; end if;
  if p_to_status not in ('待完善', '待开始', '进行中', '待确认', '已完成') then raise exception 'INVALID_TASK_STATUS'; end if;
  if current_task.status = p_to_status then return current_task; end if;
  old_status := current_task.status;
  allowed := case old_status
    when '待完善' then p_to_status = '待开始'
    when '待开始' then p_to_status in ('待完善', '进行中')
    when '进行中' then p_to_status in ('待开始', '待确认')
    when '待确认' then p_to_status in ('进行中', '已完成')
    when '已完成' then p_to_status = '待确认'
    else false end;
  if not allowed then raise exception 'ILLEGAL_TASK_STATUS_TRANSITION:%->%', old_status, p_to_status; end if;
  if old_status = '已完成' and coalesce(trim(p_reason), '') = '' then raise exception 'REOPEN_REASON_REQUIRED'; end if;
  if p_to_status = '待开始' and (
    current_task.mapping_status <> 'complete' or current_task.relation_id is null
    or current_task.team_id is null or current_task.assignee_user_id is null
    or current_task.expected_deadline is null or current_task.difficulty is null
  ) then raise exception 'TASK_REQUIRED_FIELDS_INCOMPLETE'; end if;
  if p_to_status = '已完成' and not exists (select 1 from public.task_settlements where task_id = p_task_id)
    then raise exception 'TASK_SETTLEMENT_REQUIRED'; end if;

  perform set_config('app.allow_task_status_transition', 'on', true);
  update public.tasks set status = p_to_status,
    completed_at = case when p_to_status = '已完成' then coalesce(completed_at, now()) else completed_at end,
    reopened_at = case when old_status = '已完成' then now() else reopened_at end,
    reopen_reason = case when old_status = '已完成' then p_reason else reopen_reason end,
    updated_at = now()
  where id = p_task_id returning * into result_task;

  insert into public.task_events(task_id, event_type, from_status, to_status, actor_id, actor_name, actor_role, reason, request_id, source_type)
  values (p_task_id, case when old_status = '已完成' then 'task_reopened' else 'status_changed' end,
    old_status, p_to_status, public.current_app_user_id(), coalesce(public.current_actor_name(), ''),
    public.current_actor_role_label(), p_reason, p_request_id, 'manual')
  on conflict (task_id, request_id, event_type) where request_id is not null do nothing;
  return result_task;
end;
$$;

revoke all on function public.transition_task_status(uuid, text, text, bigint, text) from public;
grant execute on function public.transition_task_status(uuid, text, text, bigint, text) to authenticated;
