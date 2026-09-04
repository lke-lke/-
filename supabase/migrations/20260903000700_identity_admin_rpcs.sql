-- 筝一小助理作业管理平台：首次管理员初始化与成员/小组维护 RPC

create or replace function public.bootstrap_first_admin(p_auth_user_id uuid)
returns public.app_users
language plpgsql
security definer
set search_path = public, auth
as $$
declare target public.app_users;
begin
  if exists (
    select 1 from public.user_roles ur where ur.role = 'admin'
  ) then raise exception 'ADMIN_ALREADY_EXISTS'; end if;

  select * into target from public.app_users where auth_user_id = p_auth_user_id for update;
  if not found then raise exception 'APP_USER_NOT_FOUND'; end if;
  delete from public.user_roles where user_id = target.id;
  insert into public.user_roles(user_id, role) values (target.id, 'admin');
  return target;
end;
$$;

-- 只能从 Supabase Studio/可信后端以 service_role 调用，绝不开放给浏览器登录用户。
revoke all on function public.bootstrap_first_admin(uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_first_admin(uuid) to service_role;

create or replace function public.assign_user_to_team(
  p_user_id uuid,
  p_team_id uuid,
  p_role text default 'member'
)
returns public.team_memberships
language plpgsql
security definer
set search_path = public, auth
as $$
declare membership public.team_memberships;
declare is_admin boolean := public.has_app_role('admin');
begin
  if p_role not in ('leader', 'member') then raise exception 'INVALID_TEAM_ROLE'; end if;
  if not is_admin and not (
    public.has_app_role('leader')
    and p_role = 'member'
    and p_team_id in (select public.current_leader_team_ids())
  ) then raise exception 'TEAM_ASSIGNMENT_FORBIDDEN'; end if;
  if not exists (select 1 from public.app_users where id = p_user_id and status = 'active') then raise exception 'ACTIVE_USER_NOT_FOUND'; end if;
  if not exists (select 1 from public.teams where id = p_team_id and active) then raise exception 'ACTIVE_TEAM_NOT_FOUND'; end if;

  delete from public.team_memberships
  where user_id = p_user_id and effective_to is null and effective_from = current_date;
  update public.team_memberships set effective_to = current_date
  where user_id = p_user_id and effective_to is null;

  insert into public.team_memberships(user_id, team_id, is_leader)
  values (p_user_id, p_team_id, p_role = 'leader')
  returning * into membership;

  delete from public.user_roles where user_id = p_user_id and role in ('leader', 'member');
  insert into public.user_roles(user_id, role) values (p_user_id, p_role);
  return membership;
end;
$$;

create or replace function public.disable_app_user(p_user_id uuid)
returns public.app_users
language plpgsql
security definer
set search_path = public, auth
as $$
declare target public.app_users;
declare target_team uuid;
begin
  select team_id into target_team from public.team_memberships where user_id = p_user_id and effective_to is null limit 1;
  if not public.has_app_role('admin') and not (
    public.has_app_role('leader') and target_team in (select public.current_leader_team_ids())
  ) then raise exception 'USER_DISABLE_FORBIDDEN'; end if;

  update public.app_users set status = 'disabled' where id = p_user_id returning * into target;
  update public.team_memberships set effective_to = current_date where user_id = p_user_id and effective_to is null;
  return target;
end;
$$;

revoke all on function public.assign_user_to_team(uuid, uuid, text) from public;
revoke all on function public.disable_app_user(uuid) from public;
grant execute on function public.assign_user_to_team(uuid, uuid, text) to authenticated;
grant execute on function public.disable_app_user(uuid) to authenticated;
