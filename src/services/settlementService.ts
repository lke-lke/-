import dayjs from 'dayjs';
import { ContributionTag, DIFFICULTY_POINTS, Team } from '@/constants';
import { DifficultyRevision, Task, TaskContribution, TaskSettlement } from '@/types';
import { USE_MOCK } from './db';
import { ensureOnedayClient } from '@/onedaycloud';

let localContributions: TaskContribution[] = [];
let localRevisions: DifficultyRevision[] = [];
let localSettlements: TaskSettlement[] = [];
let localContributionSequence = 0;

export interface MemberWorkSummaryRow {
  periodStart: string;
  userId?: string;
  member: string;
  team: Team;
  confirmedTags: number;
  workloadPoints: number;
}

const toContribution = (row: any): TaskContribution => ({
  id: row.id, taskId: row.taskId ?? row.task_id, member: row.member, tag: row.tag,
  evidenceType: row.evidenceType ?? row.evidence_type, evidenceId: row.evidenceId ?? row.evidence_id,
  note: row.note, attachedBy: row.attachedBy ?? row.attached_by,
  attachedAt: row.attachedAt ?? String(row.attached_at).slice(0, 10),
  status: row.status ?? 'pending', confirmedBy: row.confirmedBy ?? row.confirmed_by,
  confirmedAt: row.confirmedAt ?? (row.confirmed_at ? String(row.confirmed_at).slice(0, 16) : undefined),
});

const toRevision = (row: any): DifficultyRevision => ({
  id: row.id, taskId: row.taskId ?? row.task_id, difficulty: Number(row.difficulty), phase: row.phase,
  reason: row.reason, confirmedBy: row.confirmedBy ?? row.confirmed_by,
  confirmedAt: row.confirmedAt ?? String(row.confirmed_at).slice(0, 10),
});

export async function getTaskContributions(taskId: string): Promise<TaskContribution[]> {
  if (USE_MOCK) return localContributions.filter(item => item.taskId === taskId);
  const client = ensureOnedayClient(); if (!client) return [];
  const { data } = await client.supabase.from('task_contributions').select('*').eq('task_id', taskId).order('attached_at');
  return (data || []).map(toContribution);
}
export async function getAllTaskContributions(): Promise<TaskContribution[]> {
  if (USE_MOCK) return localContributions;
  const client = ensureOnedayClient(); if (!client) return [];
  const { data } = await client.supabase.from('task_contributions').select('*').order('attached_at', { ascending: false });
  return (data || []).map(toContribution);
}

/**
 * 结项工作量的唯一前端读取入口。
 * 正式环境由数据库按“任务结项难度点 × 成员已确认标签占比”计算；
 * 演示模式复用相同公式，保证页面不会出现另一套主观分数。
 */
export async function getMemberWorkSummary(
  tasks: Task[],
  contributions: TaskContribution[],
  start: dayjs.Dayjs,
  end: dayjs.Dayjs,
  grain: 'day' | 'week' | 'month',
): Promise<MemberWorkSummaryRow[]> {
  if (!USE_MOCK) {
    const client = ensureOnedayClient(); if (!client) return [];
    const { data, error } = await client.supabase.rpc('member_work_summary', {
      p_start: start.startOf('day').toISOString(),
      p_end: end.add(1, 'day').startOf('day').toISOString(),
      p_grain: grain,
    });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      periodStart: row.periodStart ?? row.period_start,
      userId: row.userId ?? row.user_id,
      member: row.member,
      team: row.team as Team,
      confirmedTags: Number(row.confirmedTags ?? row.confirmed_tags ?? 0),
      workloadPoints: Number(row.workloadPoints ?? row.workload_points ?? 0),
    }));
  }

  const taskMap = new Map(tasks.map(task => [task.id, task]));
  const rows = new Map<string, MemberWorkSummaryRow>();
  localSettlements
    .filter(settlement => {
      const date = dayjs(settlement.confirmedAt);
      return !date.isBefore(start, 'day') && !date.isAfter(end, 'day');
    })
    .forEach(settlement => {
      const task = taskMap.get(settlement.taskId);
      if (!task) return;
      const taskTags = contributions.filter(item => item.taskId === settlement.taskId && item.status === 'confirmed');
      if (!taskTags.length) return;
      const tagsByMember = taskTags.reduce((result, item) => {
        result.set(item.member, (result.get(item.member) || 0) + 1);
        return result;
      }, new Map<string, number>());
      const periodStart = dayjs(settlement.confirmedAt).startOf(grain).toISOString();
      const taskPoints = DIFFICULTY_POINTS[settlement.finalDifficulty] || 0;
      tagsByMember.forEach((confirmedTags, member) => {
        const key = `${periodStart}|${task.team}|${member}`;
        const current = rows.get(key) || { periodStart, member, team: task.team, confirmedTags: 0, workloadPoints: 0 };
        current.confirmedTags += confirmedTags;
        current.workloadPoints += taskPoints * confirmedTags / taskTags.length;
        rows.set(key, current);
      });
    });
  return [...rows.values()].map(row => ({ ...row, workloadPoints: Number(row.workloadPoints.toFixed(2)) }));
}

export async function addTaskContribution(input: Omit<TaskContribution, 'id' | 'attachedAt'>): Promise<TaskContribution> {
  const item: TaskContribution = { ...input, id: `tc${Date.now()}-${++localContributionSequence}`, attachedAt: new Date().toISOString().slice(0, 10) };
  if (USE_MOCK) { localContributions.push(item); return item; }
  const client = ensureOnedayClient(); if (!client) return item;
  const { data, error } = await client.supabase.rpc('add_task_contribution', {
    p_task_id: item.taskId, p_member: item.member, p_tag: item.tag,
    p_evidence_type: item.evidenceType || null, p_evidence_id: item.evidenceId || null,
    p_note: item.note || null,
  });
  if (error) throw error;
  return data ? toContribution(data) : item;
}

export async function confirmTaskContribution(id: string, confirmedBy: string): Promise<TaskContribution | null> {
  const confirmedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
  if (USE_MOCK) { const index = localContributions.findIndex(item => item.id === id); if (index < 0) return null; localContributions[index] = { ...localContributions[index], status: 'confirmed', confirmedBy, confirmedAt }; return localContributions[index]; }
  const client = ensureOnedayClient(); if (!client) return null;
  const { data, error } = await client.supabase.rpc('confirm_task_contribution', { p_id: id });
  if (error) throw error;
  return data ? toContribution(data) : null;
}

export async function removeTaskContribution(id: string): Promise<void> {
  if (USE_MOCK) { localContributions = localContributions.filter(item => item.id !== id); return; }
  const client = ensureOnedayClient(); if (!client) return;
  const { error } = await client.supabase.rpc('remove_task_contribution', { p_id: id });
  if (error) throw error;
}

export async function getDifficultyRevisions(taskId: string): Promise<DifficultyRevision[]> {
  if (USE_MOCK) return localRevisions.filter(item => item.taskId === taskId);
  const client = ensureOnedayClient(); if (!client) return [];
  const { data } = await client.supabase.from('difficulty_revisions').select('*').eq('task_id', taskId).order('confirmed_at');
  return (data || []).map(toRevision);
}

export async function saveFinalDifficulty(input: Omit<DifficultyRevision, 'id' | 'confirmedAt' | 'phase'>): Promise<DifficultyRevision> {
  const item: DifficultyRevision = { ...input, id: `dr${Date.now()}`, phase: 'final', confirmedAt: new Date().toISOString().slice(0, 10) };
  if (USE_MOCK) { localRevisions.push(item); return item; }
  // 正式模式在 settle_task RPC 中与结项记录同事务保存，避免“星级已改但结项失败”。
  return item;
}

export async function getTaskSettlement(taskId: string): Promise<TaskSettlement | null> {
  if (USE_MOCK) return localSettlements.find(item => item.taskId === taskId) || null;
  const client = ensureOnedayClient(); if (!client) return null;
  const { data } = await client.supabase.from('task_settlements').select('*').eq('task_id', taskId).maybeSingle();
  return data ? { taskId: data.task_id, confirmedBy: data.confirmed_by, confirmedAt: String(data.confirmed_at).slice(0, 10), finalDifficulty: data.final_difficulty, difficultyReason: data.difficulty_reason, summary: data.summary, actualDeadline: data.actual_deadline ? String(data.actual_deadline).slice(0, 10) : undefined } : null;
}

export async function confirmTaskSettlement(settlement: TaskSettlement): Promise<TaskSettlement> {
  if (USE_MOCK) { localSettlements = [...localSettlements.filter(item => item.taskId !== settlement.taskId), settlement]; return settlement; }
  const client = ensureOnedayClient(); if (!client) return settlement;
  const { data, error } = await client.supabase.rpc('settle_task_v2', {
    p_task_id: settlement.taskId, p_final_difficulty: settlement.finalDifficulty,
    p_difficulty_reason: settlement.difficultyReason || null,
    p_summary: settlement.summary || null, p_actual_deadline: settlement.actualDeadline || null,
  });
  if (error) throw error;
  return data ? { taskId: data.task_id, confirmedBy: data.confirmed_by, confirmedAt: String(data.confirmed_at).slice(0, 10), finalDifficulty: data.final_difficulty, difficultyReason: data.difficulty_reason, summary: data.summary, actualDeadline: data.actual_deadline ? String(data.actual_deadline).slice(0, 10) : settlement.actualDeadline } : settlement;
}

export const contributionEvidenceLabel: Record<NonNullable<TaskContribution['evidenceType']>, string> = { document: '文档', rescan: '回扫记录', acceptance: '数据验收' };
export const isOtherDeliverable = (tag: ContributionTag) => tag === ContributionTag.OTHER_ACCEPTED_DELIVERABLE;
