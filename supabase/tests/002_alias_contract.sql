begin;

do $$
declare
  canonical_user_id uuid;
  alias_user_id uuid;
  c_team_name text;
  second_user_id uuid;
begin
  if to_regclass('public.person_aliases') is null then raise exception 'person_aliases table missing'; end if;
  if to_regclass('public.task_relation_aliases') is null then raise exception 'task_relation_aliases table missing'; end if;
  if to_regprocedure('public.resolve_person_name(text,date)') is null then raise exception 'person resolver missing'; end if;
  if to_regprocedure('public.resolve_task_relation_name(text,text)') is null then raise exception 'relation resolver missing'; end if;
  if to_regprocedure('public.upsert_person_alias(text,uuid,date,date,uuid)') is null then raise exception 'person alias RPC missing'; end if;
  if to_regprocedure('public.upsert_task_relation_alias(text,uuid,uuid)') is null then raise exception 'relation alias RPC missing'; end if;

  select id into canonical_user_id
  from public.app_users
  where name = '成妍'
  order by created_at
  limit 1;
  if canonical_user_id is null then raise exception 'canonical member 成妍 missing'; end if;

  select r.user_id, r.team_name into alias_user_id, c_team_name
  from public.resolve_person_name('阿部', current_date) r;
  if alias_user_id is distinct from canonical_user_id or c_team_name is distinct from '业务助理C组' then
    raise exception '阿部 alias resolution mismatch';
  end if;

  select r.user_id, r.team_name into alias_user_id, c_team_name
  from public.resolve_person_name('成研', current_date) r;
  if alias_user_id is distinct from canonical_user_id or c_team_name is distinct from '业务助理C组' then
    raise exception '成研 alias resolution mismatch';
  end if;

  select r.user_id, r.team_name into alias_user_id, c_team_name
  from public.resolve_person_name('阿部', date '2026-07-01') r;
  if alias_user_id is distinct from canonical_user_id or c_team_name is distinct from '业务助理C组' then
    raise exception 'historical ledger alias must fall back to current cold-start team';
  end if;

  if (select count(*) from public.resolve_person_name('成妍', current_date)) <> 1 then
    raise exception 'canonical name must take precedence over aliases';
  end if;

  if not exists (
    select 1 from public.resolve_task_relation_name('lookie横向评测', '效果评测-美瞳')
    where match_type = 'exact' and main_task = '效果评测'
  ) then raise exception 'exact task relation resolution mismatch'; end if;

  insert into public.app_users(name, status) values ('别名冲突测试用户', 'active') returning id into second_user_id;
  begin
    insert into public.person_aliases(alias_display, alias_normalized, user_id)
    values ('阿部', public.normalize_lookup_text('阿部'), second_user_id);
    raise exception 'active person alias uniqueness was not enforced';
  exception when unique_violation then
    null;
  end;

  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'person_aliases' and c.relrowsecurity
  ) then raise exception 'person_aliases RLS missing'; end if;

  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'task_relation_aliases' and c.relrowsecurity
  ) then raise exception 'task_relation_aliases RLS missing'; end if;
end;
$$;

rollback;
