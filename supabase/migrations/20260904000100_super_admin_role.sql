-- 可配置超级管理员：不改动既有三角色业务授权，仅提供全局运维入口。
-- 停用 super_admin 只撤销能力，不删除任务、文档、审核或审计数据。

create table if not exists public.role_definitions (
  role text primary key,
  display_name text not null,
  is_active boolean not null default true,
  is_system boolean not null default false,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.role_definitions(role, display_name, is_active, is_system, description) values
  ('super_admin', '超级管理员', true, true, '系统联调、全局运维与全角色只读视角预览。正式上线后可停用。'),
  ('admin', '管理员', true, true, '全局任务、组织及组长提交交付物的管理。'),
  ('leader', '组长', true, true, '本组任务、成员及交付物审核管理。'),
  ('member', '组员', true, true, '本人任务、交付物及工作记录维护。')
on conflict (role) do update set display_name = excluded.display_name, is_system = excluded.is_system, description = excluded.description;

drop trigger if exists role_definitions_set_updated_at on public.role_definitions;
create trigger role_definitions_set_updated_at before update on public.role_definitions for each row execute function public.set_updated_at();

alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check check (role in ('super_admin', 'admin', 'leader', 'member'));
alter table public.app_users drop constraint if exists app_users_local_demo_role_check;
alter table public.app_users add constraint app_users_local_demo_role_check check (local_demo_role in ('super_admin', 'admin', 'leader', 'member'));

-- 超级管理员自动满足既有 admin / leader / member 的策略判断；角色停用后即时失效。
create or replace function public.has_app_role(required_role text)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.user_roles ur join public.role_definitions rd on rd.role = ur.role and rd.is_active
    where ur.user_id = public.current_app_user_id() and (ur.role = required_role or ur.role = 'super_admin')
  ) or exists (
    select 1 from public.app_users u join public.role_definitions rd on rd.role = u.local_demo_role and rd.is_active
    where u.id = public.current_app_user_id() and public.is_local_demo_session()
      and (u.local_demo_role = required_role or u.local_demo_role = 'super_admin')
  );
$$;

create or replace function public.set_local_demo_role(p_role text)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_local_demo_session() then raise exception 'LOCAL_DEMO_ONLY'; end if;
  if p_role not in ('super_admin', 'admin', 'leader', 'member') then raise exception 'INVALID_DEMO_ROLE'; end if;
  if not exists (select 1 from public.role_definitions where role = p_role and is_active) then raise exception 'INACTIVE_DEMO_ROLE'; end if;
  update public.app_users set local_demo_role = p_role where id = public.current_app_user_id();
end;
$$;

create or replace function public.current_actor_name()
returns text language sql stable security definer set search_path = public, auth as $$
  select case
    when public.is_local_demo_session() and local_demo_role = 'super_admin' then '超级管理员'
    when public.is_local_demo_session() and local_demo_role = 'admin' then '管理员'
    when public.is_local_demo_session() and local_demo_role = 'leader' then '组长'
    when public.is_local_demo_session() then '组员'
    else name
  end from public.app_users where id = public.current_app_user_id();
$$;

create or replace function public.current_actor_role_label()
returns text language sql stable security definer set search_path = public, auth as $$
  select case
    when public.has_app_role('super_admin') then '超级管理员'
    when public.has_app_role('admin') then '管理员'
    when public.has_app_role('leader') then '组长'
    else '组员'
  end;
$$;

alter table public.document_review_events drop constraint if exists document_review_events_actor_role_check;
alter table public.document_review_events add constraint document_review_events_actor_role_check check (actor_role in ('超级管理员', '管理员', '组长', '组员'));
alter table public.audit_logs add column if not exists actor_role text;
alter table public.audit_logs add column if not exists preview_role text;

-- 停用 super_admin 后，只有显式拥有其他角色的用户还能保留对应权限。
create or replace function public.set_role_definition_active(p_role text, p_is_active boolean)
returns void language plpgsql security definer set search_path = public, auth as $$
declare before_state jsonb;
begin
  if not public.has_app_role('super_admin') then raise exception 'SUPER_ADMIN_REQUIRED'; end if;
  select jsonb_build_object('role', role, 'is_active', is_active) into before_state from public.role_definitions where role = p_role for update;
  if before_state is null then raise exception 'ROLE_NOT_FOUND'; end if;
  update public.role_definitions set is_active = p_is_active where role = p_role;
  insert into public.audit_logs(actor_id, actor_role, entity_type, action, before_value, after_value)
  values (public.current_app_user_id(), public.current_actor_role_label(), 'role_definition', 'set_active', before_state, jsonb_build_object('role', p_role, 'is_active', p_is_active));
end;
$$;

alter table public.role_definitions enable row level security;
create policy authenticated_read_role_definitions on public.role_definitions for select to authenticated using (true);
revoke all on function public.set_role_definition_active(text, boolean) from public;
grant execute on function public.set_role_definition_active(text, boolean) to authenticated;
