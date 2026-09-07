-- 真实 2026-09 台账出现的动态分组。业务方已明确归属为 AI 试穿，
-- 原始关系基线尚未指定更细主任务，因此先显式归入“临时任务”。

insert into public.task_relations(ownership, main_task, linked_task)
values
  ('AI试穿-模型评测', '临时任务', 'AI试衣图/商品图采集'),
  ('AI试穿-模型评测', '临时任务', '效果评测-美妆')
on conflict (ownership, main_task, linked_task)
do update set active = true, updated_at = now();
