import { useParams, useNavigate } from 'react-router-dom';
import { Button, Card, DatePicker, Descriptions, Divider, Input, InputNumber, Modal, Progress, Select, Table, Tag, Timeline, Upload, message } from 'antd';
import { ArrowLeftOutlined, CheckOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { CONTRIBUTION_TAGS, ContributionTag, DocType, REQUIRED_DOCS, TaskStatus, TEAM_MEMBERS } from '@/constants';
import { Document, DocumentReviewEvent, RescanRecord, Task, TaskContribution, TaskRelation, TaskSettlement } from '@/types';
import StatusTag from '@/components/StatusTag';
import DifficultyStars from '@/components/DifficultyStars';
import { getTaskById, updateTask } from '@/services/taskService';
import { calcDocCompleteness, getDocumentReviewEvents, getDocsByTask, isDocumentFinallyApproved, leaderReviewDocument, uploadDocument } from '@/services/documentService';
import { getRescanRecords } from '@/services/rescanService';
import { addTaskContribution, confirmTaskContribution, confirmTaskSettlement, contributionEvidenceLabel, getDifficultyRevisions, getTaskContributions, getTaskSettlement, isOtherDeliverable, removeTaskContribution, saveFinalDifficulty } from '@/services/settlementService';
import { computeNextStatus } from '@/utils/status';
import { addTaskFieldChanges, getTaskFieldChanges } from '@/services/taskChangeService';
import { useActor } from '@/contexts/ActorContext';
import { getTaskRelations } from '@/services/taskRelationService';

type EvidenceType = NonNullable<TaskContribution['evidenceType']>;
const CUSTOM = '__custom__';
const TEMPORARY = '__temporary__';
const normalizeMainTask = (mainTask: string) => mainTask === '-' || mainTask === '临时任务' ? TEMPORARY : mainTask;
const documentWorkflowStatus: Record<NonNullable<Document['workflowStatus']>, { label: string; color: string }> = {
  pending_leader_review: { label: '待组长验收', color: '#806c79' }, member_revision_required: { label: '待组员返修', color: '#b97d7b' },
  pending_admin_review: { label: '待管理员验收', color: '#c1a0ac' }, leader_revision_required: { label: '待组长处理返修', color: '#b97d7b' },
  completed_by_leader: { label: '组长验收完成', color: '#928e5e' }, completed_by_admin: { label: '管理员验收完成', color: '#928e5e' },
};

export default function TaskDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState<Task | null>(null);
  const [docs, setDocs] = useState<Document[]>([]);
  const [rescans, setRescans] = useState<RescanRecord[]>([]);
  const [contributions, setContributions] = useState<TaskContribution[]>([]);
  const [settlement, setSettlement] = useState<TaskSettlement | null>(null);
  const [revisions, setRevisions] = useState<any[]>([]);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [ratingModalOpen, setRatingModalOpen] = useState(false);
  const [contributionModalOpen, setContributionModalOpen] = useState(false);
  const [settlementModalOpen, setSettlementModalOpen] = useState(false);
  const [docType, setDocType] = useState<DocType>();
  const [selectedFile, setSelectedFile] = useState<File>();
  const [difficulty, setDifficulty] = useState<number>();
  const [finalDifficulty, setFinalDifficulty] = useState<number>();
  const [difficultyReason, setDifficultyReason] = useState('');
  const [settlementSummary, setSettlementSummary] = useState('');
  const [member, setMember] = useState<string>();
  const [tags, setTags] = useState<ContributionTag[]>([]);
  const [evidenceType, setEvidenceType] = useState<EvidenceType>();
  const [evidenceId, setEvidenceId] = useState<string>();
  const [note, setNote] = useState('');
  const [fieldChanges, setFieldChanges] = useState<any[]>([]);
  const [taskEditOpen, setTaskEditOpen] = useState(false);
  const [editDeadline, setEditDeadline] = useState('');
  const [editExpectedDeadline, setEditExpectedDeadline] = useState('');
  const [editOwnership, setEditOwnership] = useState('');
  const [editMainTask, setEditMainTask] = useState('');
  const [editLinkedTask, setEditLinkedTask] = useState('');
  const [customOwnership, setCustomOwnership] = useState('');
  const [customMainTask, setCustomMainTask] = useState('');
  const [customLinkedTask, setCustomLinkedTask] = useState('');
  const [relations, setRelations] = useState<TaskRelation[]>([]);
  const [editDataVolume, setEditDataVolume] = useState<number>();
  const [editDifficulty, setEditDifficulty] = useState<number>();
  const [entryMode, setEntryMode] = useState<'member' | 'leader'>('member');
  const [reviewTarget, setReviewTarget] = useState<Document | null>(null);
  const [reviewAction, setReviewAction] = useState<'complete' | 'submit_admin' | 'reject_member'>('complete');
  const [reviewComment, setReviewComment] = useState('');
  const [documentReviewEvents, setDocumentReviewEvents] = useState<DocumentReviewEvent[]>([]);
  const { actor } = useActor();

  const load = async () => {
    if (!id) return;
    const [loadedTask, loadedDocs, loadedRescans, loadedContributions, loadedSettlement, loadedRevisions, loadedChanges, loadedRelations] = await Promise.all([
      getTaskById(id), getDocsByTask(id), getRescanRecords({ taskId: id }), getTaskContributions(id), getTaskSettlement(id), getDifficultyRevisions(id), getTaskFieldChanges(id), getTaskRelations(),
    ]);
    const rootDocuments = Array.from(loadedDocs.reduce((rows, document) => rows.set(document.rootDocumentId || document.id, document), new Map<string, Document>()).values());
    const eventGroups = await Promise.all(rootDocuments.map(document => getDocumentReviewEvents(document.id)));
    const events = Array.from(eventGroups.flat().reduce((rows, event) => rows.set(event.id, event), new Map<string, DocumentReviewEvent>()).values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    setTask(loadedTask); setDocs(loadedDocs); setDocumentReviewEvents(events); setRescans(loadedRescans); setContributions(loadedContributions); setSettlement(loadedSettlement); setRevisions(loadedRevisions); setFieldChanges(loadedChanges); setRelations(loadedRelations);
    setDifficulty(loadedTask?.difficulty); setFinalDifficulty(loadedSettlement?.finalDifficulty ?? loadedTask?.difficulty);
  };

  useEffect(() => { load(); }, [id]);
  const teamMembers = useMemo(() => Array.from(new Set([...(task ? TEAM_MEMBERS[task.team] : []), task?.assignee, task?.teamLeader, task?.reviewer].filter(Boolean))) as string[], [task]);
  if (!task) return <div>任务不存在</div>;

  const requiredDocs = REQUIRED_DOCS[task.taskType] || [];
  const canManageTask = actor.role === '管理员' || actor.role === '组长';
  const canManageThisTeam = canManageTask && (actor.role === '管理员' || actor.team === task.team);
  const canEditOwnWork = actor.role === '组员';
  const currentDocs = Array.from(docs.reduce((latest, document) => {
    const key = document.rootDocumentId || document.id;
    const current = latest.get(key);
    if (!current || Number(document.version || 1) > Number(current.version || 1)) latest.set(key, document);
    return latest;
  }, new Map<string, Document>()).values());
  const approvedDocs = currentDocs.filter(isDocumentFinallyApproved);
  const confirmedContributions = contributions.filter(item => item.status === 'confirmed');
  const canSettle = task.status === TaskStatus.TO_ACCEPT && !settlement;
  const evidenceOptions = evidenceType === 'document' ? approvedDocs.map(doc => ({ value: doc.id, label: `${doc.docType}｜${doc.name}` })) : evidenceType === 'rescan' ? rescans.map(record => ({ value: record.id, label: `${record.reason}｜${record.description}` })) : evidenceType === 'acceptance' ? [{ value: 'task-acceptance', label: `数据验收：${task.reviewer || '待确认'}` }] : [];

  const handleUpload = async () => {
    if (!docType || !selectedFile) return message.warning('请选择文档类型和文件');
    await uploadDocument({ taskId: task.id, docType, name: selectedFile.name, link: URL.createObjectURL(selectedFile), uploader: actor.name, uploadedAt: dayjs().format('YYYY-MM-DD') }, actor.role);
    setUploadModalOpen(false); setDocType(undefined); setSelectedFile(undefined); await load();
    message.success('文档已上传，等待组长验收后才会计入任务交付。');
  };

  const openReview = (doc: Document) => {
    setReviewTarget(doc);
    setReviewAction(doc.reviewRoute === 'leader_then_admin' ? 'submit_admin' : 'complete');
    setReviewComment('');
  };

  const handleReview = async () => {
    if (!reviewTarget) return;
    if (reviewAction === 'reject_member' && !reviewComment.trim()) return message.warning('驳回时请填写修改意见');
    const result = await leaderReviewDocument(reviewTarget.id, reviewAction, actor.name, reviewComment.trim() || undefined);
    if (!result) return message.error('文档状态更新失败');
    const nextDocs = docs.map(item => item.id === reviewTarget.id ? result : item);
    const completeness = calcDocCompleteness(task.taskType, nextDocs);
    const updatedTask = await updateTask(task.id, { docCompleteness: completeness, status: computeNextStatus(task, task.progress, completeness) });
    setDocs(nextDocs); if (updatedTask) setTask(updatedTask);
    setReviewTarget(null); setReviewComment(''); message.success(reviewAction === 'complete' ? '文档已由组长验收结案。' : reviewAction === 'submit_admin' ? '文档已通过组长检查并提交管理员验收。' : '文档已驳回组员，修改意见已留存。');
  };

  const handleRating = async () => {
    if (!difficulty) return message.warning('请先选择 1–5 星难度');
    const updatedTask = await updateTask(task.id, { difficulty });
    if (updatedTask) setTask(updatedTask);
    setRatingModalOpen(false); message.success('下发难度已保存');
  };

  const handleAddContribution = async () => {
    if (!member || tags.length === 0) return message.warning('请选择组员和至少一项工作标签');
    if (tags.some(isOtherDeliverable) && !note.trim()) return message.warning('选择“其他已验收交付物”时需要填写备注');
    await Promise.all(tags.map(tag => addTaskContribution({ taskId: task.id, member, tag, evidenceType, evidenceId, note: note.trim() || undefined, attachedBy: entryMode === 'leader' ? actor.name : member, status: entryMode === 'leader' ? 'confirmed' : 'pending', confirmedBy: entryMode === 'leader' ? actor.name : undefined, confirmedAt: entryMode === 'leader' ? dayjs().format('YYYY-MM-DD HH:mm') : undefined })));
    setContributionModalOpen(false); setMember(undefined); setTags([]); setEvidenceType(undefined); setEvidenceId(undefined); setNote(''); await load();
  };
  const handleConfirmContribution = async (item: TaskContribution) => { const result = await confirmTaskContribution(item.id, actor.name); if (!result) return message.error('确认失败'); setContributions(current => current.map(row => row.id === item.id ? result : row)); message.success('已由组长确认，现可计入工作量。'); };
  const openTaskEdit = () => { setEditDeadline(task.deadline); setEditExpectedDeadline(task.expectedDeadline || ''); setEditOwnership(task.ownership); setEditMainTask(task.mainTask ? normalizeMainTask(task.mainTask) : ''); setEditLinkedTask(task.linkedTask || task.taskGroup || ''); setCustomOwnership(''); setCustomMainTask(''); setCustomLinkedTask(''); setEditDataVolume(task.dataVolume); setEditDifficulty(task.difficulty); setTaskEditOpen(true); };
  const saveTaskEdit = async () => {
    const ownership = editOwnership === CUSTOM ? customOwnership.trim() : editOwnership;
    const mainTask = editMainTask === CUSTOM ? customMainTask.trim() : editMainTask === TEMPORARY ? '-' : editMainTask;
    const linkedTask = editLinkedTask === CUSTOM ? customLinkedTask.trim() : editLinkedTask;
    if (!ownership || !mainTask || !linkedTask || !editExpectedDeadline || !editDeadline) return message.warning('请完整填写任务挂链、预计截止时间和实际截止时间。');
    const relation = relations.find(item => item.ownership === ownership && item.mainTask === mainTask && item.linkedTask === linkedTask);
    const isReady = Boolean(task.team && task.assignee && ownership && mainTask && linkedTask && editExpectedDeadline && editDeadline);
    const nextStatus = task.status === TaskStatus.PENDING_INFO && isReady ? TaskStatus.IN_PROGRESS : task.status;
    const changes = [
      { field: '任务归属', beforeValue: task.ownership, afterValue: ownership }, { field: '主任务', beforeValue: task.mainTask === '-' ? '临时任务' : task.mainTask, afterValue: mainTask === '-' ? '临时任务' : mainTask }, { field: '任务分组', beforeValue: task.linkedTask || task.taskGroup, afterValue: linkedTask },
      { field: '预计截止时间', beforeValue: task.expectedDeadline, afterValue: editExpectedDeadline }, { field: '实际截止时间', beforeValue: task.deadline, afterValue: editDeadline }, { field: '数据量级', beforeValue: task.dataVolume, afterValue: editDataVolume }, { field: '下发难度', beforeValue: task.difficulty, afterValue: editDifficulty },
    ].filter(change => String(change.beforeValue || '') !== String(change.afterValue || ''));
    const updated = await updateTask(task.id, { ownership: ownership as any, mainTask, linkedTask, taskGroup: linkedTask, relationId: relation?.id, expectedDeadline: editExpectedDeadline, deadline: editDeadline, dataVolume: editDataVolume || 0, difficulty: editDifficulty, status: nextStatus });
    if (!updated) return message.error('保存失败');
    if (changes.length) await addTaskFieldChanges(task.id, changes, actor.name);
    setTask(updated); setTaskEditOpen(false); await load(); message.success(nextStatus === TaskStatus.IN_PROGRESS ? '任务字段已补齐，已进入进行中。' : '任务字段已更新，修改记录已留存。');
  };

  const handleRemoveContribution = async (item: TaskContribution) => {
    const previous = contributions;
    setContributions(current => current.filter(contribution => contribution.id !== item.id));
    try {
      await removeTaskContribution(item.id);
      message.success(`已移除 ${item.member} 的“${item.tag}”标签`);
    } catch {
      setContributions(previous);
      message.error('移除失败，请重试');
    }
  };

  const handleSettlement = async () => {
    if (!finalDifficulty) return message.warning('请确认最终难度星级');
    if (finalDifficulty !== task.difficulty && !difficultyReason.trim()) return message.warning('最终星级与下发星级不同，请填写调整原因');
    if (confirmedContributions.length === 0) return message.warning('请至少确认一条组员工作标签后再结项');
    await saveFinalDifficulty({ taskId: task.id, difficulty: finalDifficulty, reason: difficultyReason.trim() || undefined, confirmedBy: actor.name });
    const result = await confirmTaskSettlement({ taskId: task.id, confirmedBy: actor.name, confirmedAt: dayjs().format('YYYY-MM-DD HH:mm'), finalDifficulty, difficultyReason: difficultyReason.trim() || undefined, summary: settlementSummary.trim() || undefined });
    const updatedTask = await updateTask(task.id, { difficulty: finalDifficulty, status: TaskStatus.DONE });
    setSettlement(result); if (updatedTask) setTask(updatedTask); setSettlementModalOpen(false); await load();
    message.success('任务已由组长确认结项，最终星级和人员工作记录已存档。');
  };

  const timelineItems = [
    { color: 'green', children: `${task.createdAt} 任务下发` }, task.progress > 0 && { color: 'blue', children: `标注进行中 (${Math.round(task.progress * 100)}%)` },
    task.progress >= 1 && { color: 'cyan', children: '标注完成 / 数据导出' }, docs.length > 0 && { color: 'orange', children: `已上传 ${docs.length} 份文档（已验收 ${approvedDocs.length} 份）` },
    task.status === TaskStatus.TO_ACCEPT && { color: 'gold', children: '等待组长结项确认' }, settlement && { color: 'green', children: `${settlement.confirmedAt} 由 ${settlement.confirmedBy} 确认结项` },
  ].filter(Boolean);
  const reviewActionLabel: Record<DocumentReviewEvent['action'], string> = { member_submitted: '组员提交交付物', leader_rejected: '组长驳回组员', leader_completed: '组长验收并结案', leader_submitted_admin: '组长提交管理员验收', admin_rejected: '管理员驳回组长', admin_completed: '管理员验收并结案', leader_returned_member: '组长退回组员返修', leader_resubmitted_admin: '组长修改后重提管理员' };

  return <div>
    <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} style={{ marginBottom: 16 }}>返回</Button>
    <Card title={task.name} extra={<>{canManageThisTeam && <Button size="small" type="link" onClick={openTaskEdit}>编辑任务字段</Button>}<StatusTag status={task.status} /></>}>
      <Descriptions column={3} size="small" bordered>
        <Descriptions.Item label="任务归属">{task.ownership}</Descriptions.Item><Descriptions.Item label="主任务">{task.mainTask === '-' ? '临时任务' : task.mainTask || '-'}</Descriptions.Item><Descriptions.Item label="任务分组">{task.linkedTask || task.taskGroup || '-'}</Descriptions.Item>
        <Descriptions.Item label="任务类型">{task.taskType}</Descriptions.Item><Descriptions.Item label="作业性质">{task.workNature}</Descriptions.Item><Descriptions.Item label="平台任务ID">{task.platformTaskId || '-'}</Descriptions.Item>
        <Descriptions.Item label="负责人">{task.assignee}</Descriptions.Item><Descriptions.Item label="小组">{task.team}</Descriptions.Item><Descriptions.Item label="组长">{task.teamLeader}</Descriptions.Item>
        <Descriptions.Item label="数据报告">{task.dataReporter}</Descriptions.Item><Descriptions.Item label="验收同学">{task.reviewer}</Descriptions.Item><Descriptions.Item label="数据量级">{task.dataVolume}</Descriptions.Item>
        <Descriptions.Item label="下发时间">{task.createdAt}</Descriptions.Item><Descriptions.Item label="预计截止时间">{task.expectedDeadline || '待组长预填'}</Descriptions.Item><Descriptions.Item label="实际截止时间">{task.deadline || '待组长确认'}</Descriptions.Item>
        <Descriptions.Item label="下发难度">{task.difficulty ? <DifficultyStars value={task.difficulty} readOnly /> : <Button size="small" onClick={() => setRatingModalOpen(true)}>填写星级</Button>}</Descriptions.Item>
        <Descriptions.Item label="最终难度">{settlement ? <><DifficultyStars value={settlement.finalDifficulty} readOnly /> <Tag color="green">已确认</Tag></> : '待结项确认'}</Descriptions.Item>
      </Descriptions>
      <div className="task-detail-nav"><a href="#task-overview">概览</a><a href="#deliverables">交付物</a><a href="#work-records">工作记录</a><a href="#changes-and-rescans">回扫与变更</a><a href="#task-settlement">结项</a><a href="#task-history">操作历史</a></div>

      <Divider /><div id="task-overview"><h4>概览与作业进度</h4><Progress percent={Math.round(task.progress * 100)} style={{ maxWidth: 400 }} /></div>
      <Divider />
      <div id="deliverables"><h4>文档交付物 <Button size="small" type="link" onClick={() => setUploadModalOpen(true)}>上传文档</Button></h4>
      <div style={{ marginBottom: 8 }}>必需文档：{requiredDocs.map(type => { const approved = approvedDocs.some(doc => doc.docType === type); return <Tag key={type} color={approved ? 'green' : 'default'}>{type} {approved ? '✓' : '待验收'}</Tag>; })}</div>
      <Table size="small" dataSource={docs} rowKey="id" pagination={false} columns={[
        { title: '文档类型', dataIndex: 'docType', width: 105, render: (value: string) => <Tag>{value}</Tag> }, { title: '文档名称', dataIndex: 'name', width: 210 }, { title: '版本', width: 70, render: (doc: Document) => `V${doc.version || 1}` }, { title: '上传人', dataIndex: 'uploader', width: 80 }, { title: '上传时间', dataIndex: 'uploadedAt', width: 100 },
        { title: '验收状态', width: 135, render: (doc: Document) => { const value = documentWorkflowStatus[doc.workflowStatus || 'completed_by_leader']; return <Tag color={value.color}>{value.label}</Tag>; } },
        { title: '验收人', width: 85, render: (doc: Document) => doc.reviewedBy || '-' }, { title: '链接', width: 65, render: (doc: Document) => <a href={doc.link} target="_blank" rel="noreferrer">查看</a> },
        { title: '操作', width: 155, render: (doc: Document) => doc.workflowStatus === 'pending_leader_review' && actor.role === '组长' && actor.team === task.team ? <Button size="small" type="link" onClick={() => openReview(doc)}>验收并选择路线</Button> : doc.workflowStatus === 'pending_admin_review' && actor.role === '管理员' ? <Button size="small" type="link" onClick={() => navigate('/management-ledger')}>前往审核中心</Button> : doc.workflowStatus === 'member_revision_required' && actor.role === '组员' && doc.uploader === actor.name ? <Button size="small" danger type="link" onClick={() => { setDocType(doc.docType); setUploadModalOpen(true); }}>上传返修版</Button> : doc.workflowStatus === 'leader_revision_required' && actor.role === '组长' ? <Button size="small" type="link" onClick={() => navigate('/management-ledger')}>处理管理员驳回</Button> : isDocumentFinallyApproved(doc) ? <span>已完成</span> : '-' },
      ]} />
      <div className="revision-note">返修统计：本任务累计上传 <strong>{docs.length}</strong> 份文档，其中被驳回 <strong>{docs.filter(doc => doc.status === 'rejected').length}</strong> 次；同类文档再次上传会自动递增版本号。</div></div>

      {rescans.length > 0 && <><Divider /><div id="changes-and-rescans"><h4>回扫/变更记录</h4><Table size="small" dataSource={rescans} rowKey="id" pagination={false} columns={[
        { title: '原因', dataIndex: 'reason', width: 110, render: (value: string) => <Tag>{value}</Tag> }, { title: '说明', dataIndex: 'description' }, { title: '回扫量', dataIndex: 'rescanVolume', width: 90 }, { title: '执行人', dataIndex: 'executors', width: 130, render: (value: string[]) => value.join('、') },
      ]} /></div></>}

      <Divider />
      <div id="task-settlement"><div className="settlement-heading"><div><h4>结项确认</h4><p>组长按实际参与工作给组员挂载标签；关联证据与过程说明均为选填。</p></div>{canSettle && canManageThisTeam && <Button type="primary" icon={<CheckOutlined />} onClick={() => setSettlementModalOpen(true)}>确认结项</Button>}</div>
      {settlement ? <div className="settlement-complete"><Tag color="green">已结项</Tag> 最终星级 {settlement.finalDifficulty} 星，由 {settlement.confirmedBy} 于 {settlement.confirmedAt} 确认。{settlement.summary ? ` 结项备注：${settlement.summary}` : ''}</div> : <Button icon={<PlusOutlined />} disabled={!canSettle} onClick={() => { if (canEditOwnWork) { setMember(actor.name); setEntryMode('member'); } else { setEntryMode('leader'); } setContributionModalOpen(true); }}>登记组员工作标签</Button>}
      <div id="work-records"><Table className="contribution-table" size="small" rowKey="id" pagination={false} locale={{ emptyText: '尚未挂载人员工作标签' }} dataSource={contributions} columns={[
        { title: '组员', dataIndex: 'member', width: 90 }, { title: '实际工作', dataIndex: 'tag', width: 160, render: (value: string, item: TaskContribution) => <Tag color="blue" closable={!settlement && (canManageThisTeam || item.member === actor.name)} onClose={event => { event.preventDefault(); handleRemoveContribution(item); }}>{value}</Tag> }, { title: '确认状态', width: 105, render: (item: TaskContribution) => item.status === 'confirmed' ? <Tag color="green">已确认</Tag> : <Tag color="gold">待组长确认</Tag> }, { title: '关联依据', width: 160, render: (item: TaskContribution) => item.evidenceType ? `${contributionEvidenceLabel[item.evidenceType]}${item.evidenceId ? ` · ${item.evidenceId}` : ''}` : '未关联' }, { title: '备注', dataIndex: 'note' }, { title: '挂载信息', width: 130, render: (item: TaskContribution) => `${item.attachedBy} · ${item.attachedAt}` }, { title: '操作', width: 145, render: (item: TaskContribution) => !settlement && (canManageThisTeam || item.member === actor.name) && <>{item.status !== 'confirmed' && canManageThisTeam && <Button type="link" size="small" onClick={() => handleConfirmContribution(item)}>确认</Button>}<Button type="link" danger size="small" onClick={() => handleRemoveContribution(item)}>移除</Button></> },
      ]} /></div></div>
      {fieldChanges.length > 0 && <div className="revision-note"><strong>任务字段修改记录：</strong>{fieldChanges.map(change => `${change.changedAt} ${change.changedBy} 将${change.field}从“${change.beforeValue || '-'}”修改为“${change.afterValue || '-'}”`).join('；')}</div>}
      {revisions.length > 0 && <div className="revision-note">最终星级修改记录：{revisions.map(revision => `${revision.confirmedAt} ${revision.confirmedBy} 确认 ${revision.difficulty} 星${revision.reason ? `（${revision.reason}）` : ''}`).join('；')}</div>}

      <Divider /><div id="task-history"><h4>操作历史</h4><Timeline items={[...timelineItems, ...documentReviewEvents.map(event => ({ color: event.action.includes('rejected') || event.action === 'leader_returned_member' ? 'red' : 'blue', children: `${event.createdAt} ${event.actor}（${event.actorRole}）${reviewActionLabel[event.action]}${event.comment ? `：${event.comment}` : ''}` }))] as any} /></div>
    </Card>

    <Modal title="上传文档" open={uploadModalOpen} onCancel={() => setUploadModalOpen(false)} onOk={handleUpload} okText="上传">
      <p>上传后由组长验收；验收通过后才会计入任务交付与结项依据。</p><Select value={docType} onChange={setDocType} style={{ width: '100%', marginBottom: 16 }} placeholder="文档类型" options={Object.values(DocType).map(value => ({ label: value, value }))} />
      <Upload.Dragger beforeUpload={file => { setSelectedFile(file); return false; }} maxCount={1} onRemove={() => setSelectedFile(undefined)}><p><UploadOutlined /> 点击或拖拽上传</p></Upload.Dragger>
    </Modal>
    <Modal title="组长验收交付物" open={Boolean(reviewTarget)} onCancel={() => { setReviewTarget(null); setReviewComment(''); }} onOk={handleReview} okText="确认执行" okButtonProps={{ danger: reviewAction === 'reject_member' }}>
      <p>{reviewTarget?.name}（V{reviewTarget?.version || 1}） <a href={reviewTarget?.link} target="_blank" rel="noreferrer">查看交付物</a></p>
      <p style={{ color: 'var(--ink-soft)', fontSize: 12 }}>请选择本次验收结果。进入管理员链路后，后续返修版本仍须管理员最终验收。</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>{reviewTarget?.reviewRoute !== 'leader_then_admin' && <Button size="small" type={reviewAction === 'complete' ? 'primary' : 'default'} onClick={() => setReviewAction('complete')}>通过并结束</Button>}<Button size="small" type={reviewAction === 'submit_admin' ? 'primary' : 'default'} onClick={() => setReviewAction('submit_admin')}>通过并提交管理员</Button><Button size="small" danger type={reviewAction === 'reject_member' ? 'primary' : 'default'} onClick={() => setReviewAction('reject_member')}>驳回组员</Button></div>
      <Input.TextArea rows={4} value={reviewComment} onChange={event => setReviewComment(event.target.value)} placeholder={reviewAction === 'reject_member' ? '必填：请说明需要修改的内容' : '可选：填写验收说明'} />
    </Modal>
    <Modal title="下发难度评分" open={ratingModalOpen} onCancel={() => setRatingModalOpen(false)} onOk={handleRating}><p>请为该任务预填 1–5 星难度：</p><DifficultyStars value={difficulty} onChange={setDifficulty} readOnly={false} /></Modal>
    <Modal title="给组员挂载工作标签" open={contributionModalOpen} onCancel={() => setContributionModalOpen(false)} onOk={handleAddContribution} okText="保存挂载">
      <p style={{ fontSize: 12, color: 'var(--ink-soft)' }}>成员自行登记的标签会进入“待组长确认”；组长代登记时会直接确认并纳入统计。</p>
      {canManageThisTeam && <Select value={entryMode} onChange={setEntryMode} style={{ width: '100%', marginBottom: 12 }} options={[{ value: 'member', label: '成员自行登记（待组长确认）' }, { value: 'leader', label: '组长代登记（直接确认）' }]} />}
      <Select value={member} disabled={!canManageThisTeam} onChange={setMember} placeholder="选择组员" style={{ width: '100%', marginBottom: 12 }} options={teamMembers.map(value => ({ value, label: value }))} />
      <Select mode="multiple" value={tags} onChange={value => setTags(value)} placeholder="选择实际工作标签（可多选）" style={{ width: '100%', marginBottom: 12 }} options={CONTRIBUTION_TAGS.map(value => ({ value, label: value }))} />
      <Select allowClear value={evidenceType} onChange={value => { setEvidenceType(value); setEvidenceId(undefined); }} placeholder="可选：关联依据类型" style={{ width: '100%', marginBottom: 12 }} options={[{ value: 'document', label: '文档' }, { value: 'rescan', label: '回扫记录' }, { value: 'acceptance', label: '数据验收' }]} />
      {evidenceType && <Select allowClear value={evidenceId} onChange={setEvidenceId} placeholder="可选：选择关联记录" style={{ width: '100%', marginBottom: 12 }} options={evidenceOptions} />}
      <Input.TextArea value={note} onChange={event => setNote(event.target.value)} placeholder={tags.includes(ContributionTag.OTHER_ACCEPTED_DELIVERABLE) ? '必填：说明该已验收交付物' : '可选：过程说明或补充备注'} rows={3} />
    </Modal>
    <Modal title={task.status === TaskStatus.PENDING_INFO ? '完善导入任务' : '编辑任务管理字段'} open={taskEditOpen} onCancel={() => setTaskEditOpen(false)} onOk={saveTaskEdit} okText="保存并留痕" width={680}>
      <p style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{task.status === TaskStatus.PENDING_INFO ? '请补齐以下字段；保存后任务会自动进入“进行中”。' : '任务挂链、截止时间、数据量级、难度的每次修改都会记录修改前后内容、修改人和时间。'}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div><label>任务归属</label><Select value={editOwnership} onChange={value => { setEditOwnership(value); setEditMainTask(''); setEditLinkedTask(''); }} style={{ width: '100%', margin: '6px 0 12px' }} options={[...Array.from(new Set(relations.map(item => item.ownership))).map(value => ({ value, label: value })), { value: CUSTOM, label: '自定义填写…' }]} />{editOwnership === CUSTOM && <Input value={customOwnership} onChange={event => setCustomOwnership(event.target.value)} placeholder="自定义任务归属" style={{ marginBottom: 12 }} />}</div>
        <div><label>主任务</label><Select value={editMainTask} onChange={value => { setEditMainTask(value); setEditLinkedTask(''); }} style={{ width: '100%', margin: '6px 0 12px' }} options={[...Array.from(new Set(relations.filter(item => item.ownership === editOwnership).map(item => normalizeMainTask(item.mainTask)).filter(value => value !== TEMPORARY))).map(value => ({ value, label: value })), { value: TEMPORARY, label: '临时任务（无主任务从属）' }, { value: CUSTOM, label: '自定义填写…' }]} />{editMainTask === CUSTOM && <Input value={customMainTask} onChange={event => setCustomMainTask(event.target.value)} placeholder="自定义主任务" style={{ marginBottom: 12 }} />}</div>
        <div><label>任务分组</label><Select value={editLinkedTask} onChange={setEditLinkedTask} style={{ width: '100%', margin: '6px 0 12px' }} options={[...Array.from(new Set(relations.filter(item => item.ownership === editOwnership && (editMainTask === TEMPORARY ? normalizeMainTask(item.mainTask) === TEMPORARY : item.mainTask === editMainTask)).map(item => item.linkedTask))).map(value => ({ value, label: value })), { value: CUSTOM, label: '自定义填写…' }]} />{editLinkedTask === CUSTOM && <Input value={customLinkedTask} onChange={event => setCustomLinkedTask(event.target.value)} placeholder="自定义任务分组" style={{ marginBottom: 12 }} />}</div>
        <div><label>预计截止时间</label><DatePicker value={editExpectedDeadline ? dayjs(editExpectedDeadline) : undefined} onChange={value => setEditExpectedDeadline(value ? value.format('YYYY-MM-DD') : '')} placeholder="选择日期" style={{ width: '100%', margin: '6px 0 12px' }} /></div>
        <div><label>实际截止时间</label><Input value={editDeadline} onChange={event => setEditDeadline(event.target.value)} placeholder="YYYY-MM-DD" style={{ margin: '6px 0 12px' }} /></div>
        <div><label>数据量级</label><InputNumber min={0} value={editDataVolume} onChange={value => setEditDataVolume(value || 0)} style={{ width: '100%', margin: '6px 0 12px' }} /></div>
      </div>
      <label>下发难度</label><DifficultyStars value={editDifficulty} onChange={setEditDifficulty} readOnly={false} />
    </Modal>
    <Modal title="组长确认结项" open={settlementModalOpen} onCancel={() => setSettlementModalOpen(false)} onOk={handleSettlement} okText="确认并结项" okButtonProps={{ danger: false }}>
      <p>确认后任务将进入“已完成”，最终星级与人员工作标签会保留留痕。</p><div className="final-difficulty"><span>最终难度：</span><DifficultyStars value={finalDifficulty} onChange={setFinalDifficulty} readOnly={false} /></div>
      {finalDifficulty !== task.difficulty && <Input.TextArea value={difficultyReason} onChange={event => setDifficultyReason(event.target.value)} placeholder="最终星级与下发星级不同，请说明调整原因（必填）" rows={2} style={{ marginTop: 12 }} />}
      <Input.TextArea value={settlementSummary} onChange={event => setSettlementSummary(event.target.value)} placeholder="可选：结项摘要或补充说明" rows={3} style={{ marginTop: 12 }} />
      <div className="settlement-check">当前已确认 <strong>{confirmedContributions.length}</strong> / {contributions.length} 条人员工作记录，已验收文档 <strong>{approvedDocs.length}</strong> 份。</div>
    </Modal>
  </div>;
}
