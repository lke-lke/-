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

export async function addTaskContribution(input: Omit<TaskContribution, 'id' | 'attachedAt'>): Promise<TaskContribution> {
  const item: TaskContribution = { ...input, id: `tc${Date.now()}-${++localContributionSequence}`, attachedAt: new Date().toISOString().slice(0, 10) };
  if (USE_MOCK) { localContributions.push(item); return item; }
  const client = ensureOnedayClient(); if (!client) return item;
  const { data } = await client.supabase.from('task_contributions').insert([{
    task_id: item.taskId, member: item.member, tag: item.tag, evidence_type: item.evidenceType,
    evidence_id: item.evidenceId, note: item.note, attached_by: item.attachedBy, attached_at: item.attachedAt,
  }]).select().single();
  return data ? toContribution(data) : item;
}

export async function removeTaskContribution(id: string): Promise<void> {
  if (USE_MOCK) { localContributions = localContributions.filter(item => item.id !== id); return; }
  const client = ensureOnedayClient(); if (client) await client.supabase.from('task_contributions').delete().eq('id', id);
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
  const client = ensureOnedayClient(); if (!client) return item;
  const { data } = await client.supabase.from('difficulty_revisions').insert([{
    task_id: item.taskId, difficulty: item.difficulty, phase: 'final', reason: item.reason, confirmed_by: item.confirmedBy, confirmed_at: item.confirmedAt,
  }]).select().single();
  return data ? toRevision(data) : item;
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
  const { data } = await client.supabase.from('task_settlements').upsert({
    task_id: settlement.taskId, confirmed_by: settlement.confirmedBy, confirmed_at: settlement.confirmedAt,
    final_difficulty: settlement.finalDifficulty, difficulty_reason: settlement.difficultyReason, summary: settlement.summary,
  }).select().single();
  return data ? { taskId: data.task_id, confirmedBy: data.confirmed_by, confirmedAt: String(data.confirmed_at).slice(0, 10), finalDifficulty: data.final_difficulty, difficultyReason: data.difficulty_reason, summary: data.summary } : settlement;
}

export const contributionEvidenceLabel: Record<NonNullable<TaskContribution['evidenceType']>, string> = { document: '文档', rescan: '回扫记录', acceptance: '数据验收' };
export const isOtherDeliverable = (tag: ContributionTag) => tag === ContributionTag.OTHER_ACCEPTED_DELIVERABLE;
