-- 文档路线不可降级、驳回意见必填、普通组员只能为本人参与任务上传。

create or replace function public.guard_document_workflow()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  if tg_op = 'INSERT' then
    if public.has_app_role('member') and not public.has_app_role('leader') and not public.has_app_role('admin')
      and not exists(select 1 from public.task_participants tp where tp.task_id=new.task_id and tp.user_id=public.current_app_user_id() and tp.left_at is null)
    then raise exception 'MEMBER_CAN_ONLY_UPLOAD_TO_PARTICIPATING_TASK'; end if;
    if new.uploader_user_id is distinct from public.current_app_user_id() then raise exception 'DOCUMENT_UPLOADER_MUST_BE_CURRENT_ACTOR'; end if;
    return new;
  end if;
  if old.review_route='leader_then_admin' and new.review_route<>'leader_then_admin' then raise exception 'ADMIN_ROUTE_CANNOT_DOWNGRADE'; end if;
  if new.workflow_status='member_revision_required' and coalesce(trim(new.review_comment),'')='' then raise exception 'LEADER_REJECTION_COMMENT_REQUIRED'; end if;
  if new.workflow_status='leader_revision_required' and coalesce(trim(new.admin_review_comment),'')='' then raise exception 'ADMIN_REJECTION_COMMENT_REQUIRED'; end if;
  if new.workflow_status in ('pending_admin_review','completed_by_admin','leader_revision_required') and new.review_route<>'leader_then_admin' then raise exception 'ADMIN_WORKFLOW_REQUIRES_ADMIN_ROUTE'; end if;
  return new;
end;
$$;

drop trigger if exists documents_guard_workflow on public.documents;
create trigger documents_guard_workflow before insert or update of review_route,workflow_status,review_comment,admin_review_comment
on public.documents for each row execute function public.guard_document_workflow();
