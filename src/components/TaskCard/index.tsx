import { Card, Progress, Tag, Space } from 'antd';
import { ClockCircleOutlined, UserOutlined } from '@ant-design/icons';
import { Task } from '@/types';
import StatusTag from '@/components/StatusTag';
import DifficultyStars from '@/components/DifficultyStars';
import dayjs from 'dayjs';

interface Props {
  task: Task;
  onClick?: () => void;
}

export default function TaskCard({ task, onClick }: Props) {
  const daysInStage = dayjs().diff(dayjs(task.createdAt), 'day');
  const isOverdue = dayjs().isAfter(dayjs(task.deadline)) && task.status !== '已完成';

  return (
    <Card
      size="small"
      hoverable
      onClick={onClick}
      style={{ marginBottom: 8, borderLeft: isOverdue ? '3px solid #eb687b' : undefined }}
    >
      <div style={{ marginBottom: 4 }}>
        <strong className="task-card-name">{task.name}</strong>
      </div>
      <Space size={4} wrap style={{ marginBottom: 6 }}>
        <StatusTag status={task.status} />
        <Tag>{task.taskType}</Tag>
      </Space>
      <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 4 }}>
        <UserOutlined style={{ marginRight: 4 }} />{task.assignee}
        <span style={{ marginLeft: 12 }}>
          <ClockCircleOutlined style={{ marginRight: 4 }} />
          {isOverdue ? <span style={{ color: '#eb687b' }}>已逾期</span> : `截止 ${dayjs(task.deadline).format('MM-DD')}`}
        </span>
      </div>
      <Progress percent={Math.round(task.progress * 100)} size="small" style={{ marginBottom: 4 }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-soft)' }}>
        <span>文档 {Math.round(task.docCompleteness * 100)}%</span>
        <span>停留 {daysInStage}天</span>
        {task.difficulty && <DifficultyStars value={task.difficulty} readOnly />}
      </div>
    </Card>
  );
}
