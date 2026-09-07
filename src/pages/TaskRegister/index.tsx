import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, DatePicker, Empty, Form, Input, InputNumber, Modal, Segmented, Select, Space, Table, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { Task, TaskRelation } from '@/types';
import { ALL_TEAMS, getTaskStatusLabel, TEAM_LEADERS, TEAM_MEMBERS, TaskStatus, TaskType, WorkNature, Team } from '@/constants';
import { createTask, getTasks } from '@/services/taskService';
import StatusTag from '@/components/StatusTag';
import DifficultyStars from '@/components/DifficultyStars';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { getTaskRelations, saveTaskRelation } from '@/services/taskRelationService';
import { isGlobalManagerRole, useActor } from '@/contexts/ActorContext';
import TaskCard from '@/components/TaskCard';

const CUSTOM = '__custom__';
const TEMPORARY = '__temporary__';
const normalizeMainTask = (mainTask: string) => mainTask === '-' || mainTask === '临时任务' ? TEMPORARY : mainTask;
type TaskViewMode = '层级视图' | '流转看板';
type FlowStage = '待开始' | '进行中' | '待确认' | '已完成';
const FLOW_STAGES: FlowStage[] = ['待开始', '进行中', '待确认', '已完成'];

const getFlowStage = (status: TaskStatus): FlowStage => {
  if (status === TaskStatus.DONE) return '已完成';
  if (status === TaskStatus.WAIT_CONFIRM) return '待确认';
  if (status === TaskStatus.IN_PROGRESS) return '进行中';
  return '待开始';
};

export default function TaskRegister() {
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [relations, setRelations] = useState<TaskRelation[]>([]);
  const [selectedOwnership, setSelectedOwnership] = useState('');
  const [selectedMainTask, setSelectedMainTask] = useState('');
  const [viewMode, setViewMode] = useState<TaskViewMode>('层级视图');
  const [filterTeam, setFilterTeam] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [selectedFormTeam, setSelectedFormTeam] = useState<Team>();
  const { actor } = useActor();
  const isGlobalManager = isGlobalManagerRole(actor.role);
  const canManage = actor.role !== '组员';
  const navigate = useNavigate();

  useEffect(() => { getTasks().then(setTasks); getTaskRelations().then(setRelations); }, []);

  const ownershipOptions = useMemo(() => [...new Set(relations.map(item => item.ownership))], [relations]);
  const mainTaskOptions = useMemo(() => [...new Set(relations
    .filter(item => item.ownership === selectedOwnership)
    .map(item => normalizeMainTask(item.mainTask))
    .filter(value => value !== TEMPORARY))], [relations, selectedOwnership]);
  const linkedTaskOptions = useMemo(() => [...new Set(relations
    .filter(item => item.ownership === selectedOwnership && (selectedMainTask === TEMPORARY ? normalizeMainTask(item.mainTask) === TEMPORARY : item.mainTask === selectedMainTask))
    .map(item => item.linkedTask))], [relations, selectedOwnership, selectedMainTask]);

  const visibleTasks = isGlobalManager
    ? tasks
    : actor.role === '组长'
      ? tasks.filter(task => task.team === actor.team)
      : tasks.filter(task => task.assignee === actor.name || task.participantNames?.includes(actor.name));
  const pendingCompletion = visibleTasks.filter(task => task.status === TaskStatus.PENDING_INFO);
  const pageTitle = isGlobalManager ? '任务全景' : actor.role === '组长' ? '本组任务' : '我的任务';
  const boardTasks = visibleTasks.filter(task => (!filterTeam || task.team === filterTeam) && (!filterAssignee || task.assignee === filterAssignee));
  const assigneeOptions = [...new Set(visibleTasks.filter(task => !filterTeam || task.team === filterTeam).map(task => task.assignee).filter(Boolean))];
  const tasksByStage = FLOW_STAGES.reduce((result, stage) => {
    result[stage] = boardTasks.filter(task => getFlowStage(task.status) === stage);
    return result;
  }, {} as Record<FlowStage, Task[]>);

  const resetHierarchy = (fields: string[]) => {
    form.resetFields(fields);
  };

  const closeModal = () => {
    setModalOpen(false);
    form.resetFields();
    setSelectedOwnership('');
    setSelectedMainTask('');
    setSelectedFormTeam(undefined);
  };

  const openCreateModal = () => {
    const initialTeam = actor.role === '组长' ? actor.team : undefined;
    setSelectedFormTeam(initialTeam);
    form.setFieldsValue({
      team: initialTeam,
      teamLeader: initialTeam ? TEAM_LEADERS[initialTeam] : undefined,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const ownership = values.ownership === CUSTOM ? values.customOwnership?.trim() : values.ownership;
      const mainTask = values.mainTask === CUSTOM ? values.customMainTask?.trim() : values.mainTask === TEMPORARY ? '临时任务' : values.mainTask;
      const linkedTask = values.linkedTask === CUSTOM ? values.customLinkedTask?.trim() : values.linkedTask;
      if (!ownership || !mainTask || !linkedTask) return message.warning('请完整填写任务归属、主任务和任务分组。');
      let relation = relations.find(item => item.ownership === ownership && item.mainTask === mainTask && item.linkedTask === linkedTask);
      if (!relation) {
        relation = await saveTaskRelation({ ownership, mainTask, linkedTask, active: true });
        setRelations(current => [...current, relation!]);
      }
      const task = {
        name: values.name,
        ownership,
        taskGroup: linkedTask,
        mainTask,
        linkedTask,
        relationId: relation?.id,
        workNature: values.workNature,
        taskType: values.taskType,
        assignee: values.assignee,
        team: values.team,
        teamLeader: values.teamLeader,
        dataReporter: '',
        reviewer: values.reviewer || '',
        dataVolume: values.dataVolume || 0,
        workforce: values.workforce || 0,
        createdAt: dayjs().format('YYYY-MM-DD'),
        dispatchedAt: dayjs().format('YYYY-MM-DD'),
        expectedDeadline: values.expectedDeadline.format('YYYY-MM-DD'),
        deadline: '',
        platformTaskId: values.platformTaskId,
        remark: values.remark,
        difficulty: values.difficulty,
        mappingStatus: 'complete',
        initialStatus: TaskStatus.PENDING,
      } as any;
      const created = await createTask(task);
      setTasks(current => [created, ...current]);
      message.success('任务已创建并进入待开始。');
      closeModal();
    } catch (_) { /* 表单提示由组件处理 */ }
  };

  const taskNameColumn = { title: '任务名称', dataIndex: 'name', width: 220, render: (text: string, record: Task) => <a onClick={() => navigate(`/tasks/${record.id}`)}>{text}</a> };
  const statusColumn = { title: '状态', dataIndex: 'status', width: 95, render: (value: TaskStatus) => <StatusTag status={value} />, filters: Object.values(TaskStatus).map(value => ({ text: getTaskStatusLabel(value), value })), onFilter: (value: any, record: Task) => record.status === value };
  const hierarchyColumns = [
    { title: '任务归属', dataIndex: 'ownership', width: 145 },
    { title: '主任务', dataIndex: 'mainTask', width: 135, render: (value: string) => value === '-' ? '临时任务' : value || '-' },
    { title: '任务分组', dataIndex: 'linkedTask', width: 160, render: (value: string, record: Task) => value || record.taskGroup || '-' },
  ];
  const executionColumns = [
    { title: '负责人', dataIndex: 'assignee', width: 85 },
    { title: '小组', dataIndex: 'team', width: 105, filters: ALL_TEAMS.map(value => ({ text: value, value })), onFilter: (value: any, record: Task) => record.team === value },
    { title: '预计截止时间', dataIndex: 'expectedDeadline', width: 120, render: (value: string) => value || '待完善' },
    { title: '实际截止时间', dataIndex: 'deadline', width: 120, render: (value: string, record: Task) => <span style={{ color: value && record.status !== TaskStatus.DONE && dayjs().isAfter(dayjs(value)) ? '#eb687b' : undefined }}>{value || '待完善'}</span> },
    { title: '进度', dataIndex: 'progress', width: 70, render: (value: number) => `${Math.round(value * 100)}%` },
    { title: '难度', dataIndex: 'difficulty', width: 120, render: (value: number) => value ? <DifficultyStars value={value} readOnly /> : '-' },
  ];
  const columns = isGlobalManager
    ? [...hierarchyColumns, taskNameColumn, statusColumn, ...executionColumns.slice(0, 3)]
    : [taskNameColumn, statusColumn, ...hierarchyColumns, ...executionColumns];

  return <div>
    <div className="page-title-row">
      <div><h2 style={{ margin: 0 }}>{pageTitle}</h2><p style={{ color: 'var(--text-secondary)', margin: '6px 0 0' }}>任务归属、主任务和任务分组可从已维护关系选择，也支持为本次任务自定义填写。</p></div>
      {canManage && <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>新建任务</Button>}
    </div>
    {actor.role === '组长' && pendingCompletion.length > 0 && <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={`有 ${pendingCompletion.length} 个台账导入任务待完善`} description="请进入任务详情确认挂链、主负责人、预计截止时间和下发难度；保存后任务进入“待开始”。" />}
    {canManage && <Card className="task-view-switcher">
      <div className="task-view-switcher-row">
        <div><strong>任务视图</strong><span>按挂链字段查询，或按流程阶段推进任务</span></div>
        <Segmented value={viewMode} options={['层级视图', '流转看板']} onChange={value => setViewMode(value as TaskViewMode)} />
      </div>
    </Card>}
    {viewMode === '层级视图' || !canManage ? <Table dataSource={visibleTasks} columns={columns} rowKey="id" size="small" pagination={{ pageSize: 15 }} scroll={{ x: 1550 }} /> : <div className="embedded-flow-board">
      <div className="embedded-flow-toolbar">
      <div><h3>任务流转看板</h3><p>待完善任务暂归入“待开始”；作业与交付物完成后统一进入“待确认”。</p></div>
        <Space wrap>
          {isGlobalManager && <Select allowClear placeholder="筛选小组" value={filterTeam || undefined} style={{ width: 150 }} options={ALL_TEAMS.map(value => ({ label: value, value }))} onChange={value => { setFilterTeam(value || ''); setFilterAssignee(''); }} />}
          <Select allowClear placeholder="筛选负责人" value={filterAssignee || undefined} style={{ width: 150 }} options={assigneeOptions.map(value => ({ label: value, value }))} onChange={value => setFilterAssignee(value || '')} />
        </Space>
      </div>
      <div className="embedded-flow-grid">
        {FLOW_STAGES.map(stage => <section className={`embedded-flow-column stage-${FLOW_STAGES.indexOf(stage) + 1}`} key={stage}>
          <div className="embedded-flow-column-title"><strong>{stage}</strong><span>{tasksByStage[stage].length}</span></div>
          <div className="embedded-flow-column-body">
            {tasksByStage[stage].map(task => <TaskCard key={task.id} task={task} showContext showTeam={isGlobalManager} preferExpectedDeadline onClick={() => navigate(`/tasks/${task.id}`)} />)}
            {!tasksByStage[stage].length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务" />}
          </div>
        </section>)}
      </div>
    </div>}
    <Modal title="手动新建任务" open={modalOpen} onOk={handleSubmit} onCancel={closeModal} width={760} okText="创建任务">
      <Form form={form} layout="vertical" style={{ maxHeight: 540, overflow: 'auto' }}>
        <Form.Item name="name" label="任务名称" rules={[{ required: true }]}><Input placeholder="如：0701-叠穿生成图评测标注" /></Form.Item>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Form.Item name="ownership" label="任务归属" rules={[{ required: true }]}><Select placeholder="选择任务归属" options={[...ownershipOptions.map(value => ({ value, label: value })), { value: CUSTOM, label: '自定义填写…' }]} onChange={value => { setSelectedOwnership(value); setSelectedMainTask(''); resetHierarchy(['mainTask', 'linkedTask', 'customOwnership', 'customMainTask', 'customLinkedTask']); }} /></Form.Item>
          {selectedOwnership === CUSTOM && <Form.Item name="customOwnership" label="自定义任务归属" rules={[{ required: true }]}><Input /></Form.Item>}
          <Form.Item name="mainTask" label="主任务" rules={[{ required: true }]}><Select placeholder="选择主任务" options={[...mainTaskOptions.map(value => ({ value, label: value === TEMPORARY ? '临时任务' : value })), { value: TEMPORARY, label: '临时任务（无主任务从属）' }, { value: CUSTOM, label: '自定义填写…' }]} onChange={value => { setSelectedMainTask(value); resetHierarchy(['linkedTask', 'customMainTask', 'customLinkedTask']); }} /></Form.Item>
          {selectedMainTask === CUSTOM && <Form.Item name="customMainTask" label="自定义主任务" rules={[{ required: true }]}><Input /></Form.Item>}
          <Form.Item name="linkedTask" label="任务分组" rules={[{ required: true }]}><Select placeholder="选择任务分组" options={[...linkedTaskOptions.map(value => ({ value, label: value })), { value: CUSTOM, label: '自定义填写…' }]} /></Form.Item>
          <Form.Item shouldUpdate noStyle>{() => form.getFieldValue('linkedTask') === CUSTOM && <Form.Item name="customLinkedTask" label="自定义任务分组" rules={[{ required: true }]}><Input /></Form.Item>}</Form.Item>
          <Form.Item name="workNature" label="作业性质" rules={[{ required: true }]}><Select options={Object.values(WorkNature).map(value => ({ label: value, value }))} /></Form.Item>
          <Form.Item name="taskType" label="任务类型" rules={[{ required: true }]}><Select options={Object.values(TaskType).map(value => ({ label: value, value }))} /></Form.Item>
          <Form.Item name="team" label="所属小组" rules={[{ required: true }]}><Select disabled={actor.role === '组长'} options={(actor.role === '组长' && actor.team ? [actor.team] : ALL_TEAMS).map(value => ({ label: value, value }))} onChange={(value: Team) => { setSelectedFormTeam(value); form.setFieldsValue({ teamLeader: TEAM_LEADERS[value], assignee: undefined }); }} /></Form.Item>
          <Form.Item name="teamLeader" label="对应组长" rules={[{ required: true }]}><Input disabled /></Form.Item>
          <Form.Item name="assignee" label="主负责人" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" disabled={!selectedFormTeam} placeholder={selectedFormTeam ? '选择本组成员' : '请先选择所属小组'} options={(selectedFormTeam ? TEAM_MEMBERS[selectedFormTeam] : []).map(value => ({ label: value, value }))} /></Form.Item>
          <Form.Item name="expectedDeadline" label="预计截止时间" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="difficulty" label="下发难度" rules={[{ required: true }]}><InputNumber min={1} max={5} style={{ width: '100%' }} addonAfter="星" /></Form.Item>
          <Form.Item name="dataVolume" label="数据量级" rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
          <Form.Item name="workforce" label="作业人力"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
          <Form.Item name="reviewer" label="验收同学"><Input /></Form.Item>
        </div>
        <Form.Item name="platformTaskId" label="作业平台任务 ID"><Input placeholder="用于关联标注平台进度" /></Form.Item>
        <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  </div>;
}
