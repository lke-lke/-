import { Document } from '@/types';
import { DocType, REQUIRED_DOCS, TaskType } from '@/constants';
import { USE_MOCK } from './db';
import { mockDocuments } from '@/mock';
import { ensureOnedayClient } from '@/onedaycloud';

let localDocs = [...mockDocuments];

const toDocument = (row: any): Document => ({
  ...row,
  taskId: row.taskId ?? row.task_id,
  docType: row.docType ?? row.doc_type,
  uploadedAt: row.uploadedAt ?? String(row.uploaded_at).slice(0, 10),
  status: row.status ?? 'approved',
  reviewedBy: row.reviewedBy ?? row.reviewed_by,
  reviewedAt: row.reviewedAt ?? (row.reviewed_at ? String(row.reviewed_at).slice(0, 10) : undefined),
  reviewComment: row.reviewComment ?? row.review_comment,
});

const toDocumentRow = (doc: Omit<Document, 'id'>) => ({
  task_id: doc.taskId,
  doc_type: doc.docType,
  name: doc.name,
  link: doc.link,
  uploader: doc.uploader,
  uploaded_at: doc.uploadedAt,
  status: doc.status ?? 'pending_review',
});

export async function getDocsByTask(taskId: string): Promise<Document[]> {
  if (USE_MOCK) {
    return localDocs.filter(d => d.taskId === taskId).map(toDocument);
  }
  const client = ensureOnedayClient();
  if (!client) return [];
  const { data } = await client.supabase.from('documents').select('*').eq('task_id', taskId);
  return (data || []).map(toDocument);
}

export async function getAllDocuments(): Promise<Document[]> {
  if (USE_MOCK) return localDocs.map(toDocument);
  const client = ensureOnedayClient();
  if (!client) return [];
  const { data } = await client.supabase.from('documents').select('*');
  return (data || []).map(toDocument);
}

export async function uploadDocument(doc: Omit<Document, 'id'>): Promise<Document> {
  const newDoc: Document = { ...doc, id: `d${Date.now()}`, status: doc.status ?? 'pending_review' };
  if (USE_MOCK) {
    localDocs.push(newDoc);
    return newDoc;
  }
  const client = ensureOnedayClient();
  if (!client) return newDoc;
  const { data } = await client.supabase.from('documents').insert([toDocumentRow(newDoc)]).select().single();
  return data ? toDocument(data) : newDoc;
}

export async function reviewDocument(id: string, decision: 'approved' | 'rejected', reviewer: string, reviewComment?: string): Promise<Document | null> {
  const reviewedAt = new Date().toISOString().slice(0, 10);
  if (USE_MOCK) {
    const index = localDocs.findIndex(doc => doc.id === id);
    if (index < 0) return null;
    localDocs[index] = { ...localDocs[index], status: decision, reviewedBy: reviewer, reviewedAt, reviewComment };
    return localDocs[index];
  }
  const client = ensureOnedayClient();
  if (!client) return null;
  const { data } = await client.supabase.from('documents').update({ status: decision, reviewed_by: reviewer, reviewed_at: reviewedAt, review_comment: reviewComment }).eq('id', id).select().single();
  return data ? toDocument(data) : null;
}

export function calcDocCompleteness(taskType: TaskType, docs: Document[]): number {
  const required = REQUIRED_DOCS[taskType] || [];
  if (required.length === 0) return 1;
  const uploaded = new Set(docs.filter(d => d.status === 'approved').map(d => d.docType));
  const fulfilled = required.filter(r => uploaded.has(r)).length;
  return fulfilled / required.length;
}
