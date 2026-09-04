import { useEffect, useMemo, useState } from 'react';
import { Avatar, Badge, Button, Card, Empty, Input, Modal, Progress, Select, Table, Tag, message } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined, EditOutlined, FileDoneOutlined, ReloadOutlined, RightOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { ALL_TEAMS, TEAM_MEMBERS, TaskStatus } from '@/constants';
import { Document, Task } from '@/types';
import { getAllDocuments, handleAdminRejection, leaderReviewDocument, reviewDocumentByAdmin } from '@/services/documentService';
import { getTasks } from '@/services/taskService';
import { isGlobalManagerRole, useActor } from '@/contexts/ActorContext';
import { useNavigate } from 'react-router-dom';

type TodoKind = 'incomplete' | 'document' | 'revision' | 'risk';
interface TodoItem { id: string; kind: TodoKind; title: string; detail: string; time: string; taskId: string; priority: number; documentId?: string; }

const todoStyle: Record<TodoKind, { label: string; color: string; background: string }> = {
  incomplete: { label: '待完善字段', color: '#806c79', background: '#f6edef' },
  document: { label: '交付物待确认', color: '#806c79', background: '#f4e8ed' },
  revision: { label: '待处理返修', color: '#b97d7b', background: '#faeeee' },
  risk: { label: '需要跟进', color: '#928e5e', background: '#eeeee2' },
};

function SummaryCard({ title, value, hint, icon, color, onClick, active }: { title: string; value: number; hint: string; icon: React.ReactNode; color: string; onClick: () => void; active: boolean }) {
  return <Card hoverable onClick={onClick} style={{ cursor: 'pointer', borderColor: active ? color : undefined, boxShadow: active ? `0 0 0 2px ${color}22` : undefined }} bodyStyle={{ padding: 22 }}>
    <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}><span style={{ width: 46, height: 46, borderRadius: 14, display: 'inline-flex', justifyContent: 'center', alignItems: 'center', color, background: `${color}18`, fontSize: 22 }}>{icon}</span><div><div style={{ color: 'var(--ink-soft)', fontSize: 14 }}>{title}</div><div style={{ fontSize: 30, lineHeight: 1.2, fontWeight: 700 }}>{value}</div><div style={{ color: 'var(--ink-soft)', fontSize: 12, marginTop: 4 }}>{hint}</div></div></div>
  </Card>;
}

export default function ManagementLedger() {
  const { actor } = useActor();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [focus, setFocus] = useState<TodoKind | 'all'>('all');
  const [selectedTeam, setSelectedTeam] = useState<string>();
  const [adminReviewTarget, setAdminReviewTarget] = useState<Document | null>(null);
  const [adminReviewDecision, setAdminReviewDecision] = useState<'approved' | 'rejected'>('approved');
  const [adminReviewComment, setAdminReviewComment] = useState('');
  const [leaderReviewTarget, setLeaderReviewTarget] = useState<Document | null>(null);
  const [leaderReviewAction, setLeaderReviewAction] = useState<'complete' | 'submit_admin' | 'reject_member' | 'resubmit_admin' | 'return_member'>('complete');
  const [leaderReviewComment, setLeaderReviewComment] = useState('');

  useEffect(() => { getTasks().then(setTasks); getAllDocuments().then(setDocuments); }, []);

  const isAdmin = isGlobalManagerRole(actor.role);
  const groupTasks = useMemo(() => tasks.filter(task => isAdmin ? !selectedTeam || task.team === selectedTeam : task.team === actor.team), [tasks, actor.team, isAdmin, selectedTeam]);
  const taskById = useMemo(() => new Map(groupTasks.map(task => [task.id, task])), [groupTasks]);
  const latestDocuments = useMemo(() => Array.from(documents.reduce((latest, document) => {
    const key = document.rootDocumentId || document.id;
    const current = latest.get(key);
    if (!current || Number(document.version || 1) > Number(current.version || 1)) latest.set(key, document);
    return latest;
  }, new Map<string, Document>()).values()), [documents]);
  const pendingCompletion = groupTasks.filter(task => task.status === TaskStatus.PENDING_INFO);
  const ongoing = groupTasks.filter(task => task.status === TaskStatus.IN_PROGRESS);
  const pendingDocuments = latestDocuments.filter(document => taskById.has(document.taskId) && (isAdmin ? document.workflowStatus === 'pending_admin_review' : document.workflowStatus === 'pending_leader_review' && document.uploader !== actor.name));
  const revisions = latestDocuments.filter(document => taskById.has(document.taskId) && (isAdmin
    ? document.reviewRoute === 'leader_then_admin' && ['leader_revision_required', 'member_revision_required', 'pending_leader_review'].includes(document.workflowStatus || '')
    : document.workflowStatus === 'leader_revision_required'));
  const deliveryProgress = useMemo(() => latestDocuments.filter(document => taskById.has(document.taskId) && document.reviewRoute === 'leader_then_admin').map(document => ({ ...document, task: taskById.get(document.taskId)! })), [latestDocuments, taskById]);
  const riskTasks = ongoing.filter(task => task.alerts.length > 0 || (task.deadline && dayjs(task.deadline).isBefore(dayjs(), 'day')));

  const allTodos = useMemo<TodoItem[]>(() => [
    ...(!isAdmin ? pendingCompletion.map(task => ({ id: `incomplete-${task.id}`, kind: 'incomplete' as const, title: `完善任务字段：${task.name}`, detail: `${task.assignee || '待分配'} · 请补齐任务挂链及两类截止时间`, time: task.createdAt, taskId: task.id, priority: 1 })) : []),
    ...pendingDocuments.map(document => { const task = taskById.get(document.taskId)!; return { id: `document-${document.id}`, kind: 'document' as const, title: `${isAdmin ? '审核组长交付物' : '确认交付物'}：${document.name}`, detail: `${document.uploader} 提交 · ${task.name}`, time: isAdmin ? document.submittedToAdminAt || document.uploadedAt : document.uploadedAt, taskId: task.id, priority: 2, documentId: document.id }; }),
    ...revisions.map(document => { const task = taskById.get(document.taskId)!; return { id: `revision-${document.id}`, kind: 'revision' as const, title: `${isAdmin ? '处理返修交付物' : '处理管理员驳回'}：${document.name}`, detail: document.adminReviewComment || `任务：${task.name}`, time: document.adminReviewedAt || document.uploadedAt, taskId: task.id, priority: 0, documentId: document.id }; }),
    ...(!isAdmin ? riskTasks.map(task => ({ id: `risk-${task.id}`, kind: 'risk' as const, title: `跟进进行中任务：${task.name}`, detail: task.alerts[0]?.message || '任务已逾期，请确认下一步处理', time: task.deadline, taskId: task.id, priority: 3 })) : []),
  ].sort((a, b) => a.priority - b.priority || dayjs(a.time).valueOf() - dayjs(b.time).valueOf()), [pendingCompletion, pendingDocuments, revisions, riskTasks, taskById, isAdmin]);
  const todoItems = focus === 'all' ? allTodos : allTodos.filter(item => item.kind === focus);

  const people = useMemo(() => {
    const members = Array.from(new Set([...(isAdmin ? groupTasks.map(task => task.teamLeader) : actor.team ? TEAM_MEMBERS[actor.team] : []), ...groupTasks.map(task => isAdmin ? task.teamLeader : task.assignee), ...pendingDocuments.map(document => document.uploader)].filter(Boolean)));
    return members.map(member => {
      const active = ongoing.filter(task => (isAdmin ? task.teamLeader : task.assignee) === member).length;
      const incomplete = pendingCompletion.filter(task => (isAdmin ? task.teamLeader : task.assignee) === member).length;
      const documentsToConfirm = pendingDocuments.filter(document => document.uploader === member).length;
      const latestDocument = latestDocuments.filter(document => document.uploader === member && taskById.has(document.taskId)).sort((a, b) => dayjs(b.uploadedAt).valueOf() - dayjs(a.uploadedAt).valueOf())[0];
      return { member, active, incomplete, documentsToConfirm, latest: latestDocument ? `提交 ${latestDocument.name}` : '暂无近期交付物' };
    }).sort((a, b) => (b.incomplete + b.documentsToConfirm + b.active) - (a.incomplete + a.documentsToConfirm + a.active));
  }, [actor.team, groupTasks, ongoing, pendingCompletion, pendingDocuments, latestDocuments, taskById, isAdmin]);

  const openAdminReview = (document: Document) => { setAdminReviewTarget(document); setAdminReviewDecision('approved'); setAdminReviewComment(''); };
  const openLeaderReview = (document: Document) => {
    setLeaderReviewTarget(document);
    setLeaderReviewAction(document.workflowStatus === 'leader_revision_required' ? 'resubmit_admin' : document.reviewRoute === 'leader_then_admin' ? 'submit_admin' : 'complete');
    setLeaderReviewComment('');
  };
  const saveAdminReview = async () => {
    if (!adminReviewTarget) return;
    if (adminReviewDecision === 'rejected' && !adminReviewComment.trim()) return message.warning('驳回时请填写返修意见');
    const result = await reviewDocumentByAdmin(adminReviewTarget.id, adminReviewDecision, actor.name, adminReviewComment.trim() || undefined);
    if (!result) return message.error('审核保存失败');
    setDocuments(current => current.map(document => document.id === result.id ? result : document));
    setAdminReviewTarget(null); setAdminReviewComment('');
    message.success(adminReviewDecision === 'approved' ? '已通过管理员审核。' : '已驳回并回流至对应组长的待处理返修。');
  };
  const saveLeaderReview = async () => {
    if (!leaderReviewTarget) return;
    if (['reject_member', 'return_member'].includes(leaderReviewAction) && !leaderReviewComment.trim()) return message.warning('退回组员时请填写修改意见');
    const isAdminRevision = leaderReviewTarget.workflowStatus === 'leader_revision_required';
    const result = isAdminRevision
      ? await handleAdminRejection(leaderReviewTarget.id, leaderReviewAction === 'return_member' ? 'return_member' : 'resubmit_admin', actor.name, leaderReviewComment.trim() || undefined)
      : await leaderReviewDocument(leaderReviewTarget.id, leaderReviewAction as 'complete' | 'submit_admin' | 'reject_member', actor.name, leaderReviewComment.trim() || undefined);
    if (!result) return message.error('审核保存失败');
    setDocuments(current => current.map(document => document.id === result.id ? result : document));
    setLeaderReviewTarget(null); setLeaderReviewComment('');
    const feedback = leaderReviewAction === 'complete' ? '交付物已由组长验收结案。' : leaderReviewAction === 'submit_admin' || leaderReviewAction === 'resubmit_admin' ? '交付物已提交管理员验收。' : '交付物已退回组员，修改意见已留存。';
    message.success(feedback);
  };

  return <div>
    <div className="page-title-row"><div><span className="eyebrow">{isAdmin ? 'ADMIN REVIEW CENTER' : 'LEADER REVIEW CENTER'}</span><h2>{isAdmin ? '管理员审核中心' : '审核中心'}</h2><p>{isAdmin ? '仅处理组长提交的交付物二级审核及已驳回交付物的返修跟进。' : '聚合本组需要你完善、确认、返修和推进的事项；点击摘要卡可筛选“我的待办”。'}</p></div>{isAdmin && <Select allowClear value={selectedTeam} onChange={setSelectedTeam} placeholder="查看全部小组" style={{ width: 180 }} options={ALL_TEAMS.map(team => ({ value: team, label: team }))} />}</div>
    <div style={{ display: 'grid', gridTemplateColumns: isAdmin ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: 16, marginBottom: 20 }}>
      {!isAdmin && <SummaryCard title="待完善项目" value={pendingCompletion.length} hint="需补齐字段后才能开始" icon={<EditOutlined />} color="#806c79" active={focus === 'incomplete'} onClick={() => setFocus(focus === 'incomplete' ? 'all' : 'incomplete')} />}
      {!isAdmin && <SummaryCard title="我的进行中" value={ongoing.length} hint={riskTasks.length ? `${riskTasks.length} 项需要重点跟进` : '本组正在推进的任务'} icon={<ClockCircleOutlined />} color="#928e5e" active={focus === 'risk'} onClick={() => setFocus(focus === 'risk' ? 'all' : 'risk')} />}
      <SummaryCard title={isAdmin ? '组长交付物待审核' : '交付物待确认'} value={pendingDocuments.length} hint={isAdmin ? '组长已提交，等待二级审核' : '组员提交，等待你的验收'} icon={<FileDoneOutlined />} color="#c1a0ac" active={focus === 'document'} onClick={() => setFocus(focus === 'document' ? 'all' : 'document')} />
      <SummaryCard title={isAdmin ? '返修跟进' : '待处理返修'} value={revisions.length} hint={isAdmin ? '已驳回，等待组长重提' : '管理员驳回，需修改重提'} icon={<ReloadOutlined />} color="#b97d7b" active={focus === 'revision'} onClick={() => setFocus(focus === 'revision' ? 'all' : 'revision')} />
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: isAdmin ? 'minmax(0, 1fr)' : 'minmax(0, 2fr) minmax(320px, .9fr)', gap: 20 }}>
      <Card title={<div><span className="eyebrow">TO-DO</span><div style={{ fontSize: 22, marginTop: 4 }}>我的待办 <Badge count={allTodos.length} overflowCount={99} style={{ marginLeft: 8, backgroundColor: '#806c79' }} /></div></div>} extra={focus !== 'all' && <Button type="link" onClick={() => setFocus('all')}>查看全部</Button>} bodyStyle={{ paddingTop: 10 }}>
        {todoItems.length ? <div>{todoItems.map(item => { const meta = todoStyle[item.kind]; const document = item.documentId ? documents.find(row => row.id === item.documentId) : undefined; const opensReview = Boolean(document && (isAdmin ? document.workflowStatus === 'pending_admin_review' : item.kind === 'document' || item.kind === 'revision')); return <div key={item.id} style={{ padding: '17px 2px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 12, alignItems: 'center' }}><span style={{ width: 34, height: 34, borderRadius: 10, background: meta.background, color: meta.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{item.kind === 'incomplete' ? <EditOutlined /> : item.kind === 'revision' ? <ReloadOutlined /> : item.kind === 'document' ? <CheckCircleOutlined /> : <ClockCircleOutlined />}</span><div style={{ flex: 1, minWidth: 0 }}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><strong>{item.title}</strong><Tag color={meta.color}>{meta.label}</Tag></div><div style={{ color: 'var(--ink-soft)', fontSize: 13, marginTop: 5 }}>{item.detail}</div></div><div style={{ textAlign: 'right', color: 'var(--ink-soft)', fontSize: 12, whiteSpace: 'nowrap' }}><div>{item.time || '待处理'}</div><Button type="link" size="small" icon={<RightOutlined />} onClick={() => opensReview && document ? isAdmin ? openAdminReview(document) : openLeaderReview(document) : navigate(`/tasks/${item.taskId}`)}>{opensReview ? (isAdmin ? '审核' : '处理') : '查看进度'}</Button></div></div>; })}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有待处理事项" />}
      </Card>
      {!isAdmin && <Card title={<div><span className="eyebrow">PEOPLE</span><div style={{ fontSize: 22, marginTop: 4 }}>人员动态</div></div>} bodyStyle={{ paddingTop: 8 }}>
        <div style={{ color: 'var(--ink-soft)', fontSize: 12, marginBottom: 6 }}>{isAdmin ? '按组长汇总其负责任务、待完善字段和提交管理员审核的交付物。' : '按成员汇总进行中任务、待完善字段和待确认交付物。'}</div>
        {people.map(person => <div key={person.member} style={{ padding: '14px 0', borderBottom: '1px solid var(--line)' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Avatar style={{ backgroundColor: '#806c79' }}>{person.member.slice(0, 1)}</Avatar><strong>{person.member}</strong></div><Button size="small" type="link" onClick={() => navigate('/tasks/register')}>查看</Button></div><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '9px 0 7px' }}><Tag color="#928e5e">进行中 {person.active}</Tag>{person.incomplete > 0 && <Tag color="#806c79">待完善 {person.incomplete}</Tag>}{person.documentsToConfirm > 0 && <Tag color="#c1a0ac">待确认交付物 {person.documentsToConfirm}</Tag>}</div><div style={{ color: 'var(--ink-soft)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{person.latest}</div></div>)}
      </Card>}
    </div>
    {!isAdmin && <Card style={{ marginTop: 20 }} title="本组进行中概况" extra={<span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>按任务平台进度展示</span>}><div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>{ongoing.slice(0, 6).map(task => <div key={task.id} style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 12, background: '#fffafa' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong>{task.name}</strong><span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>{task.assignee}</span></div><Progress percent={Math.round(task.progress * 100)} size="small" style={{ marginTop: 10 }} /></div>)}</div></Card>}
    {isAdmin && <Card style={{ marginTop: 20 }} title="交付物验收与返修进度" extra={<span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>{selectedTeam || '全部小组'} · 共 {deliveryProgress.length} 份</span>}><Table size="small" rowKey="id" dataSource={deliveryProgress} pagination={{ pageSize: 8 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前小组暂无管理员审核交付物" /> }} columns={[{ title: '小组 / 组长', width: 155, render: (row: any) => <>{row.task.team}<br /><span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>{row.task.teamLeader}</span></> }, { title: '交付物', width: 245, render: (row: any) => <><strong>{row.name}</strong><br /><span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>{row.task.name}</span></> }, { title: '验收状态', width: 135, render: (row: any) => { const labels: Record<string, string> = { pending_admin_review: '待管理员审核', leader_revision_required: '待组长处理', member_revision_required: '待组员返修', pending_leader_review: '待组长复核', completed_by_admin: '管理员已通过' }; return <Tag color={row.workflowStatus === 'completed_by_admin' ? '#928e5e' : ['leader_revision_required', 'member_revision_required'].includes(row.workflowStatus) ? '#b97d7b' : '#806c79'}>{labels[row.workflowStatus] || '流转中'}</Tag>; } }, { title: '驳回返修', width: 105, render: (row: any) => row.adminRevisionCount ? <Tag color="#b97d7b">第 {row.adminRevisionCount} 次返修</Tag> : <span style={{ color: 'var(--ink-soft)' }}>未驳回</span> }, { title: '最新意见 / 时间', render: (row: any) => <span style={{ color: 'var(--ink-soft)' }}>{row.adminReviewComment || (row.submittedToAdminAt ? `提交于 ${row.submittedToAdminAt}` : '-')}</span> }, { title: '操作', width: 100, render: (row: any) => row.workflowStatus === 'pending_admin_review' ? <Button type="link" size="small" onClick={() => openAdminReview(row)}>审核</Button> : <Button type="link" size="small" onClick={() => navigate(`/tasks/${row.taskId}`)}>查看进度</Button> }]} /></Card>}
    <Modal title={adminReviewDecision === 'approved' ? '通过组长交付物' : '驳回组长交付物'} open={Boolean(adminReviewTarget)} onCancel={() => { setAdminReviewTarget(null); setAdminReviewComment(''); }} onOk={saveAdminReview} okText={adminReviewDecision === 'approved' ? '确认通过' : '确认驳回'} okButtonProps={{ danger: adminReviewDecision === 'rejected' }}>
      <p><strong>{adminReviewTarget?.name}</strong> <a href={adminReviewTarget?.link} target="_blank" rel="noreferrer" style={{ marginLeft: 8 }}>查看交付物</a></p><p style={{ color: 'var(--ink-soft)', fontSize: 12 }}>提交人：{adminReviewTarget?.uploader}；通过后完成管理员审核，驳回后会回流对应组长的“待处理返修”。</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}><Button size="small" type={adminReviewDecision === 'approved' ? 'primary' : 'default'} onClick={() => setAdminReviewDecision('approved')}>通过</Button><Button size="small" danger type={adminReviewDecision === 'rejected' ? 'primary' : 'default'} onClick={() => setAdminReviewDecision('rejected')}>驳回</Button></div>
      <Input.TextArea value={adminReviewComment} onChange={event => setAdminReviewComment(event.target.value)} rows={4} placeholder={adminReviewDecision === 'rejected' ? '必填：请填写组长需要修改的返修意见' : '可选：填写审核说明'} />
    </Modal>
    <Modal title={leaderReviewTarget?.workflowStatus === 'leader_revision_required' ? '处理管理员驳回' : '组长验收交付物'} open={Boolean(leaderReviewTarget)} onCancel={() => { setLeaderReviewTarget(null); setLeaderReviewComment(''); }} onOk={saveLeaderReview} okText="确认执行" okButtonProps={{ danger: ['reject_member', 'return_member'].includes(leaderReviewAction) }}>
      <p><strong>{leaderReviewTarget?.name}</strong> <a href={leaderReviewTarget?.link} target="_blank" rel="noreferrer" style={{ marginLeft: 8 }}>查看交付物</a></p>
      {leaderReviewTarget?.workflowStatus === 'leader_revision_required' ? <p style={{ color: 'var(--ink-soft)', fontSize: 12 }}>管理员驳回意见：{leaderReviewTarget.adminReviewComment || '未填写'}。你可以直接修改后重提管理员，也可以退回组员上传新版本。</p> : <p style={{ color: 'var(--ink-soft)', fontSize: 12 }}>提交人：{leaderReviewTarget?.uploader}。首次验收时由你决定“组长验收即结束”或“继续提交管理员”；进入管理员链路后不可降级。</p>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {leaderReviewTarget?.workflowStatus === 'leader_revision_required' ? <><Button size="small" type={leaderReviewAction === 'resubmit_admin' ? 'primary' : 'default'} onClick={() => setLeaderReviewAction('resubmit_admin')}>修改完成，重提管理员</Button><Button size="small" danger type={leaderReviewAction === 'return_member' ? 'primary' : 'default'} onClick={() => setLeaderReviewAction('return_member')}>退回组员返修</Button></> : <>{leaderReviewTarget?.reviewRoute !== 'leader_then_admin' && <Button size="small" type={leaderReviewAction === 'complete' ? 'primary' : 'default'} onClick={() => setLeaderReviewAction('complete')}>通过并结束</Button>}<Button size="small" type={leaderReviewAction === 'submit_admin' ? 'primary' : 'default'} onClick={() => setLeaderReviewAction('submit_admin')}>通过并提交管理员</Button><Button size="small" danger type={leaderReviewAction === 'reject_member' ? 'primary' : 'default'} onClick={() => setLeaderReviewAction('reject_member')}>驳回组员</Button></>}
      </div>
      <Input.TextArea value={leaderReviewComment} onChange={event => setLeaderReviewComment(event.target.value)} rows={4} placeholder={['reject_member', 'return_member'].includes(leaderReviewAction) ? '必填：请填写需要修改的内容' : '可选：填写审核或重提说明'} />
    </Modal>
  </div>;
}
