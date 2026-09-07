-- 工作贡献标签目录及任务、人员、证据、确认权限完整性约束。

create table if not exists public.contribution_tag_definitions (
  tag text primary key,
  category text not null check (category in ('document', 'process', 'acceptance', 'other')),
  active boolean not null default true,
  sort_order integer not null,
  created_at timestamptz not null default now()
);

insert into public.contribution_tag_definitions(tag, category, sort_order) values
  ('规则文档撰写', 'document', 10),
  ('需求文档撰写', 'document', 20),
  ('需求文档培训', 'process', 30),
  ('规则培训', 'process', 40),
  ('过程答疑', 'process', 50),
  ('作业中规则变更并下发', 'process', 60),
  ('回扫安排/发起', 'process', 70),
  ('数据验收', 'acceptance', 80),
  ('数据分析', 'process', 90),
  ('评测报告撰写', 'document', 100),
  ('其他已验收交付物', 'other', 110),
  ('组员带教', 'process', 120)
on conflict (tag) do update set
  category = excluded.category,
  sort_order = excluded.sort_order;

alter table public.contribution_tag_definitions enable row level security;
drop policy if exists authenticated_read_contribution_tags on public.contribution_tag_definitions;
create policy authenticated_read_contribution_tags on public.contribution_tag_definitions
  for select to authenticated using (true);
grant select on public.contribution_tag_definitions to authenticated;

create unique index if not exists task_contributions_active_tag_unique_idx
  on public.task_contributions(task_id, member_user_id, tag)
  where status <> 'removed';

create or replace function public.guard_task_contribution_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_id uuid := public.current_app_user_id();
  canonical_name text;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED'; end if;

  if tg_op = 'UPDATE' then
    if new.task_id <> old.task_id or new.member_user_id is distinct from old.member_user_id
      or new.tag <> old.tag or new.evidence_type is distinct from old.evidence_type
      or new.evidence_id is distinct from old.evidence_id then
      raise exception 'CONTRIBUTION_IDENTITY_IMMUTABLE';
    end if;
    if old.status = 'removed' and new.status <> old.status then
      raise exception 'CONTRIBUTION_FINAL_STATE_LOCKED';
    end if;
    if old.status = 'confirmed' and new.status not in ('confirmed', 'removed') then
      raise exception 'CONTRIBUTION_FINAL_STATE_LOCKED';
    end if;
  end if;

  if not exists (
    select 1 from public.contribution_tag_definitions d
    where d.tag = new.tag and d.active
  ) then raise exception 'INVALID_CONTRIBUTION_TAG'; end if;

  if new.member_user_id is null or not exists (
    select 1 from public.task_participants p
    where p.task_id = new.task_id and p.user_id = new.member_user_id and p.left_at is null
  ) then raise exception 'CONTRIBUTION_MEMBER_NOT_ACTIVE_PARTICIPANT'; end if;

  select name into canonical_name from public.app_users
  where id = new.member_user_id and status = 'active';
  if canonical_name is null then raise exception 'CONTRIBUTION_MEMBER_NOT_ACTIVE'; end if;
  new.member := canonical_name;

  if not (public.has_app_role('admin') or public.can_lead_task(new.task_id))
     and new.member_user_id <> actor_id then
    raise exception 'CONTRIBUTION_WRITE_FORBIDDEN';
  end if;

  if new.evidence_type is null and new.evidence_id is not null then
    raise exception 'CONTRIBUTION_EVIDENCE_TYPE_REQUIRED';
  elsif new.evidence_type is not null and new.evidence_id is null then
    raise exception 'CONTRIBUTION_EVIDENCE_ID_REQUIRED';
  elsif new.evidence_type = 'document' and not exists (
    select 1 from public.documents d where d.id = new.evidence_id
      and d.task_id = new.task_id
      and d.workflow_status in ('completed_by_leader', 'completed_by_admin')
  ) then raise exception 'CONTRIBUTION_DOCUMENT_NOT_APPROVED';
  elsif new.evidence_type = 'rescan' and not exists (
    select 1 from public.rescan_records r where r.id = new.evidence_id
      and r.original_task_id = new.task_id and r.status = 'accepted'
  ) then raise exception 'CONTRIBUTION_RESCAN_NOT_ACCEPTED';
  elsif new.evidence_type = 'acceptance' and not exists (
    select 1 from public.task_management_events e where e.id = new.evidence_id
      and e.task_id = new.task_id and e.event_type = 'data_acceptance_completed'
  ) then raise exception 'CONTRIBUTION_ACCEPTANCE_NOT_FOUND';
  end if;

  if new.tag = '其他已验收交付物' and nullif(trim(coalesce(new.note, '')), '') is null then
    raise exception 'OTHER_DELIVERABLE_NOTE_REQUIRED';
  end if;

  if tg_op = 'INSERT' then
    new.attached_by_user_id := actor_id;
    new.attached_by := public.current_actor_name();
    new.status := 'pending';
    new.confirmed_by := null;
    new.confirmed_by_user_id := null;
    new.confirmed_at := null;
  elsif new.status = 'confirmed' and old.status <> 'confirmed' then
    if not (public.has_app_role('admin') or public.can_lead_task(new.task_id)) then
      raise exception 'CONTRIBUTION_CONFIRM_FORBIDDEN';
    end if;
    new.confirmed_by_user_id := actor_id;
    new.confirmed_by := public.current_actor_name();
    new.confirmed_at := now();
  elsif new.status = 'removed' and old.status <> 'removed' then
    if not (public.has_app_role('admin') or public.can_lead_task(new.task_id) or new.member_user_id = actor_id) then
      raise exception 'CONTRIBUTION_REMOVE_FORBIDDEN';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists task_contributions_guard_integrity on public.task_contributions;
create trigger task_contributions_guard_integrity
before insert or update on public.task_contributions
for each row execute function public.guard_task_contribution_integrity();

create or replace function public.confirm_task_contribution(p_id uuid)
returns public.task_contributions
language plpgsql
security definer
set search_path = public, auth
as $$
declare current_row public.task_contributions;
declare changed public.task_contributions;
begin
  select * into current_row from public.task_contributions where id = p_id for update;
  if not found then raise exception 'CONTRIBUTION_NOT_FOUND'; end if;
  if current_row.status <> 'pending' then raise exception 'CONTRIBUTION_STATE_CONFLICT'; end if;
  if not (public.has_app_role('admin') or public.can_lead_task(current_row.task_id)) then
    raise exception 'CONTRIBUTION_CONFIRM_FORBIDDEN';
  end if;
  update public.task_contributions set status = 'confirmed'
  where id = p_id returning * into changed;
  return changed;
end;
$$;

create or replace function public.remove_task_contribution(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare current_row public.task_contributions;
begin
  select * into current_row from public.task_contributions where id = p_id for update;
  if not found then return; end if;
  if current_row.status = 'removed' then return; end if;
  if current_row.status = 'confirmed' and not (public.has_app_role('admin') or public.can_lead_task(current_row.task_id)) then
    raise exception 'CONFIRMED_CONTRIBUTION_LOCKED';
  end if;
  if not (public.has_app_role('admin') or public.can_lead_task(current_row.task_id)
          or (current_row.member_user_id = public.current_app_user_id() and current_row.status = 'pending')) then
    raise exception 'CONTRIBUTION_REMOVE_FORBIDDEN';
  end if;
  update public.task_contributions set status = 'removed' where id = p_id;
end;
$$;

revoke all on function public.confirm_task_contribution(uuid) from public;
revoke all on function public.remove_task_contribution(uuid) from public;
grant execute on function public.confirm_task_contribution(uuid) to authenticated;
grant execute on function public.remove_task_contribution(uuid) to authenticated;
