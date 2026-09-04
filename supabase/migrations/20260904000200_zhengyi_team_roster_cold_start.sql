-- 筝一小组冷启名册：B/C/D 为当前正式组织；旧 A 组仅保留历史数据，不参与正式看板。
-- 允许重复执行：会复用同名人员，并将其当前有效组别与角色校正为本名册。

insert into public.teams(code, name, active) values
  ('assistant-b', '业务助理B组', true),
  ('assistant-c', '业务助理C组', true),
  ('assistant-d', '业务助理D组', true)
on conflict (name) do update set active = true;

update public.teams set active = false where name = '业务助理A组';

do $$
declare
  roster jsonb := '[
    {"name":"李杨","team":"业务助理B组","role":"leader"},
    {"name":"程晔","team":"业务助理B组","role":"member"},
    {"name":"陈婧","team":"业务助理B组","role":"member"},
    {"name":"廖嘉裕","team":"业务助理B组","role":"member"},
    {"name":"叶子涵","team":"业务助理B组","role":"member"},
    {"name":"王星宇","team":"业务助理C组","role":"leader"},
    {"name":"郑倩君","team":"业务助理C组","role":"member"},
    {"name":"成妍","team":"业务助理C组","role":"member"},
    {"name":"刘美彤","team":"业务助理C组","role":"member"},
    {"name":"牛佳欣","team":"业务助理C组","role":"member"},
    {"name":"徐金云","team":"业务助理C组","role":"member"},
    {"name":"钱杭琪","team":"业务助理D组","role":"leader"},
    {"name":"齐曼夷","team":"业务助理D组","role":"member"},
    {"name":"桂丽丹","team":"业务助理D组","role":"member"},
    {"name":"高翔","team":"业务助理D组","role":"member"}
  ]'::jsonb;
  item jsonb;
  target_user_id uuid;
  target_team_id uuid;
  target_name text;
  target_team_name text;
  target_role text;
begin
  for item in select value from jsonb_array_elements(roster) loop
    target_name := item ->> 'name';
    target_team_name := item ->> 'team';
    target_role := item ->> 'role';

    select id into target_team_id from public.teams where name = target_team_name;
    select id into target_user_id
      from public.app_users
      where name = target_name
      order by created_at asc
      limit 1;
    if target_user_id is null then
      insert into public.app_users(name, status) values (target_name, 'active') returning id into target_user_id;
    else
      update public.app_users set status = 'active' where id = target_user_id;
    end if;

    delete from public.user_roles where user_id = target_user_id and role in ('leader', 'member');
    insert into public.user_roles(user_id, role) values (target_user_id, target_role)
      on conflict (user_id, role) do nothing;

    delete from public.team_memberships
      where user_id = target_user_id and effective_to is null and effective_from = current_date;
    update public.team_memberships
      set effective_to = current_date - 1
      where user_id = target_user_id and effective_to is null and effective_from < current_date;
    insert into public.team_memberships(user_id, team_id, is_leader, effective_from)
      values (target_user_id, target_team_id, target_role = 'leader', current_date);
  end loop;
end;
$$;
