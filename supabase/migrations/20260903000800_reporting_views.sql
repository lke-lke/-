-- 筝一小助理作业管理平台：前端看板和审核中心使用的只读视图

create view public.latest_documents
with (security_invoker = true)
as
select distinct on (coalesce(root_document_id, id)) d.*
from public.documents d
order by coalesce(root_document_id, id), version desc, uploaded_at desc;

create view public.document_review_queue
with (security_invoker = true)
as
select
  d.id,
  d.root_document_id,
  d.task_id,
  t.name as task_name,
  t.team,
  t.team_id,
  d.name as document_name,
  d.doc_type,
  d.uploader,
  d.version,
  d.workflow_status,
  d.review_route,
  d.leader_rejection_count,
  d.admin_revision_count,
  d.uploaded_at,
  d.submitted_to_admin_at,
  d.admin_review_comment
from public.latest_documents d
join public.tasks t on t.id = d.task_id
where d.workflow_status in (
  'pending_leader_review', 'member_revision_required',
  'pending_admin_review', 'leader_revision_required'
);

create view public.task_hierarchy_summary
with (security_invoker = true)
as
select
  ownership,
  main_task_snapshot as main_task,
  linked_task_snapshot as task_group,
  team,
  count(*) as task_count,
  count(*) filter (where status = '待开始') as pending_count,
  count(*) filter (where status = '进行中') as in_progress_count,
  count(*) filter (where status = '待验收') as pending_review_count,
  count(*) filter (where status = '已完成') as completed_count,
  coalesce(sum(data_volume), 0) as data_volume,
  coalesce(avg(difficulty), 0) as average_difficulty
from public.tasks
group by ownership, main_task_snapshot, linked_task_snapshot, team;

create view public.task_current_progress
with (security_invoker = true)
as
select
  t.id as task_id,
  t.name as task_name,
  t.team,
  t.status,
  coalesce(p.total, t.data_volume) as total,
  coalesce(p.completed, round(t.data_volume * t.progress / 100.0)::integer) as completed,
  coalesce(p.percentage, t.progress) as percentage,
  p.synced_at
from public.tasks t
left join lateral (
  select ps.total, ps.completed, ps.percentage, ps.synced_at
  from public.progress_snapshots ps
  where ps.task_id = t.id
  order by ps.synced_at desc
  limit 1
) p on true;

grant select on public.latest_documents to authenticated;
grant select on public.document_review_queue to authenticated;
grant select on public.task_hierarchy_summary to authenticated;
grant select on public.task_current_progress to authenticated;
