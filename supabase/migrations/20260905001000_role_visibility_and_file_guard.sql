-- 三角色读取边界与交付物物理删除保护。

create or replace function public.can_view_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.has_app_role('admin')
    or public.is_local_demo_session()
    or exists (
      select 1 from public.tasks t
      where t.id = p_task_id and (
        (public.has_app_role('leader') and t.team_id in (select public.current_leader_team_ids()))
        or (public.has_app_role('member') and (
          t.assignee_user_id = public.current_app_user_id()
          or exists (select 1 from public.task_participants tp where tp.task_id = t.id and tp.user_id = public.current_app_user_id() and tp.left_at is null)
        ))
      )
    );
$$;

drop policy if exists authenticated_read_tasks on public.tasks;
create policy role_read_tasks on public.tasks for select to authenticated using (public.can_view_task(id));

drop policy if exists authenticated_read_documents on public.documents;
create policy role_read_documents on public.documents for select to authenticated using (public.can_view_task(task_id));
drop policy if exists authenticated_read_review_events on public.document_review_events;
create policy role_read_review_events on public.document_review_events for select to authenticated using (public.can_view_task(task_id));
drop policy if exists authenticated_read_task_participants on public.task_participants;
create policy role_read_task_participants on public.task_participants for select to authenticated using (public.can_view_task(task_id));
drop policy if exists authenticated_read_task_field_provenance on public.task_field_provenance;
create policy role_read_task_field_provenance on public.task_field_provenance for select to authenticated using (public.can_view_task(task_id));
drop policy if exists authenticated_read_task_events on public.task_events;
create policy role_read_task_events on public.task_events for select to authenticated using (public.can_view_task(task_id));
drop policy if exists authenticated_read_rescans on public.rescan_records;
create policy role_read_rescans on public.rescan_records for select to authenticated using (public.can_view_task(original_task_id));
drop policy if exists authenticated_read_contributions on public.task_contributions;
create policy role_read_contributions on public.task_contributions for select to authenticated using (public.can_view_task(task_id));

drop policy if exists authenticated_read_todos on public.todos;
create policy role_read_todos on public.todos for select to authenticated using (
  public.has_app_role('admin') or public.is_local_demo_session()
  or assignee_user_id = public.current_app_user_id()
  or (public.has_app_role('leader') and assignee_team_id in (select public.current_leader_team_ids()))
  or (public.has_app_role('leader') and assignee_role = 'leader' and task_id is not null and public.can_view_task(task_id))
  or (public.has_app_role('member') and assignee_role = 'member' and task_id is not null and public.can_view_task(task_id))
);

drop policy if exists authenticated_read_batches on public.import_batches;
create policy role_read_batches on public.import_batches for select to authenticated using (
  public.has_app_role('admin') or public.is_local_demo_session() or created_by = public.current_app_user_id()
);
drop policy if exists authenticated_read_import_rows on public.import_rows;
create policy role_read_import_rows on public.import_rows for select to authenticated using (
  exists (select 1 from public.import_batches ib where ib.id = batch_id and (
    public.has_app_role('admin') or public.is_local_demo_session() or ib.created_by = public.current_app_user_id()
  ))
);

create or replace function public.can_delete_storage_object(p_bucket_id text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, auth, storage
as $$
  select case
    when p_bucket_id = 'ledger-imports' then
      (storage.foldername(p_name))[1] = auth.uid()::text or public.has_app_role('admin')
    when p_bucket_id = 'deliverables' then
      ((storage.foldername(p_name))[1] = auth.uid()::text or public.has_app_role('admin') or public.has_app_role('leader'))
      and not exists (
        select 1 from public.documents d
        where d.storage_key = p_name and (
          d.workflow_status in ('completed_by_leader', 'completed_by_admin')
          or exists (select 1 from public.task_settlements s where s.task_id = d.task_id)
          or exists (select 1 from public.task_contributions c where c.evidence_type = 'document' and c.evidence_id = d.id and c.status <> 'removed')
          or exists (select 1 from public.rule_change_records rc where rc.document_id = d.id)
        )
      )
    else false end;
$$;

drop policy if exists owner_or_manager_delete_files on storage.objects;
create policy guarded_delete_files on storage.objects for delete to authenticated
  using (public.can_delete_storage_object(bucket_id, name));

revoke all on function public.can_view_task(uuid) from public;
revoke all on function public.can_delete_storage_object(text, text) from public;
grant execute on function public.can_view_task(uuid) to authenticated;
grant execute on function public.can_delete_storage_object(text, text) to authenticated;
