-- 工作标签写入 RPC：组员只能记录本人，组长/管理员可为成员挂载并确认。

create or replace function public.add_task_contribution(
  p_task_id uuid,
  p_member text,
  p_tag text,
  p_evidence_type text default null,
  p_evidence_id uuid default null,
  p_note text default null
)
returns public.task_contributions
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_id uuid := public.current_app_user_id();
  actor_name text := public.current_actor_name();
  target_user_id uuid;
  target_name text;
  created public.task_contributions;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_evidence_type is not null and p_evidence_type not in ('document', 'rescan', 'acceptance') then raise exception 'INVALID_EVIDENCE_TYPE'; end if;
  if nullif(trim(p_tag), '') is null then raise exception 'CONTRIBUTION_TAG_REQUIRED'; end if;

  if public.has_app_role('admin') or public.has_app_role('leader') then
    target_name := trim(p_member);
    select id into target_user_id from public.app_users where name = target_name and status = 'active' order by created_at limit 1;
  else
    target_user_id := actor_id;
    target_name := actor_name;
  end if;

  insert into public.task_contributions(
    task_id, member, member_user_id, tag, evidence_type, evidence_id,
    note, attached_by, attached_by_user_id
  ) values (
    p_task_id, target_name, target_user_id, trim(p_tag), p_evidence_type,
    p_evidence_id, p_note, actor_name, actor_id
  ) returning * into created;
  return created;
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
  if not (public.has_app_role('admin') or public.has_app_role('leader') or current_row.member_user_id = public.current_app_user_id())
    then raise exception 'CONTRIBUTION_REMOVE_FORBIDDEN'; end if;
  if current_row.status = 'confirmed' and not (public.has_app_role('admin') or public.has_app_role('leader'))
    then raise exception 'CONFIRMED_CONTRIBUTION_LOCKED'; end if;
  update public.task_contributions set status = 'removed' where id = p_id;
end;
$$;

revoke all on function public.add_task_contribution(uuid, text, text, text, uuid, text) from public;
revoke all on function public.remove_task_contribution(uuid) from public;
grant execute on function public.add_task_contribution(uuid, text, text, text, uuid, text) to authenticated;
grant execute on function public.remove_task_contribution(uuid) to authenticated;
