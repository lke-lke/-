import { Task } from '@/types';
import { TaskStatus } from '@/constants';
import { USE_MOCK } from './db';
import { mockTasks } from '@/mock';
import { ensureOnedayClient } from '@/onedaycloud';

let localTasks = [...mockTasks];

const toTask = (row: any): Task => ({
  ...row,
  taskGroup: row.taskGroup ?? row.task_group,
  workNature: row.workNature ?? row.work_nature,
  teamLeader: row.teamLeader ?? row.team_leader,
  dataReporter: row.dataReporter ?? row.data_reporter ?? '',
  dataVolume: row.dataVolume ?? row.data_volume ?? 0,
  platformTaskId: row.platformTaskId ?? row.platform_task_id,
  ruleDocLink: row.ruleDocLink ?? row.rule_doc_link,
  relationId: row.relationId ?? row.relation_id,
  mainTask: row.mainTask ?? row.main_task_snapshot,
  linkedTask: row.linkedTask ?? row.linked_task_snapshot,
  docCompleteness: Number(row.docCompleteness ?? row.doc_completeness ?? 0),
  progress: Number(row.progress ?? 0),
  createdAt: row.createdAt ?? String(row.created_at).slice(0, 10),
  deadline: row.deadline ? String(row.deadline).slice(0, 10) : '',
  expectedDeadline: row.expectedDeadline ?? (row.expected_deadline ? String(row.expected_deadline).slice(0, 10) : ''),
  alerts: row.alerts ?? [],
});

const toTaskRow = (task: Partial<Task>) => {
  const { taskGroup, workNature, teamLeader, dataReporter, dataVolume, platformTaskId, ruleDocLink, relationId, mainTask, linkedTask, docCompleteness, createdAt, expectedDeadline, alerts, ...rest } = task;
  return {
    ...rest,
    ...(taskGroup !== undefined && { task_group: taskGroup }),
    ...(workNature !== undefined && { work_nature: workNature }),
    ...(teamLeader !== undefined && { team_leader: teamLeader }),
    ...(dataReporter !== undefined && { data_reporter: dataReporter }),
    ...(dataVolume !== undefined && { data_volume: dataVolume }),
    ...(platformTaskId !== undefined && { platform_task_id: platformTaskId }),
    ...(ruleDocLink !== undefined && { rule_doc_link: ruleDocLink }),
    ...(relationId !== undefined && { relation_id: relationId || null }),
    ...(mainTask !== undefined && { main_task_snapshot: mainTask }),
    ...(linkedTask !== undefined && { linked_task_snapshot: linkedTask }),
    ...(docCompleteness !== undefined && { doc_completeness: docCompleteness }),
    ...(createdAt !== undefined && { created_at: createdAt }),
    ...(expectedDeadline !== undefined && { expected_deadline: expectedDeadline || null }),
  };
};

export async function getTasks(filters?: {
  status?: TaskStatus;
  team?: string;
  assignee?: string;
  ownership?: string;
}): Promise<Task[]> {
  if (USE_MOCK) {
    let result = localTasks;
    if (filters?.status) result = result.filter(t => t.status === filters.status);
    if (filters?.team) result = result.filter(t => t.team === filters.team);
    if (filters?.assignee) result = result.filter(t => t.assignee === filters.assignee);
    if (filters?.ownership) result = result.filter(t => t.ownership === filters.ownership);
    return result;
  }
  const client = ensureOnedayClient();
  if (!client) return [];
  let query = client.supabase.from('tasks').select('*');
  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.team) query = query.eq('team', filters.team);
  if (filters?.assignee) query = query.eq('assignee', filters.assignee);
  const { data } = await query.order('created_at', { ascending: false });
  return (data || []).map(toTask);
}

export async function getTaskById(id: string): Promise<Task | null> {
  if (USE_MOCK) {
    return localTasks.find(t => t.id === id) || null;
  }
  const client = ensureOnedayClient();
  if (!client) return null;
  const { data } = await client.supabase.from('tasks').select('*').eq('id', id).single();
  return data ? toTask(data) : null;
}

export async function createTask(task: Omit<Task, 'id' | 'status' | 'progress' | 'docCompleteness' | 'alerts'> & { initialStatus?: TaskStatus }): Promise<Task> {
  const { initialStatus, ...taskData } = task;
  const newTask: Task = {
    ...taskData,
    id: `t${Date.now()}`,
    status: initialStatus || TaskStatus.PENDING,
    progress: 0,
    docCompleteness: 0,
    alerts: [],
  };
  if (USE_MOCK) {
    localTasks.unshift(newTask);
    return newTask;
  }
  const client = ensureOnedayClient();
  if (!client) return newTask;
  const { data } = await client.supabase.from('tasks').insert([toTaskRow(newTask)]).select().single();
  return data ? toTask(data) : newTask;
}

export async function updateTask(id: string, updates: Partial<Task>): Promise<Task | null> {
  if (USE_MOCK) {
    const idx = localTasks.findIndex(t => t.id === id);
    if (idx === -1) return null;
    localTasks[idx] = { ...localTasks[idx], ...updates };
    return localTasks[idx];
  }
  const client = ensureOnedayClient();
  if (!client) return null;
  const { data } = await client.supabase.from('tasks').update(toTaskRow(updates)).eq('id', id).select().single();
  return data ? toTask(data) : null;
}

export function getTasksByStatus(): Record<TaskStatus, Task[]> {
  const grouped: Record<TaskStatus, Task[]> = {
    [TaskStatus.PENDING_INFO]: [],
    [TaskStatus.PENDING]: [],
    [TaskStatus.IN_PROGRESS]: [],
    [TaskStatus.DATA_DONE]: [],
    [TaskStatus.TO_DELIVER]: [],
    [TaskStatus.TO_ACCEPT]: [],
    [TaskStatus.DONE]: [],
  };
  localTasks.forEach(t => {
    if (grouped[t.status]) grouped[t.status].push(t);
  });
  return grouped;
}
