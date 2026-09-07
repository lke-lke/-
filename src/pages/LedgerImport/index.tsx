import { useState } from 'react';
import { Alert, Button, Card, Descriptions, Modal, Progress, Segmented, Select, Space, Table, Tag, Upload, message } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { commitRescanLedgerImport, commitTaskLedgerImport, ImportedRow, ImportRowStatus, LedgerPreview, previewLedger, resolvePreviewRow, resolveRescanPreviewRow, retryTaskImportRows } from '@/services/ledgerImportService';
import { ALL_TEAMS, RescanReason, TaskOwnership, TaskStatus, TaskType, Team, TEAM_LEADERS, TEAM_MEMBERS, WorkNature } from '@/constants';
import { createTask, getTasks } from '@/services/taskService';
import { createRescanRecord } from '@/services/rescanService';
import { USE_MOCK } from '@/services/db';
import { getTaskRelations } from '@/services/taskRelationService';
import { Task, TaskRelation } from '@/types';

export default function LedgerImport() {
  const [preview, setPreview] = useState<LedgerPreview>();
  const [loading, setLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | ImportRowStatus>('all');
  const [imported, setImported] = useState<string>();
  const [relations, setRelations] = useState<TaskRelation[]>([]);
  const [resolutionTarget, setResolutionTarget] = useState<ImportedRow>();
  const [resolutionRelationId, setResolutionRelationId] = useState<string>();
  const [resolutionPeople, setResolutionPeople] = useState<string[]>([]);
  const [resolutionPrimary, setResolutionPrimary] = useState<string>();
  const [rescanTarget, setRescanTarget] = useState<ImportedRow>();
  const [rescanTaskId, setRescanTaskId] = useState<string>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const readFile = async (file: File) => {
    setLoading(true);
    try {
      const result = await previewLedger(file);
      setRelations(await getTaskRelations());
      if (result.kind === 'rescan') setTasks(await getTasks());
      setPreview(result);
      setSelectedRowKeys(result.rows.filter(row => row.status === 'ready' || row.status === 'needs_completion').map(row => row.key));
      setStatusFilter('all');
      message.success(`已读取 ${result.sourceName}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '读取台账失败');
    } finally { setLoading(false); }
    return false;
  };

  const openResolution = (row: ImportedRow) => {
    setResolutionTarget(row);
    setResolutionRelationId(row.resolution?.relation?.id);
    setResolutionPeople(row.resolution?.participants || []);
    setResolutionPrimary(row.resolution?.primaryAssignee);
  };
  const saveResolution = async () => {
    if (!preview || !resolutionTarget || !resolutionRelationId || !resolutionPeople.length) return message.warning('请选择任务挂链和参与人');
    if (resolutionPrimary && !resolutionPeople.includes(resolutionPrimary)) return message.warning('主负责人必须包含在参与人中');
    const relation = relations.find(item => item.id === resolutionRelationId);
    if (!relation) return message.warning('所选任务关系无效');
    setLoading(true);
    try {
      const updated = await resolvePreviewRow(preview, resolutionTarget, relation, resolutionPeople, resolutionPrimary);
      const rows = preview.rows.map(row => row.key === updated.key ? updated : row);
      const summary = rows.reduce<Record<ImportRowStatus, number>>((result, row) => { result[row.status] += 1; return result; }, { ready: 0, needs_completion: 0, conflict: 0, error: 0 });
      setPreview({ ...preview, rows, summary, ready: summary.ready, review: rows.length - summary.ready });
      if (updated.status !== 'conflict' && updated.status !== 'error') setSelectedRowKeys(keys => [...new Set([...keys, updated.key])]);
      setResolutionTarget(undefined);
      message.success('该行解析结果已更新');
    } catch (error) { message.error(error instanceof Error ? error.message : '处理失败'); }
    finally { setLoading(false); }
  };
  const exportIssues = () => {
    if (!preview) return;
    const rows = preview.rows.filter(row => row.issues.length).map(row => [row.sourceSheet, row.sourceRow, row.name, row.status, row.issues.map(issue => `${issue.code}:${issue.message}`).join('；')]);
    const csv = [['Sheet', '行号', '任务名称', '状态', '问题'], ...rows].map(cells => cells.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    link.download = `${preview.sourceName.replace(/\.xlsx$/i, '')}-导入问题.csv`; link.click(); URL.revokeObjectURL(link.href);
  };
  const saveRescanResolution = async () => {
    if (!preview || !rescanTarget || !rescanTaskId) return message.warning('请选择关联任务');
    const task = tasks.find(item => item.id === rescanTaskId); if (!task) return;
    setLoading(true);
    try {
      const updated = await resolveRescanPreviewRow(rescanTarget, task);
      const rows = preview.rows.map(row => row.key === updated.key ? updated : row);
      const summary = rows.reduce<Record<ImportRowStatus, number>>((result, row) => { result[row.status] += 1; return result; }, { ready: 0, needs_completion: 0, conflict: 0, error: 0 });
      setPreview({ ...preview, rows, summary, ready: summary.ready, review: rows.length - summary.ready });
      setSelectedRowKeys(keys => [...new Set([...keys, updated.key])]); setRescanTarget(undefined); message.success('回扫记录已关联任务');
    } catch (error) { message.error(error instanceof Error ? error.message : '关联失败'); }
    finally { setLoading(false); }
  };
  const retryFailedRows = async () => {
    if (!preview) return;
    setLoading(true);
    try {
      const retried = await retryTaskImportRows(preview); setPreview(retried);
      setSelectedRowKeys(retried.rows.filter(row => ['ready', 'needs_completion'].includes(row.status)).map(row => row.key));
      message.success('已创建独立重试批次，原始失败行保持不变');
    } catch (error) { message.error(error instanceof Error ? error.message : '重试失败'); }
    finally { setLoading(false); }
  };

  const taskType = (name: string, group: string): TaskType => {
    const content = `${name}${group}`;
    if (/规则|SOP/.test(content)) return TaskType.EVAL_RULE;
    if (/分析/.test(content)) return TaskType.ANALYSIS;
    if (/采集|标注|补标/.test(content)) return TaskType.DATA_COLLECTION;
    return TaskType.MODEL_EVAL;
  };
  const normalize = (name: string) => name.replace(/[\s\-—_（()）【】]/g, '').toLowerCase();
  const importTasks = async () => {
    if (!preview || selectedRowKeys.length === 0) return;
    setLoading(true);
    try {
      if (!USE_MOCK) {
        const batch = await commitTaskLedgerImport(preview, selectedRowKeys.map(String));
        setImported(`批次 ${batch?.id || ''} 已持久化：新建 ${batch?.created_rows ?? 0} 条，更新 ${batch?.updated_rows ?? 0} 条，跳过 ${batch?.skipped_rows ?? 0} 条。`);
        message.success('任务台账已通过数据库事务导入');
        return;
      }
      const existing = await getTasks();
      const knownKeys = new Set(existing.map(task => task.platformTaskId ? `id:${task.platformTaskId}` : `name:${normalize(task.name)}:${task.createdAt}`));
      let createdCount = 0;
      let skippedCount = 0;
      for (const row of preview.rows.filter(item => selectedRowKeys.includes(item.key))) {
        const rowKey = row.externalId ? `id:${row.externalId}` : `name:${normalize(row.name)}:${row.date || ''}`;
        if (knownKeys.has(rowKey)) { skippedCount += 1; continue; }
        if (!row.canonical || !row.resolution?.team || !row.resolution.relation) { skippedCount += 1; continue; }
        const ownership = Object.values(TaskOwnership).includes(row.canonical.ownership as TaskOwnership) ? row.canonical.ownership as TaskOwnership : TaskOwnership.OTHER;
        const workNature = Object.values(WorkNature).includes(row.canonical.workNature as WorkNature) ? row.canonical.workNature as WorkNature : WorkNature.FIRST_DELIVERY;
        const team = row.resolution.team as Team;
        const created = await createTask({
          name: row.name, ownership, taskGroup: row.resolution.relation.linkedTask, workNature,
          taskType: taskType(row.name, row.resolution.relation.linkedTask), assignee: row.resolution.primaryAssignee || '', team, teamLeader: TEAM_LEADERS[team],
          dataReporter: '', reviewer: '', dataVolume: row.canonical.dataVolume || 0, workforce: row.canonical.workforce || 0,
          createdAt: new Date().toISOString().slice(0, 10), dispatchedAt: row.canonical.dispatchedAt,
          expectedDeadline: row.canonical.expectedDeadline || '', deadline: '', initialStatus: TaskStatus.PENDING_INFO,
          platformTaskId: row.externalId, ruleDocLink: '', relationId: row.resolution.relation.id,
          mainTask: row.resolution.relation.mainTask, linkedTask: row.resolution.relation.linkedTask,
          participantNames: row.resolution.participants, mappingStatus: row.status === 'conflict' ? 'conflict' : row.status === 'needs_completion' ? 'needs_completion' : 'complete',
          sourcePayload: row.payload, remark: `Excel 导入：${row.sourceSheet} 第 ${row.sourceRow} 行`, difficulty: row.canonical.difficulty,
        });
        knownKeys.add(rowKey);
        createdCount += 1;
      }
      setImported(`已导入 ${createdCount} 条任务，跳过 ${skippedCount} 条重复或未解决记录。系统已逐行识别小组和参与人，任务进入“待完善”。`);
      message.success('任务台账导入完成，已等待组长完善');
    } finally { setLoading(false); }
  };
  const importRescans = async () => {
    if (!preview) return;
    setLoading(true);
    try {
      if (!USE_MOCK) {
        const batch = await commitRescanLedgerImport(preview, selectedRowKeys.map(String));
        setImported(`回扫批次已提交：成功 ${batch?.committed_rows || 0} 条，失败 ${batch?.error_rows || 0} 条。`);
        message.success('回扫台账已通过数据库事务导入'); return;
      }
      const tasks = await getTasks();
      const matched = preview.rows.map(row => ({ row, task: tasks.find(task => normalize(task.name) === normalize(row.name)) })).filter(item => item.task);
      for (const { row, task } of matched) {
        await createRescanRecord({ originalTaskId: task!.id, originalTaskName: task!.name, reason: RescanReason.OTHER,
          description: `Excel 借调导入：${row.detail}`, rescanVolume: row.volume || 0,
          executors: [String(row.payload.executor || '未填写')], contactAssistant: String(row.payload.contactAssistant || '未填写'),
          expectedDone: row.date || new Date().toISOString().slice(0, 10), actualDone: undefined,
          accepted: row.payload.accepted === '通过' ? true : row.payload.accepted === '不通过' ? false : undefined });
      }
      setImported(`已导入 ${matched.length} 条已匹配借调记录；${preview.rows.length - matched.length} 条未匹配记录保留待确认。`);
      message.success('已导入可自动匹配的借调记录');
    } finally { setLoading(false); }
  };

  return <div>
    <div className="page-title-row"><div><span className="eyebrow">IMPORT CENTER</span><h2>导入中心</h2><p>上传任务台账并完成字段识别、预览校验和确认入库；回扫台账保留解析与关联入口。</p></div></div>
    <Alert type="info" showIcon style={{ marginBottom: 16 }} message="支持任务台账和业务借调明细。任务台账会按每一行的对应验收同学自动识别小组与参与人，并按任务分组自动挂链；组长只需处理系统明确标出的待完善或冲突项。" />
    <Card title="上传 Excel 台账" style={{ marginBottom: 16 }}>
      <Upload.Dragger accept=".xlsx" maxCount={1} showUploadList={false} beforeUpload={readFile} disabled={loading}>
        <p><InboxOutlined style={{ fontSize: 32, color: '#b6b3d6' }} /></p><p>点击或拖入 Excel 文件</p><p style={{ color: 'var(--ink-soft)' }}>系统将自动识别任务台账或借调台账</p>
      </Upload.Dragger>
    </Card>
    {preview && <>
      <Card title="导入预览" extra={<Tag color={preview.kind === 'task' ? 'blue' : 'purple'}>{preview.kind === 'task' ? '任务台账' : '借调台账'}</Tag>} style={{ marginBottom: 16 }}>
        <Descriptions column={5}><Descriptions.Item label="来源文件">{preview.sourceName}</Descriptions.Item><Descriptions.Item label="总行数">{preview.total}</Descriptions.Item><Descriptions.Item label="可直接提交">{preview.summary.ready}</Descriptions.Item><Descriptions.Item label="待完善">{preview.summary.needs_completion}</Descriptions.Item><Descriptions.Item label="冲突/错误">{preview.summary.conflict + preview.summary.error}</Descriptions.Item></Descriptions>
        <Progress percent={preview.total ? Math.round((preview.summary.ready + preview.summary.needs_completion) / preview.total * 100) : 0} format={() => `${preview.summary.ready + preview.summary.needs_completion} 条可建单`} />
      </Card>
      <Card title="字段适配规则" style={{ marginBottom: 16 }}><Table size="small" pagination={false} rowKey="source" dataSource={preview.fieldMapping} columns={[{ title: 'Excel 字段', dataIndex: 'source' }, { title: '系统字段', dataIndex: 'target' }]} /></Card>
      <Card title="确认导入" style={{ marginBottom: 16 }}>
        {preview.kind === 'task' ? <Space wrap>
          <Button type="primary" loading={loading} disabled={selectedRowKeys.length === 0} onClick={importTasks}>提交已选 {selectedRowKeys.length} 条</Button>
        </Space> : <Button type="primary" loading={loading} onClick={importRescans}>导入可自动关联的借调记录</Button>}
        <div style={{ color: 'var(--ink-soft)', fontSize: 12, marginTop: 10 }}>{preview.kind === 'task' ? '冲突和错误行不会默认选中；待完善行可先建单，并自动进入对应组长的待完善队列。' : '仅导入与现有任务名称精确匹配的记录；其余记录不会被写入。'}</div>
        {USE_MOCK && <Alert type="warning" showIcon message="当前为 Mock 数据模式：导入后刷新页面会丢失。开通 OneDay Cloud 后，导入记录才会持久保存。" style={{ marginTop: 12 }} />}
        {imported && <Alert type="success" showIcon message={imported} style={{ marginTop: 12 }} />}
      </Card>
      <Card title="逐行解析结果" extra={<Space>{preview.kind === 'task' && !USE_MOCK && preview.summary.conflict + preview.summary.error > 0 && <Button loading={loading} onClick={retryFailedRows}>重新解析失败行</Button>}<Button onClick={exportIssues}>导出问题明细</Button><Segmented value={statusFilter} onChange={value => setStatusFilter(value as typeof statusFilter)} options={[{ label: `全部 ${preview.total}`, value: 'all' }, { label: `可提交 ${preview.summary.ready}`, value: 'ready' }, { label: `待完善 ${preview.summary.needs_completion}`, value: 'needs_completion' }, { label: `冲突 ${preview.summary.conflict}`, value: 'conflict' }, { label: `错误 ${preview.summary.error}`, value: 'error' }]} /></Space>}><Table size="small" rowKey="key" dataSource={preview.rows.filter(row => statusFilter === 'all' || row.status === statusFilter).slice(0, 50)} pagination={false} scroll={{ x: 1400 }} rowSelection={preview.kind === 'task' ? { selectedRowKeys, onChange: setSelectedRowKeys, getCheckboxProps: row => ({ disabled: row.status === 'conflict' || row.status === 'error' }) } : undefined} columns={[
        { title: 'Sheet / 行', key: 'location', width: 130, render: row => `${row.sourceSheet} #${row.sourceRow}` }, { title: '任务名称', dataIndex: 'name', width: 260 },
        { title: '解析状态', dataIndex: 'status', width: 105, render: value => <Tag color={value === 'ready' ? 'green' : value === 'needs_completion' ? 'gold' : 'red'}>{{ ready: '可提交', needs_completion: '待完善', conflict: '冲突', error: '错误' }[value as ImportRowStatus]}</Tag> },
        { title: '任务 ID', dataIndex: 'externalId', width: 170, render: value => value || '-' }, { title: '下发日期', dataIndex: 'date', width: 105 }, { title: '量级', dataIndex: 'volume', width: 80 },
        { title: '挂链结果', dataIndex: 'detail', width: 280 },
        { title: '小组 / 参与人', key: 'people', width: 230, render: row => row.resolution?.team ? `${row.resolution.team} · ${row.resolution.participants.join('、') || '待补充'}` : '未识别' },
        { title: '问题与依据', dataIndex: 'issues', render: issues => issues.map((issue: any) => <Tag color={issue.level === 'error' ? 'red' : 'orange'} key={`${issue.code}-${issue.message}`}>{issue.message}</Tag>) },
        { title: '操作', key: 'action', fixed: 'right' as const, width: 100, render: (_: unknown, row: ImportedRow) => <Button size="small" onClick={() => preview.kind === 'task' ? openResolution(row) : (setRescanTarget(row), setRescanTaskId(row.matchedTaskId))}>人工处理</Button> },
      ]} /></Card>
    </>}
    <Modal title="人工处理导入行" open={Boolean(resolutionTarget)} onCancel={() => setResolutionTarget(undefined)} onOk={saveResolution} confirmLoading={loading} okText="保存解析结果">
      <p style={{ color: 'var(--ink-soft)' }}>{resolutionTarget?.name}；本次选择只作用于当前导入行，不会自动修改全局人员别名或任务关系。</p>
      <div style={{ marginBottom: 14 }}><div style={{ marginBottom: 6 }}>任务挂链</div><Select showSearch optionFilterProp="label" value={resolutionRelationId} onChange={setResolutionRelationId} style={{ width: '100%' }} options={relations.map(relation => ({ value: relation.id, label: `${relation.ownership} / ${relation.mainTask} / ${relation.linkedTask}` }))} /></div>
      <div style={{ marginBottom: 14 }}><div style={{ marginBottom: 6 }}>参与人</div><Select mode="multiple" showSearch optionFilterProp="label" value={resolutionPeople} onChange={values => { setResolutionPeople(values); if (resolutionPrimary && !values.includes(resolutionPrimary)) setResolutionPrimary(undefined); }} style={{ width: '100%' }} options={ALL_TEAMS.flatMap(team => TEAM_MEMBERS[team].map(name => ({ value: name, label: `${name}（${team}）` })))} /></div>
      <div><div style={{ marginBottom: 6 }}>主负责人</div><Select allowClear value={resolutionPrimary} onChange={setResolutionPrimary} style={{ width: '100%' }} options={resolutionPeople.filter(name => !Object.values(TEAM_LEADERS).includes(name)).map(name => ({ value: name, label: name }))} placeholder="只能选择普通组员；多人参与时由组长确认" /></div>
    </Modal>
    <Modal title="确认回扫关联任务" open={Boolean(rescanTarget)} onCancel={() => setRescanTarget(undefined)} onOk={saveRescanResolution} confirmLoading={loading} okText="确认关联">
      <p style={{ color: 'var(--ink-soft)' }}>{rescanTarget?.name}；系统不会在多候选或无候选时自动猜测，人工选择会被保留在导入记录中。</p>
      <Select showSearch optionFilterProp="label" value={rescanTaskId} onChange={setRescanTaskId} style={{ width: '100%' }} placeholder="选择规范化任务" options={tasks.map(task => ({ value: task.id, label: `${task.name} · ${task.team} · ${task.platformTaskId || task.id}` }))} />
    </Modal>
  </div>;
}
