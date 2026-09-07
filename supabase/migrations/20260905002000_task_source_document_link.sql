-- 台账“规则文档”只作为任务已有资料入口保留，不生成正式交付物或审核事实。

create or replace function public.apply_excel_source_document_link()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  source_link text;
begin
  if new.source_type is distinct from 'excel' or new.source_payload is null then return new; end if;
  if tg_op = 'UPDATE' and public.task_field_is_manually_locked(new.id, 'rule_doc_link') then return new; end if;

  select nullif(trim(entry.value), '') into source_link
  from jsonb_each_text(new.source_payload) entry
  where public.normalize_lookup_text(entry.key) in ('规则文档', '规则文档链接', '来源文档链接')
    and nullif(trim(entry.value), '') is not null
  limit 1;

  if source_link is not null then new.rule_doc_link := source_link; end if;
  return new;
end;
$$;

drop trigger if exists tasks_apply_excel_source_document_link on public.tasks;
create trigger tasks_apply_excel_source_document_link
before insert or update of source_payload on public.tasks
for each row execute function public.apply_excel_source_document_link();

-- 给此前已经导入、但尚未写入已有资料入口的任务补齐链接。
update public.tasks t
set rule_doc_link = (
  select nullif(trim(entry.value), '')
  from jsonb_each_text(t.source_payload) entry
  where public.normalize_lookup_text(entry.key) in ('规则文档', '规则文档链接', '来源文档链接')
    and nullif(trim(entry.value), '') is not null
  limit 1
)
where t.source_type = 'excel'
  and nullif(t.rule_doc_link, '') is null
  and not public.task_field_is_manually_locked(t.id, 'rule_doc_link')
  and exists (
    select 1 from jsonb_each_text(t.source_payload) entry
    where public.normalize_lookup_text(entry.key) in ('规则文档', '规则文档链接', '来源文档链接')
      and nullif(trim(entry.value), '') is not null
  );

comment on column public.tasks.rule_doc_link is '台账已有资料/来源文档链接；不等同于平台交付物，不参与审核齐套判断。';

revoke all on function public.apply_excel_source_document_link() from public;
