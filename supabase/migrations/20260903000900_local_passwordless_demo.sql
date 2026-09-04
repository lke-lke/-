-- 本地开发专用：Supabase 匿名会话 + 三角色演示切换，无密码登录页。
-- 正式 1d 环境必须在部署配置中关闭 anonymous sign-in；普通认证用户不会命中此通道。

alter table public.app_users
  add column local_demo_role text not null default 'member'
  check (local_demo_role in ('admin', 'leader', 'member'));

create or replace function public.is_local_demo_session()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and exists (
      select 1 from auth.users u
      where u.id = auth.uid()
        and coalesce((u.raw_user_meta_data ->> 'local_demo')::boolean, false)
    );
$$;

create or replace function public.has_app_role(required_role text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = public.current_app_user_id() and role = required_role
  ) or exists (
    select 1 from public.app_users
    where id = public.current_app_user_id()
      and public.is_local_demo_session()
      and local_demo_role = required_role
  );
$$;

create or replace function public.set_local_demo_role(p_role text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_local_demo_session() then raise exception 'LOCAL_DEMO_ONLY'; end if;
  if p_role not in ('admin', 'leader', 'member') then raise exception 'INVALID_DEMO_ROLE'; end if;
  update public.app_users set local_demo_role = p_role where id = public.current_app_user_id();
end;
$$;

create or replace function public.current_actor_name()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select case
    when public.is_local_demo_session() and local_demo_role = 'admin' then '管理员'
    when public.is_local_demo_session() and local_demo_role = 'leader' then '组长'
    when public.is_local_demo_session() then '组员'
    else name
  end
  from public.app_users where id = public.current_app_user_id();
$$;

create or replace function public.can_lead_task(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.has_app_role('admin')
    or (public.is_local_demo_session() and public.has_app_role('leader'))
    or (
      public.has_app_role('leader') and exists (
        select 1
        from public.tasks t
        join public.team_memberships tm
          on tm.user_id = public.current_app_user_id()
         and tm.is_leader
         and tm.effective_from <= current_date
         and (tm.effective_to is null or tm.effective_to >= current_date)
        left join public.teams team on team.id = tm.team_id
        where t.id = target_task_id
          and (t.team_id = tm.team_id or (t.team_id is null and t.team = team.name))
      )
    );
$$;

drop policy leader_insert_team_tasks on public.tasks;
create policy leader_insert_team_tasks on public.tasks for insert to authenticated
  with check (
    public.has_app_role('leader') and (
      public.is_local_demo_session()
      or team_id in (select public.current_leader_team_ids())
      or exists (select 1 from public.teams where id in (select public.current_leader_team_ids()) and name = team)
    )
  );

revoke all on function public.is_local_demo_session() from public;
revoke all on function public.set_local_demo_role(text) from public;
grant execute on function public.is_local_demo_session() to authenticated;
grant execute on function public.set_local_demo_role(text) to authenticated;
