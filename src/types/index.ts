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
  status: TaskStatus;
  platformTaskId?: string;
  ruleDocLink?: string;
  difficulty?: number;
  progress: number;
  docCompleteness: number;
  alerts: Alert[];
  remark?: string;
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
