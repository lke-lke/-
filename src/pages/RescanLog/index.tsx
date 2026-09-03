import { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, InputNumber, DatePicker, Tag, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { RescanRecord } from '@/types';
import { RescanReason } from '@/constants';
import { getRescanRecords, createRescanRecord } from '@/services/rescanService';
import { Task } from '@/types';
import { getTasks } from '@/services/taskService';
import dayjs from 'dayjs';
import { useActor } from '@/contexts/ActorContext';

export default function RescanLog() {
  const [records, setRecords] = useState<RescanRecord[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const { actor } = useActor();
  const canManage = actor.role !== '组员';

  useEffect(() => {
    getRescanRecords().then(setRecords);
    getTasks().then(setTasks);
  }, []);

  const columns = [
    { title: '关联任务', dataIndex: 'originalTaskName', key: 'originalTaskName', width: 200 },
    { title: '变更原因', dataIndex: 'reason', key: 'reason', width: 110,
      render: (r: string) => <Tag>{r}</Tag> },
    { title: '变更说明', dataIndex: 'description', key: 'description', width: 200 },
    { title: '回扫数据量', dataIndex: 'rescanVolume', key: 'rescanVolume', width: 100 },
    { title: '执行人', dataIndex: 'executors', key: 'executors', width: 140,
      render: (e: string[]) => e.join('、') },
    { title: '对接助理', dataIndex: 'contactAssistant', key: 'contactAssistant', width: 90 },
    { title: '预计完成', dataIndex: 'expectedDone', key: 'expectedDone', width: 100 },
    { title: '实际完成', dataIndex: 'actualDone', key: 'actualDone', width: 100,
      render: (d: string) => d || '-' },
    { title: '验收', dataIndex: 'accepted', key: 'accepted', width: 80,
      render: (a: boolean | undefined) => a === undefined ? '-' : a ? <Tag color="green">通过</Tag> : <Tag color="red">未通过</Tag> },
    { title: '登记日期', dataIndex: 'createdAt', key: 'createdAt', width: 100 },
  ];

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const task = tasks.find(t => t.id === values.originalTaskId);
      const record = {
        originalTaskId: values.originalTaskId,
        originalTaskName: task?.name || '',
        reason: values.reason,
        description: values.description,
        rescanVolume: values.rescanVolume,
        executors: values.executors.split(',').map((s: string) => s.trim()),
        contactAssistant: values.contactAssistant,
        expectedDone: values.expectedDone.format('YYYY-MM-DD'),
        actualDone: undefined,
        accepted: undefined,
      };
      const created = await createRescanRecord(record);
      setRecords([created, ...records]);
      message.success('回扫登记成功');
      setModalOpen(false);
      form.resetFields();
    } catch (e) {}
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>回扫/变更登记台账</h2>
        {canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>新建回扫登记</Button>}
      </div>

      <Table
        dataSource={records}
        columns={columns}
        rowKey="id"
        size="small"
        pagination={{ pageSize: 15 }}
        scroll={{ x: 1200 }}
      />

      <Modal
        title="新建回扫/变更登记"
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        width={600}
        okText="提交"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="originalTaskId" label="关联原任务" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={tasks.map(t => ({ label: t.name, value: t.id }))}
            />
          </Form.Item>
          <Form.Item name="reason" label="变更原因" rules={[{ required: true }]}>
            <Select options={Object.values(RescanReason).map(v => ({ label: v, value: v }))} />
          </Form.Item>
          <Form.Item name="description" label="变更说明" rules={[{ required: true }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item name="rescanVolume" label="回扫数据量" rules={[{ required: true }]}>
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
            <Form.Item name="contactAssistant" label="对接业务助理" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="executors" label="执行人（逗号分隔）" rules={[{ required: true }]}>
              <Input placeholder="如：王静,谢婷" />
            </Form.Item>
            <Form.Item name="expectedDone" label="预计完成时间" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
