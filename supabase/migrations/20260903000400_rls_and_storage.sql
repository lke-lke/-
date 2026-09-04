-- 筝一小助理作业管理平台：RLS、API 权限与私有文件桶
-- 阅读范围暂不按角色隔离；写入严格按管理员/组长/本人职责隔离。

alter table public.teams enable row level security;
alter table public.app_users enable row level security;
alter table public.user_roles enable row level security;
alter table public.team_memberships enable row level security;
alter table public.import_batches enable row level security;
alter table public.task_relations enable row level security;
alter table public.tasks enable row level security;
alter table public.documents enable row level security;
alter table public.document_review_events enable row level security;
alter table public.progress_snapshots enable row level security;
alter table public.rule_change_records enable row level security;
alter table public.rescan_records enable row level security;
alter table public.alerts enable row level security;
alter table public.difficulty_revisions enable row level security;
alter table public.task_management_events enable row level security;
alter table public.task_contributions enable row level security;
alter table public.task_settlements enable row level security;
alter table public.import_rows enable row level security;
alter table public.task_match_queue enable row level security;
alter table public.task_field_changes enable row level security;
alter table public.audit_logs enable row level security;

create policy authenticated_read_teams on public.teams for select to authenticated using (true);
create policy authenticated_read_users on public.app_users for select to authenticated using (true);
create policy authenticated_read_roles on public.user_roles for select to authenticated using (true);
create policy authenticated_read_memberships on public.team_memberships for select to authenticated using (true);
create policy authenticated_read_batches on public.import_batches for select to authenticated using (true);
create policy authenticated_read_relations on public.task_relations for select to authenticated using (true);
create policy authenticated_read_tasks on public.tasks for select to authenticated using (true);
create policy authenticated_read_documents on public.documents for select to authenticated using (true);
create policy authenticated_read_review_events on public.document_review_events for select to authenticated using (true);
create policy authenticated_read_progress on public.progress_snapshots for select to authenticated using (true);
create policy authenticated_read_rule_changes on public.rule_change_records for select to authenticated using (true);
create policy authenticated_read_rescans on public.rescan_records for select to authenticated using (true);
create policy authenticated_read_alerts on public.alerts for select to authenticated using (true);
create policy authenticated_read_difficulty on public.difficulty_revisions for select to authenticated using (true);
create policy authenticated_read_management_events on public.task_management_events for select to authenticated using (true);
create policy authenticated_read_contributions on public.task_contributions for select to authenticated using (true);
create policy authenticated_read_settlements on public.task_settlements for select to authenticated using (true);
create policy authenticated_read_import_rows on public.import_rows for select to authenticated using (true);
create policy authenticated_read_match_queue on public.task_match_queue for select to authenticated using (true);
create policy authenticated_read_field_changes on public.task_field_changes for select to authenticated using (true);
create policy admin_read_audit_logs on public.audit_logs for select to authenticated using (public.has_app_role('admin'));

create policy admin_manage_teams on public.teams for all to authenticated
  using (public.has_app_role('admin')) with check (public.has_app_role('admin'));
create policy admin_manage_users on public.app_users for all to authenticated
  using (public.has_app_role('admin')) with check (public.has_app_role('admin'));
create policy admin_manage_roles on public.user_roles for all to authenticated
  using (public.has_app_role('admin')) with check (public.has_app_role('admin'));

create policy admin_manage_memberships on public.team_memberships for all to authenticated
  using (public.has_app_role('admin')) with check (public.has_app_role('admin'));
create policy leader_manage_own_team_memberships on public.team_memberships for all to authenticated
  using (
    public.has_app_role('leader') and team_id in (select public.current_leader_team_ids())
  )
  with check (
    public.has_app_role('leader') and team_id in (select public.current_leader_team_ids())
  );

create policy admin_write_tasks on public.tasks for all to authenticated
  using (public.has_app_role('admin')) with check (public.has_app_role('admin'));
create policy leader_insert_team_tasks on public.tasks for insert to authenticated
  with check (
    public.has_app_role('leader') and (
      team_id in (select public.current_leader_team_ids())
      or exists (select 1 from public.teams where id in (select public.current_leader_team_ids()) and name = team)
    )
  );
create policy leader_update_team_tasks on public.tasks for update to authenticated
  using (public.can_lead_task(id)) with check (public.can_lead_task(id));
create policy leader_delete_team_tasks on public.tasks for delete to authenticated
  using (public.can_lead_task(id));
create policy manager_write_relations on public.task_relations for all to authenticated
  using (public.has_app_role('admin') or public.has_app_role('leader'))
  with check (public.has_app_role('admin') or public.has_app_role('leader'));
create policy manager_write_import_batches on public.import_batches for all to authenticated
  using (public.has_app_role('admin') or public.has_app_role('leader'))
  with check (public.has_app_role('admin') or public.has_app_role('leader'));
create policy manager_write_import_rows on public.import_rows for all to authenticated
  using (public.has_app_role('admin') or public.has_app_role('leader'))
  with check (public.has_app_role('admin') or public.has_app_role('leader'));
create policy manager_write_match_queue on public.task_match_queue for all to authenticated
  using (public.has_app_role('admin') or public.has_app_role('leader'))
  with check (public.has_app_role('admin') or public.has_app_role('leader'));

-- 文档创建和状态变更只允许通过安全定义者 RPC；普通用户不能绕开版本与审核状态机。

create policy manager_write_rescans on public.rescan_records for all to authenticated
  using (public.has_app_role('admin') or public.has_app_role('leader'))
  with check (public.has_app_role('admin') or public.has_app_role('leader'));
create policy manager_write_rule_changes on public.rule_change_records for all to authenticated
  using (public.has_app_role('admin') or public.has_app_role('leader'))
  with check (public.has_app_role('admin') or public.has_app_role('leader'));
create policy manager_write_management_events on public.task_management_events for all to authenticated
  using (public.has_app_role('admin') or public.has_app_role('leader'))
  with check (public.has_app_role('admin') or public.has_app_role('leader'));
create policy manager_update_alerts on public.alerts for update to authenticated
  using (public.has_app_role('admin') or public.has_app_role('leader'))
  with check (public.has_app_role('admin') or public.has_app_role('leader'));

create policy member_insert_own_contribution on public.task_contributions for insert to authenticated
  with check (
    member_user_id = public.current_app_user_id()
    and attached_by_user_id = public.current_app_user_id()
    and status = 'pending'
  );
create policy member_update_own_pending_contribution on public.task_contributions for update to authenticated
  using (member_user_id = public.current_app_user_id() and status = 'pending')
  with check (member_user_id = public.current_app_user_id() and status in ('pending', 'removed'));
create policy member_delete_own_pending_contribution on public.task_contributions for delete to authenticated
  using (member_user_id = public.current_app_user_id() and status = 'pending');
create policy manager_write_contributions on public.task_contributions for all to authenticated
  using (public.has_app_role('admin') or public.has_app_role('leader'))
  with check (public.has_app_role('admin') or public.has_app_role('leader'));
create policy manager_write_difficulty on public.difficulty_revisions for all to authenticated
  using (public.has_app_role('admin') or public.has_app_role('leader'))
  with check (public.has_app_role('admin') or public.has_app_role('leader'));
create policy manager_write_settlements on public.task_settlements for all to authenticated
  using (public.has_app_role('admin') or public.has_app_role('leader'))
  with check (public.has_app_role('admin') or public.has_app_role('leader'));

-- 平台进度和系统预警由可信服务账号写入；前端登录用户只有读取权限。
-- 审核事件、字段变更和审计日志由触发器/RPC 写入，不开放直接写入策略。

grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.teams, public.app_users, public.user_roles, public.team_memberships to authenticated;
grant insert, update, delete on public.tasks, public.task_relations to authenticated;
grant insert, update, delete on public.rescan_records, public.rule_change_records, public.task_management_events to authenticated;
grant update on public.alerts to authenticated;
grant insert, update, delete on public.task_contributions, public.difficulty_revisions, public.task_settlements to authenticated;
grant insert, update, delete on public.import_batches, public.import_rows, public.task_match_queue to authenticated;

insert into storage.buckets(id, name, public, file_size_limit)
values
  ('deliverables', 'deliverables', false, 52428800),
  ('ledger-imports', 'ledger-imports', false, 52428800)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

create policy authenticated_read_private_files on storage.objects for select to authenticated
  using (bucket_id in ('deliverables', 'ledger-imports'));
create policy authenticated_upload_own_files on storage.objects for insert to authenticated
  with check (
    bucket_id in ('deliverables', 'ledger-imports')
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy owner_or_manager_update_files on storage.objects for update to authenticated
  using (
    bucket_id in ('deliverables', 'ledger-imports')
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.has_app_role('admin')
      or public.has_app_role('leader')
    )
  )
  with check (
    bucket_id in ('deliverables', 'ledger-imports')
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.has_app_role('admin')
      or public.has_app_role('leader')
    )
  );
create policy owner_or_manager_delete_files on storage.objects for delete to authenticated
  using (
    bucket_id in ('deliverables', 'ledger-imports')
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.has_app_role('admin')
      or public.has_app_role('leader')
    )
  );
