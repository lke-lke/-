-- 交付物事件生成权威待办；结项由数据库统一校验全部门禁。

create table public.task_type_required_documents (
  task_type text not null,
  doc_type text not null,
  active boolean not null default true,
  primary key (task_type, doc_type)
);

insert into public.task_type_required_documents(task_type, doc_type) values
  ('数据集构建', '需求文档'), ('数据集构建', '数据导出文件'),
  ('数据收集标注', '规则文档'), ('数据收集标注', '数据导出文件'), ('数据收集标注', '质检结果'),
  ('评测规则制定', '规则文档'),
  ('模型评测', '规则文档'), ('模型评测', '评测报告'),
  ('全流程评测', '需求文档'), ('全流程评测', '规则文档'), ('全流程评测', '评测报告'),
  ('专项分析', '评测报告')
on conflict (task_type, doc_type) do update set active = true;

alter table public.task_type_required_documents enable row level security;
create policy authenticated_read_required_documents on public.task_type_required_documents
  for select to authenticated using (true);
grant select on public.task_type_required_documents to authenticated;

create or replace function public.sync_document_workflow_todo()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare
  task_row public.tasks;
  target_user uuid;
  todo_role text;
  todo_type_value text;
  todo_title text;
begin
  select * into task_row from public.tasks where id = new.task_id;
  update public.todos set status = 'completed', completed_at = now(), completed_by = public.current_app_user_id()
  where document_id = new.id and status = 'open';

  if new.workflow_status in ('completed_by_leader', 'completed_by_admin') then return new; end if;
  if new.workflow_status = 'pending_leader_review' then
    todo_role := 'leader'; todo_type_value := 'deliverable_pending_leader_review';
    todo_title := '确认交付物：' || new.name;
  elsif new.workflow_status = 'member_revision_required' then
    target_user := new.uploader_user_id; todo_role := 'member'; todo_type_value := 'deliverable_member_revision';
    todo_title := '返修交付物：' || new.name;
  elsif new.workflow_status = 'pending_admin_review' then
    todo_role := 'admin'; todo_type_value := 'deliverable_pending_admin_review';
    todo_title := '审核组长交付物：' || new.name;
  elsif new.workflow_status = 'leader_revision_required' then
    todo_role := 'leader'; todo_type_value := 'deliverable_leader_revision';
    todo_title := '处理返修交付物：' || new.name;
  else return new;
  end if;

  insert into public.todos(todo_type, title, description, task_id, document_id,
    assignee_user_id, assignee_team_id, assignee_role, priority, dedupe_key, detail, created_by)
  values (todo_type_value, todo_title,
    coalesce(new.admin_review_comment, new.review_comment, '请查看交付物并完成当前处理。'),
    new.task_id, new.id, target_user,
    case when todo_role = 'leader' then task_row.team_id else null end,
    todo_role, case when new.workflow_status in ('member_revision_required','leader_revision_required') then 'urgent' else 'high' end,
    'document:' || new.id || ':' || new.workflow_status,
    jsonb_build_object('workflow_status', new.workflow_status, 'version', new.version,
      'leader_rejections', new.leader_rejection_count, 'admin_rejections', new.admin_revision_count),
    public.current_app_user_id())
  on conflict (dedupe_key) where status = 'open' do update set description = excluded.description,
    detail = excluded.detail, priority = excluded.priority, updated_at = now();
  return new;
end;
$$;

drop trigger if exists documents_sync_workflow_todo on public.documents;
create trigger documents_sync_workflow_todo after insert or update of workflow_status, review_comment, admin_review_comment
on public.documents for each row execute function public.sync_document_workflow_todo();

create or replace function public.settle_task(
  p_task_id uuid,
  p_final_difficulty smallint,
  p_difficulty_reason text default null,
  p_summary text default null,
  p_workload_points numeric default null
)
returns public.task_settlements language plpgsql security definer set search_path = public, auth as $$
declare
  changed public.task_settlements;
  current_task public.tasks;
  missing_doc text;
  missing_member text;
  calculated_points numeric;
begin
  select * into current_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  if not public.can_lead_task(p_task_id) then raise exception 'TASK_SETTLEMENT_FORBIDDEN'; end if;
  if current_task.status <> '待确认' then raise exception 'TASK_NOT_READY_FOR_SETTLEMENT'; end if;
  if p_final_difficulty not between 1 and 5 then raise exception 'INVALID_DIFFICULTY'; end if;
  if p_final_difficulty is distinct from current_task.difficulty and coalesce(trim(p_difficulty_reason), '') = '' then
    raise exception 'DIFFICULTY_CHANGE_REASON_REQUIRED';
  end if;
  if coalesce(trim(p_summary), '') = '' then raise exception 'SETTLEMENT_SUMMARY_REQUIRED'; end if;

  with latest_documents as (
    select distinct on (coalesce(root_document_id, id)) * from public.documents
    where task_id = p_task_id order by coalesce(root_document_id, id), version desc, uploaded_at desc
  )
  select required.doc_type into missing_doc
  from public.task_type_required_documents required
  where required.task_type = current_task.task_type and required.active
    and not exists (
      select 1 from latest_documents document
      where document.doc_type = required.doc_type
        and document.workflow_status in ('completed_by_leader', 'completed_by_admin')
    ) limit 1;
  if missing_doc is not null then raise exception 'REQUIRED_DOCUMENT_NOT_APPROVED:%', missing_doc; end if;

  if exists (select 1 from public.documents where task_id = p_task_id
    and workflow_status in ('pending_leader_review','member_revision_required','pending_admin_review','leader_revision_required'))
    then raise exception 'OPEN_DOCUMENT_WORKFLOW_EXISTS'; end if;
  if exists (select 1 from public.rescan_records where original_task_id = p_task_id
    and (status not in ('accepted') or accepted is distinct from true))
    then raise exception 'OPEN_OR_UNACCEPTED_RESCAN_EXISTS'; end if;

  select tp.user_name_snapshot into missing_member
  from public.task_participants tp
  where tp.task_id = p_task_id and tp.left_at is null and not tp.is_leader_snapshot
    and not exists (select 1 from public.task_contributions contribution
      where contribution.task_id = p_task_id and contribution.member_user_id = tp.user_id and contribution.status = 'confirmed')
  limit 1;
  if missing_member is not null then raise exception 'PARTICIPANT_CONTRIBUTION_NOT_CONFIRMED:%', missing_member; end if;
  if not exists (select 1 from public.task_contributions where task_id = p_task_id and status = 'confirmed')
    then raise exception 'CONFIRMED_CONTRIBUTION_REQUIRED'; end if;

  calculated_points := coalesce(p_workload_points, case p_final_difficulty when 1 then 1 when 2 then 2 when 3 then 3 when 4 then 5 else 8 end);
  insert into public.difficulty_revisions(task_id, difficulty, phase, reason, confirmed_by, confirmed_by_user_id)
  values (p_task_id, p_final_difficulty, 'final', p_difficulty_reason, public.current_actor_name(), public.current_app_user_id());
  insert into public.task_settlements(task_id, confirmed_by, confirmed_by_user_id, final_difficulty,
    difficulty_reason, summary, workload_points)
  values (p_task_id, public.current_actor_name(), public.current_app_user_id(), p_final_difficulty,
    p_difficulty_reason, p_summary, calculated_points)
  on conflict (task_id) do update set confirmed_by = excluded.confirmed_by,
    confirmed_by_user_id = excluded.confirmed_by_user_id, confirmed_at = now(),
    final_difficulty = excluded.final_difficulty, difficulty_reason = excluded.difficulty_reason,
    summary = excluded.summary, workload_points = excluded.workload_points
  returning * into changed;

  perform set_config('app.allow_task_status_transition', 'on', true);
  update public.tasks set difficulty = p_final_difficulty, settled_at = now(), completed_at = now(),
    deadline = now(), settled_by = public.current_app_user_id(), status = '已完成', updated_at = now()
  where id = p_task_id;
  update public.todos set status = 'completed', completed_by = public.current_app_user_id(), completed_at = now()
  where task_id = p_task_id and status = 'open';
  insert into public.task_events(task_id, event_type, from_status, to_status, actor_id, actor_name, actor_role,
    reason, detail, source_type)
  values (p_task_id, 'settled', current_task.status, '已完成', public.current_app_user_id(),
    coalesce(public.current_actor_name(), ''), public.current_actor_role_label(), p_summary,
    jsonb_build_object('final_difficulty', p_final_difficulty, 'workload_points', calculated_points), 'manual');
  insert into public.audit_logs(actor_id, actor_role, entity_type, entity_id, action, before_value, after_value)
  values (public.current_app_user_id(), public.current_actor_role_label(), 'task', p_task_id, 'settle',
    to_jsonb(current_task), jsonb_build_object('settlement', to_jsonb(changed), 'status', '已完成'));
  return changed;
end;
$$;
