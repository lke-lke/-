import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, Table, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import { Document, Task } from '@/types';
import { getAllDocuments } from '@/services/documentService';
import { getTasks } from '@/services/taskService';
import { isGlobalManagerRole, useActor } from '@/contexts/ActorContext';

const STATUS: Record<NonNullable<Document['workflowStatus']>, { label: string; color: string }> = {
  pending_leader_review: { label: '待组长验收', color: '#806c79' }, member_revision_required: { label: '待我返修', color: '#b97d7b' },
  pending_admin_review: { label: '待管理员验收', color: '#c1a0ac' }, leader_revision_required: { label: '组长处理返修', color: '#b97d7b' },
  completed_by_leader: { label: '组长验收完成', color: '#928e5e' }, completed_by_admin: { label: '管理员验收完成', color: '#928e5e' },
};

export default function MyDeliverables() {
  const [documents, setDocuments] = useState<Document[]>([]); const [tasks, setTasks] = useState<Task[]>([]);
  const { actor } = useActor(); const navigate = useNavigate(); const isGlobalManager = isGlobalManagerRole(actor.role);
  useEffect(() => { getAllDocuments().then(setDocuments); getTasks().then(setTasks); }, []);
  const rows = useMemo(() => {
    const mine = documents.filter(document => {
    const task = tasks.find(item => item.id === document.taskId);
    return task && (isGlobalManager || task.assignee === actor.name || task.participantNames?.includes(actor.name) || document.uploader === actor.name);
    }).map(document => ({ ...document, task: tasks.find(item => item.id === document.taskId) }));
    return Array.from(mine.reduce((latest, document) => {
      const key = document.rootDocumentId || document.id;
      const current = latest.get(key);
      if (!current || Number(document.version || 1) > Number(current.version || 1)) latest.set(key, document);
      return latest;
    }, new Map<string, typeof mine[number]>()).values());
  }, [documents, tasks, actor.name, isGlobalManager]);
  const rejected = rows.filter(item => item.workflowStatus === 'member_revision_required').length;
  return <div><div className="page-title-row"><div><span className="eyebrow">{isGlobalManager ? 'ALL DELIVERABLES' : 'MY DELIVERABLES'}</span><h2>{isGlobalManager ? '全部交付物与返修' : '我的交付物与返修'}</h2><p>查看交付物当前流转环节、审核意见和返修要求；被退回后从对应任务提交新版本。</p></div></div>{rejected > 0 && <Card className="personal-filter-card">当前有 <strong>{rejected}</strong> 份交付物待你返修。新版本提交后会重新进入组长验收；已进入管理员链路的交付物仍须管理员最终通过。</Card>}<Card title={isGlobalManager ? '全部文档交付' : '我的文档交付'} style={{ marginTop: 18 }}><Table rowKey="id" size="small" dataSource={rows} pagination={false} locale={{ emptyText: <Empty description={isGlobalManager ? '暂无交付物' : '暂无我的交付物'} /> }} columns={[{ title: '任务', width: 230, render: (row: any) => <Button type="link" size="small" onClick={() => navigate(`/tasks/${row.taskId}`)}>{row.task?.name || row.taskId}</Button> }, { title: '文档类型', dataIndex: 'docType', width: 110, render: (value: string) => <Tag>{value}</Tag> }, { title: '文档', dataIndex: 'name', width: 220 }, { title: '版本', width: 65, render: (row: Document) => `V${row.version || 1}` }, { title: '审核路线', width: 125, render: (row: Document) => row.reviewRoute === 'leader_then_admin' ? '组长 → 管理员' : row.reviewRoute === 'leader_only' ? '仅组长' : '待组长决定' }, { title: '状态', width: 130, render: (row: Document) => { const status = STATUS[row.workflowStatus || 'completed_by_leader']; return <Tag color={status.color}>{status.label}</Tag>; } }, { title: '最新审核意见', width: 230, render: (row: Document) => row.workflowStatus === 'member_revision_required' ? row.reviewComment || row.adminReviewComment || '-' : row.adminReviewComment || row.reviewComment || '-' }, { title: '操作', width: 105, render: (row: Document) => row.workflowStatus === 'member_revision_required' ? <Button danger type="link" size="small" onClick={() => navigate(`/tasks/${row.taskId}`)}>修改并重提</Button> : <Button type="link" size="small" onClick={() => navigate(`/tasks/${row.taskId}`)}>查看</Button> }, { title: '提交时间', dataIndex: 'uploadedAt', width: 105 }]} /></Card></div>;
}
