-- 业务借调/回扫台账：候选匹配、人工确认、幂等提交与原始行追溯。

alter table public.rescan_records
  add column if not exists import_row_id uuid references public.import_rows(id) on delete set null,
  add column if not exists support_hours numeric(10,2) check (support_hours is null or support_hours >= 0),
  add column if not exists source_result text,
  add column if not exists acceptance_detail text;
create unique index if not exists rescan_records_import_row_unique_idx on public.rescan_records(import_row_id) where import_row_id is not null;

create or replace function public.preview_rescan_ledger_import_v2(
  p_filename text, p_rows jsonb, p_source_hash text default null, p_idempotency_key text default null
)
returns public.import_batches
language plpgsql security definer set search_path = public, auth as $$
declare
  batch public.import_batches;
  item jsonb;
  imported_row public.import_rows;
  candidate public.tasks;
  candidate_count integer;
  item_index integer := 0;
  ready_count integer := 0;
  conflict_count integer := 0;
  effective_key text;
begin
  if not (public.has_app_role('admin') or public.has_app_role('leader')) then raise exception 'IMPORT_FORBIDDEN'; end if;
  effective_key := coalesce(nullif(p_idempotency_key, ''), encode(extensions.digest(coalesce(p_filename,'') || '|' || p_rows::text, 'sha256'), 'hex'));
  select * into batch from public.import_batches where source_system = 'rescan-preview' and idempotency_key = effective_key;
  if found then return batch; end if;
  insert into public.import_batches(source_type, source_system, original_filename, status, total_rows, source_hash, source_version, idempotency_key, created_by)
  values ('rescan_ledger', 'rescan-preview', p_filename, 'previewing', jsonb_array_length(p_rows), p_source_hash, 'rescan-ledger-v2', effective_key, public.current_app_user_id())
  returning * into batch;

  for item in select value from jsonb_array_elements(p_rows) loop
    item_index := item_index + 1;
    select count(*) into candidate_count from public.tasks t where
      (nullif(item -> 'normalized_data' ->> 'externalTaskId','') is not null and t.external_task_id = item -> 'normalized_data' ->> 'externalTaskId')
      or public.normalize_lookup_text(t.name) = public.normalize_lookup_text(item -> 'normalized_data' ->> 'taskName');
    insert into public.import_rows(batch_id, row_key, source_sheet, source_row, raw_data, normalized_data,
      resolved_data, issues, status, action)
    values (batch.id, coalesce(nullif(item ->> 'row_key',''), '回扫台账:' || item_index),
      coalesce(nullif(item ->> 'source_sheet',''), '业务借调明细'), coalesce(nullif(item ->> 'source_row','')::integer,item_index),
      coalesce(item -> 'raw_data','{}'::jsonb), coalesce(item -> 'normalized_data','{}'::jsonb),
      '{}'::jsonb,
      case when candidate_count = 1 then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
        'code', case when candidate_count = 0 then 'RESCAN_TASK_UNMATCHED' else 'RESCAN_TASK_AMBIGUOUS' end,
        'field','关联任务','level','error','message',case when candidate_count = 0 then '未找到任务候选，请人工选择' else '存在多个任务候选，请人工选择' end)) end,
      case when candidate_count = 1 then 'ready' else 'conflict' end, 'create') returning * into imported_row;
    for candidate in select t.* from public.tasks t where
      (nullif(item -> 'normalized_data' ->> 'externalTaskId','') is not null and t.external_task_id = item -> 'normalized_data' ->> 'externalTaskId')
      or public.normalize_lookup_text(t.name) = public.normalize_lookup_text(item -> 'normalized_data' ->> 'taskName')
    loop
      insert into public.task_match_queue(import_row_id, candidate_task_id, match_score, status)
      values (imported_row.id, candidate.id, case when candidate.external_task_id = item -> 'normalized_data' ->> 'externalTaskId' then 100 else 90 end,
        case when candidate_count = 1 then 'confirmed' else 'pending' end);
      if candidate_count = 1 then
        update public.import_rows set resolved_data = jsonb_build_object('task_id', candidate.id, 'task_name', candidate.name, 'team_id', candidate.team_id, 'team', candidate.team)
        where id = imported_row.id;
      end if;
    end loop;
    if candidate_count = 1 then ready_count := ready_count + 1; else conflict_count := conflict_count + 1; end if;
  end loop;
  update public.import_batches set status='previewed', ready_rows=ready_count, conflict_rows=conflict_count
  where id=batch.id returning * into batch;
  return batch;
end;
$$;

create or replace function public.resolve_rescan_import_row_v2(p_import_row_id uuid, p_task_id uuid)
returns public.import_rows
language plpgsql security definer set search_path = public, auth as $$
declare target public.import_rows; task_row public.tasks;
begin
  if not (public.has_app_role('admin') or public.has_app_role('leader')) then raise exception 'IMPORT_RESOLVE_FORBIDDEN'; end if;
  select * into target from public.import_rows where id=p_import_row_id for update;
  select * into task_row from public.tasks where id=p_task_id;
  if target.id is null or task_row.id is null then raise exception 'IMPORT_ROW_OR_TASK_NOT_FOUND'; end if;
  if public.has_app_role('leader') and not public.has_app_role('admin') and not public.is_local_demo_session()
    and task_row.team_id not in (select public.current_leader_team_ids()) then raise exception 'LEADER_CANNOT_MATCH_OTHER_TEAM'; end if;
  update public.task_match_queue set status=case when candidate_task_id=p_task_id then 'confirmed' else 'rejected' end,
    confirmed_by=public.current_app_user_id(), confirmed_at=now() where import_row_id=p_import_row_id;
  insert into public.task_match_queue(import_row_id,candidate_task_id,match_score,status,confirmed_by,confirmed_at)
  select p_import_row_id,p_task_id,100,'confirmed',public.current_app_user_id(),now()
  where not exists(select 1 from public.task_match_queue where import_row_id=p_import_row_id and candidate_task_id=p_task_id);
  update public.import_rows set resolved_data=jsonb_build_object('task_id',task_row.id,'task_name',task_row.name,'team_id',task_row.team_id,'team',task_row.team),
    issues='[]'::jsonb,status='ready',resolved_by=public.current_app_user_id(),resolved_at=now(),error_message=null
  where id=p_import_row_id returning * into target;
  return target;
end;
$$;

create or replace function public.commit_rescan_import_batch_v2(p_batch_id uuid, p_row_ids uuid[] default null)
returns public.import_batches
language plpgsql security definer set search_path = public, auth as $$
declare batch public.import_batches; row_record public.import_rows; task_row public.tasks; committed integer:=0; failed integer:=0;
begin
  if not (public.has_app_role('admin') or public.has_app_role('leader')) then raise exception 'IMPORT_FORBIDDEN'; end if;
  select * into batch from public.import_batches where id=p_batch_id and source_type='rescan_ledger' for update;
  if not found then raise exception 'IMPORT_BATCH_NOT_FOUND'; end if;
  for row_record in select * from public.import_rows where batch_id=p_batch_id and status='ready'
    and (p_row_ids is null or id=any(p_row_ids)) for update
  loop
    begin
      select * into task_row from public.tasks where id=(row_record.resolved_data->>'task_id')::uuid;
      if not found then raise exception 'MATCHED_TASK_NOT_FOUND'; end if;
      if public.has_app_role('leader') and not public.has_app_role('admin') and not public.is_local_demo_session()
        and task_row.team_id not in (select public.current_leader_team_ids()) then raise exception 'LEADER_CANNOT_IMPORT_OTHER_TEAM'; end if;
      insert into public.rescan_records(original_task_id,original_task_name,reason,description,rescan_volume,executors,
        contact_assistant,expected_done,actual_done,accepted,initiated_by,status,import_row_id,support_hours,source_result,acceptance_detail)
      values(task_row.id,task_row.name,'其他',row_record.normalized_data->>'detail',coalesce((row_record.normalized_data->>'volume')::integer,0),
        array[row_record.normalized_data->>'executor'],coalesce(row_record.normalized_data->>'contactAssistant',''),
        nullif(row_record.normalized_data->>'date','')::timestamptz,
        case when (row_record.normalized_data->>'accepted')::boolean then nullif(row_record.normalized_data->>'date','')::timestamptz end,
        nullif(row_record.normalized_data->>'accepted','')::boolean,public.current_app_user_id(),
        case when nullif(row_record.normalized_data->>'accepted','')::boolean is true then 'accepted'
          when nullif(row_record.normalized_data->>'accepted','')::boolean is false then 'rejected' else 'pending' end,row_record.id,
        nullif(row_record.normalized_data->>'supportHours','')::numeric,
        nullif(row_record.normalized_data->>'sourceResult',''), nullif(row_record.normalized_data->>'acceptanceDetail',''))
      on conflict (import_row_id) where import_row_id is not null do nothing;
      update public.import_rows set status='committed',task_id=task_row.id where id=row_record.id;
      committed:=committed+1;
    exception when others then
      update public.import_rows set status='error',error_message=sqlerrm,
        issues=issues||jsonb_build_array(jsonb_build_object('code','RESCAN_COMMIT_ERROR','field','整行','level','error','message',sqlerrm)) where id=row_record.id;
      failed:=failed+1;
    end;
  end loop;
  update public.import_batches set committed_rows=committed,error_rows=failed,status=case when failed>0 and committed>0 then 'partial' when failed>0 then 'failed' else 'succeeded' end,
    committed_at=now() where id=p_batch_id returning * into batch;
  return batch;
end;
$$;

revoke all on function public.preview_rescan_ledger_import_v2(text,jsonb,text,text) from public;
revoke all on function public.resolve_rescan_import_row_v2(uuid,uuid) from public;
revoke all on function public.commit_rescan_import_batch_v2(uuid,uuid[]) from public;
grant execute on function public.preview_rescan_ledger_import_v2(text,jsonb,text,text) to authenticated;
grant execute on function public.resolve_rescan_import_row_v2(uuid,uuid) to authenticated;
grant execute on function public.commit_rescan_import_batch_v2(uuid,uuid[]) to authenticated;
