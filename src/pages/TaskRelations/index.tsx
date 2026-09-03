import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Form, Input, Modal, Popconfirm, Space, Table, Tag, Tree, message } from 'antd';
import { ApartmentOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { TaskRelation } from '@/types';
import { archiveTaskRelation, buildRelationTree, getTaskRelations, saveTaskRelation } from '@/services/taskRelationService';
import { useActor } from '@/contexts/ActorContext';

export default function TaskRelations() {
  const [relations, setRelations] = useState<TaskRelation[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TaskRelation | null>(null);
  const [form] = Form.useForm();
  const { actor } = useActor();
  const canManage = actor.role !== '组员';
  const load = () => getTaskRelations().then(setRelations);
  useEffect(() => { load(); }, []);
  const treeData = useMemo(() => buildRelationTree(relations).map(item => ({ key: item.ownership, title: <strong>{item.ownership}（{item.total}）</strong>, children: item.mains.map(main => ({ key: `${item.ownership}-${main.mainTask}`, title: <span>{main.mainTask === '-' ? '临时任务' : main.mainTask}（{main.children.length}）</span>, children: main.children.map(child => ({ key: child.id, title: child.linkedTask })) })) })), [relations]);
  const showEdit = (record?: TaskRelation) => { setEditing(record || null); form.setFieldsValue(record || { ownership: 'AI试穿-模型评测', mainTask: '-' }); setOpen(true); };
  const submit = async () => { try { const values = await form.validateFields(); await saveTaskRelation({ ...values, active: true, id: editing?.id }); message.success(editing ? '任务关系已更新' : '关联任务已新增'); setOpen(false); load(); } catch {} };
  const remove = async (record: TaskRelation) => { await archiveTaskRelation(record.id); message.success('已停用该任务关系，历史任务不会受影响'); load(); };
  return <div>
    <div className="page-title-row"><div><span className="eyebrow">TASK RELATION LIBRARY</span><h2>任务关系管理</h2><p>维护任务归属、主任务与任务分组。任务分组是实际任务与统计的唯一口径。</p></div>{canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => showEdit()}>新增任务分组</Button>}</div>
    <Card className="relation-summary" title={<><ApartmentOutlined /> 任务层级总览</>} extra={<Tag color="processing">已上线 {relations.length} 条任务分组</Tag>}>
      <Tree defaultExpandAll selectable={false} treeData={treeData} className="relation-tree" />
    </Card>
    <Card title="关系明细" style={{ marginTop: 20 }}>
      <Table rowKey="id" size="small" dataSource={relations} pagination={{ pageSize: 12 }} columns={[
        { title: '任务归属', dataIndex: 'ownership', width: 180 },
        { title: '主任务', dataIndex: 'mainTask', width: 190, render: (value: string) => value === '-' ? <Tag>临时任务</Tag> : value },
        { title: '任务分组', dataIndex: 'linkedTask' },
        { title: '更新时间', dataIndex: 'updatedAt', width: 150 },
        { title: '操作', width: 150, render: (_: unknown, record: TaskRelation) => canManage ? <Space><Button type="link" size="small" icon={<EditOutlined />} onClick={() => showEdit(record)}>编辑</Button><Popconfirm title="停用该关系？已产生的历史任务不会删除。" onConfirm={() => remove(record)}><Button danger type="link" size="small" icon={<DeleteOutlined />}>停用</Button></Popconfirm></Space> : '-' },
      ]} />
    </Card>
    <Modal title={editing ? '编辑任务关系' : '新增任务分组'} open={open} onCancel={() => setOpen(false)} onOk={submit} okText="保存">
      <Form form={form} layout="vertical"><Form.Item name="ownership" label="任务归属" rules={[{ required: true, message: '请输入任务归属' }]}><Input placeholder="如：AI试穿-模型评测" /></Form.Item><Form.Item name="mainTask" label="主任务" rules={[{ required: true, message: '请输入主任务；临时任务填写 -' }]}><Input placeholder="无从属关系请填写 -" /></Form.Item><Form.Item name="linkedTask" label="任务分组" rules={[{ required: true, message: '请输入任务分组名称' }]}><Input placeholder="实际执行的最小任务单元" /></Form.Item></Form>
    </Modal>
  </div>;
}
