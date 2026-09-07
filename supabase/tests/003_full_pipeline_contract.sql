begin;

do $$
declare
  resolved jsonb;
begin
  if to_regclass('public.task_field_provenance') is null then raise exception 'task_field_provenance missing'; end if;
  if to_regclass('public.task_events') is null then raise exception 'task_events missing'; end if;
  if to_regclass('public.todos') is null then raise exception 'todos missing'; end if;
  if to_regclass('public.contribution_tag_definitions') is null then raise exception 'contribution tag directory missing'; end if;
  if to_regprocedure('public.preview_task_ledger_import_v2(text,jsonb,text,text,text,text)') is null then raise exception 'task preview RPC missing'; end if;
  if to_regprocedure('public.resolve_import_row_v2(uuid,uuid,text[],text)') is null then raise exception 'task row resolver RPC missing'; end if;
  if to_regprocedure('public.commit_task_ledger_import_v2(text,jsonb,text,text,uuid)') is null then raise exception 'task commit v2 RPC missing'; end if;
  if to_regprocedure('public.retry_task_import_rows_v2(uuid,uuid[],jsonb,text)') is null then raise exception 'task retry RPC missing'; end if;
  if to_regprocedure('public.preview_rescan_ledger_import_v2(text,jsonb,text,text)') is null then raise exception 'rescan preview RPC missing'; end if;
  if to_regprocedure('public.resolve_rescan_import_row_v2(uuid,uuid)') is null then raise exception 'rescan resolver RPC missing'; end if;
  if to_regprocedure('public.commit_rescan_import_batch_v2(uuid,uuid[])') is null then raise exception 'rescan commit RPC missing'; end if;
  if to_regprocedure('public.create_manual_task_v2(jsonb,text)') is null then raise exception 'manual task RPC missing'; end if;
  if to_regprocedure('public.transition_task_status(uuid,text,text,bigint,text)') is null then raise exception 'task transition RPC missing'; end if;
  if to_regprocedure('public.complete_task_setup(uuid,uuid,text,timestamp with time zone,integer,smallint,text,bigint)') is null then raise exception 'task setup RPC missing'; end if;
  if to_regprocedure('public.team_task_status_summary(timestamp with time zone,timestamp with time zone)') is null then raise exception 'reporting RPC missing'; end if;
  if to_regprocedure('public.settle_task_v2(uuid,smallint,text,text,timestamp with time zone)') is null then raise exception 'settlement v2 RPC missing'; end if;
  if to_regprocedure('public.register_task_management_event_v2(uuid,text,text,jsonb)') is null then raise exception 'task management event RPC missing'; end if;
  if to_regprocedure('public.apply_excel_source_document_link()') is null then raise exception 'source document link trigger missing'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='task_settlements' and column_name='actual_deadline') then raise exception 'actual deadline missing'; end if;
  if (select count(*) from public.contribution_tag_definitions where active) <> 12 then raise exception 'contribution tag seed mismatch'; end if;

  if public.normalize_lookup_text(' Lookie-横向评测 ') <> public.normalize_lookup_text('lookie横向评测') then
    raise exception 'lookup normalization mismatch';
  end if;
  resolved := public.resolve_task_import_payload_v2(jsonb_build_object(
    'name','别名解析测试','ownership','lookie横向评测','taskGroup','效果评测-美瞳',
    'acceptancePeople',jsonb_build_array('成研'),'dispatchedAt','2026-09-01',
    'expectedDeadline','2026-09-10','difficulty',3
  ));
  if resolved -> 'resolution' ->> 'team' <> '业务助理C组' then raise exception 'alias team resolution mismatch'; end if;
  if resolved -> 'resolution' ->> 'primary_assignee' <> '成妍' then raise exception 'alias primary resolution mismatch'; end if;
  if resolved -> 'resolution' ->> 'main_task' <> '效果评测' then raise exception 'hierarchy resolution mismatch'; end if;
  if resolved ->> 'status' <> 'ready' then raise exception 'complete canonical row should be ready: %', resolved; end if;

  if (select count(*) from public.task_relations where ownership='AI试穿-模型评测' and active) <> 66 then raise exception 'AI relation count mismatch'; end if;
  if (select count(*) from public.task_relations where ownership='lookie横向评测' and active) <> 10 then raise exception 'lookie relation count mismatch'; end if;
  if exists (select 1 from public.task_relations where main_task='临时任务' and linked_task='临时任务') then
    raise exception 'duplicate generic temporary relation must not exist';
  end if;
end;
$$;

rollback;
