import { TaskStatus, TaskType, TaskOwnership, WorkNature, DocType, AlertLevel, AlertType, RescanReason, Team, ContributionTag } from '@/constants';

export interface Task {
  id: string;
  name: string;
  ownership: TaskOwnership;
  taskGroup: string;
  workNature: WorkNature;
  taskType: TaskType;
  assignee: string;
  team: Team;
  teamLeader: string;
  dataReporter: string;
  reviewer: string;
  dataVolume: number;
  workforce: number;
  createdAt: string;
  deadline: string;
  /** 组长预填的预计完成时间；实际截止时间以 deadline 为准。 */
  expectedDeadline?: string;
  status: TaskStatus;
  platformTaskId?: string;
  ruleDocLink?: string;
  difficulty?: number;
  progress: number;
  docCompleteness: number;
  alerts: Alert[];
  remark?: string;
  relationId?: string;
  mainTask?: string;
  linkedTask?: string;
  participantNames?: string[];
}

export interface TaskRelation {
  id: string;
  ownership: string;
  mainTask: string;
  linkedTask: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskFieldChange {
  id: string;
  taskId: string;
  field: string;
  beforeValue?: string | number;
  afterValue?: string | number;
  changedBy: string;
  changedAt: string;
}

export interface Document {
  id: string;
  taskId: string;
  docType: DocType;
  name: string;
  link: string;
  uploader: string;
  uploadedAt: string;
  status?: 'pending_review' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewedAt?: string;
  reviewComment?: string;
  version?: number;
  replacedDocumentId?: string;
  /** 组长验收后，可提交管理员作二级审核；该链路预留给后续管理员/组员页面。 */
  adminReviewStatus?: 'not_submitted' | 'pending' | 'approved' | 'rejected';
  submittedToAdminAt?: string;
  adminReviewedBy?: string;
  adminReviewedAt?: string;
  adminReviewComment?: string;
  /** 管理员驳回后重提不会清零，用于管理员跟踪返修轮次。 */
  adminRevisionCount?: number;
  /** 审核路线由组长首次验收时决定；进入管理员路线后不可降级。 */
  reviewRoute?: 'undecided' | 'leader_only' | 'leader_then_admin';
  workflowStatus?: 'pending_leader_review' | 'member_revision_required' | 'pending_admin_review' | 'leader_revision_required' | 'completed_by_leader' | 'completed_by_admin';
  leaderRejectionCount?: number;
  finalApprovalLevel?: 'leader' | 'admin';
  completedBy?: string;
  completedAt?: string;
  /** 同一交付物多个版本共用的根记录，便于串起完整审核历史。 */
  rootDocumentId?: string;
}

export interface DocumentReviewEvent {
  id: string;
  documentId: string;
  rootDocumentId: string;
  taskId: string;
  actor: string;
  actorRole: '管理员' | '组长' | '组员';
  action: 'member_submitted' | 'leader_rejected' | 'leader_completed' | 'leader_submitted_admin' | 'admin_rejected' | 'admin_completed' | 'leader_returned_member' | 'leader_resubmitted_admin';
  fromStatus?: Document['workflowStatus'];
  toStatus: NonNullable<Document['workflowStatus']>;
  comment?: string;
  createdAt: string;
}

export interface TaskContribution {
  id: string;
  taskId: string;
  member: string;
  tag: ContributionTag;
  evidenceType?: 'document' | 'rescan' | 'acceptance';
  evidenceId?: string;
  note?: string;
  attachedBy: string;
  attachedAt: string;
  status?: 'pending' | 'confirmed' | 'removed';
  confirmedBy?: string;
  confirmedAt?: string;
}

export interface DifficultyRevision {
  id: string;
  taskId: string;
  difficulty: number;
  phase: 'initial' | 'final';
  reason?: string;
  confirmedBy: string;
  confirmedAt: string;
}

export interface TaskSettlement {
  taskId: string;
  confirmedBy: string;
  confirmedAt: string;
  finalDifficulty: number;
  difficultyReason?: string;
  summary?: string;
}

export interface RescanRecord {
  id: string;
  originalTaskId: string;
  originalTaskName: string;
  reason: RescanReason;
  description: string;
  rescanVolume: number;
  executors: string[];
  contactAssistant: string;
  expectedDone: string;
  actualDone?: string;
  accepted?: boolean;
  createdAt: string;
}

export interface ProgressSnapshot {
  taskId: string;
  total: number;
  completed: number;
  percentage: number;
  syncedAt: string;
}

export interface Member {
  id: string;
  name: string;
  team: Team;
  role: 'leader' | 'assistant' | 'operator';
  activeTasks: number;
  difficultyPoints: number;
  completedPoints4w: number;
}

export interface Alert {
  type: AlertType;
  level: AlertLevel;
  message: string;
  triggeredAt: string;
}

export interface OverviewStats {
  totalDispatched: number;
  totalCompleted: number;
  inProgress: number;
  overdue: number;
  onTimeRate: number;
  docCompleteRate: number;
  alertRate: number;
}
