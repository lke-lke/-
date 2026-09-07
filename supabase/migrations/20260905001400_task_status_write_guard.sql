-- 禁止通过 REST/直接 update 绕过任务状态机、事件和结项门禁。
create or replace function public.guard_task_status_write()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status and coalesce(current_setting('app.allow_task_status_transition', true), '') <> 'on' then
    raise exception 'TASK_STATUS_MUST_USE_WORKFLOW_RPC';
  end if;
  return new;
end;
$$;
drop trigger if exists tasks_guard_status_write on public.tasks;
create trigger tasks_guard_status_write before update of status on public.tasks
for each row execute function public.guard_task_status_write();
