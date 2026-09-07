-- 结项事实收口：实际截止时间显式确认；人员工作量只按已确认客观标签分摊。

alter table public.task_settlements
  add column if not exists actual_deadline timestamptz;

create or replace function public.settle_task_v2(
  p_task_id uuid,
  p_final_difficulty smallint,
  p_difficulty_reason text default null,
  p_summary text default null,
  p_actual_deadline timestamptz default null
)
returns public.task_settlements language plpgsql security definer set search_path = public, auth as $$
declare
  changed public.task_settlements;
  current_task public.tasks;
begin
  select * into current_task from public.tasks where id = p_task_id;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  if p_actual_deadline is null then raise exception 'ACTUAL_DEADLINE_REQUIRED'; end if;
  if current_task.dispatched_at is not null and p_actual_deadline < current_task.dispatched_at then
    raise exception 'ACTUAL_DEADLINE_BEFORE_DISPATCH';
  end if;

  -- 复用既有门禁与原子结项逻辑，但不允许调用方传入主观工作量分数。
  select * into changed from public.settle_task(
    p_task_id, p_final_difficulty, p_difficulty_reason, p_summary, null
  );

  update public.task_settlements
  set actual_deadline = p_actual_deadline
  where task_id = p_task_id
  returning * into changed;

  update public.tasks
  set deadline = p_actual_deadline, updated_at = now()
  where id = p_task_id;

  update public.task_events
  set detail = detail || jsonb_build_object('actual_deadline', p_actual_deadline)
  where id = (
    select id from public.task_events
    where task_id = p_task_id and event_type = 'settled'
    order by created_at desc limit 1
  );

  return changed;
end;
$$;

-- 旧接口允许传入任意 workload_points，仅保留给迁移内部兼容调用。
revoke all on function public.settle_task(uuid, smallint, text, text, numeric) from authenticated;
revoke all on function public.settle_task_v2(uuid, smallint, text, text, timestamptz) from public;
grant execute on function public.settle_task_v2(uuid, smallint, text, text, timestamptz) to authenticated;

create or replace function public.member_work_summary(p_start timestamptz, p_end timestamptz, p_grain text default 'week')
returns table(period_start timestamptz, user_id uuid, member text, team text, confirmed_tags bigint, workload_points numeric)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if p_grain not in ('day','week','month') then raise exception 'INVALID_GRAIN'; end if;
  return query
  with member_tags as (
    select c.task_id, c.member_user_id, c.member, count(*)::numeric as tag_count
    from public.task_contributions c where c.status = 'confirmed'
    group by c.task_id, c.member_user_id, c.member
  ), task_tags as (
    select task_id, sum(tag_count) as tag_count from member_tags group by task_id
  )
  select date_trunc(p_grain, s.confirmed_at), member_tags.member_user_id, member_tags.member, t.team,
    sum(member_tags.tag_count)::bigint,
    coalesce(sum(s.workload_points * member_tags.tag_count / nullif(task_tags.tag_count, 0)), 0)
  from public.task_settlements s
  join public.tasks t on t.id = s.task_id
  join member_tags on member_tags.task_id = t.id
  join task_tags on task_tags.task_id = t.id
  where s.confirmed_at >= p_start and s.confirmed_at < p_end and public.can_view_task(t.id)
  group by date_trunc(p_grain, s.confirmed_at), member_tags.member_user_id, member_tags.member, t.team
  order by date_trunc(p_grain, s.confirmed_at), t.team, member_tags.member;
end;
$$;

revoke all on function public.member_work_summary(timestamptz, timestamptz, text) from public;
grant execute on function public.member_work_summary(timestamptz, timestamptz, text) to authenticated;
