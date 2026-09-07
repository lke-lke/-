import { ensureOnedayClient } from '@/onedaycloud';
import { USE_MOCK } from './db';

export interface TaskManagementEvent {
  id: string;
  taskId: string;
  eventType: 'training_completed' | 'rule_change_published' | 'rescan_initiated' | 'rescan_closed' | 'data_acceptance_completed' | 'evaluation_report_approved';
  actorId?: string;
  evidenceLink?: string;
  detail: Record<string, unknown>;
  occurredAt: string;
}

let localEvents: TaskManagementEvent[] = [];

const toEvent = (row: any): TaskManagementEvent => ({
  id: row.id, taskId: row.task_id ?? row.taskId, eventType: row.event_type ?? row.eventType,
  actorId: row.actor_id ?? row.actorId, evidenceLink: row.evidence_link ?? row.evidenceLink,
  detail: row.detail || {}, occurredAt: row.occurred_at ?? row.occurredAt,
});

export async function getTaskManagementEvents(taskId: string): Promise<TaskManagementEvent[]> {
  if (USE_MOCK) return localEvents.filter(event => event.taskId === taskId);
  const client = ensureOnedayClient(); if (!client) return [];
  const { data, error } = await client.supabase.from('task_management_events').select('*').eq('task_id', taskId).order('occurred_at');
  if (error) throw error;
  return (data || []).map(toEvent);
}

export async function registerTaskManagementEvent(input: Omit<TaskManagementEvent, 'id' | 'actorId' | 'occurredAt'>): Promise<TaskManagementEvent> {
  if (USE_MOCK) {
    const event: TaskManagementEvent = { ...input, id: `management-${Date.now()}`, occurredAt: new Date().toISOString() };
    localEvents = [...localEvents, event];
    return event;
  }
  const client = ensureOnedayClient(); if (!client) throw new Error('Supabase 尚未配置');
  const { data, error } = await client.supabase.rpc('register_task_management_event_v2', {
    p_task_id: input.taskId, p_event_type: input.eventType,
    p_evidence_link: input.evidenceLink || null, p_detail: input.detail || {},
  });
  if (error) throw error;
  return toEvent(Array.isArray(data) ? data[0] : data);
}
