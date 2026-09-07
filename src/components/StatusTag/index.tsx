import { Tag } from 'antd';
import { getTaskStatusLabel, TaskStatus } from '@/constants';

const STATUS_COLOR: Record<TaskStatus, string> = {
  [TaskStatus.PENDING_INFO]: '#b58c62',
  [TaskStatus.PENDING]: '#ddd3c9',
  [TaskStatus.IN_PROGRESS]: '#806c79',
  [TaskStatus.WAIT_CONFIRM]: '#c1a0ac',
  [TaskStatus.DONE]: '#928e5e',
};

export default function StatusTag({ status }: { status: TaskStatus }) {
  return <Tag color={STATUS_COLOR[status]}>{getTaskStatusLabel(status)}</Tag>;
}
