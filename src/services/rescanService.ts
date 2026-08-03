import { RescanRecord } from '@/types';
import { USE_MOCK } from './db';
import { mockRescanRecords } from '@/mock';
import { ensureOnedayClient } from '@/onedaycloud';

let localRecords = [...mockRescanRecords];

const toRecord = (row: any): RescanRecord => ({
  ...row,
  originalTaskId: row.originalTaskId ?? row.original_task_id,
  originalTaskName: row.originalTaskName ?? row.original_task_name,
  rescanVolume: row.rescanVolume ?? row.rescan_volume,
  contactAssistant: row.contactAssistant ?? row.contact_assistant,
  expectedDone: (row.expectedDone ?? row.expected_done) ? String(row.expectedDone ?? row.expected_done).slice(0, 10) : '',
  actualDone: (row.actualDone ?? row.actual_done) ? String(row.actualDone ?? row.actual_done).slice(0, 10) : undefined,
  createdAt: row.createdAt ?? String(row.created_at).slice(0, 10),
});

const toRecordRow = (record: Omit<RescanRecord, 'id' | 'createdAt'>) => ({
  original_task_id: record.originalTaskId,
  original_task_name: record.originalTaskName,
  reason: record.reason,
  description: record.description,
  rescan_volume: record.rescanVolume,
  executors: record.executors,
  contact_assistant: record.contactAssistant,
  expected_done: record.expectedDone,
  actual_done: record.actualDone,
  accepted: record.accepted,
});

export async function getRescanRecords(filters?: { taskId?: string; assistant?: string }): Promise<RescanRecord[]> {
  if (USE_MOCK) {
    let result = localRecords;
    if (filters?.taskId) result = result.filter(r => r.originalTaskId === filters.taskId);
    if (filters?.assistant) result = result.filter(r => r.contactAssistant === filters.assistant);
    return result;
  }
  const client = ensureOnedayClient();
  if (!client) return [];
  let query = client.supabase.from('rescan_records').select('*');
  if (filters?.taskId) query = query.eq('original_task_id', filters.taskId);
  const { data } = await query.order('created_at', { ascending: false });
  return (data || []).map(toRecord);
}

export async function createRescanRecord(record: Omit<RescanRecord, 'id' | 'createdAt'>): Promise<RescanRecord> {
  const newRecord: RescanRecord = {
    ...record,
    id: `r${Date.now()}`,
    createdAt: new Date().toISOString().split('T')[0],
  };
  if (USE_MOCK) {
    localRecords.unshift(newRecord);
    return newRecord;
  }
  const client = ensureOnedayClient();
  if (!client) return newRecord;
  const { data } = await client.supabase.from('rescan_records').insert([toRecordRow(newRecord)]).select().single();
  return data ? toRecord(data) : newRecord;
}
