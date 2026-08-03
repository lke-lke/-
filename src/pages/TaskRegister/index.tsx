import { useEffect, useState } from 'react';
import { Tabs, Table, Button, Modal, Form, Input, Select, InputNumber, DatePicker, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { Task } from '@/types';
import { TaskStatus, TaskType, TaskOwnership, WorkNature, TASK_GROUPS, ALL_TEAMS } from '@/constants';
import { createTask, getTasks } from '@/services/taskService';
import StatusTag from '@/components/StatusTag';
import DifficultyStars from '@/components/DifficultyStars';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';

const { TabPane } = Tabs;

export default function TaskRegister() {
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedOwnership, setSelectedOwnership] = useState<TaskOwnership | ''>('');
  const navigate = useNavigate();

  useEffect(() => { getTasks().then(setTasks); }, []);

  const columns = [
    { title: '任务名称', dataIndex: 'name', key: 'name', width: 220,
      render: (text: string, record: Task) => <a onClick={() => navigate(`/tasks/${record.id}`)}>{text}</a> },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (s: TaskStatus) => <StatusTag status={s} />,
      filters: Object.values(TaskStatus).map(s => ({ text: s, value: s })),
      onFilter: (value: any, record: Task) => record.status === value },
    { title: '任务归属', dataIndex: 'ownership', key: 'ownership', width: 140 },
    { title: '任务类型', dataIndex: 'taskType', key: 'taskType', width: 120 },
    { title: '负责人', dataIndex: 'assignee', key: 'assignee', width: 80 },
    { title: '小组', dataIndex: 'team', key: 'team', width: 80,
      filters: ALL_TEAMS.map(t => ({ text: t, value: t })),
      onFilter: (value: any, record: Task) => record.team === value },
    { title: '数据量级', dataIndex: 'dataVolume', key: 'dataVolume', width: 90 },
    { title: '下发时间', dataIndex: 'createdAt', key: 'createdAt', width: 100 },
    { title: '截止时间', dataIndex: 'deadline', key: 'deadline', width: 100,
      render: (d: string, record: Task) => {
        const overdue = record.status !== '已完成' && dayjs().isAfter(dayjs(d));
        return <span style={{ color: overdue ? '#eb687b' : undefined }}>{d}</span>;
      }},
    { title: '进度', dataIndex: 'progress', key: 'progress', width: 70,
      render: (p: number) => `${Math.round(p * 100)}%` },
    { title: '难度', dataIndex: 'difficulty', key: 'difficulty', width: 120,
      render: (d: number) => d ? <DifficultyStars value={d} readOnly /> : '-' },
  ];

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const task = {
        name: values.name,
        ownership: values.ownership,
        taskGroup: values.taskGroup,
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
        deadline: values.deadline.format('YYYY-MM-DD'),
        platformTaskId: values.platformTaskId,
        ruleDocLink: values.ruleDocLink,
        remark: values.remark,
        difficulty: undefined,
      };
      const created = await createTask(task);
      setTasks([created, ...tasks]);
      message.success('任务创建成功');
      setModalOpen(false);
      form.resetFields();
    } catch (e) {}
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>任务登记台账</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          新建任务
        </Button>
      </div>

      <Table
        dataSource={tasks}
        columns={columns}
        rowKey="id"
        size="small"
        pagination={{ pageSize: 15 }}
        scroll={{ x: 1300 }}
      />

      <Modal
        title="新建任务"
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        width={700}
        okText="提交"
      >
        <Form form={form} layout="vertical" style={{ maxHeight: 500, overflow: 'auto' }}>
          <Form.Item name="name" label="任务名称" rules={[{ required: true }]}>
            <Input placeholder="如：0701-叠穿生成图评测标注" />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item name="ownership" label="任务归属" rules={[{ required: true }]}>
              <Select
                options={Object.values(TaskOwnership).map(v => ({ label: v, value: v }))}
                onChange={(v) => setSelectedOwnership(v)}
              />
            </Form.Item>
            <Form.Item name="taskGroup" label="任务分组" rules={[{ required: true }]}>
              <Select
                options={(selectedOwnership ? TASK_GROUPS[selectedOwnership] : []).map(g => ({ label: g, value: g }))}
                placeholder="先选择任务归属"
              />
            </Form.Item>
            <Form.Item name="workNature" label="作业性质" rules={[{ required: true }]}>
              <Select options={Object.values(WorkNature).map(v => ({ label: v, value: v }))} />
            </Form.Item>
            <Form.Item name="taskType" label="任务类型" rules={[{ required: true }]}>
              <Select options={Object.values(TaskType).map(v => ({ label: v, value: v }))} />
            </Form.Item>
            <Form.Item name="assignee" label="主负责人" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="team" label="所属小组" rules={[{ required: true }]}>
              <Select options={ALL_TEAMS.map(t => ({ label: t, value: t }))} />
            </Form.Item>
            <Form.Item name="teamLeader" label="对应组长" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="dataReporter" label="数据报告同学">
              <Input />
            </Form.Item>
            <Form.Item name="reviewer" label="验收同学">
              <Input />
            </Form.Item>
            <Form.Item name="dataVolume" label="数据量级" rules={[{ required: true }]}>
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
            <Form.Item name="workforce" label="作业人力">
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
            <Form.Item name="deadline" label="截止时间" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item name="platformTaskId" label="作业平台任务ID">
            <Input placeholder="用于关联标注平台进度" />
          </Form.Item>
          <Form.Item name="ruleDocLink" label="规则文档链接">
            <Input placeholder="已有规则文档时填写" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
