import { useParams, useNavigate } from 'react-router-dom';
import { Button, Card, Descriptions, Divider, Input, Modal, Progress, Select, Table, Tag, Timeline, Upload, message } from 'antd';
import { ArrowLeftOutlined, CheckOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { CONTRIBUTION_TAGS, ContributionTag, DocType, REQUIRED_DOCS, TaskStatus, TEAM_MEMBERS } from '@/constants';
import { Document, RescanRecord, Task, TaskContribution, TaskSettlement } from '@/types';
import StatusTag from '@/components/StatusTag';
import DifficultyStars from '@/components/DifficultyStars';
import { getTaskById, updateTask } from '@/services/taskService';
import { calcDocCompleteness, getDocsByTask, reviewDocument, uploadDocument } from '@/services/documentService';
import { getRescanRecords } from '@/services/rescanService';
import { addTaskContribution, confirmTaskSettlement, contributionEvidenceLabel, getDifficultyRevisions, getTaskContributions, getTaskSettlement, isOtherDeliverable, removeTaskContribution, saveFinalDifficulty } from '@/services/settlementService';
import { computeNextStatus } from '@/utils/status';

type EvidenceType = NonNullable<TaskContribution['evidenceType']>;
const documentStatus: Record<NonNullable<Document['status']>, { label: string; color: string }> = {
  pending_review: { label: '待验收', color: 'gold' }, approved: { label: '已验收', color: 'green' }, rejected: { label: '已驳回', color: 'red' },
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

  const load = async () => {
    if (!id) return;
    const [loadedTask, loadedDocs, loadedRescans, loadedContributions, loadedSettlement, loadedRevisions] = await Promise.all([
      getTaskById(id), getDocsByTask(id), getRescanRecords({ taskId: id }), getTaskContributions(id), getTaskSettlement(id), getDifficultyRevisions(id),
    ]);
    setTask(loadedTask); setDocs(loadedDocs); setRescans(loadedRescans); setContributions(loadedContributions); setSettlement(loadedSettlement); setRevisions(loadedRevisions);
    setDifficulty(loadedTask?.difficulty); setFinalDifficulty(loadedSettlement?.finalDifficulty ?? loadedTask?.difficulty);
  };

  useEffect(() => { load(); }, [id]);
  const teamMembers = useMemo(() => Array.from(new Set([...(task ? TEAM_MEMBERS[task.team] : []), task?.assignee, task?.teamLeader, task?.reviewer].filter(Boolean))) as string[], [task]);
  if (!task) return <div>任务不存在</div>;

  const requiredDocs = REQUIRED_DOCS[task.taskType] || [];
  const approvedDocs = docs.filter(doc => doc.status === 'approved');
  const canSettle = task.status === TaskStatus.TO_ACCEPT && !settlement;
  const evidenceOptions = evidenceType === 'document' ? approvedDocs.map(doc => ({ value: doc.id, label: `${doc.docType}｜${doc.name}` })) : evidenceType === 'rescan' ? rescans.map(record => ({ value: record.id, label: `${record.reason}｜${record.description}` })) : evidenceType === 'acceptance' ? [{ value: 'task-acceptance', label: `数据验收：${task.reviewer || '待确认'}` }] : [];

  const handleUpload = async () => {
    if (!docType || !selectedFile) return message.warning('请选择文档类型和文件');
    await uploadDocument({ taskId: task.id, docType, name: selectedFile.name, link: URL.createObjectURL(selectedFile), uploader: task.assignee, uploadedAt: dayjs().format('YYYY-MM-DD') });
    setUploadModalOpen(false); setDocType(undefined); setSelectedFile(undefined); await load();
    message.success('文档已上传，等待组长验收后才会计入任务交付。');
  };

  const handleReview = async (doc: Document, decision: 'approved' | 'rejected') => {
    const result = await reviewDocument(doc.id, decision, task.teamLeader);
    if (!result) return message.error('文档状态更新失败');
    const nextDocs = docs.map(item => item.id === doc.id ? result : item);
    const completeness = calcDocCompleteness(task.taskType, nextDocs);
    const updatedTask = await updateTask(task.id, { docCompleteness: completeness, status: computeNextStatus(task, task.progress, completeness) });
    setDocs(nextDocs); if (updatedTask) setTask(updatedTask);
    message.success(decision === 'approved' ? '文档已验收，可作为结项依据。' : '文档已驳回。');
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
    await Promise.all(tags.map(tag => addTaskContribution({ taskId: task.id, member, tag, evidenceType, evidenceId, note: note.trim() || undefined, attachedBy: task.teamLeader })));
    setContributionModalOpen(false); setMember(undefined); setTags([]); setEvidenceType(undefined); setEvidenceId(undefined); setNote(''); await load();
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
    if (contributions.length === 0) return message.warning('请至少给一位组员挂载一项实际工作标签');
    await saveFinalDifficulty({ taskId: task.id, difficulty: finalDifficulty, reason: difficultyReason.trim() || undefined, confirmedBy: task.teamLeader });
    const result = await confirmTaskSettlement({ taskId: task.id, confirmedBy: task.teamLeader, confirmedAt: dayjs().format('YYYY-MM-DD HH:mm'), finalDifficulty, difficultyReason: difficultyReason.trim() || undefined, summary: settlementSummary.trim() || undefined });
    const updatedTask = await updateTask(task.id, { difficulty: finalDifficulty, status: TaskStatus.DONE });
    setSettlement(result); if (updatedTask) setTask(updatedTask); setSettlementModalOpen(false); await load();
    message.success('任务已由组长确认结项，最终星级和人员工作记录已存档。');
  };

  const timelineItems = [
    { color: 'green', children: `${task.createdAt} 任务下发` }, task.progress > 0 && { color: 'blue', children: `标注进行中 (${Math.round(task.progress * 100)}%)` },
    task.progress >= 1 && { color: 'cyan', children: '标注完成 / 数据导出' }, docs.length > 0 && { color: 'orange', children: `已上传 ${docs.length} 份文档（已验收 ${approvedDocs.length} 份）` },
    task.status === TaskStatus.TO_ACCEPT && { color: 'gold', children: '等待组长结项确认' }, settlement && { color: 'green', children: `${settlement.confirmedAt} 由 ${settlement.confirmedBy} 确认结项` },
  ].filter(Boolean);

  return <div>
    <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} style={{ marginBottom: 16 }}>返回</Button>
    <Card title={task.name} extra={<StatusTag status={task.status} />}>
      <Descriptions column={3} size="small" bordered>
        <Descriptions.Item label="任务归属">{task.ownership}</Descriptions.Item><Descriptions.Item label="任务分组">{task.taskGroup}</Descriptions.Item><Descriptions.Item label="任务类型">{task.taskType}</Descriptions.Item>
        <Descriptions.Item label="负责人">{task.assignee}</Descriptions.Item><Descriptions.Item label="小组">{task.team}</Descriptions.Item><Descriptions.Item label="组长">{task.teamLeader}</Descriptions.Item>
        <Descriptions.Item label="数据报告">{task.dataReporter}</Descriptions.Item><Descriptions.Item label="验收同学">{task.reviewer}</Descriptions.Item><Descriptions.Item label="数据量级">{task.dataVolume}</Descriptions.Item>
        <Descriptions.Item label="下发时间">{task.createdAt}</Descriptions.Item><Descriptions.Item label="截止时间">{task.deadline}</Descriptions.Item><Descriptions.Item label="平台任务ID">{task.platformTaskId || '-'}</Descriptions.Item>
        <Descriptions.Item label="下发难度">{task.difficulty ? <DifficultyStars value={task.difficulty} readOnly /> : <Button size="small" onClick={() => setRatingModalOpen(true)}>填写星级</Button>}</Descriptions.Item>
        <Descriptions.Item label="最终难度">{settlement ? <><DifficultyStars value={settlement.finalDifficulty} readOnly /> <Tag color="green">已确认</Tag></> : '待结项确认'}</Descriptions.Item>
      </Descriptions>

      <Divider /><h4>标注进度</h4><Progress percent={Math.round(task.progress * 100)} style={{ maxWidth: 400 }} />
      <Divider />
      <h4>文档交付物 <Button size="small" type="link" onClick={() => setUploadModalOpen(true)}>上传文档</Button></h4>
      <div style={{ marginBottom: 8 }}>必需文档：{requiredDocs.map(type => { const approved = approvedDocs.some(doc => doc.docType === type); return <Tag key={type} color={approved ? 'green' : 'default'}>{type} {approved ? '✓' : '待验收'}</Tag>; })}</div>
      <Table size="small" dataSource={docs} rowKey="id" pagination={false} columns={[
        { title: '文档类型', dataIndex: 'docType', width: 105, render: (value: string) => <Tag>{value}</Tag> }, { title: '文档名称', dataIndex: 'name', width: 210 }, { title: '上传人', dataIndex: 'uploader', width: 80 }, { title: '上传时间', dataIndex: 'uploadedAt', width: 100 },
        { title: '验收状态', width: 100, render: (doc: Document) => { const value = documentStatus[doc.status ?? 'approved']; return <Tag color={value.color}>{value.label}</Tag>; } },
        { title: '验收人', width: 85, render: (doc: Document) => doc.reviewedBy || '-' }, { title: '链接', width: 65, render: (doc: Document) => <a href={doc.link} target="_blank" rel="noreferrer">查看</a> },
        { title: '操作', width: 145, render: (doc: Document) => doc.status === 'pending_review' ? <><Button size="small" type="link" onClick={() => handleReview(doc, 'approved')}>验收</Button><Button size="small" danger type="link" onClick={() => handleReview(doc, 'rejected')}>驳回</Button></> : '-' },
      ]} />

      {rescans.length > 0 && <><Divider /><h4>回扫/变更记录</h4><Table size="small" dataSource={rescans} rowKey="id" pagination={false} columns={[
        { title: '原因', dataIndex: 'reason', width: 110, render: (value: string) => <Tag>{value}</Tag> }, { title: '说明', dataIndex: 'description' }, { title: '回扫量', dataIndex: 'rescanVolume', width: 90 }, { title: '执行人', dataIndex: 'executors', width: 130, render: (value: string[]) => value.join('、') },
      ]} /></>}

      <Divider />
      <div className="settlement-heading"><div><h4>结项确认</h4><p>组长按实际参与工作给组员挂载标签；关联证据与过程说明均为选填。</p></div>{canSettle && <Button type="primary" icon={<CheckOutlined />} onClick={() => setSettlementModalOpen(true)}>确认结项</Button>}</div>
      {settlement ? <div className="settlement-complete"><Tag color="green">已结项</Tag> 最终星级 {settlement.finalDifficulty} 星，由 {settlement.confirmedBy} 于 {settlement.confirmedAt} 确认。{settlement.summary ? ` 结项备注：${settlement.summary}` : ''}</div> : <Button icon={<PlusOutlined />} disabled={!canSettle} onClick={() => setContributionModalOpen(true)}>给组员挂载工作标签</Button>}
      <Table className="contribution-table" size="small" rowKey="id" pagination={false} locale={{ emptyText: '尚未挂载人员工作标签' }} dataSource={contributions} columns={[
        { title: '组员', dataIndex: 'member', width: 110 }, { title: '实际工作', dataIndex: 'tag', width: 180, render: (value: string, item: TaskContribution) => <Tag color="blue" closable={!settlement} onClose={event => { event.preventDefault(); handleRemoveContribution(item); }}>{value}</Tag> }, { title: '关联依据', width: 190, render: (item: TaskContribution) => item.evidenceType ? `${contributionEvidenceLabel[item.evidenceType]}${item.evidenceId ? ` · ${item.evidenceId}` : ''}` : '未关联' }, { title: '备注', dataIndex: 'note' }, { title: '挂载信息', width: 150, render: (item: TaskContribution) => `${item.attachedBy} · ${item.attachedAt}` }, { title: '操作', width: 70, render: (item: TaskContribution) => !settlement && <Button type="link" danger size="small" onClick={() => handleRemoveContribution(item)}>移除</Button> },
      ]} />
      {revisions.length > 0 && <div className="revision-note">最终星级修改记录：{revisions.map(revision => `${revision.confirmedAt} ${revision.confirmedBy} 确认 ${revision.difficulty} 星${revision.reason ? `（${revision.reason}）` : ''}`).join('；')}</div>}

      <Divider /><h4>任务时间线</h4><Timeline items={timelineItems as any} />
    </Card>

    <Modal title="上传文档" open={uploadModalOpen} onCancel={() => setUploadModalOpen(false)} onOk={handleUpload} okText="上传">
      <p>上传后由组长验收；验收通过后才会计入任务交付与结项依据。</p><Select value={docType} onChange={setDocType} style={{ width: '100%', marginBottom: 16 }} placeholder="文档类型" options={Object.values(DocType).map(value => ({ label: value, value }))} />
      <Upload.Dragger beforeUpload={file => { setSelectedFile(file); return false; }} maxCount={1} onRemove={() => setSelectedFile(undefined)}><p><UploadOutlined /> 点击或拖拽上传</p></Upload.Dragger>
    </Modal>
    <Modal title="下发难度评分" open={ratingModalOpen} onCancel={() => setRatingModalOpen(false)} onOk={handleRating}><p>请为该任务预填 1–5 星难度：</p><DifficultyStars value={difficulty} onChange={setDifficulty} readOnly={false} /></Modal>
    <Modal title="给组员挂载工作标签" open={contributionModalOpen} onCancel={() => setContributionModalOpen(false)} onOk={handleAddContribution} okText="保存挂载">
      <Select value={member} onChange={setMember} placeholder="选择组员" style={{ width: '100%', marginBottom: 12 }} options={teamMembers.map(value => ({ value, label: value }))} />
      <Select mode="multiple" value={tags} onChange={value => setTags(value)} placeholder="选择实际工作标签（可多选）" style={{ width: '100%', marginBottom: 12 }} options={CONTRIBUTION_TAGS.map(value => ({ value, label: value }))} />
      <Select allowClear value={evidenceType} onChange={value => { setEvidenceType(value); setEvidenceId(undefined); }} placeholder="可选：关联依据类型" style={{ width: '100%', marginBottom: 12 }} options={[{ value: 'document', label: '文档' }, { value: 'rescan', label: '回扫记录' }, { value: 'acceptance', label: '数据验收' }]} />
      {evidenceType && <Select allowClear value={evidenceId} onChange={setEvidenceId} placeholder="可选：选择关联记录" style={{ width: '100%', marginBottom: 12 }} options={evidenceOptions} />}
      <Input.TextArea value={note} onChange={event => setNote(event.target.value)} placeholder={tags.includes(ContributionTag.OTHER_ACCEPTED_DELIVERABLE) ? '必填：说明该已验收交付物' : '可选：过程说明或补充备注'} rows={3} />
    </Modal>
    <Modal title="组长确认结项" open={settlementModalOpen} onCancel={() => setSettlementModalOpen(false)} onOk={handleSettlement} okText="确认并结项" okButtonProps={{ danger: false }}>
      <p>确认后任务将进入“已完成”，最终星级与人员工作标签会保留留痕。</p><div className="final-difficulty"><span>最终难度：</span><DifficultyStars value={finalDifficulty} onChange={setFinalDifficulty} readOnly={false} /></div>
      {finalDifficulty !== task.difficulty && <Input.TextArea value={difficultyReason} onChange={event => setDifficultyReason(event.target.value)} placeholder="最终星级与下发星级不同，请说明调整原因（必填）" rows={2} style={{ marginTop: 12 }} />}
      <Input.TextArea value={settlementSummary} onChange={event => setSettlementSummary(event.target.value)} placeholder="可选：结项摘要或补充说明" rows={3} style={{ marginTop: 12 }} />
      <div className="settlement-check">当前已挂载 <strong>{contributions.length}</strong> 条人员工作记录，已验收文档 <strong>{approvedDocs.length}</strong> 份。</div>
    </Modal>
  </div>;
}
