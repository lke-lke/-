-- 台账全链路：可恢复、可幂等、可逐行处理的导入批次契约。

alter table public.import_batches drop constraint if exists import_batches_status_check;
alter table public.import_batches add constraint import_batches_status_check
  check (status in ('previewing', 'previewed', 'committing', 'succeeded', 'partial', 'failed', 'committed'));

alter table public.import_batches
  add column if not exists source_system text not null default 'excel',
  add column if not exists source_hash text,
  add column if not exists source_version text,
  add column if not exists request_id text,
  add column if not exists idempotency_key text,
  add column if not exists ready_rows integer not null default 0 check (ready_rows >= 0),
  add column if not exists needs_completion_rows integer not null default 0 check (needs_completion_rows >= 0),
  add column if not exists conflict_rows integer not null default 0 check (conflict_rows >= 0),
  add column if not exists error_rows integer not null default 0 check (error_rows >= 0),
  add column if not exists created_rows integer not null default 0 check (created_rows >= 0),
  add column if not exists updated_rows integer not null default 0 check (updated_rows >= 0),
  add column if not exists error_summary jsonb not null default '{}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists import_batches_idempotency_unique_idx
  on public.import_batches(source_system, idempotency_key)
  where idempotency_key is not null;
create index if not exists import_batches_source_hash_idx
  on public.import_batches(source_system, source_hash, created_at desc)
  where source_hash is not null;

drop trigger if exists import_batches_set_updated_at on public.import_batches;
create trigger import_batches_set_updated_at before update on public.import_batches
for each row execute function public.set_updated_at();

alter table public.import_rows drop constraint if exists import_rows_status_check;
alter table public.import_rows add constraint import_rows_status_check
  check (status in (
    'pending', 'ready', 'needs_completion', 'conflict', 'error',
    'created', 'updated', 'skipped', 'needs_match', 'committed'
  ));

alter table public.import_rows
  add column if not exists row_key text,
  add column if not exists resolved_data jsonb,
  add column if not exists issues jsonb not null default '[]'::jsonb,
  add column if not exists action text check (action is null or action in ('create', 'update', 'skip')),
  add column if not exists task_id uuid references public.tasks(id) on delete set null,
  add column if not exists resolved_by uuid references public.app_users(id) on delete set null,
  add column if not exists resolved_at timestamptz,
  add column if not exists retry_of_row_id uuid references public.import_rows(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

update public.import_rows
set row_key = source_sheet || ':' || source_row::text
where row_key is null;
alter table public.import_rows alter column row_key set not null;

create unique index if not exists import_rows_batch_row_key_unique_idx
  on public.import_rows(batch_id, row_key);
create index if not exists import_rows_task_idx on public.import_rows(task_id)
  where task_id is not null;
create index if not exists import_rows_retry_idx on public.import_rows(retry_of_row_id)
  where retry_of_row_id is not null;

drop trigger if exists import_rows_set_updated_at on public.import_rows;
create trigger import_rows_set_updated_at before update on public.import_rows
for each row execute function public.set_updated_at();

comment on column public.import_rows.raw_data is 'Excel 原始行，包含不再映射为业务字段的列，仅用于追溯。';
comment on column public.import_rows.normalized_data is '纯格式标准化后的 Canonical DTO，不包含匹配结果。';
comment on column public.import_rows.resolved_data is '人员、组别、任务关系、去重目标等服务端解析结果。';
comment on column public.import_rows.issues is '结构化问题数组：code、field、level、message、candidates。';

