-- 失败/冲突行重试：创建新批次与子行，原始 raw/normalized/resolution 永不覆盖。

create or replace function public.retry_task_import_rows_v2(
  p_batch_id uuid,
  p_row_ids uuid[],
  p_corrections jsonb default '{}'::jsonb,
  p_request_id text default null
)
returns public.import_batches
language plpgsql security definer set search_path = public, auth as $$
declare
  source_batch public.import_batches;
  retry_batch public.import_batches;
  source_row public.import_rows;
  normalized jsonb;
  result jsonb;
  ready_count integer:=0;
  completion_count integer:=0;
  conflict_count integer:=0;
  error_count integer:=0;
  retry_key text;
begin
  if not (public.has_app_role('admin') or public.has_app_role('leader')) then raise exception 'IMPORT_RETRY_FORBIDDEN'; end if;
  select * into source_batch from public.import_batches where id=p_batch_id and source_type='task_ledger';
  if not found then raise exception 'IMPORT_BATCH_NOT_FOUND'; end if;
  if public.has_app_role('leader') and not public.has_app_role('admin') and not public.is_local_demo_session()
    and source_batch.created_by <> public.current_app_user_id() then raise exception 'LEADER_CAN_ONLY_RETRY_OWN_BATCH'; end if;
  retry_key := coalesce(nullif(p_request_id,''),'retry:'||p_batch_id||':'||clock_timestamp()::text);
  insert into public.import_batches(source_type,source_system,original_filename,status,total_rows,source_hash,source_version,
    request_id,idempotency_key,metadata,created_by)
  values('task_ledger','excel-retry',source_batch.original_filename,'previewing',coalesce(array_length(p_row_ids,1),0),
    source_batch.source_hash,source_batch.source_version,p_request_id,retry_key,
    jsonb_build_object('retry_of_batch_id',p_batch_id),public.current_app_user_id()) returning * into retry_batch;

  for source_row in select * from public.import_rows where batch_id=p_batch_id and id=any(coalesce(p_row_ids,'{}')) loop
    begin
      normalized := coalesce(source_row.normalized_data,'{}'::jsonb) || coalesce(p_corrections -> source_row.id::text,'{}'::jsonb);
      result := public.resolve_task_import_payload_v2(normalized);
      insert into public.import_rows(batch_id,row_key,source_sheet,source_row,raw_data,normalized_data,resolved_data,issues,status,action,retry_of_row_id)
      values(retry_batch.id,source_row.row_key||':retry:'||source_row.id,source_row.source_sheet,source_row.source_row,
        source_row.raw_data,normalized,result->'resolution',result->'issues',result->>'status',result->'resolution'->>'action',source_row.id);
      case result->>'status' when 'ready' then ready_count:=ready_count+1 when 'needs_completion' then completion_count:=completion_count+1
        when 'conflict' then conflict_count:=conflict_count+1 else error_count:=error_count+1 end case;
    exception when others then
      insert into public.import_rows(batch_id,row_key,source_sheet,source_row,raw_data,normalized_data,issues,status,error_message,retry_of_row_id)
      values(retry_batch.id,source_row.row_key||':retry:'||source_row.id,source_row.source_sheet,source_row.source_row,
        source_row.raw_data,source_row.normalized_data,jsonb_build_array(jsonb_build_object('code','RETRY_ERROR','field','整行','level','error','message',sqlerrm)),'error',sqlerrm,source_row.id);
      error_count:=error_count+1;
    end;
  end loop;
  update public.import_batches set status='previewed',ready_rows=ready_count,needs_completion_rows=completion_count,
    conflict_rows=conflict_count,error_rows=error_count where id=retry_batch.id returning * into retry_batch;
  return retry_batch;
end;
$$;

revoke all on function public.retry_task_import_rows_v2(uuid,uuid[],jsonb,text) from public;
grant execute on function public.retry_task_import_rows_v2(uuid,uuid[],jsonb,text) to authenticated;
