import { Document, DocumentReviewEvent } from '@/types';
import { REQUIRED_DOCS, TaskType } from '@/constants';
import { USE_MOCK } from './db';
import { mockDocuments } from '@/mock';
import { ensureOnedayClient } from '@/onedaycloud';

type ActorRole = DocumentReviewEvent['actorRole'];
type LeaderAction = 'reject_member' | 'complete' | 'submit_admin';
type RevisionAction = 'return_member' | 'resubmit_admin';

let localDocs: Document[] = [...mockDocuments];
let localReviewEvents: DocumentReviewEvent[] = [];

const now = () => new Date().toISOString().slice(0, 16).replace('T', ' ');

const inferRoute = (row: any): NonNullable<Document['reviewRoute']> => {
  const explicit = row.reviewRoute ?? row.review_route;
  if (explicit) return explicit;
  const adminStatus = row.adminReviewStatus ?? row.admin_review_status;
  if (adminStatus && adminStatus !== 'not_submitted') return 'leader_then_admin';
  return (row.status ?? 'approved') === 'approved' ? 'leader_only' : 'undecided';
};

const inferWorkflowStatus = (row: any): NonNullable<Document['workflowStatus']> => {
  const explicit = row.workflowStatus ?? row.workflow_status;
  if (explicit) return explicit;
  const adminStatus = row.adminReviewStatus ?? row.admin_review_status;
  if (adminStatus === 'pending') return 'pending_admin_review';
  if (adminStatus === 'rejected') return 'leader_revision_required';
  if (adminStatus === 'approved') return 'completed_by_admin';
  const leaderStatus = row.status ?? 'approved';
  if (leaderStatus === 'pending_review') return 'pending_leader_review';
  if (leaderStatus === 'rejected') return 'member_revision_required';
  return 'completed_by_leader';
};

const toDocument = (row: any): Document => ({
  ...row,
  taskId: row.taskId ?? row.task_id,
  docType: row.docType ?? row.doc_type,
  uploadedAt: row.uploadedAt ?? String(row.uploaded_at).slice(0, 10),
  status: row.status ?? 'approved',
  reviewedBy: row.reviewedBy ?? row.reviewed_by,
  reviewedAt: row.reviewedAt ?? (row.reviewed_at ? String(row.reviewed_at).slice(0, 16) : undefined),
  reviewComment: row.reviewComment ?? row.review_comment,
  version: Number(row.version ?? 1),
  replacedDocumentId: row.replacedDocumentId ?? row.replaced_document_id,
  adminReviewStatus: row.adminReviewStatus ?? row.admin_review_status ?? 'not_submitted',
  submittedToAdminAt: row.submittedToAdminAt ?? (row.submitted_to_admin_at ? String(row.submitted_to_admin_at).slice(0, 16) : undefined),
  adminReviewedBy: row.adminReviewedBy ?? row.admin_reviewed_by,
  adminReviewedAt: row.adminReviewedAt ?? (row.admin_reviewed_at ? String(row.admin_reviewed_at).slice(0, 16) : undefined),
  adminReviewComment: row.adminReviewComment ?? row.admin_review_comment,
  adminRevisionCount: Number(row.adminRevisionCount ?? row.admin_revision_count ?? 0),
  reviewRoute: inferRoute(row),
  workflowStatus: inferWorkflowStatus(row),
  leaderRejectionCount: Number(row.leaderRejectionCount ?? row.leader_rejection_count ?? 0),
  finalApprovalLevel: row.finalApprovalLevel ?? row.final_approval_level,
  completedBy: row.completedBy ?? row.completed_by,
  completedAt: row.completedAt ?? (row.completed_at ? String(row.completed_at).slice(0, 16) : undefined),
  rootDocumentId: row.rootDocumentId ?? row.root_document_id ?? row.id,
});

const toDocumentRow = (doc: Omit<Document, 'id'>) => ({
  task_id: doc.taskId, doc_type: doc.docType, name: doc.name, link: doc.link,
  uploader: doc.uploader, uploaded_at: doc.uploadedAt,
  status: doc.status ?? 'pending_review', version: doc.version ?? 1,
  replaced_document_id: doc.replacedDocumentId,
  admin_review_status: doc.adminReviewStatus ?? 'not_submitted',
  submitted_to_admin_at: doc.submittedToAdminAt,
  admin_reviewed_by: doc.adminReviewedBy, admin_reviewed_at: doc.adminReviewedAt,
  admin_review_comment: doc.adminReviewComment,
  admin_revision_count: doc.adminRevisionCount ?? 0,
  review_route: doc.reviewRoute ?? 'undecided',
  workflow_status: doc.workflowStatus ?? 'pending_leader_review',
  leader_rejection_count: doc.leaderRejectionCount ?? 0,
  final_approval_level: doc.finalApprovalLevel,
  completed_by: doc.completedBy, completed_at: doc.completedAt,
  root_document_id: doc.rootDocumentId,
});

const rpcDocument = (data: any): Document | null => {
  const row = Array.isArray(data) ? data[0] : data;
  return row ? toDocument(row) : null;
};

async function withSignedLink(row: any): Promise<Document> {
  const document = toDocument(row);
  const storageKey = row.storage_key;
  if (!storageKey || USE_MOCK) return document;
  const client = ensureOnedayClient();
  if (!client) return document;
  const { data } = await client.supabase.storage.from('deliverables').createSignedUrl(storageKey, 3600);
  return { ...document, link: data?.signedUrl || document.link };
}

async function appendReviewEvent(document: Document, actor: string, actorRole: ActorRole, action: DocumentReviewEvent['action'], fromStatus: Document['workflowStatus'], comment?: string) {
  const event: DocumentReviewEvent = {
    id: `dre${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    documentId: document.id, rootDocumentId: document.rootDocumentId || document.id,
    taskId: document.taskId, actor, actorRole, action, fromStatus,
    toStatus: document.workflowStatus || 'pending_leader_review', comment, createdAt: now(),
  };
  if (USE_MOCK) { localReviewEvents.push(event); return; }
  const client = ensureOnedayClient();
  if (!client) return;
  await client.supabase.from('document_review_events').insert([{
    document_id: event.documentId, root_document_id: event.rootDocumentId,
    task_id: event.taskId, actor: event.actor, actor_role: event.actorRole,
    action: event.action, from_status: event.fromStatus, to_status: event.toStatus,
    comment: event.comment, created_at: event.createdAt,
  }]);
}

async function updateDocument(id: string, updates: Partial<Document>): Promise<Document | null> {
  if (USE_MOCK) {
    const index = localDocs.findIndex(doc => doc.id === id);
    if (index < 0) return null;
    localDocs[index] = toDocument({ ...localDocs[index], ...updates });
    return localDocs[index];
  }
  const client = ensureOnedayClient();
  if (!client) return null;
  const row: Record<string, unknown> = {};
  const mapping: Array<[keyof Document, string]> = [
    ['status', 'status'], ['reviewedBy', 'reviewed_by'], ['reviewedAt', 'reviewed_at'], ['reviewComment', 'review_comment'],
    ['adminReviewStatus', 'admin_review_status'], ['submittedToAdminAt', 'submitted_to_admin_at'],
    ['adminReviewedBy', 'admin_reviewed_by'], ['adminReviewedAt', 'admin_reviewed_at'], ['adminReviewComment', 'admin_review_comment'],
    ['adminRevisionCount', 'admin_revision_count'], ['reviewRoute', 'review_route'], ['workflowStatus', 'workflow_status'],
    ['leaderRejectionCount', 'leader_rejection_count'], ['finalApprovalLevel', 'final_approval_level'],
    ['completedBy', 'completed_by'], ['completedAt', 'completed_at'], ['rootDocumentId', 'root_document_id'],
  ];
  mapping.forEach(([source, target]) => {
    if (Object.prototype.hasOwnProperty.call(updates, source)) row[target] = updates[source] ?? null;
  });
  const { data } = await client.supabase.from('documents').update(row).eq('id', id).select().single();
  return data ? toDocument(data) : null;
}

export async function getDocsByTask(taskId: string): Promise<Document[]> {
  if (USE_MOCK) return localDocs.filter(d => d.taskId === taskId).map(toDocument);
  const client = ensureOnedayClient(); if (!client) return [];
  const { data, error } = await client.supabase.from('documents').select('*').eq('task_id', taskId);
  if (error) throw error;
  return Promise.all((data || []).map(withSignedLink));
}

export async function getAllDocuments(): Promise<Document[]> {
  if (USE_MOCK) return localDocs.map(toDocument);
  const client = ensureOnedayClient(); if (!client) return [];
  const { data, error } = await client.supabase.from('documents').select('*');
  if (error) throw error;
  return Promise.all((data || []).map(withSignedLink));
}

export async function getDocumentReviewEvents(documentId: string): Promise<DocumentReviewEvent[]> {
  const document = (await getAllDocuments()).find(item => item.id === documentId);
  const rootId = document?.rootDocumentId || documentId;
  if (USE_MOCK) return localReviewEvents.filter(event => event.rootDocumentId === rootId);
  const client = ensureOnedayClient(); if (!client) return [];
  const { data, error } = await client.supabase.from('document_review_events').select('*').eq('root_document_id', rootId).order('created_at');
  if (error) throw error;
  return (data || []).map((row: any) => ({ id: row.id, documentId: row.document_id, rootDocumentId: row.root_document_id, taskId: row.task_id, actor: row.actor, actorRole: row.actor_role, action: row.action, fromStatus: row.from_status, toStatus: row.to_status, comment: row.comment, createdAt: row.created_at }));
}

export async function uploadDocument(doc: Omit<Document, 'id'>, actorRole: ActorRole = '组员', file?: File): Promise<Document> {
  const allDocs = await getAllDocuments();
  const prior = allDocs.filter(item => item.taskId === doc.taskId && item.docType === doc.docType).sort((a, b) => Number(b.version || 1) - Number(a.version || 1))[0];
  const id = `d${Date.now()}`;
  const inheritedRoute = prior?.reviewRoute === 'leader_then_admin' ? 'leader_then_admin' : 'undecided';
  const newDoc: Document = { ...doc, id, status: 'pending_review', version: prior ? Number(prior.version || 1) + 1 : 1, replacedDocumentId: prior?.id, rootDocumentId: prior?.rootDocumentId || prior?.id || (USE_MOCK ? id : undefined), reviewRoute: inheritedRoute, workflowStatus: 'pending_leader_review', leaderRejectionCount: prior?.leaderRejectionCount || 0, adminRevisionCount: prior?.adminRevisionCount || 0, adminReviewStatus: 'not_submitted', adminReviewedBy: inheritedRoute === 'leader_then_admin' ? prior?.adminReviewedBy : undefined, adminReviewedAt: inheritedRoute === 'leader_then_admin' ? prior?.adminReviewedAt : undefined, adminReviewComment: inheritedRoute === 'leader_then_admin' ? prior?.adminReviewComment : undefined, finalApprovalLevel: undefined, completedBy: undefined, completedAt: undefined };
  if (USE_MOCK) {
    localDocs.push(newDoc);
    await appendReviewEvent(newDoc, doc.uploader, actorRole, 'member_submitted', prior?.workflowStatus, prior ? `提交 V${newDoc.version} 返修版本` : '首次提交交付物');
    return newDoc;
  }
  const client = ensureOnedayClient(); if (!client) return newDoc;
  let storageKey: string | null = null;
  if (file) {
    const { data: authData } = await client.supabase.auth.getUser();
    const userId = authData.user?.id;
    if (!userId) throw new Error('本地数据库会话尚未建立');
    const safeName = file.name.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, '_');
    storageKey = `${userId}/${doc.taskId}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await client.supabase.storage.from('deliverables').upload(storageKey, file, { upsert: false });
    if (uploadError) throw uploadError;
  }
  const { data, error } = await client.supabase.rpc('register_document_version', {
    p_task_id: doc.taskId, p_doc_type: doc.docType, p_name: doc.name,
    p_link: storageKey ? null : doc.link || null, p_storage_key: storageKey,
  });
  if (error) {
    if (storageKey) await client.supabase.storage.from('deliverables').remove([storageKey]);
    throw error;
  }
  const saved = rpcDocument(data);
  return saved ? withSignedLink({ ...saved, storage_key: storageKey }) : newDoc;
}

export async function leaderReviewDocument(id: string, action: LeaderAction, reviewer: string, comment?: string): Promise<Document | null> {
  if (!USE_MOCK) {
    const client = ensureOnedayClient(); if (!client) return null;
    const { data, error } = await client.supabase.rpc('leader_review_document', { p_document_id: id, p_action: action, p_comment: comment || null });
    if (error) throw error;
    return rpcDocument(data);
  }
  const current = (await getAllDocuments()).find(doc => doc.id === id);
  if (!current || current.workflowStatus !== 'pending_leader_review') return null;
  if (action === 'complete' && current.reviewRoute === 'leader_then_admin') return null;
  const reviewedAt = now();
  const updates: Partial<Document> = action === 'reject_member'
    ? { status: 'rejected', reviewedBy: reviewer, reviewedAt, reviewComment: comment, workflowStatus: 'member_revision_required', leaderRejectionCount: Number(current.leaderRejectionCount || 0) + 1 }
    : action === 'complete'
      ? { status: 'approved', reviewedBy: reviewer, reviewedAt, reviewComment: comment, reviewRoute: 'leader_only', workflowStatus: 'completed_by_leader', finalApprovalLevel: 'leader', completedBy: reviewer, completedAt: reviewedAt }
      : { status: 'approved', reviewedBy: reviewer, reviewedAt, reviewComment: comment, reviewRoute: 'leader_then_admin', workflowStatus: 'pending_admin_review', adminReviewStatus: 'pending', submittedToAdminAt: reviewedAt, adminReviewedBy: undefined, adminReviewedAt: undefined, adminReviewComment: undefined };
  const result = await updateDocument(id, updates);
  if (result) await appendReviewEvent(result, reviewer, '组长', action === 'reject_member' ? 'leader_rejected' : action === 'complete' ? 'leader_completed' : 'leader_submitted_admin', current.workflowStatus, comment);
  return result;
}

/** 兼容任务详情旧调用：通过默认为“仅组长验收完成”。 */
export async function reviewDocument(id: string, decision: 'approved' | 'rejected', reviewer: string, reviewComment?: string): Promise<Document | null> {
  return leaderReviewDocument(id, decision === 'approved' ? 'complete' : 'reject_member', reviewer, reviewComment);
}

export async function submitDocumentForAdminReview(id: string, reviewer = '组长', comment?: string): Promise<Document | null> {
  const current = (await getAllDocuments()).find(doc => doc.id === id);
  if (!current) return null;
  if (current.workflowStatus === 'pending_leader_review') return leaderReviewDocument(id, 'submit_admin', reviewer, comment);
  if (current.workflowStatus !== 'leader_revision_required') return null;
  return handleAdminRejection(id, 'resubmit_admin', reviewer, comment);
}

export async function reviewDocumentByAdmin(id: string, decision: 'approved' | 'rejected', reviewer: string, comment?: string): Promise<Document | null> {
  if (!USE_MOCK) {
    const client = ensureOnedayClient(); if (!client) return null;
    const { data, error } = await client.supabase.rpc('admin_review_document', { p_document_id: id, p_decision: decision, p_comment: comment || null });
    if (error) throw error;
    return rpcDocument(data);
  }
  const current = (await getAllDocuments()).find(doc => doc.id === id);
  if (!current || current.workflowStatus !== 'pending_admin_review' || current.reviewRoute !== 'leader_then_admin') return null;
  const reviewedAt = now();
  const updates: Partial<Document> = decision === 'approved'
    ? { adminReviewStatus: 'approved', adminReviewedBy: reviewer, adminReviewedAt: reviewedAt, adminReviewComment: comment, workflowStatus: 'completed_by_admin', finalApprovalLevel: 'admin', completedBy: reviewer, completedAt: reviewedAt }
    : { adminReviewStatus: 'rejected', adminReviewedBy: reviewer, adminReviewedAt: reviewedAt, adminReviewComment: comment, workflowStatus: 'leader_revision_required', adminRevisionCount: Number(current.adminRevisionCount || 0) + 1 };
  const result = await updateDocument(id, updates);
  if (result) await appendReviewEvent(result, reviewer, '管理员', decision === 'approved' ? 'admin_completed' : 'admin_rejected', current.workflowStatus, comment);
  return result;
}

export async function handleAdminRejection(id: string, action: RevisionAction, leader: string, comment?: string): Promise<Document | null> {
  if (!USE_MOCK) {
    const client = ensureOnedayClient(); if (!client) return null;
    const { data, error } = await client.supabase.rpc('leader_handle_admin_rejection', { p_document_id: id, p_action: action, p_comment: comment || null });
    if (error) throw error;
    return rpcDocument(data);
  }
  const current = (await getAllDocuments()).find(doc => doc.id === id);
  if (!current || current.workflowStatus !== 'leader_revision_required' || current.reviewRoute !== 'leader_then_admin') return null;
  const updates: Partial<Document> = action === 'return_member'
    ? { status: 'rejected', reviewedBy: leader, reviewedAt: now(), reviewComment: comment || current.adminReviewComment, workflowStatus: 'member_revision_required' }
    : { status: 'approved', reviewedBy: leader, reviewedAt: now(), reviewComment: comment, adminReviewStatus: 'pending', submittedToAdminAt: now(), adminReviewedBy: undefined, adminReviewedAt: undefined, adminReviewComment: undefined, workflowStatus: 'pending_admin_review' };
  const result = await updateDocument(id, updates);
  if (result) await appendReviewEvent(result, leader, '组长', action === 'return_member' ? 'leader_returned_member' : 'leader_resubmitted_admin', current.workflowStatus, comment);
  return result;
}

export function isDocumentFinallyApproved(doc: Document): boolean {
  return doc.workflowStatus === 'completed_by_leader' || doc.workflowStatus === 'completed_by_admin';
}

export function calcDocCompleteness(taskType: TaskType, docs: Document[]): number {
  const required = REQUIRED_DOCS[taskType] || [];
  if (required.length === 0) return 1;
  const latestDocs = Array.from(docs.reduce((latest, document) => {
    const key = document.rootDocumentId || document.id;
    const current = latest.get(key);
    if (!current || Number(document.version || 1) > Number(current.version || 1)) latest.set(key, document);
    return latest;
  }, new Map<string, Document>()).values());
  const uploaded = new Set(latestDocs.filter(isDocumentFinallyApproved).map(d => d.docType));
  return required.filter(r => uploaded.has(r)).length / required.length;
}
