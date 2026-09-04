import { ContributionTag } from '@/constants';
import { DifficultyRevision, TaskContribution, TaskSettlement } from '@/types';
import { USE_MOCK } from './db';
import { ensureOnedayClient } from '@/onedaycloud';

let localContributions: TaskContribution[] = [];
let localRevisions: DifficultyRevision[] = [];
let localSettlements: TaskSettlement[] = [];
let localContributionSequence = 0;

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
  return data ? { taskId: data.task_id, confirmedBy: data.confirmed_by, confirmedAt: String(data.confirmed_at).slice(0, 10), finalDifficulty: data.final_difficulty, difficultyReason: data.difficulty_reason, summary: data.summary } : null;
}

export async function confirmTaskSettlement(settlement: TaskSettlement): Promise<TaskSettlement> {
  if (USE_MOCK) { localSettlements = [...localSettlements.filter(item => item.taskId !== settlement.taskId), settlement]; return settlement; }
  const client = ensureOnedayClient(); if (!client) return settlement;
  const { data, error } = await client.supabase.rpc('settle_task', {
    p_task_id: settlement.taskId, p_final_difficulty: settlement.finalDifficulty,
    p_difficulty_reason: settlement.difficultyReason || null,
    p_summary: settlement.summary || null, p_workload_points: null,
  });
  if (error) throw error;
  return data ? { taskId: data.task_id, confirmedBy: data.confirmed_by, confirmedAt: String(data.confirmed_at).slice(0, 10), finalDifficulty: data.final_difficulty, difficultyReason: data.difficulty_reason, summary: data.summary } : settlement;
}

export const contributionEvidenceLabel: Record<NonNullable<TaskContribution['evidenceType']>, string> = { document: '文档', rescan: '回扫记录', acceptance: '数据验收' };
export const isOtherDeliverable = (tag: ContributionTag) => tag === ContributionTag.OTHER_ACCEPTED_DELIVERABLE;
