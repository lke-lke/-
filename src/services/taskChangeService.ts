import { TaskFieldChange } from '@/types';
import { USE_MOCK } from './db';
import { ensureOnedayClient } from '@/onedaycloud';
let localChanges: TaskFieldChange[] = [];
export async function getTaskFieldChanges(taskId: string) {
  if (USE_MOCK) return localChanges.filter(item => item.taskId === taskId).sort((a, b) => b.changedAt.localeCompare(a.changedAt));
  const client = ensureOnedayClient(); if (!client) return [];
  const { data, error } = await client.supabase.from('task_field_changes').select('*').eq('task_id', taskId).order('changed_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row: any) => ({ id: row.id, taskId: row.task_id, field: row.field, beforeValue: row.before_value, afterValue: row.after_value, changedBy: row.changed_by, changedAt: row.changed_at }));
}
export async function addTaskFieldChanges(taskId: string, changes: Array<Pick<TaskFieldChange, 'field' | 'beforeValue' | 'afterValue'>>, changedBy: string) {
  // Supabase 模式由 tasks_audit_field_changes 触发器统一记录，避免前端伪造修改人或重复写日志。
  if (!USE_MOCK) return;
  const changedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
  localChanges = [...changes.filter(item => String(item.beforeValue ?? '') !== String(item.afterValue ?? '')).map((item, index) => ({ id: `change-${Date.now()}-${index}`, taskId, ...item, changedBy, changedAt })), ...localChanges];
}
