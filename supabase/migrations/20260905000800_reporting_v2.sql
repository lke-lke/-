-- 统一看板口径：状态时间点、结项工作量、人员贡献、导入与审核队列。

create or replace view public.task_hierarchy_summary with (security_invoker = true) as
select ownership, main_task_snapshot as main_task, linked_task_snapshot as task_group, team,
  count(*) as task_count,
  count(*) filter (where status in ('待完善','待开始')) as pending_count,
  count(*) filter (where status = '进行中') as in_progress_count,
  count(*) filter (where status = '待确认') as pending_review_count,
  count(*) filter (where status = '已完成') as completed_count,
  coalesce(sum(data_volume), 0) as data_volume, coalesce(avg(difficulty), 0) as average_difficulty
from public.tasks group by ownership, main_task_snapshot, linked_task_snapshot, team;

create or replace view public.task_current_state_view with (security_invoker = true) as
select t.*, coalesce(participants.people, '[]'::jsonb) as participants,
  coalesce(open_todos.count, 0) as open_todo_count
from public.tasks t
left join lateral (
  select jsonb_agg(jsonb_build_object('user_id', tp.user_id, 'name', tp.user_name_snapshot,
    'responsibility', tp.responsibility, 'team', tp.team_name_snapshot) order by tp.responsibility desc, tp.user_name_snapshot) as people
  from public.task_participants tp where tp.task_id = t.id and tp.left_at is null
) participants on true
left join lateral (select count(*) from public.todos where task_id = t.id and status = 'open') open_todos on true;

create or replace function public.task_state_at(p_at timestamptz)
returns table(task_id uuid, status text)
language sql stable security definer set search_path = public, auth as $$
  select t.id,
    coalesce((select e.to_status from public.task_events e where e.task_id = t.id
      and e.to_status is not null and e.created_at < p_at order by e.created_at desc limit 1),
      case when t.created_at < p_at then '待完善' end) as status
  from public.tasks t where t.created_at < p_at and public.can_view_task(t.id);
$$;

create or replace function public.team_task_status_summary(p_start timestamptz, p_end timestamptz)
returns table(team_id uuid, team text, total bigint, pending bigint, in_progress bigint, pending_confirmation bigint, completed bigint)
language sql stable security definer set search_path = public, auth as $$
  with state as (select * from public.task_state_at(p_end)), scoped as (
    select t.team_id, t.team, state.status from public.tasks t join state on state.task_id = t.id
    where coalesce(t.dispatched_at, t.created_at) < p_end
      and coalesce(t.completed_at, p_end) >= p_start
  )
  select scoped.team_id, scoped.team, count(*),
    count(*) filter (where status in ('待完善','待开始')),
    count(*) filter (where status = '进行中'),
    count(*) filter (where status = '待确认'),
    count(*) filter (where status = '已完成')
  from scoped group by scoped.team_id, scoped.team order by scoped.team;
$$;

create or replace function public.completed_workload_summary(p_start timestamptz, p_end timestamptz)
returns table(team_id uuid, team text, completed_tasks bigint, workload_points numeric)
language sql stable security definer set search_path = public, auth as $$
  select t.team_id, t.team, count(*), coalesce(sum(s.workload_points), 0)
  from public.task_settlements s join public.tasks t on t.id = s.task_id
  where s.confirmed_at >= p_start and s.confirmed_at < p_end and public.can_view_task(t.id)
  group by t.team_id, t.team order by t.team;
$$;

create or replace function public.member_work_summary(p_start timestamptz, p_end timestamptz, p_grain text default 'week')
returns table(period_start timestamptz, user_id uuid, member text, team text, confirmed_tags bigint, workload_points numeric)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if p_grain not in ('day','week','month') then raise exception 'INVALID_GRAIN'; end if;
  return query
  with member_tags as (
    select c.task_id, c.member_user_id, c.member, count(*) as tag_count
    from public.task_contributions c where c.status = 'confirmed'
    group by c.task_id, c.member_user_id, c.member
  ), contribution_members as (
    select task_id, count(*) as member_count from member_tags group by task_id
  )
  select date_trunc(p_grain, s.confirmed_at), member_tags.member_user_id, member_tags.member, t.team,
    sum(member_tags.tag_count)::bigint,
    coalesce(sum(s.workload_points / nullif(contribution_members.member_count, 0)), 0)
  from public.task_settlements s join public.tasks t on t.id = s.task_id
  join member_tags on member_tags.task_id = t.id
  join contribution_members on contribution_members.task_id = t.id
  where s.confirmed_at >= p_start and s.confirmed_at < p_end and public.can_view_task(t.id)
  group by date_trunc(p_grain, s.confirmed_at), member_tags.member_user_id, member_tags.member, t.team
  order by date_trunc(p_grain, s.confirmed_at), t.team, member_tags.member;
end;
$$;

create or replace view public.import_batch_summary with (security_invoker = true) as
select id, source_type, source_system, original_filename, status, total_rows, ready_rows,
  needs_completion_rows, conflict_rows, error_rows, created_rows, updated_rows, skipped_rows,
  created_by, created_at, committed_at, error_summary
from public.import_batches;

create or replace view public.document_review_queue with (security_invoker = true) as
select d.id, d.root_document_id, d.task_id, t.name as task_name, t.team, t.team_id,
  d.name as document_name, d.doc_type, d.uploader, d.uploader_user_id, d.version,
  d.workflow_status, d.review_route, d.leader_rejection_count, d.admin_revision_count,
  d.uploaded_at, d.submitted_to_admin_at, d.admin_review_comment, todo.id as todo_id,
  todo.assignee_user_id, todo.assignee_team_id, todo.assignee_role, todo.priority
from public.latest_documents d join public.tasks t on t.id = d.task_id
left join public.todos todo on todo.document_id = d.id and todo.status = 'open'
where d.workflow_status in ('pending_leader_review','member_revision_required','pending_admin_review','leader_revision_required');

grant select on public.task_current_state_view, public.import_batch_summary to authenticated;
revoke all on function public.task_state_at(timestamptz) from public;
revoke all on function public.team_task_status_summary(timestamptz, timestamptz) from public;
revoke all on function public.completed_workload_summary(timestamptz, timestamptz) from public;
revoke all on function public.member_work_summary(timestamptz, timestamptz, text) from public;
grant execute on function public.task_state_at(timestamptz) to authenticated;
grant execute on function public.team_task_status_summary(timestamptz, timestamptz) to authenticated;
grant execute on function public.completed_workload_summary(timestamptz, timestamptz) to authenticated;
grant execute on function public.member_work_summary(timestamptz, timestamptz, text) to authenticated;
