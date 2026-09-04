import { Card, Progress, Tag, Space } from 'antd';
import { ClockCircleOutlined, UserOutlined } from '@ant-design/icons';
import { Task } from '@/types';
import StatusTag from '@/components/StatusTag';
import DifficultyStars from '@/components/DifficultyStars';
import dayjs from 'dayjs';

interface Props {
  task: Task;
  onClick?: () => void;
  showContext?: boolean;
  showTeam?: boolean;
  preferExpectedDeadline?: boolean;
}

export default function TaskCard({ task, onClick, showContext = false, showTeam = false, preferExpectedDeadline = false }: Props) {
  const daysInStage = dayjs().diff(dayjs(task.createdAt), 'day');
  const displayDeadline = preferExpectedDeadline ? task.expectedDeadline || task.deadline : task.deadline || task.expectedDeadline;
  const isOverdue = Boolean(displayDeadline) && dayjs().isAfter(dayjs(displayDeadline), 'day') && task.status !== '已完成';
  const hierarchy = [task.ownership, task.mainTask === '-' ? '临时任务' : task.mainTask, task.linkedTask || task.taskGroup].filter(Boolean).join(' · ');

  return (
    <Card
      size="small"
      hoverable
      onClick={onClick}
      style={{ marginBottom: 8, borderLeft: isOverdue ? '3px solid #eb687b' : undefined }}
    >
      <div style={{ marginBottom: 4 }}>
        <strong style={{ fontSize: 13 }}>{task.name}</strong>
      </div>
      {showContext && <div className="task-card-context" title={hierarchy}>{hierarchy || '任务挂链待完善'}</div>}
      <Space size={4} wrap style={{ marginBottom: 6 }}>
        <StatusTag status={task.status} />
        <Tag>{task.taskType}</Tag>
      </Space>
      <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 4 }}>
        <UserOutlined style={{ marginRight: 4 }} />{task.assignee}
        {showTeam && <span style={{ marginLeft: 8 }}>· {task.team}</span>}
        <span style={{ marginLeft: 12 }}>
          <ClockCircleOutlined style={{ marginRight: 4 }} />
          {isOverdue ? <span style={{ color: '#eb687b' }}>已逾期</span> : displayDeadline ? `${preferExpectedDeadline ? '预计 ' : '截止 '}${dayjs(displayDeadline).format('MM-DD')}` : '时间待完善'}
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
