export enum TaskStatus {
  PENDING_INFO = '待完善',
  PENDING = '待开始',
  IN_PROGRESS = '进行中',
  DATA_DONE = '数据完成',
  TO_DELIVER = '待交付',
  TO_ACCEPT = '待验收',
  DONE = '已完成',
}

// 任务状态的系统值保持不变，避免影响既有流程判断；看板展示按最新口径互换两个人工确认阶段。
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  [TaskStatus.PENDING_INFO]: '待完善',
  [TaskStatus.PENDING]: '待开始',
  [TaskStatus.IN_PROGRESS]: '进行中',
  [TaskStatus.DATA_DONE]: '数据完成',
  [TaskStatus.TO_DELIVER]: '待验收',
  [TaskStatus.TO_ACCEPT]: '待交付',
  [TaskStatus.DONE]: '已完成',
};

export function getTaskStatusLabel(status: TaskStatus) {
  return TASK_STATUS_LABELS[status] || status;
}

export enum TaskType {
  DATASET_BUILD = '数据集构建',
  DATA_COLLECTION = '数据收集标注',
  EVAL_RULE = '评测规则制定',
  MODEL_EVAL = '模型评测',
  FULL_EVAL = '全流程评测',
  ANALYSIS = '专项分析',
}

export enum TaskOwnership {
  AI_TRYON = 'AI试穿-模型评测',
  LOOKIE = 'lookie横向评测',
  OTHER = '其他',
}

export enum WorkNature {
  FIRST_DELIVERY = '首次交付',
  RESCAN = '回扫',
  SUPPLEMENT = '补标',
}

export enum AlertLevel {
  RED = '红色',
  YELLOW = '黄色',
  BLUE = '蓝色',
}

export enum AlertType {
  NEAR_OVERDUE = '临近逾期',
  OVERDUE = '已逾期',
  PROGRESS_STALL = '标注停滞',
  DOC_STALL = '文档停滞',
  TASK_AGING = '任务老化',
  OVERLOAD = '负荷过高',
  UNEVEN = '分配不均',
}

export enum DocType {
  RULE = '规则文档',
  REQUIREMENT = '需求文档',
  EVAL_REPORT = '评测报告',
  DATA_EXPORT = '数据导出文件',
  QC_RESULT = '质检结果',
  OTHER = '其他',
}

export enum ContributionTag {
  RULE_WRITING = '规则文档撰写',
  REQUIREMENT_WRITING = '需求文档撰写',
  REQUIREMENT_TRAINING = '需求文档培训',
  RULE_TRAINING = '规则培训',
  Q_AND_A = '过程答疑',
  RULE_CHANGE_PUBLISHED = '作业中规则变更并下发',
  RESCAN_INITIATED = '回扫安排/发起',
  DATA_ACCEPTANCE = '数据验收',
  DATA_ANALYSIS = '数据分析',
  EVAL_REPORT_WRITING = '评测报告撰写',
  OTHER_ACCEPTED_DELIVERABLE = '其他已验收交付物',
  MENTORING = '组员带教',
}

export const CONTRIBUTION_TAGS = Object.values(ContributionTag);

export enum RescanReason {
  RULE_CHANGE = '规则变更',
  DATA_QUALITY = '数据质量问题',
  REQUIREMENT_CHANGE = '需求变更',
  OTHER = '其他',
}

export const DIFFICULTY_POINTS: Record<number, number> = {
  1: 1,
  2: 2,
  3: 3,
  4: 5,
  5: 8,
};

export const REQUIRED_DOCS: Record<TaskType, DocType[]> = {
  [TaskType.DATASET_BUILD]: [DocType.REQUIREMENT, DocType.DATA_EXPORT],
  [TaskType.DATA_COLLECTION]: [DocType.RULE, DocType.DATA_EXPORT, DocType.QC_RESULT],
  [TaskType.EVAL_RULE]: [DocType.RULE],
  [TaskType.MODEL_EVAL]: [DocType.RULE, DocType.EVAL_REPORT],
  [TaskType.FULL_EVAL]: [DocType.REQUIREMENT, DocType.RULE, DocType.EVAL_REPORT],
  [TaskType.ANALYSIS]: [DocType.EVAL_REPORT],
};

export enum Team {
  GROUP_A = '业务助理A组',
  GROUP_B = '业务助理B组',
  GROUP_C = '业务助理C组',
  GROUP_D = '业务助理D组',
}

export const TEAM_MEMBERS: Record<Team, string[]> = {
  [Team.GROUP_A]: [],
  [Team.GROUP_B]: [],
  [Team.GROUP_C]: [],
  [Team.GROUP_D]: [],
};

export const TEAM_LEADERS: Record<Team, string> = {
  [Team.GROUP_A]: '',
  [Team.GROUP_B]: '',
  [Team.GROUP_C]: '',
  [Team.GROUP_D]: '',
};

export const ALL_TEAMS: Team[] = [Team.GROUP_A, Team.GROUP_B, Team.GROUP_C, Team.GROUP_D];

export const ALL_MEMBERS = Object.values(TEAM_MEMBERS).flat();

export const TASK_GROUPS: Record<TaskOwnership, string[]> = {
  [TaskOwnership.AI_TRYON]: [
    'GSB细项评测-服装',
    '评测集标注',
    'AI试衣图/商品图采集',
    '点踩原因主观判断',
    '用户图补标',
    '赞踩情况-照片试穿',
    '线上日志-照片试穿',
    '用户图&服饰素材标注',
  ],
  [TaskOwnership.LOOKIE]: [
    'AI试衣图/商品图采集',
    '美妆试穿评测',
  ],
  [TaskOwnership.OTHER]: ['其他'],
};
