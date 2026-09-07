-- 文档返修跨版本待办闭环：关闭同一根文档旧待办，并为管理员保留返修跟进。

create or replace function public.sync_document_workflow_todo()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  task_row public.tasks;
  root_id uuid := coalesce(new.root_document_id, new.id);
  target_user uuid;
  todo_role text;
  todo_type_value text;
  todo_title text;
begin
  select * into task_row from public.tasks where id = new.task_id;

  update public.todos set status = 'completed', completed_at = now(), completed_by = public.current_app_user_id()
  where status = 'open' and document_id in (
    select d.id from public.documents d where coalesce(d.root_document_id, d.id) = root_id
  );

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
    'document:' || root_id || ':' || new.workflow_status,
    jsonb_build_object('workflow_status', new.workflow_status, 'version', new.version,
      'leader_rejections', new.leader_rejection_count, 'admin_rejections', new.admin_revision_count,
      'root_document_id', root_id),
    public.current_app_user_id())
  on conflict (dedupe_key) where status = 'open' do update set document_id = excluded.document_id,
    description = excluded.description, detail = excluded.detail, priority = excluded.priority, updated_at = now();

  if new.review_route = 'leader_then_admin'
     and new.workflow_status in ('leader_revision_required', 'member_revision_required', 'pending_leader_review') then
    insert into public.todos(todo_type, title, description, task_id, document_id,
      assignee_role, priority, dedupe_key, detail, created_by)
    values ('deliverable_revision_tracking', '返修跟进：' || new.name,
      coalesce(new.admin_review_comment, new.review_comment, '该交付物正在返修链路中。'),
      new.task_id, new.id, 'admin', 'normal',
      'document-tracking:' || root_id || ':' || new.workflow_status,
      jsonb_build_object('workflow_status', new.workflow_status, 'version', new.version,
        'admin_rejections', new.admin_revision_count, 'root_document_id', root_id),
      public.current_app_user_id())
    on conflict (dedupe_key) where status = 'open' do update set document_id = excluded.document_id,
      description = excluded.description, detail = excluded.detail, updated_at = now();
  end if;
  return new;
end;
$$;

