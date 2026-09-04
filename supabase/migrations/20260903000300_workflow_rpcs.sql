-- 筝一小助理作业管理平台：原子化业务 RPC 与自动审计

create or replace function public.current_actor_name()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select name from public.app_users where id = public.current_app_user_id();
$$;

create or replace function public.current_actor_role_label()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select case
    when public.has_app_role('admin') then '管理员'
    when public.has_app_role('leader') then '组长'
    else '组员'
  end;
$$;

create or replace function public.can_lead_task(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.has_app_role('admin') or (
    public.has_app_role('leader') and exists (
      select 1
      from public.tasks t
      join public.team_memberships tm
        on tm.user_id = public.current_app_user_id()
       and tm.is_leader
       and tm.effective_from <= current_date
       and (tm.effective_to is null or tm.effective_to >= current_date)
      left join public.teams team on team.id = tm.team_id
      where t.id = target_task_id
        and (t.team_id = tm.team_id or (t.team_id is null and t.team = team.name))
    )
  );
$$;

create or replace function public.register_document_version(
  p_task_id uuid,
  p_doc_type text,
  p_name text,
  p_link text default null,
  p_storage_key text default null
)
returns public.documents
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_id uuid := public.current_app_user_id();
  actor_name text := public.current_actor_name();
  actor_role text := public.current_actor_role_label();
  prior public.documents;
  created public.documents;
  inherited_route text := 'undecided';
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'DOCUMENT_NAME_REQUIRED'; end if;
  if not exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and (
        public.has_app_role('admin')
        or public.can_lead_task(t.id)
        or t.assignee_user_id = actor_id
        or exists (
          select 1 from public.team_memberships tm
          where tm.user_id = actor_id
            and tm.team_id = t.team_id
            and tm.effective_from <= current_date
            and (tm.effective_to is null or tm.effective_to >= current_date)
        )
      )
  ) then raise exception 'TASK_UPLOAD_FORBIDDEN'; end if;

  select d.* into prior
  from public.documents d
  where d.task_id = p_task_id and d.doc_type = p_doc_type
  order by d.version desc, d.uploaded_at desc
  limit 1
  for update;

  if found and prior.review_route = 'leader_then_admin' then
    inherited_route := 'leader_then_admin';
  end if;

  insert into public.documents (
    task_id, doc_type, name, link, storage_key,
    uploader, uploader_user_id, version, replaced_document_id,
    review_route, workflow_status, leader_rejection_count,
    admin_revision_count, admin_review_status
  ) values (
    p_task_id, p_doc_type, trim(p_name), p_link, p_storage_key,
    actor_name, actor_id, coalesce(prior.version, 0) + 1, prior.id,
    inherited_route, 'pending_leader_review',
    coalesce(prior.leader_rejection_count, 0),
    coalesce(prior.admin_revision_count, 0), 'not_submitted'
  ) returning * into created;

  if prior.id is null then
    update public.documents set root_document_id = created.id where id = created.id returning * into created;
  else
    update public.documents set root_document_id = coalesce(prior.root_document_id, prior.id) where id = created.id returning * into created;
  end if;

  insert into public.document_review_events(
    document_id, root_document_id, task_id, actor, actor_user_id,
    actor_role, action, from_status, to_status, comment
  ) values (
    created.id, created.root_document_id, created.task_id, actor_name, actor_id,
    actor_role, 'member_submitted', prior.workflow_status, created.workflow_status,
    case when prior.id is null then '首次提交交付物' else format('提交 V%s 返修版本', created.version) end
  );

  return created;
end;
$$;

create or replace function public.leader_review_document(
  p_document_id uuid,
  p_action text,
  p_comment text default null
)
returns public.documents
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_id uuid := public.current_app_user_id();
  actor_name text := public.current_actor_name();
  current_doc public.documents;
  changed public.documents;
  event_action text;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_action not in ('reject_member', 'complete', 'submit_admin') then raise exception 'INVALID_LEADER_ACTION'; end if;

  select * into current_doc from public.documents where id = p_document_id for update;
  if not found then raise exception 'DOCUMENT_NOT_FOUND'; end if;
  if current_doc.workflow_status <> 'pending_leader_review' then raise exception 'DOCUMENT_STATE_CONFLICT'; end if;
  if not public.can_lead_task(current_doc.task_id) then raise exception 'LEADER_REVIEW_FORBIDDEN'; end if;
  if p_action = 'complete' and current_doc.review_route = 'leader_then_admin' then raise exception 'ADMIN_ROUTE_CANNOT_DOWNGRADE'; end if;

  if p_action = 'reject_member' then
    update public.documents set
      status = 'rejected', reviewed_by = actor_name, reviewed_by_user_id = actor_id,
      reviewed_at = now(), review_comment = p_comment,
      workflow_status = 'member_revision_required',
      leader_rejection_count = leader_rejection_count + 1
    where id = p_document_id returning * into changed;
    event_action := 'leader_rejected';
  elsif p_action = 'complete' then
    update public.documents set
      status = 'approved', reviewed_by = actor_name, reviewed_by_user_id = actor_id,
      reviewed_at = now(), review_comment = p_comment,
      review_route = 'leader_only', workflow_status = 'completed_by_leader',
      final_approval_level = 'leader', completed_by = actor_name,
      completed_by_user_id = actor_id, completed_at = now()
    where id = p_document_id returning * into changed;
    event_action := 'leader_completed';
  else
    update public.documents set
      status = 'approved', reviewed_by = actor_name, reviewed_by_user_id = actor_id,
      reviewed_at = now(), review_comment = p_comment,
      review_route = 'leader_then_admin', workflow_status = 'pending_admin_review',
      admin_review_status = 'pending', submitted_to_admin_at = now(),
      admin_reviewed_by = null, admin_reviewed_by_user_id = null,
      admin_reviewed_at = null, admin_review_comment = null
    where id = p_document_id returning * into changed;
    event_action := 'leader_submitted_admin';
  end if;

  insert into public.document_review_events(
    document_id, root_document_id, task_id, actor, actor_user_id,
    actor_role, action, from_status, to_status, comment
  ) values (
    changed.id, changed.root_document_id, changed.task_id, actor_name, actor_id,
    '组长', event_action, current_doc.workflow_status, changed.workflow_status, p_comment
  );
  return changed;
end;
$$;

create or replace function public.admin_review_document(
  p_document_id uuid,
  p_decision text,
  p_comment text default null
)
returns public.documents
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_id uuid := public.current_app_user_id();
  actor_name text := public.current_actor_name();
  current_doc public.documents;
  changed public.documents;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_app_role('admin') then raise exception 'ADMIN_REVIEW_FORBIDDEN'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'INVALID_ADMIN_DECISION'; end if;

  select * into current_doc from public.documents where id = p_document_id for update;
  if not found then raise exception 'DOCUMENT_NOT_FOUND'; end if;
  if current_doc.workflow_status <> 'pending_admin_review' or current_doc.review_route <> 'leader_then_admin'
    then raise exception 'DOCUMENT_STATE_CONFLICT'; end if;

  if p_decision = 'approved' then
    update public.documents set
      admin_review_status = 'approved', admin_reviewed_by = actor_name,
      admin_reviewed_by_user_id = actor_id, admin_reviewed_at = now(),
      admin_review_comment = p_comment, workflow_status = 'completed_by_admin',
      final_approval_level = 'admin', completed_by = actor_name,
      completed_by_user_id = actor_id, completed_at = now()
    where id = p_document_id returning * into changed;
  else
    update public.documents set
      admin_review_status = 'rejected', admin_reviewed_by = actor_name,
      admin_reviewed_by_user_id = actor_id, admin_reviewed_at = now(),
      admin_review_comment = p_comment, workflow_status = 'leader_revision_required',
      admin_revision_count = admin_revision_count + 1
    where id = p_document_id returning * into changed;
  end if;

  insert into public.document_review_events(
    document_id, root_document_id, task_id, actor, actor_user_id,
    actor_role, action, from_status, to_status, comment
  ) values (
    changed.id, changed.root_document_id, changed.task_id, actor_name, actor_id,
    '管理员', case when p_decision = 'approved' then 'admin_completed' else 'admin_rejected' end,
    current_doc.workflow_status, changed.workflow_status, p_comment
  );
  return changed;
end;
$$;

create or replace function public.leader_handle_admin_rejection(
  p_document_id uuid,
  p_action text,
  p_comment text default null
)
returns public.documents
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_id uuid := public.current_app_user_id();
  actor_name text := public.current_actor_name();
  current_doc public.documents;
  changed public.documents;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_action not in ('return_member', 'resubmit_admin') then raise exception 'INVALID_REVISION_ACTION'; end if;
  select * into current_doc from public.documents where id = p_document_id for update;
  if not found then raise exception 'DOCUMENT_NOT_FOUND'; end if;
  if current_doc.workflow_status <> 'leader_revision_required' or current_doc.review_route <> 'leader_then_admin'
    then raise exception 'DOCUMENT_STATE_CONFLICT'; end if;
  if not public.can_lead_task(current_doc.task_id) then raise exception 'LEADER_REVISION_FORBIDDEN'; end if;

  if p_action = 'return_member' then
    update public.documents set
      status = 'rejected', reviewed_by = actor_name, reviewed_by_user_id = actor_id,
      reviewed_at = now(), review_comment = coalesce(p_comment, admin_review_comment),
      workflow_status = 'member_revision_required'
    where id = p_document_id returning * into changed;
  else
    update public.documents set
      status = 'approved', reviewed_by = actor_name, reviewed_by_user_id = actor_id,
      reviewed_at = now(), review_comment = p_comment,
      admin_review_status = 'pending', submitted_to_admin_at = now(),
      admin_reviewed_by = null, admin_reviewed_by_user_id = null,
      admin_reviewed_at = null, admin_review_comment = null,
      workflow_status = 'pending_admin_review'
    where id = p_document_id returning * into changed;
  end if;

  insert into public.document_review_events(
    document_id, root_document_id, task_id, actor, actor_user_id,
    actor_role, action, from_status, to_status, comment
  ) values (
    changed.id, changed.root_document_id, changed.task_id, actor_name, actor_id,
    '组长', case when p_action = 'return_member' then 'leader_returned_member' else 'leader_resubmitted_admin' end,
    current_doc.workflow_status, changed.workflow_status, p_comment
  );
  return changed;
end;
$$;

create or replace function public.upsert_task_relation(
  p_ownership text,
  p_main_task text,
  p_linked_task text,
  p_id uuid default null
)
returns public.task_relations
language plpgsql
security definer
set search_path = public, auth
as $$
declare changed public.task_relations;
begin
  if public.current_app_user_id() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not (public.has_app_role('admin') or public.has_app_role('leader')) then raise exception 'RELATION_WRITE_FORBIDDEN'; end if;
  if nullif(trim(p_ownership), '') is null or nullif(trim(p_linked_task), '') is null then raise exception 'RELATION_FIELDS_REQUIRED'; end if;

  if p_id is not null then
    update public.task_relations set ownership = trim(p_ownership),
      main_task = coalesce(nullif(trim(p_main_task), ''), '临时任务'),
      linked_task = trim(p_linked_task), active = true,
      created_by = coalesce(created_by, public.current_app_user_id())
    where id = p_id returning * into changed;
  else
    insert into public.task_relations(ownership, main_task, linked_task, created_by)
    values (trim(p_ownership), coalesce(nullif(trim(p_main_task), ''), '临时任务'), trim(p_linked_task), public.current_app_user_id())
    on conflict (ownership, main_task, linked_task)
    do update set active = true, updated_at = now()
    returning * into changed;
  end if;
  if changed.id is null then raise exception 'RELATION_NOT_FOUND'; end if;
  return changed;
end;
$$;

create or replace function public.archive_task_relation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not (public.has_app_role('admin') or public.has_app_role('leader')) then raise exception 'RELATION_WRITE_FORBIDDEN'; end if;
  update public.task_relations set active = false where id = p_id;
end;
$$;

create or replace function public.confirm_task_contribution(p_id uuid)
returns public.task_contributions
language plpgsql
security definer
set search_path = public, auth
as $$
declare changed public.task_contributions;
begin
  if not (public.has_app_role('admin') or public.has_app_role('leader')) then raise exception 'CONTRIBUTION_CONFIRM_FORBIDDEN'; end if;
  update public.task_contributions set
    status = 'confirmed', confirmed_by = public.current_actor_name(),
    confirmed_by_user_id = public.current_app_user_id(), confirmed_at = now()
  where id = p_id returning * into changed;
  return changed;
end;
$$;

create or replace function public.settle_task(
  p_task_id uuid,
  p_final_difficulty smallint,
  p_difficulty_reason text default null,
  p_summary text default null,
  p_workload_points numeric default null
)
returns public.task_settlements
language plpgsql
security definer
set search_path = public, auth
as $$
declare changed public.task_settlements;
begin
  if not public.can_lead_task(p_task_id) then raise exception 'TASK_SETTLEMENT_FORBIDDEN'; end if;
  if p_final_difficulty not between 1 and 5 then raise exception 'INVALID_DIFFICULTY'; end if;

  insert into public.difficulty_revisions(task_id, difficulty, phase, reason, confirmed_by, confirmed_by_user_id)
  values (p_task_id, p_final_difficulty, 'final', p_difficulty_reason, public.current_actor_name(), public.current_app_user_id());

  insert into public.task_settlements(task_id, confirmed_by, confirmed_by_user_id, final_difficulty, difficulty_reason, summary, workload_points)
  values (p_task_id, public.current_actor_name(), public.current_app_user_id(), p_final_difficulty, p_difficulty_reason, p_summary, p_workload_points)
  on conflict (task_id) do update set
    confirmed_by = excluded.confirmed_by, confirmed_by_user_id = excluded.confirmed_by_user_id,
    confirmed_at = now(), final_difficulty = excluded.final_difficulty,
    difficulty_reason = excluded.difficulty_reason, summary = excluded.summary,
    workload_points = excluded.workload_points
  returning * into changed;

  update public.tasks set difficulty = p_final_difficulty, settled_at = now(),
    settled_by = public.current_app_user_id(), status = '已完成'
  where id = p_task_id;
  return changed;
end;
$$;

create or replace function public.audit_task_field_changes()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare field_name text;
declare tracked_fields text[] := array[
  'ownership', 'main_task_snapshot', 'linked_task_snapshot', 'name', 'status',
  'assignee', 'team', 'expected_deadline', 'deadline', 'data_volume', 'difficulty'
];
begin
  foreach field_name in array tracked_fields loop
    if (to_jsonb(old) -> field_name) is distinct from (to_jsonb(new) -> field_name) then
      insert into public.task_field_changes(task_id, field, before_value, after_value, changed_by, changed_by_user_id)
      values (
        new.id, field_name, to_jsonb(old) -> field_name, to_jsonb(new) -> field_name,
        coalesce(public.current_actor_name(), 'system'), public.current_app_user_id()
      );
    end if;
  end loop;
  return new;
end;
$$;

create trigger tasks_audit_field_changes
after update on public.tasks
for each row execute function public.audit_task_field_changes();

revoke all on function public.current_actor_name() from public;
revoke all on function public.current_actor_role_label() from public;
revoke all on function public.can_lead_task(uuid) from public;
revoke all on function public.register_document_version(uuid, text, text, text, text) from public;
revoke all on function public.leader_review_document(uuid, text, text) from public;
revoke all on function public.admin_review_document(uuid, text, text) from public;
revoke all on function public.leader_handle_admin_rejection(uuid, text, text) from public;
revoke all on function public.upsert_task_relation(text, text, text, uuid) from public;
revoke all on function public.archive_task_relation(uuid) from public;
revoke all on function public.confirm_task_contribution(uuid) from public;
revoke all on function public.settle_task(uuid, smallint, text, text, numeric) from public;

grant execute on function public.current_actor_name() to authenticated;
grant execute on function public.current_actor_role_label() to authenticated;
grant execute on function public.can_lead_task(uuid) to authenticated;
grant execute on function public.register_document_version(uuid, text, text, text, text) to authenticated;
grant execute on function public.leader_review_document(uuid, text, text) to authenticated;
grant execute on function public.admin_review_document(uuid, text, text) to authenticated;
grant execute on function public.leader_handle_admin_rejection(uuid, text, text) to authenticated;
grant execute on function public.upsert_task_relation(text, text, text, uuid) to authenticated;
grant execute on function public.archive_task_relation(uuid) to authenticated;
grant execute on function public.confirm_task_contribution(uuid) to authenticated;
grant execute on function public.settle_task(uuid, smallint, text, text, numeric) to authenticated;
