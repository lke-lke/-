-- 台账全链路：任务来源、字段人工锁、参与人历史快照、事件和统一待办。

alter table public.tasks
  add column if not exists dispatched_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists reopened_at timestamptz,
  add column if not exists reopen_reason text,
  add column if not exists mapping_status text not null default 'complete'
    check (mapping_status in ('complete', 'needs_completion', 'conflict')),
  add column if not exists source_payload jsonb not null default '{}'::jsonb,
  add column if not exists source_version text,
  add column if not exists row_version bigint not null default 1 check (row_version > 0);

create or replace function public.bump_task_row_version()
returns trigger language plpgsql set search_path = public as $$
begin
  new.row_version := old.row_version + 1;
  return new;
end;
$$;

drop trigger if exists tasks_bump_row_version on public.tasks;
create trigger tasks_bump_row_version before update on public.tasks
for each row execute function public.bump_task_row_version();

alter table public.task_participants
  add column if not exists source_type text not null default 'manual'
    check (source_type in ('manual', 'excel', 'scheduler', 'system')),
  add column if not exists source_ref text,
  add column if not exists team_id_snapshot uuid references public.teams(id) on delete set null,
  add column if not exists team_name_snapshot text not null default '',
  add column if not exists user_name_snapshot text not null default '',
  add column if not exists is_leader_snapshot boolean not null default false;

update public.task_participants tp
set user_name_snapshot = u.name,
    team_id_snapshot = coalesce(tp.team_id_snapshot, t.team_id),
    team_name_snapshot = case when tp.team_name_snapshot = '' then t.team else tp.team_name_snapshot end
from public.app_users u, public.tasks t
where tp.user_id = u.id and tp.task_id = t.id;

create unique index if not exists task_participants_one_active_primary_idx
  on public.task_participants(task_id)
  where responsibility = '主负责人' and left_at is null;

create table public.task_field_provenance (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  field_name text not null,
  source_type text not null check (source_type in ('manual', 'excel', 'scheduler', 'system')),
  source_ref text,
  source_value jsonb,
  manually_locked boolean not null default false,
  locked_by uuid references public.app_users(id) on delete set null,
  locked_at timestamptz,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, field_name),
  check (not manually_locked or locked_at is not null)
);
create index task_field_provenance_locked_idx on public.task_field_provenance(task_id)
  where manually_locked;
create trigger task_field_provenance_set_updated_at before update on public.task_field_provenance
for each row execute function public.set_updated_at();

create table public.task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  actor_id uuid references public.app_users(id) on delete set null,
  actor_name text not null default '',
  actor_role text,
  reason text,
  detail jsonb not null default '{}'::jsonb,
  request_id text,
  source_type text not null default 'manual' check (source_type in ('manual', 'excel', 'scheduler', 'system')),
  created_at timestamptz not null default now()
);
create index task_events_task_created_idx on public.task_events(task_id, created_at desc);
create unique index task_events_request_unique_idx on public.task_events(task_id, request_id, event_type)
  where request_id is not null;

create table public.todos (
  id uuid primary key default gen_random_uuid(),
  todo_type text not null,
  title text not null,
  description text,
  task_id uuid references public.tasks(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  assignee_user_id uuid references public.app_users(id) on delete cascade,
  assignee_team_id uuid references public.teams(id) on delete cascade,
  assignee_role text check (assignee_role is null or assignee_role in ('super_admin', 'admin', 'leader', 'member')),
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  priority text not null default 'normal' check (priority in ('normal', 'high', 'urgent')),
  due_at timestamptz,
  dedupe_key text not null,
  detail jsonb not null default '{}'::jsonb,
  created_by uuid references public.app_users(id) on delete set null,
  completed_by uuid references public.app_users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (assignee_user_id is not null or assignee_team_id is not null or assignee_role is not null)
);
create unique index todos_open_dedupe_unique_idx on public.todos(dedupe_key) where status = 'open';
create index todos_assignee_user_idx on public.todos(assignee_user_id, status, created_at desc);
create index todos_assignee_team_idx on public.todos(assignee_team_id, status, created_at desc);
create trigger todos_set_updated_at before update on public.todos
for each row execute function public.set_updated_at();

alter table public.task_field_provenance enable row level security;
alter table public.task_events enable row level security;
alter table public.todos enable row level security;

create policy authenticated_read_task_field_provenance on public.task_field_provenance
  for select to authenticated using (true);
create policy authenticated_read_task_events on public.task_events
  for select to authenticated using (true);
create policy authenticated_read_todos on public.todos
  for select to authenticated using (true);

-- 三张表均由受控 RPC 写入，前端没有直接增删改权限。
grant select on public.task_field_provenance, public.task_events, public.todos to authenticated;

comment on column public.tasks.dispatched_at is '业务任务下发时间；不得再写入系统 created_at。';
comment on column public.tasks.deadline is '实际截止时间，仅在结项或真实完成后填写。';
comment on column public.tasks.expected_deadline is '组长预填的预计截止时间。';

-- 后续报表 RPC 在建立时即使用同一读取边界；010 migration 再将该函数应用到 RLS policy。
create or replace function public.can_view_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select public.has_app_role('admin') or public.is_local_demo_session() or exists (
    select 1 from public.tasks t where t.id = p_task_id and (
      (public.has_app_role('leader') and t.team_id in (select public.current_leader_team_ids()))
      or (public.has_app_role('member') and (t.assignee_user_id = public.current_app_user_id() or exists (
        select 1 from public.task_participants tp where tp.task_id=t.id and tp.user_id=public.current_app_user_id() and tp.left_at is null
      )))
    )
  );
$$;
revoke all on function public.can_view_task(uuid) from public;
grant execute on function public.can_view_task(uuid) to authenticated;
