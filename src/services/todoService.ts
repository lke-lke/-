import { ensureOnedayClient } from '@/onedaycloud';
import { USE_MOCK } from './db';

export interface SystemTodo {
  id: string;
  type: string;
  title: string;
  description?: string;
  taskId?: string;
  documentId?: string;
  priority: 'normal' | 'high' | 'urgent';
  status: 'open' | 'completed' | 'cancelled';
  dueAt?: string;
  createdAt: string;
  detail: Record<string, unknown>;
}

export async function getOpenTodos(): Promise<SystemTodo[]> {
  if (USE_MOCK) return [];
  const client = ensureOnedayClient(); if (!client) return [];
  const { data, error } = await client.supabase.from('todos').select('*').eq('status', 'open').order('created_at');
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id, type: row.todo_type, title: row.title, description: row.description,
    taskId: row.task_id, documentId: row.document_id, priority: row.priority,
    status: row.status, dueAt: row.due_at, createdAt: row.created_at, detail: row.detail || {},
  }));
}
