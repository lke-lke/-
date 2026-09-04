-- 业务方确认的三级任务挂链基线：AI 试穿 66 项，lookie 10 项。
-- 后续组长通过任务关系管理新增/停用；历史任务保留快照，不随关系库回写。

insert into public.task_relations(ownership, main_task, linked_task)
select 'AI试穿-模型评测', source.main_task, child.value
from (
  values
    ('线上巡检', '["线上日志-照片试穿","赞踩情况-照片试穿"]'::jsonb),
    ('GSB模型对比评测', '["自研-GSB细项评测-服装","自研-GSB评测-鞋包帽","自研-GSB细项评测-鞋包帽","自研-GSB细项评测-鞋包帽（3模型）","竞对-GSB评测-服装","竞对-GSB细项评测-服装","竞对-GSB细项评测-鞋包帽"]'::jsonb),
    ('模型极端评测', '["自研-极端评测-鞋包帽","极端对比标注-鞋包帽维度（2模型）","极端对比评测-服装维度（2模型）","竞对-极端评测-服装","竞对-极端评测-鞋包帽","多件试穿三模型极端case对比"]'::jsonb),
    ('模型细项评测', '["细项评测-服装","鞋包帽细项评测"]'::jsonb),
    ('评测集标注', '["评测集标注（26-30）","评测集标注（21-25）","评测集标注（16-20）","评测集标注（11-15）","评测集标注（6-10）","评测集标注（5）"]'::jsonb),
    ('评测集采集', '["评测集采集"]'::jsonb),
    ('benchmark对比评测', '["benchmark-竞对-GSB评测","benchmark-竞对-GSB细项评测","benchmark合理性标注"]'::jsonb),
    ('doc分评测', '["doc分标注"]'::jsonb)
) as source(main_task, children)
cross join lateral jsonb_array_elements_text(source.children) as child(value)
on conflict (ownership, main_task, linked_task) do update set active = true, updated_at = now();

insert into public.task_relations(ownership, main_task, linked_task)
select 'AI试穿-模型评测', '临时任务', child.value
from jsonb_array_elements_text('[
  "极端+GSB整体服装维度（2模型）","鞋包帽定向叶子类目异常+极端","异常+极端标注-服装维度","类目信息一致性标注-1",
  "风控数据拦截情况评测","身型问题标注","用户图性别标注","口红训练数据异常标注","帽子放大效果评测","用户图&穿法标注",
  "用户图&服饰素材标注","试衣上身图判断","用户图标注-训练数据","点踩原因主观判断","点踩用户图&极端标注","点踩原因主观判断-服装细项",
  "场景模型ai感训练集","鞋包帽生成图一致性标注","一致性标注","帽穿模标注","用户图样本判断","GPT层级L1-2标注","类目判断","用户图补标",
  "用户图补标2","廓形摸排补标","用户图人像大小比例补标","穿法评测","社区虚拟形象问题下钻","人像评测","美学分析AI评测","质培-评测集标注提升",
  "pair对标注","模特图包类标注","素材分类标注","商家DOC分放宽评测","商家DOC分原因标注下钻","商家DOC分放宽评测2"
]'::jsonb) as child(value)
on conflict (ownership, main_task, linked_task) do update set active = true, updated_at = now();

insert into public.task_relations(ownership, main_task, linked_task)
select 'lookie横向评测', source.main_task, child.value
from (
  values
    ('评测集标注', '["评测集标注（6-8）","评测集标注（3-5）"]'::jsonb),
    ('效果评测', '["效果评测-整体（除披肩）","效果评测-美瞳","效果评测-美瞳-用户图标注","效果评测-美妆","效果评测-眼镜","效果评测-口红"]'::jsonb),
    ('临时任务', '["效果评测-口红-训练数据","效果评测-补标"]'::jsonb)
) as source(main_task, children)
cross join lateral jsonb_array_elements_text(source.children) as child(value)
on conflict (ownership, main_task, linked_task) do update set active = true, updated_at = now();

do $$
declare ai_count integer;
declare lookie_count integer;
begin
  select count(*) into ai_count from public.task_relations where ownership = 'AI试穿-模型评测' and active;
  select count(*) into lookie_count from public.task_relations where ownership = 'lookie横向评测' and active;
  if ai_count <> 66 then raise exception 'AI试穿挂链数量应为 66，实际为 %', ai_count; end if;
  if lookie_count <> 10 then raise exception 'lookie 挂链数量应为 10，实际为 %', lookie_count; end if;
end;
$$;
