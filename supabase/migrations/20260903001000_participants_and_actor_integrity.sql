-- 多人任务规范化关系与写入者自动落库，姓名数组仅保留为展示快照。

create table public.task_participants (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete restrict,
  responsibility text not null default '协作人' check (responsibility in ('主负责人', '协作人')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  created_by uuid references public.app_users(id),
  check (left_at is null or left_at >= joined_at),
  unique (task_id, user_id)
);
create index task_participants_user_idx on public.task_participants(user_id, joined_at desc);

create or replace function public.fill_current_actor_references()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare actor_id uuid := public.current_app_user_id();
begin
  if tg_table_name = 'tasks' and new.created_by is null then new.created_by := actor_id; end if;
  if tg_table_name = 'rescan_records' and new.initiated_by is null then new.initiated_by := actor_id; end if;
  if tg_table_name = 'import_batches' and new.created_by is null then new.created_by := actor_id; end if;
  if tg_table_name = 'task_participants' and new.created_by is null then new.created_by := actor_id; end if;
  return new;
end;
$$;

create trigger tasks_fill_actor before insert on public.tasks
for each row execute function public.fill_current_actor_references();
create trigger rescans_fill_actor before insert on public.rescan_records
for each row execute function public.fill_current_actor_references();
create trigger import_batches_fill_actor before insert on public.import_batches
for each row execute function public.fill_current_actor_references();
create trigger task_participants_fill_actor before insert on public.task_participants
for each row execute function public.fill_current_actor_references();

alter table public.task_participants enable row level security;
create policy authenticated_read_task_participants on public.task_participants for select to authenticated using (true);
create policy manager_write_task_participants on public.task_participants for all to authenticated
  using (public.has_app_role('admin') or public.can_lead_task(task_id))
  with check (public.has_app_role('admin') or public.can_lead_task(task_id));
grant select, insert, update, delete on public.task_participants to authenticated;
