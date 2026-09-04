-- 筝一小助理作业管理平台：身份、组织与通用数据库能力
-- 本目录是数据库变更的唯一可执行来源；不要直接在数据库控制台改表。

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  employee_id text unique,
  name text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  role text not null check (role in ('admin', 'leader', 'member')),
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create table public.team_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete restrict,
  is_leader boolean not null default false,
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  unique (user_id, team_id, effective_from)
);

create unique index team_memberships_one_active_team_idx
  on public.team_memberships(user_id)
  where effective_to is null;
create index team_memberships_active_team_idx
  on public.team_memberships(team_id, is_leader)
  where effective_to is null;

create trigger teams_set_updated_at
before update on public.teams
for each row execute function public.set_updated_at();

create trigger app_users_set_updated_at
before update on public.app_users
for each row execute function public.set_updated_at();

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select id
  from public.app_users
  where auth_user_id = auth.uid()
    and status = 'active'
  limit 1;
$$;

create or replace function public.has_app_role(required_role text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = public.current_app_user_id()
      and role = required_role
  );
$$;

create or replace function public.current_team_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select team_id
  from public.team_memberships
  where user_id = public.current_app_user_id()
    and effective_from <= current_date
    and (effective_to is null or effective_to >= current_date);
$$;

create or replace function public.current_leader_team_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select team_id
  from public.team_memberships
  where user_id = public.current_app_user_id()
    and is_leader
    and effective_from <= current_date
    and (effective_to is null or effective_to >= current_date);
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  created_user_id uuid;
begin
  insert into public.app_users(auth_user_id, employee_id, name)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'employee_id', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(coalesce(new.email, new.phone, new.id::text), '@', 1))
  )
  returning id into created_user_id;

  -- 自助创建的账号一律从组组员开始；提权必须由管理员/组长业务操作完成。
  insert into public.user_roles(user_id, role) values (created_user_id, 'member');
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

revoke all on function public.current_app_user_id() from public;
revoke all on function public.has_app_role(text) from public;
revoke all on function public.current_team_ids() from public;
revoke all on function public.current_leader_team_ids() from public;
grant execute on function public.current_app_user_id() to authenticated;
grant execute on function public.has_app_role(text) to authenticated;
grant execute on function public.current_team_ids() to authenticated;
grant execute on function public.current_leader_team_ids() to authenticated;
