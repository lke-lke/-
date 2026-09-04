-- 无密码本地联调：成员名册可以先建档，正式接入 1d 后再绑定 auth.users。

alter table public.app_users alter column auth_user_id drop not null;

create view public.managed_members
with (security_invoker = true)
as
select
  u.id,
  u.name,
  t.name as team,
  case when exists (
    select 1 from public.user_roles ur where ur.user_id = u.id and ur.role = 'leader'
  ) then '组长' else '组员' end as role,
  case when u.status = 'active' then '在职' else '已停用' end as status
from public.app_users u
join public.team_memberships tm
  on tm.user_id = u.id
 and tm.effective_from <= current_date
 and (tm.effective_to is null or tm.effective_to >= current_date)
join public.teams t on t.id = tm.team_id;

create or replace function public.save_managed_member(
  p_id uuid,
  p_name text,
  p_team_name text,
  p_role text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_user_id uuid := p_id;
  target_team_id uuid;
  is_admin boolean := public.has_app_role('admin');
  is_leader boolean := public.has_app_role('leader');
begin
  if not (is_admin or is_leader) then raise exception 'MEMBER_MANAGEMENT_FORBIDDEN'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'MEMBER_NAME_REQUIRED'; end if;
  if nullif(trim(p_team_name), '') is null then raise exception 'TEAM_REQUIRED'; end if;
  if p_role not in ('leader', 'member') then raise exception 'INVALID_MEMBER_ROLE'; end if;
  if p_status not in ('active', 'disabled') then raise exception 'INVALID_MEMBER_STATUS'; end if;

  select id into target_team_id from public.teams where name = trim(p_team_name);
  if target_team_id is null then
    if not (is_admin or public.is_local_demo_session()) then raise exception 'TEAM_NOT_FOUND'; end if;
    insert into public.teams(code, name)
    values ('team-' || substr(md5(trim(p_team_name)), 1, 12), trim(p_team_name))
    returning id into target_team_id;
  end if;

  if is_leader and not public.is_local_demo_session()
     and target_team_id not in (select public.current_leader_team_ids()) then
    raise exception 'LEADER_CAN_ONLY_MANAGE_OWN_TEAM';
  end if;

  if target_user_id is null then
    insert into public.app_users(name, status)
    values (trim(p_name), p_status)
    returning id into target_user_id;
  else
    if exists (select 1 from public.user_roles where user_id = target_user_id and role = 'admin') then
      raise exception 'ADMIN_ACCOUNT_CANNOT_BE_CHANGED_HERE';
    end if;
    if is_leader and not public.is_local_demo_session() and not exists (
      select 1 from public.team_memberships
      where user_id = target_user_id
        and team_id in (select public.current_leader_team_ids())
        and effective_from <= current_date
        and (effective_to is null or effective_to >= current_date)
    ) then raise exception 'LEADER_CAN_ONLY_MANAGE_OWN_TEAM'; end if;
    update public.app_users set name = trim(p_name), status = p_status where id = target_user_id;
    if not found then raise exception 'MEMBER_NOT_FOUND'; end if;
  end if;

  delete from public.user_roles where user_id = target_user_id and role in ('leader', 'member');
  insert into public.user_roles(user_id, role) values (target_user_id, p_role);

  delete from public.team_memberships
  where user_id = target_user_id and effective_to is null and effective_from = current_date;
  update public.team_memberships
  set effective_to = current_date - 1
  where user_id = target_user_id and effective_to is null and effective_from < current_date;
  insert into public.team_memberships(user_id, team_id, is_leader)
  values (target_user_id, target_team_id, p_role = 'leader');

  return jsonb_build_object(
    'id', target_user_id,
    'name', trim(p_name),
    'team', trim(p_team_name),
    'role', case when p_role = 'leader' then '组长' else '组员' end,
    'status', case when p_status = 'active' then '在职' else '已停用' end
  );
end;
$$;

create or replace function public.toggle_managed_member(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not (public.has_app_role('admin') or public.has_app_role('leader')) then
    raise exception 'MEMBER_MANAGEMENT_FORBIDDEN';
  end if;
  if exists (select 1 from public.user_roles where user_id = p_id and role = 'admin') then
    raise exception 'ADMIN_ACCOUNT_CANNOT_BE_CHANGED_HERE';
  end if;
  if public.has_app_role('leader') and not public.is_local_demo_session() and not exists (
    select 1 from public.team_memberships
    where user_id = p_id
      and team_id in (select public.current_leader_team_ids())
      and effective_from <= current_date
      and (effective_to is null or effective_to >= current_date)
  ) then raise exception 'LEADER_CAN_ONLY_MANAGE_OWN_TEAM'; end if;

  update public.app_users
  set status = case when status = 'active' then 'disabled' else 'active' end
  where id = p_id;
  if not found then raise exception 'MEMBER_NOT_FOUND'; end if;
end;
$$;

grant select on public.managed_members to authenticated;
revoke all on function public.save_managed_member(uuid, text, text, text, text) from public;
revoke all on function public.toggle_managed_member(uuid) from public;
grant execute on function public.save_managed_member(uuid, text, text, text, text) to authenticated;
grant execute on function public.toggle_managed_member(uuid) to authenticated;
