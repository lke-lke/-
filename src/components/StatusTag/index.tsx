import { Tag } from 'antd';
import { getTaskStatusLabel, TaskStatus } from '@/constants';

const STATUS_COLOR: Record<TaskStatus, string> = {
  [TaskStatus.PENDING_INFO]: '#b58c62',
  [TaskStatus.PENDING]: '#ddd3c9',
  [TaskStatus.IN_PROGRESS]: '#806c79',
  [TaskStatus.DATA_DONE]: '#c1a0ac',
  [TaskStatus.TO_DELIVER]: '#f0d9e4',
  [TaskStatus.TO_ACCEPT]: '#ecc4c3',
  [TaskStatus.DONE]: '#928e5e',
};

export default function StatusTag({ status }: { status: TaskStatus }) {
  return <Tag color={STATUS_COLOR[status]}>{getTaskStatusLabel(status)}</Tag>;
}
