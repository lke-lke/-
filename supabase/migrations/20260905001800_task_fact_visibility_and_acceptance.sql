-- 将过程事实、结项事实和私有文件读取统一收口到任务可见范围。

drop policy if exists authenticated_read_progress on public.progress_snapshots;
create policy role_read_progress on public.progress_snapshots for select to authenticated
  using (public.can_view_task(task_id));

drop policy if exists authenticated_read_rule_changes on public.rule_change_records;
create policy role_read_rule_changes on public.rule_change_records for select to authenticated
  using (public.can_view_task(task_id));

drop policy if exists authenticated_read_alerts on public.alerts;
create policy role_read_alerts on public.alerts for select to authenticated
  using (public.can_view_task(task_id));

drop policy if exists authenticated_read_difficulty on public.difficulty_revisions;
create policy role_read_difficulty on public.difficulty_revisions for select to authenticated
  using (public.can_view_task(task_id));

drop policy if exists authenticated_read_management_events on public.task_management_events;
create policy role_read_management_events on public.task_management_events for select to authenticated
  using (public.can_view_task(task_id));

drop policy if exists authenticated_read_settlements on public.task_settlements;
create policy role_read_settlements on public.task_settlements for select to authenticated
  using (public.can_view_task(task_id));

drop policy if exists authenticated_read_field_changes on public.task_field_changes;
create policy role_read_field_changes on public.task_field_changes for select to authenticated
  using (public.can_view_task(task_id));

drop policy if exists authenticated_read_match_queue on public.task_match_queue;
create policy role_read_match_queue on public.task_match_queue for select to authenticated
  using (
    public.has_app_role('admin')
    or exists (
      select 1 from public.import_rows row
      join public.import_batches batch on batch.id = row.batch_id
      where row.id = import_row_id and batch.created_by = public.current_app_user_id()
    )
    or (candidate_task_id is not null and public.can_view_task(candidate_task_id))
  );

drop policy if exists manager_write_rescans on public.rescan_records;
create policy manager_write_scoped_rescans on public.rescan_records for all to authenticated
  using (public.has_app_role('admin') or public.can_lead_task(original_task_id))
  with check (public.has_app_role('admin') or public.can_lead_task(original_task_id));

drop policy if exists manager_write_rule_changes on public.rule_change_records;
create policy manager_write_scoped_rule_changes on public.rule_change_records for all to authenticated
  using (public.has_app_role('admin') or public.can_lead_task(task_id))
  with check (public.has_app_role('admin') or public.can_lead_task(task_id));

drop policy if exists manager_write_management_events on public.task_management_events;

drop policy if exists manager_update_alerts on public.alerts;
create policy manager_update_scoped_alerts on public.alerts for update to authenticated
  using (public.has_app_role('admin') or public.can_lead_task(task_id))
  with check (public.has_app_role('admin') or public.can_lead_task(task_id));

-- 贡献、最终难度和结项只允许受控 RPC 写入，防止绕开状态机与审核门禁。
drop policy if exists member_insert_own_contribution on public.task_contributions;
drop policy if exists member_update_own_pending_contribution on public.task_contributions;
drop policy if exists member_delete_own_pending_contribution on public.task_contributions;
drop policy if exists manager_write_contributions on public.task_contributions;
drop policy if exists manager_write_difficulty on public.difficulty_revisions;
drop policy if exists manager_write_settlements on public.task_settlements;
revoke insert, update, delete on public.task_contributions from authenticated;
revoke insert, update, delete on public.difficulty_revisions from authenticated;
revoke insert, update, delete on public.task_settlements from authenticated;

create or replace function public.register_task_management_event_v2(
  p_task_id uuid,
  p_event_type text,
  p_evidence_link text default null,
  p_detail jsonb default '{}'::jsonb
)
returns public.task_management_events
language plpgsql security definer set search_path = public, auth as $$
declare changed public.task_management_events;
begin
  if not (public.has_app_role('admin') or public.can_lead_task(p_task_id)) then
    raise exception 'TASK_EVENT_WRITE_FORBIDDEN';
  end if;
  if p_event_type not in ('training_completed','rule_change_published','rescan_initiated','rescan_closed',
      'data_acceptance_completed','evaluation_report_approved') then
    raise exception 'INVALID_TASK_EVENT_TYPE';
  end if;
  insert into public.task_management_events(task_id, event_type, actor_id, evidence_link, detail)
  values (p_task_id, p_event_type, public.current_app_user_id(), nullif(trim(p_evidence_link), ''), coalesce(p_detail, '{}'::jsonb))
  returning * into changed;
  insert into public.audit_logs(actor_id, actor_role, entity_type, entity_id, action, after_value)
  values (public.current_app_user_id(), public.current_actor_role_label(), 'task_management_event', changed.id,
    'register', to_jsonb(changed));
  return changed;
end;
$$;

revoke all on function public.register_task_management_event_v2(uuid, text, text, jsonb) from public;
grant execute on function public.register_task_management_event_v2(uuid, text, text, jsonb) to authenticated;

drop policy if exists authenticated_read_private_files on storage.objects;
create policy task_scoped_read_private_files on storage.objects for select to authenticated using (
  (bucket_id = 'ledger-imports' and (
    (storage.foldername(name))[1] = auth.uid()::text or public.has_app_role('admin')
  ))
  or (bucket_id = 'deliverables' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from public.documents d where d.storage_key = name and public.can_view_task(d.task_id))
  ))
);

-- 对象不可原地覆盖；修订必须创建新对象和新 document 版本。
drop policy if exists owner_or_manager_update_files on storage.objects;
