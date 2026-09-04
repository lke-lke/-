begin;

do $$
begin
  if to_regclass('public.tasks') is null then raise exception 'tasks table missing'; end if;
  if to_regclass('public.documents') is null then raise exception 'documents table missing'; end if;
  if to_regclass('public.document_review_events') is null then raise exception 'document_review_events table missing'; end if;
  if to_regclass('public.task_relations') is null then raise exception 'task_relations table missing'; end if;
  if to_regclass('public.integration_connections') is null then raise exception 'integration_connections table missing'; end if;
  if to_regclass('public.managed_members') is null then raise exception 'managed_members view missing'; end if;
  if to_regprocedure('public.leader_review_document(uuid,text,text)') is null then raise exception 'leader review RPC missing'; end if;
  if to_regprocedure('public.admin_review_document(uuid,text,text)') is null then raise exception 'admin review RPC missing'; end if;
  if to_regprocedure('public.commit_task_ledger_import(text,jsonb,text)') is null then raise exception 'ledger import RPC missing'; end if;
  if to_regprocedure('public.save_managed_member(uuid,text,text,text,text)') is null then raise exception 'member roster RPC missing'; end if;
  if (select count(*) from public.task_relations where ownership = 'AI试穿-模型评测' and active) <> 66 then
    raise exception 'AI task relation baseline mismatch';
  end if;
  if (select count(*) from public.task_relations where ownership = 'lookie横向评测' and active) <> 10 then
    raise exception 'lookie task relation baseline mismatch';
  end if;
  if exists (select 1 from public.tasks) then raise exception 'migrations must not contain test tasks'; end if;
  if exists (select 1 from public.documents) then raise exception 'migrations must not contain test documents'; end if;
end;
$$;

rollback;
