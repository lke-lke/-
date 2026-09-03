import { TaskRelation } from '@/types';

const aiGroups: Record<string, string[]> = {
  '线上巡检': ['线上日志-照片试穿', '赞踩情况-照片试穿'],
  'GSB模型对比评测': ['自研-GSB细项评测-服装', '自研-GSB评测-鞋包帽', '自研-GSB细项评测-鞋包帽', '自研-GSB细项评测-鞋包帽（3模型）', '竞对-GSB评测-服装', '竞对-GSB细项评测-服装', '竞对-GSB细项评测-鞋包帽'],
  '模型极端评测': ['自研-极端评测-鞋包帽', '极端对比标注-鞋包帽维度（2模型）', '极端对比评测-服装维度（2模型）', '竞对-极端评测-服装', '竞对-极端评测-鞋包帽', '多件试穿三模型极端case对比'],
  '模型细项评测': ['细项评测-服装', '鞋包帽细项评测'],
  '评测集标注': ['评测集标注（26-30）', '评测集标注（21-25）', '评测集标注（16-20）', '评测集标注（11-15）', '评测集标注（6-10）', '评测集标注（5）'],
  '评测集采集': ['评测集采集'],
  'benchmark对比评测': ['benchmark-竞对-GSB评测', 'benchmark-竞对-GSB细项评测', 'benchmark合理性标注'],
  'doc分评测': ['doc分标注'],
};

const aiIndependent = ['极端+GSB整体服装维度（2模型）', '鞋包帽定向叶子类目异常+极端', '异常+极端标注-服装维度', '类目信息一致性标注-1', '风控数据拦截情况评测', '身型问题标注', '用户图性别标注', '口红训练数据异常标注', '帽子放大效果评测', '用户图&穿法标注', '用户图&服饰素材标注', '试衣上身图判断', '用户图标注-训练数据', '点踩原因主观判断', '点踩用户图&极端标注', '点踩原因主观判断-服装细项', '场景模型ai感训练集', '鞋包帽生成图一致性标注', '一致性标注', '帽穿模标注', '用户图样本判断', 'GPT层级L1-2标注', '类目判断', '用户图补标', '用户图补标2', '廓形摸排补标', '用户图人像大小比例补标', '穿法评测', '社区虚拟形象问题下钻', '人像评测', '美学分析AI评测', '质培-评测集标注提升', 'pair对标注', '模特图包类标注', '素材分类标注', '商家DOC分放宽评测', '商家DOC分原因标注下钻', '商家DOC分放宽评测2'];

const lookieGroups: Record<string, string[]> = {
  // 以业务方确认的三级挂链为唯一来源：lookie横向评测（10）= 2 + 6 + 2。
  '评测集标注': ['评测集标注（6-8）', '评测集标注（3-5）'],
  '效果评测': ['效果评测-整体（除披肩）', '效果评测-美瞳', '效果评测-美瞳-用户图标注', '效果评测-美妆', '效果评测-眼镜', '效果评测-口红'],
};
// 无主任务从属关系：在下拉中统一归并为唯一“临时任务”入口。
const lookieIndependent = ['效果评测-口红-训练数据', '效果评测-补标'];

function seeds(ownership: string, groups: Record<string, string[]>, independent: string[]): TaskRelation[] {
  const rows: TaskRelation[] = [];
  Object.entries(groups).forEach(([mainTask, children]) => children.forEach((linkedTask, index) => rows.push({
    id: `${ownership}-${mainTask}-${index}`.replace(/\s/g, ''), ownership, mainTask, linkedTask, active: true, createdAt: '2026-08-01', updatedAt: '2026-08-01',
  })));
  independent.forEach((linkedTask, index) => rows.push({ id: `${ownership}-independent-${index}`, ownership, mainTask: '-', linkedTask, active: true, createdAt: '2026-08-01', updatedAt: '2026-08-01' }));
  return rows;
}

let localRelations: TaskRelation[] = [
  ...seeds('AI试穿-模型评测', aiGroups, aiIndependent),
  ...seeds('lookie横向评测', lookieGroups, lookieIndependent),
];

export async function getTaskRelations(ownership?: string): Promise<TaskRelation[]> {
  return localRelations.filter(item => item.active && (!ownership || item.ownership === ownership));
}

export async function saveTaskRelation(input: Omit<TaskRelation, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<TaskRelation> {
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  if (input.id) {
    const index = localRelations.findIndex(item => item.id === input.id);
    if (index >= 0) { localRelations[index] = { ...localRelations[index], ...input, updatedAt: now }; return localRelations[index]; }
  }
  const relation: TaskRelation = { ...input, id: `relation-${Date.now()}`, createdAt: now, updatedAt: now };
  localRelations = [...localRelations, relation];
  return relation;
}

export async function archiveTaskRelation(id: string): Promise<void> {
  localRelations = localRelations.map(item => item.id === id ? { ...item, active: false, updatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') } : item);
}

export function buildRelationTree(relations: TaskRelation[]) {
  return Object.entries(relations.reduce<Record<string, Record<string, TaskRelation[]>>>((acc, relation) => {
    (acc[relation.ownership] ||= {}); (acc[relation.ownership][relation.mainTask] ||= []).push(relation); return acc;
  }, {})).map(([ownership, mains]) => ({ ownership, total: Object.values(mains).flat().length, mains: Object.entries(mains).map(([mainTask, children]) => ({ mainTask, children })) }));
}
