import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Table, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { Task, TaskRelation } from '@/types';
import { ALL_TEAMS, getTaskStatusLabel, TaskStatus, TaskType, WorkNature } from '@/constants';
import { createTask, getTasks } from '@/services/taskService';
import StatusTag from '@/components/StatusTag';
import DifficultyStars from '@/components/DifficultyStars';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { getTaskRelations } from '@/services/taskRelationService';
import { useActor } from '@/contexts/ActorContext';

const CUSTOM = '__custom__';
const TEMPORARY = '__temporary__';
const normalizeMainTask = (mainTask: string) => mainTask === '-' || mainTask === '临时任务' ? TEMPORARY : mainTask;

export default function TaskRegister() {
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [relations, setRelations] = useState<TaskRelation[]>([]);
  const [selectedOwnership, setSelectedOwnership] = useState('');
  const [selectedMainTask, setSelectedMainTask] = useState('');
  const { actor } = useActor();
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

  const visibleTasks = actor.role === '管理员'
    ? tasks
    : actor.role === '组长'
      ? tasks.filter(task => task.team === actor.team)
      : tasks.filter(task => task.assignee === actor.name || task.participantNames?.includes(actor.name));
  const pendingCompletion = visibleTasks.filter(task => task.status === TaskStatus.PENDING_INFO);
  const pageTitle = actor.role === '管理员' ? '任务全景' : actor.role === '组长' ? '本组任务' : '我的任务';

  const resetHierarchy = (fields: string[]) => {
    form.resetFields(fields);
  };

  const closeModal = () => {
    setModalOpen(false);
    form.resetFields();
    setSelectedOwnership('');
    setSelectedMainTask('');
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const ownership = values.ownership === CUSTOM ? values.customOwnership?.trim() : values.ownership;
      const mainTask = values.mainTask === CUSTOM ? values.customMainTask?.trim() : values.mainTask === TEMPORARY ? '-' : values.mainTask;
      const linkedTask = values.linkedTask === CUSTOM ? values.customLinkedTask?.trim() : values.linkedTask;
      if (!ownership || !mainTask || !linkedTask) return message.warning('请完整填写任务归属、主任务和任务分组。');
      const relation = relations.find(item => item.ownership === ownership && item.mainTask === mainTask && item.linkedTask === linkedTask);
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
        dataReporter: values.dataReporter || '',
        reviewer: values.reviewer || '',
        dataVolume: values.dataVolume || 0,
        workforce: values.workforce || 0,
        createdAt: dayjs().format('YYYY-MM-DD'),
        expectedDeadline: values.expectedDeadline.format('YYYY-MM-DD'),
        deadline: values.deadline.format('YYYY-MM-DD'),
        platformTaskId: values.platformTaskId,
        ruleDocLink: values.ruleDocLink,
        remark: values.remark,
        difficulty: undefined,
        initialStatus: TaskStatus.IN_PROGRESS,
      } as any;
      const created = await createTask(task);
      setTasks(current => [created, ...current]);
      message.success('任务已创建并进入进行中。');
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
  const columns = actor.role === '管理员'
    ? [...hierarchyColumns, taskNameColumn, statusColumn, ...executionColumns]
    : [taskNameColumn, statusColumn, ...hierarchyColumns, ...executionColumns];

  return <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
      <div><h2 style={{ margin: 0 }}>{pageTitle}</h2><p style={{ color: 'var(--text-secondary)', margin: '6px 0 0' }}>任务归属、主任务和任务分组可从已维护关系选择，也支持为本次任务自定义填写。</p></div>
      {canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>新建任务</Button>}
    </div>
    {actor.role === '组长' && pendingCompletion.length > 0 && <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={`有 ${pendingCompletion.length} 个台账导入任务待完善`} description="请进入任务详情补齐预计截止时间、实际截止时间及任务挂链信息；保存完整后任务会自动进入“进行中”。" />}
    <Table dataSource={visibleTasks} columns={columns} rowKey="id" size="small" pagination={{ pageSize: 15 }} scroll={{ x: 1550 }} />
    <Modal title="手动新建任务" open={modalOpen} onOk={handleSubmit} onCancel={closeModal} width={760} okText="创建并开始">
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
          <Form.Item name="assignee" label="主负责人" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="team" label="所属小组" rules={[{ required: true }]}><Select options={ALL_TEAMS.map(value => ({ label: value, value }))} /></Form.Item>
          <Form.Item name="teamLeader" label="对应组长" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="expectedDeadline" label="预计截止时间" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="deadline" label="实际截止时间" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="dataVolume" label="数据量级" rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
          <Form.Item name="workforce" label="作业人力"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
          <Form.Item name="dataReporter" label="数据报告同学"><Input /></Form.Item>
          <Form.Item name="reviewer" label="验收同学"><Input /></Form.Item>
        </div>
        <Form.Item name="platformTaskId" label="作业平台任务 ID"><Input placeholder="用于关联标注平台进度" /></Form.Item>
        <Form.Item name="ruleDocLink" label="规则文档链接"><Input placeholder="已有规则文档时填写" /></Form.Item>
        <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  </div>;
}
