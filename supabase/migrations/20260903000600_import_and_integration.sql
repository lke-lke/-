-- 筝一小助理作业管理平台：Excel 批量入库与 1d/调度系统接入边界

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  provider text not null check (provider in ('oneday', 'scheduler', 'custom')),
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not (config ?| array['password', 'secret', 'token', 'service_role_key']))
);

create table public.external_sync_runs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  direction text not null check (direction in ('pull', 'push')),
  resource_type text not null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'partial')),
  cursor_before text,
  cursor_after text,
  received_count integer not null default 0,
  applied_count integer not null default 0,
  error_count integer not null default 0,
  error_detail jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.external_task_mappings (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  external_task_id text not null,
  external_version text,
  source_updated_at timestamptz,
  payload_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_task_id),
  unique (connection_id, task_id)
);

create trigger integration_connections_set_updated_at before update on public.integration_connections
for each row execute function public.set_updated_at();
create trigger external_task_mappings_set_updated_at before update on public.external_task_mappings
for each row execute function public.set_updated_at();

create or replace function public.apply_task_relation_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
declare relation public.task_relations;
begin
  if new.relation_id is not null then
    select * into relation from public.task_relations where id = new.relation_id and active;
    if not found then raise exception 'ACTIVE_TASK_RELATION_NOT_FOUND'; end if;
    new.ownership := relation.ownership;
    new.main_task_snapshot := relation.main_task;
    new.linked_task_snapshot := relation.linked_task;
    new.task_group := relation.linked_task;
  else
    new.main_task_snapshot := coalesce(nullif(trim(new.main_task_snapshot), ''), '临时任务');
    new.linked_task_snapshot := coalesce(nullif(trim(new.linked_task_snapshot), ''), '临时任务');
    new.task_group := coalesce(nullif(trim(new.task_group), ''), new.linked_task_snapshot);
  end if;
  return new;
end;
$$;

create trigger tasks_apply_relation_snapshot
before insert or update of relation_id, ownership, main_task_snapshot, linked_task_snapshot, task_group
on public.tasks for each row execute function public.apply_task_relation_snapshot();

create or replace function public.commit_task_ledger_import(
  p_filename text,
  p_rows jsonb,
  p_storage_key text default null
)
returns public.import_batches
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  batch public.import_batches;
  item jsonb;
  normalized jsonb;
  committed integer := 0;
  skipped integer := 0;
  row_status text;
  imported_row_id uuid;
  dedupe_key text;
begin
  if not (public.has_app_role('admin') or public.has_app_role('leader')) then raise exception 'IMPORT_FORBIDDEN'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'IMPORT_ROWS_MUST_BE_ARRAY'; end if;

  insert into public.import_batches(source_type, original_filename, storage_key, total_rows, created_by)
  values ('task_ledger', p_filename, p_storage_key, jsonb_array_length(p_rows), public.current_app_user_id())
  returning * into batch;

  for item in select value from jsonb_array_elements(p_rows) loop
    normalized := coalesce(item -> 'normalized_data', '{}'::jsonb);
    row_status := case
      when nullif(trim(coalesce(normalized ->> 'name', '')), '') is null then 'error'
      else 'ready'
    end;

    insert into public.import_rows(batch_id, source_sheet, source_row, raw_data, normalized_data, status, error_message)
    values (
      batch.id,
      coalesce(nullif(item ->> 'source_sheet', ''), '任务台账'),
      coalesce(nullif(item ->> 'source_row', '')::integer, committed + skipped + 1),
      coalesce(item -> 'raw_data', item), normalized, row_status,
      case when row_status = 'error' then '任务名称为空' end
    ) returning id into imported_row_id;

    if row_status = 'error' then skipped := skipped + 1; continue; end if;

    dedupe_key := coalesce(
      nullif(normalized ->> 'external_task_id', ''),
      encode(extensions.digest(lower(normalized ->> 'name') || '|' || coalesce(normalized ->> 'created_at', ''), 'sha256'), 'hex')
    );

    insert into public.tasks(
      name, ownership, main_task_snapshot, linked_task_snapshot, task_group,
      work_nature, task_type, assignee, team, team_leader, data_reporter,
      reviewer, data_volume, workforce, created_at, deadline, expected_deadline,
      status, platform_task_id, rule_doc_link, difficulty, source_type,
      external_task_id, source_dedupe_key, source_updated_at, imported_batch_id, created_by
    ) values (
      normalized ->> 'name', coalesce(nullif(normalized ->> 'ownership', ''), '其他'),
      coalesce(nullif(normalized ->> 'main_task', ''), '临时任务'),
      coalesce(nullif(normalized ->> 'task_group', ''), '临时任务'),
      coalesce(nullif(normalized ->> 'task_group', ''), '临时任务'),
      coalesce(nullif(normalized ->> 'work_nature', ''), '首次交付'),
      coalesce(nullif(normalized ->> 'task_type', ''), '模型评测'),
      coalesce(normalized ->> 'assignee', ''), coalesce(normalized ->> 'team', ''),
      coalesce(normalized ->> 'team_leader', ''), coalesce(normalized ->> 'data_reporter', ''),
      coalesce(normalized ->> 'reviewer', ''), coalesce(nullif(normalized ->> 'data_volume', '')::integer, 0),
      coalesce(nullif(normalized ->> 'workforce', '')::integer, 0),
      coalesce(nullif(normalized ->> 'created_at', '')::timestamptz, now()),
      nullif(normalized ->> 'deadline', '')::timestamptz,
      nullif(normalized ->> 'expected_deadline', '')::timestamptz,
      '待完善', nullif(normalized ->> 'platform_task_id', ''), nullif(normalized ->> 'rule_doc_link', ''),
      nullif(normalized ->> 'difficulty', '')::smallint, 'excel',
      nullif(normalized ->> 'external_task_id', ''), dedupe_key, now(), batch.id, public.current_app_user_id()
    )
    on conflict (source_type, source_dedupe_key) where source_dedupe_key is not null
    do update set
      name = excluded.name, ownership = excluded.ownership,
      main_task_snapshot = excluded.main_task_snapshot,
      linked_task_snapshot = excluded.linked_task_snapshot,
      task_group = excluded.task_group, work_nature = excluded.work_nature,
      data_volume = excluded.data_volume, source_updated_at = now(),
      imported_batch_id = excluded.imported_batch_id;
    update public.import_rows set status = 'committed' where id = imported_row_id;
    committed := committed + 1;
  end loop;

  update public.import_batches set status = 'committed', committed_rows = committed,
    skipped_rows = skipped, committed_at = now()
  where id = batch.id returning * into batch;
  return batch;
end;
$$;

alter table public.integration_connections enable row level security;
alter table public.external_sync_runs enable row level security;
alter table public.external_task_mappings enable row level security;

create policy authenticated_read_connections on public.integration_connections for select to authenticated using (true);
create policy authenticated_read_sync_runs on public.external_sync_runs for select to authenticated using (true);
create policy authenticated_read_external_mappings on public.external_task_mappings for select to authenticated using (true);
create policy admin_manage_connections on public.integration_connections for all to authenticated
  using (public.has_app_role('admin')) with check (public.has_app_role('admin'));

grant select on public.integration_connections, public.external_sync_runs, public.external_task_mappings to authenticated;
grant insert, update, delete on public.integration_connections to authenticated;
revoke all on function public.commit_task_ledger_import(text, jsonb, text) from public;
grant execute on function public.commit_task_ledger_import(text, jsonb, text) to authenticated;
