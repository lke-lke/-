-- DB-001：人员别名与任务关系别名契约。
-- 别名仅用于解析，不修改标准姓名或历史任务快照。

create or replace function public.normalize_lookup_text(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select lower(regexp_replace(trim(coalesce(p_value, '')), '[[:space:]，,、/;；\\\-—_（）()【】\[\]·:：​‌‍﻿]+', '', 'g'));
$$;

create table public.person_aliases (
  id uuid primary key default gen_random_uuid(),
  alias_display text not null,
  alias_normalized text not null,
  user_id uuid not null references public.app_users(id) on delete restrict,
  active boolean not null default true,
  valid_from date not null default current_date,
  valid_to date,
  created_by uuid references public.app_users(id) on delete set null,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (alias_normalized <> ''),
  check (alias_normalized = public.normalize_lookup_text(alias_display)),
  check (valid_to is null or valid_to >= valid_from)
);

create unique index person_aliases_one_active_alias_idx
  on public.person_aliases(alias_normalized)
  where active;
create index person_aliases_user_idx on public.person_aliases(user_id, active);
create index person_aliases_validity_idx on public.person_aliases(valid_from, valid_to);

create table public.task_relation_aliases (
  id uuid primary key default gen_random_uuid(),
  relation_id uuid not null references public.task_relations(id) on delete restrict,
  ownership_display text not null,
  ownership_normalized text not null,
  alias_display text not null,
  alias_normalized text not null,
  active boolean not null default true,
  created_by uuid references public.app_users(id) on delete set null,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ownership_normalized <> ''),
  check (alias_normalized <> ''),
  check (ownership_normalized = public.normalize_lookup_text(ownership_display)),
  check (alias_normalized = public.normalize_lookup_text(alias_display))
);

create unique index task_relation_aliases_one_active_alias_idx
  on public.task_relation_aliases(ownership_normalized, alias_normalized)
  where active;
create index task_relation_aliases_relation_idx on public.task_relation_aliases(relation_id, active);

create trigger person_aliases_set_updated_at
before update on public.person_aliases
for each row execute function public.set_updated_at();

create trigger task_relation_aliases_set_updated_at
before update on public.task_relation_aliases
for each row execute function public.set_updated_at();

create or replace function public.resolve_person_name(
  p_name text,
  p_effective_date date default current_date
)
returns table (
  match_type text,
  user_id uuid,
  canonical_name text,
  user_status text,
  team_id uuid,
  team_name text,
  is_leader boolean,
  team_resolution text
)
language sql
stable
security definer
set search_path = public, auth
as $$
  with input as (
    select public.normalize_lookup_text(p_name) as normalized_name,
           coalesce(p_effective_date, current_date) as effective_date
  ),
  exact_matches as (
    select
      'exact'::text as match_type,
      u.id as user_id,
      u.name as canonical_name,
      u.status as user_status,
      tm.team_id,
      t.name as team_name,
      coalesce(tm.is_leader, false) as is_leader,
      tm.team_resolution
    from input i
    join public.app_users u
      on public.normalize_lookup_text(u.name) = i.normalized_name
    left join lateral (
      select membership.*,
             case
               when membership.effective_from <= i.effective_date
                and (membership.effective_to is null or membership.effective_to >= i.effective_date)
               then 'effective'::text
               else 'current_fallback'::text
             end as team_resolution
      from public.team_memberships membership
      where membership.user_id = u.id
        and (
          (membership.effective_from <= i.effective_date
           and (membership.effective_to is null or membership.effective_to >= i.effective_date))
          or (membership.effective_from <= current_date
              and (membership.effective_to is null or membership.effective_to >= current_date))
        )
      order by
        case
          when membership.effective_from <= i.effective_date
           and (membership.effective_to is null or membership.effective_to >= i.effective_date)
          then 0 else 1
        end,
        membership.effective_from desc
      limit 1
    ) tm on true
    left join public.teams t on t.id = tm.team_id
    where i.normalized_name <> ''
  ),
  alias_matches as (
    select
      'alias'::text as match_type,
      u.id as user_id,
      u.name as canonical_name,
      u.status as user_status,
      tm.team_id,
      t.name as team_name,
      coalesce(tm.is_leader, false) as is_leader,
      tm.team_resolution
    from input i
    join public.person_aliases pa
      on pa.alias_normalized = i.normalized_name
     and pa.active
     and pa.valid_from <= i.effective_date
     and (pa.valid_to is null or pa.valid_to >= i.effective_date)
    join public.app_users u on u.id = pa.user_id
    left join lateral (
      select membership.*,
             case
               when membership.effective_from <= i.effective_date
                and (membership.effective_to is null or membership.effective_to >= i.effective_date)
               then 'effective'::text
               else 'current_fallback'::text
             end as team_resolution
      from public.team_memberships membership
      where membership.user_id = u.id
        and (
          (membership.effective_from <= i.effective_date
           and (membership.effective_to is null or membership.effective_to >= i.effective_date))
          or (membership.effective_from <= current_date
              and (membership.effective_to is null or membership.effective_to >= current_date))
        )
      order by
        case
          when membership.effective_from <= i.effective_date
           and (membership.effective_to is null or membership.effective_to >= i.effective_date)
          then 0 else 1
        end,
        membership.effective_from desc
      limit 1
    ) tm on true
    left join public.teams t on t.id = tm.team_id
    where not exists (select 1 from exact_matches)
  )
  select * from exact_matches
  union all
  select * from alias_matches;
$$;

create or replace function public.resolve_task_relation_name(
  p_ownership text,
  p_task_group text
)
returns table (
  match_type text,
  relation_id uuid,
  ownership text,
  main_task text,
  task_group text
)
language sql
stable
security definer
set search_path = public, auth
as $$
  with input as (
    select public.normalize_lookup_text(p_ownership) as ownership_key,
           public.normalize_lookup_text(p_task_group) as group_key
  ),
  exact_matches as (
    select
      'exact'::text as match_type,
      tr.id as relation_id,
      tr.ownership,
      tr.main_task,
      tr.linked_task as task_group
    from input i
    join public.task_relations tr
      on public.normalize_lookup_text(tr.ownership) = i.ownership_key
     and public.normalize_lookup_text(tr.linked_task) = i.group_key
     and tr.active
    where i.ownership_key <> '' and i.group_key <> ''
  ),
  alias_matches as (
    select
      'alias'::text as match_type,
      tr.id as relation_id,
      tr.ownership,
      tr.main_task,
      tr.linked_task as task_group
    from input i
    join public.task_relation_aliases tra
      on tra.ownership_normalized = i.ownership_key
     and tra.alias_normalized = i.group_key
     and tra.active
    join public.task_relations tr
      on tr.id = tra.relation_id
     and tr.active
    where not exists (select 1 from exact_matches)
  )
  select * from exact_matches
  union all
  select * from alias_matches;
$$;

create or replace function public.can_manage_person_alias_target(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.has_app_role('admin')
    or (
      public.has_app_role('leader')
      and (
        public.is_local_demo_session()
        or exists (
          select 1
          from public.team_memberships tm
          where tm.user_id = p_user_id
            and tm.team_id in (select public.current_leader_team_ids())
            and tm.effective_from <= current_date
            and (tm.effective_to is null or tm.effective_to >= current_date)
        )
      )
    );
$$;

create or replace function public.upsert_person_alias(
  p_alias text,
  p_user_id uuid,
  p_valid_from date default current_date,
  p_valid_to date default null,
  p_id uuid default null
)
returns public.person_aliases
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_id uuid := public.current_app_user_id();
  normalized_alias text := public.normalize_lookup_text(p_alias);
  target_user public.app_users;
  before_state jsonb;
  changed public.person_aliases;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.can_manage_person_alias_target(p_user_id) then raise exception 'PERSON_ALIAS_WRITE_FORBIDDEN'; end if;
  if normalized_alias = '' then raise exception 'PERSON_ALIAS_REQUIRED'; end if;
  if p_valid_to is not null and p_valid_to < coalesce(p_valid_from, current_date) then raise exception 'PERSON_ALIAS_INVALID_VALIDITY'; end if;

  select * into target_user from public.app_users where id = p_user_id;
  if not found then raise exception 'PERSON_ALIAS_USER_NOT_FOUND'; end if;
  if public.normalize_lookup_text(target_user.name) = normalized_alias then
    raise exception 'PERSON_ALIAS_DUPLICATES_CANONICAL_NAME';
  end if;

  if p_id is not null then
    select to_jsonb(pa) into before_state
    from public.person_aliases pa
    where pa.id = p_id
    for update;
    if before_state is null then raise exception 'PERSON_ALIAS_NOT_FOUND'; end if;
    if not public.can_manage_person_alias_target((before_state ->> 'user_id')::uuid) then
      raise exception 'PERSON_ALIAS_WRITE_FORBIDDEN';
    end if;

    update public.person_aliases
    set alias_display = trim(p_alias),
        alias_normalized = normalized_alias,
        user_id = p_user_id,
        active = true,
        valid_from = coalesce(p_valid_from, current_date),
        valid_to = p_valid_to,
        updated_by = actor_id
    where id = p_id
    returning * into changed;
  else
    begin
      insert into public.person_aliases(
        alias_display, alias_normalized, user_id, valid_from, valid_to, created_by, updated_by
      ) values (
        trim(p_alias), normalized_alias, p_user_id, coalesce(p_valid_from, current_date), p_valid_to, actor_id, actor_id
      ) returning * into changed;
    exception when unique_violation then
      select * into changed
      from public.person_aliases
      where alias_normalized = normalized_alias and active
      for update;
      if changed.user_id <> p_user_id then raise exception 'PERSON_ALIAS_CONFLICT'; end if;
      before_state := to_jsonb(changed);
      update public.person_aliases
      set alias_display = trim(p_alias),
          valid_from = coalesce(p_valid_from, current_date),
          valid_to = p_valid_to,
          updated_by = actor_id
      where id = changed.id
      returning * into changed;
    end;
  end if;

  insert into public.audit_logs(actor_id, actor_role, entity_type, entity_id, action, before_value, after_value)
  values (
    actor_id, public.current_actor_role_label(), 'person_alias', changed.id,
    case when before_state is null then 'create' else 'update' end,
    before_state, to_jsonb(changed)
  );
  return changed;
end;
$$;

create or replace function public.archive_person_alias(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_id uuid := public.current_app_user_id();
  current_row public.person_aliases;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into current_row from public.person_aliases where id = p_id for update;
  if not found then raise exception 'PERSON_ALIAS_NOT_FOUND'; end if;
  if not public.can_manage_person_alias_target(current_row.user_id) then raise exception 'PERSON_ALIAS_WRITE_FORBIDDEN'; end if;

  update public.person_aliases
  set active = false,
      valid_to = case
        when valid_from > current_date then valid_from
        else least(coalesce(valid_to, current_date), current_date)
      end,
      updated_by = actor_id
  where id = p_id;

  insert into public.audit_logs(actor_id, actor_role, entity_type, entity_id, action, before_value, after_value)
  values (
    actor_id, public.current_actor_role_label(), 'person_alias', p_id, 'archive',
    to_jsonb(current_row),
    (select to_jsonb(pa) from public.person_aliases pa where pa.id = p_id)
  );
end;
$$;

create or replace function public.upsert_task_relation_alias(
  p_alias text,
  p_relation_id uuid,
  p_id uuid default null
)
returns public.task_relation_aliases
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_id uuid := public.current_app_user_id();
  normalized_alias text := public.normalize_lookup_text(p_alias);
  target_relation public.task_relations;
  before_state jsonb;
  changed public.task_relation_aliases;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not (public.has_app_role('admin') or public.has_app_role('leader')) then raise exception 'RELATION_ALIAS_WRITE_FORBIDDEN'; end if;
  if normalized_alias = '' then raise exception 'RELATION_ALIAS_REQUIRED'; end if;
  select * into target_relation from public.task_relations where id = p_relation_id and active;
  if not found then raise exception 'ACTIVE_TASK_RELATION_NOT_FOUND'; end if;
  if public.normalize_lookup_text(target_relation.linked_task) = normalized_alias then
    raise exception 'RELATION_ALIAS_DUPLICATES_CANONICAL_NAME';
  end if;

  if p_id is not null then
    select to_jsonb(tra) into before_state
    from public.task_relation_aliases tra
    where tra.id = p_id
    for update;
    if before_state is null then raise exception 'RELATION_ALIAS_NOT_FOUND'; end if;

    update public.task_relation_aliases
    set relation_id = p_relation_id,
        ownership_display = target_relation.ownership,
        ownership_normalized = public.normalize_lookup_text(target_relation.ownership),
        alias_display = trim(p_alias),
        alias_normalized = normalized_alias,
        active = true,
        updated_by = actor_id
    where id = p_id
    returning * into changed;
  else
    begin
      insert into public.task_relation_aliases(
        relation_id, ownership_display, ownership_normalized,
        alias_display, alias_normalized, created_by, updated_by
      ) values (
        p_relation_id, target_relation.ownership, public.normalize_lookup_text(target_relation.ownership),
        trim(p_alias), normalized_alias, actor_id, actor_id
      ) returning * into changed;
    exception when unique_violation then
      select * into changed
      from public.task_relation_aliases
      where ownership_normalized = public.normalize_lookup_text(target_relation.ownership)
        and alias_normalized = normalized_alias
        and active
      for update;
      if changed.relation_id <> p_relation_id then raise exception 'RELATION_ALIAS_CONFLICT'; end if;
      before_state := to_jsonb(changed);
      update public.task_relation_aliases
      set alias_display = trim(p_alias), updated_by = actor_id
      where id = changed.id
      returning * into changed;
    end;
  end if;

  insert into public.audit_logs(actor_id, actor_role, entity_type, entity_id, action, before_value, after_value)
  values (
    actor_id, public.current_actor_role_label(), 'task_relation_alias', changed.id,
    case when before_state is null then 'create' else 'update' end,
    before_state, to_jsonb(changed)
  );
  return changed;
end;
$$;

create or replace function public.archive_task_relation_alias(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_id uuid := public.current_app_user_id();
  current_row public.task_relation_aliases;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not (public.has_app_role('admin') or public.has_app_role('leader')) then raise exception 'RELATION_ALIAS_WRITE_FORBIDDEN'; end if;
  select * into current_row from public.task_relation_aliases where id = p_id for update;
  if not found then raise exception 'RELATION_ALIAS_NOT_FOUND'; end if;
  update public.task_relation_aliases set active = false, updated_by = actor_id where id = p_id;
  insert into public.audit_logs(actor_id, actor_role, entity_type, entity_id, action, before_value, after_value)
  values (
    actor_id, public.current_actor_role_label(), 'task_relation_alias', p_id, 'archive',
    to_jsonb(current_row),
    (select to_jsonb(tra) from public.task_relation_aliases tra where tra.id = p_id)
  );
end;
$$;

alter table public.person_aliases enable row level security;
alter table public.task_relation_aliases enable row level security;

create policy authenticated_read_person_aliases
on public.person_aliases for select to authenticated using (true);
create policy authenticated_read_task_relation_aliases
on public.task_relation_aliases for select to authenticated using (true);

grant select on public.person_aliases, public.task_relation_aliases to authenticated;

revoke all on function public.normalize_lookup_text(text) from public;
revoke all on function public.resolve_person_name(text, date) from public;
revoke all on function public.resolve_task_relation_name(text, text) from public;
revoke all on function public.can_manage_person_alias_target(uuid) from public;
revoke all on function public.upsert_person_alias(text, uuid, date, date, uuid) from public;
revoke all on function public.archive_person_alias(uuid) from public;
revoke all on function public.upsert_task_relation_alias(text, uuid, uuid) from public;
revoke all on function public.archive_task_relation_alias(uuid) from public;

grant execute on function public.normalize_lookup_text(text) to authenticated;
grant execute on function public.resolve_person_name(text, date) to authenticated;
grant execute on function public.resolve_task_relation_name(text, text) to authenticated;
grant execute on function public.upsert_person_alias(text, uuid, date, date, uuid) to authenticated;
grant execute on function public.archive_person_alias(uuid) to authenticated;
grant execute on function public.upsert_task_relation_alias(text, uuid, uuid) to authenticated;
grant execute on function public.archive_task_relation_alias(uuid) to authenticated;

do $$
declare
  target_user_id uuid;
begin
  select u.id into target_user_id
  from public.app_users u
  join public.team_memberships tm
    on tm.user_id = u.id
   and tm.effective_from <= current_date
   and (tm.effective_to is null or tm.effective_to >= current_date)
  join public.teams t on t.id = tm.team_id
  where u.name = '成妍' and t.name = '业务助理C组'
  order by u.created_at
  limit 1;

  if target_user_id is null then raise exception 'C组成员成妍不存在，无法创建人员别名'; end if;

  insert into public.person_aliases(
    alias_display, alias_normalized, user_id, active, valid_from
  ) values
    ('阿部', public.normalize_lookup_text('阿部'), target_user_id, true, date '1900-01-01'),
    ('成研', public.normalize_lookup_text('成研'), target_user_id, true, date '1900-01-01')
  on conflict (alias_normalized) where active
  do update set user_id = excluded.user_id,
                alias_display = excluded.alias_display,
                valid_from = least(public.person_aliases.valid_from, excluded.valid_from),
                updated_at = now();
end;
$$;
