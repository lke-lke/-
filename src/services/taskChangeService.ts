import { TaskFieldChange } from '@/types';
let localChanges: TaskFieldChange[] = [];
export async function getTaskFieldChanges(taskId: string) { return localChanges.filter(item => item.taskId === taskId).sort((a, b) => b.changedAt.localeCompare(a.changedAt)); }
export async function addTaskFieldChanges(taskId: string, changes: Array<Pick<TaskFieldChange, 'field' | 'beforeValue' | 'afterValue'>>, changedBy: string) {
  const changedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
  localChanges = [...changes.filter(item => String(item.beforeValue ?? '') !== String(item.afterValue ?? '')).map((item, index) => ({ id: `change-${Date.now()}-${index}`, taskId, ...item, changedBy, changedAt })), ...localChanges];
}
