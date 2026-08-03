import { useState } from 'react';
import { Alert, Button, Card, Descriptions, Progress, Select, Space, Table, Tag, Upload, message } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { LedgerPreview, previewLedger } from '@/services/ledgerImportService';
import { ALL_TEAMS, RescanReason, TaskOwnership, TaskStatus, TaskType, Team, TEAM_LEADERS, TEAM_MEMBERS, WorkNature } from '@/constants';
import { createTask, getTasks, updateTask } from '@/services/taskService';
import { createRescanRecord } from '@/services/rescanService';
import { USE_MOCK } from '@/services/db';

export default function LedgerImport() {
  const [preview, setPreview] = useState<LedgerPreview>();
  const [loading, setLoading] = useState(false);
  const [team, setTeam] = useState<Team>();
  const [assignee, setAssignee] = useState<string>();
  const [imported, setImported] = useState<string>();
  const readFile = async (file: File) => {
    setLoading(true);
    try {
      const result = await previewLedger(file);
      setPreview(result);
      message.success(`已读取 ${result.sourceName}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '读取台账失败');
    } finally { setLoading(false); }
    return false;
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
    if (!preview || !team || !assignee) return;
    setLoading(true);
    try {
      const existing = await getTasks();
      const knownKeys = new Set(existing.map(task => task.platformTaskId ? `id:${task.platformTaskId}` : `name:${normalize(task.name)}:${task.createdAt}`));
      let createdCount = 0;
      let skippedCount = 0;
      for (const row of preview.rows) {
        const rowKey = row.externalId ? `id:${row.externalId}` : `name:${normalize(row.name)}:${row.date || ''}`;
        if (knownKeys.has(rowKey)) { skippedCount += 1; continue; }
        const ownership = Object.values(TaskOwnership).includes(row.payload.ownership as TaskOwnership) ? row.payload.ownership as TaskOwnership : TaskOwnership.OTHER;
        const workNature = Object.values(WorkNature).includes(row.payload.workNature as WorkNature) ? row.payload.workNature as WorkNature : WorkNature.FIRST_DELIVERY;
        const created = await createTask({
          name: row.name, ownership, taskGroup: String(row.payload.taskGroup || '未分类'), workNature,
          taskType: taskType(row.name, String(row.payload.taskGroup || '')), assignee, team, teamLeader: TEAM_LEADERS[team],
          dataReporter: String(row.payload.dataReporter || ''), reviewer: String(row.payload.reviewer || ''),
          dataVolume: row.volume || 0, workforce: 0, createdAt: row.date || new Date().toISOString().slice(0, 10),
          deadline: String(row.payload.deadline || row.date || new Date().toISOString().slice(0, 10)),
          platformTaskId: row.externalId, ruleDocLink: String(row.payload.ruleDoc || ''), remark: `Excel 导入：${row.sourceSheet} 第 ${row.sourceRow} 行`, difficulty: undefined,
        });
        if (row.payload.ruleDoc) await updateTask(created.id, { status: TaskStatus.IN_PROGRESS });
        knownKeys.add(rowKey);
        createdCount += 1;
      }
      setImported(`已导入 ${createdCount} 条任务，跳过 ${skippedCount} 条重复记录；当前归属：${team} / ${assignee}`);
      message.success('任务台账导入完成');
    } finally { setLoading(false); }
  };
  const importRescans = async () => {
    if (!preview) return;
    setLoading(true);
    try {
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
    <h2>台账手动拉取</h2>
    <Alert type="info" showIcon style={{ marginBottom: 16 }} message="支持《美学&试衣数据留存文档》和《业务借调明细》。读取仅在浏览器内预览；关联缺失的数据必须确认后才能入库。" />
    <Card title="上传 Excel 台账" style={{ marginBottom: 16 }}>
      <Upload.Dragger accept=".xlsx" maxCount={1} showUploadList={false} beforeUpload={readFile} disabled={loading}>
        <p><InboxOutlined style={{ fontSize: 32, color: '#b6b3d6' }} /></p><p>点击或拖入 Excel 文件</p><p style={{ color: 'var(--ink-soft)' }}>系统将自动识别任务台账或借调台账</p>
      </Upload.Dragger>
    </Card>
    {preview && <>
      <Card title="导入预览" extra={<Tag color={preview.kind === 'task' ? 'blue' : 'purple'}>{preview.kind === 'task' ? '任务台账' : '借调台账'}</Tag>} style={{ marginBottom: 16 }}>
        <Descriptions column={3}><Descriptions.Item label="来源文件">{preview.sourceName}</Descriptions.Item><Descriptions.Item label="识别记录">{preview.total}</Descriptions.Item><Descriptions.Item label="需人工确认">{preview.review}</Descriptions.Item></Descriptions>
        <Progress percent={preview.total ? Math.round(preview.ready / preview.total * 100) : 0} format={() => `${preview.ready} 条可直接匹配`} />
      </Card>
      <Card title="字段适配规则" style={{ marginBottom: 16 }}><Table size="small" pagination={false} rowKey="source" dataSource={preview.fieldMapping} columns={[{ title: 'Excel 字段', dataIndex: 'source' }, { title: '系统字段', dataIndex: 'target' }]} /></Card>
      <Card title="确认导入" style={{ marginBottom: 16 }}>
        {preview.kind === 'task' ? <Space wrap>
          <Select placeholder="统一归属小组" style={{ width: 150 }} value={team} onChange={(value: Team) => { setTeam(value); setAssignee(undefined); }} options={ALL_TEAMS.map(value => ({ value, label: value }))} />
          <Select placeholder="统一主负责人" style={{ width: 150 }} value={assignee} onChange={setAssignee} disabled={!team} options={(team ? TEAM_MEMBERS[team] : []).map(value => ({ value, label: value }))} />
          <Button type="primary" loading={loading} disabled={!team || !assignee} onClick={importTasks}>确认导入 {preview.total} 条任务</Button>
        </Space> : <Button type="primary" loading={loading} onClick={importRescans}>导入可自动关联的借调记录</Button>}
        <div style={{ color: 'var(--ink-soft)', fontSize: 12, marginTop: 10 }}>{preview.kind === 'task' ? '台账没有当前系统的小组与主负责人字段，因此需先指定本批次归属。' : '仅导入与现有任务名称精确匹配的记录；其余记录不会被写入。'}</div>
        {USE_MOCK && <Alert type="warning" showIcon message="当前为 Mock 数据模式：导入后刷新页面会丢失。开通 OneDay Cloud 后，导入记录才会持久保存。" style={{ marginTop: 12 }} />}
        {imported && <Alert type="success" showIcon message={imported} style={{ marginTop: 12 }} />}
      </Card>
      <Card title="前 50 条数据预览"><Table size="small" rowKey="key" dataSource={preview.rows.slice(0, 50)} pagination={false} scroll={{ x: 1000 }} columns={[
        { title: 'Sheet / 行', key: 'location', width: 130, render: row => `${row.sourceSheet} #${row.sourceRow}` }, { title: '任务名称', dataIndex: 'name', width: 260 },
        { title: '任务 ID', dataIndex: 'externalId', width: 170, render: value => value || '-' }, { title: '日期', dataIndex: 'date', width: 105 }, { title: '量级', dataIndex: 'volume', width: 80 },
        { title: '来源信息', dataIndex: 'detail', width: 220 }, { title: '待确认项', dataIndex: 'warnings', render: warnings => warnings.map((warning: string) => <Tag color="orange" key={warning}>{warning}</Tag>) },
      ]} /></Card>
    </>}
  </div>;
}
