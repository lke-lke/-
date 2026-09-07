import { useState, useEffect } from 'react';
import { Select, Space } from 'antd';
import { Task } from '@/types';
import { TaskStatus, ALL_TEAMS } from '@/constants';
import { getTasks } from '@/services/taskService';
import TaskCard from '@/components/TaskCard';
import { useNavigate } from 'react-router-dom';

const STATUS_COLUMNS: TaskStatus[] = [
  TaskStatus.PENDING,
  TaskStatus.IN_PROGRESS,
  TaskStatus.WAIT_CONFIRM,
  TaskStatus.DONE,
];

const COLUMN_COLORS: Record<TaskStatus, string> = {
  [TaskStatus.PENDING_INFO]: '#f4e7dc',
  [TaskStatus.PENDING]: '#f2ece7',
  [TaskStatus.IN_PROGRESS]: '#eee4e7',
  [TaskStatus.WAIT_CONFIRM]: '#ecc4c3',
  [TaskStatus.DONE]: '#e3e1c7',
};

const createEmptyGroups = (): Record<TaskStatus, Task[]> => STATUS_COLUMNS.reduce((groups, status) => {
  groups[status] = [];
  return groups;
}, {} as Record<TaskStatus, Task[]>);

export default function Kanban() {
  const [grouped, setGrouped] = useState<Record<TaskStatus, Task[]>>(createEmptyGroups);
  const [filterTeam, setFilterTeam] = useState<string>('');
  const [filterAssignee, setFilterAssignee] = useState<string>('');
  const navigate = useNavigate();

  useEffect(() => {
    getTasks().then(tasks => setGrouped(tasks.reduce((result, task) => {
      // 待完善仍由组长工作台单独提醒；流转看板暂归入待开始列，避免任务消失。
      const columnStatus = task.status === TaskStatus.PENDING_INFO ? TaskStatus.PENDING : task.status;
      if (!result[columnStatus]) result[columnStatus] = [];
      result[columnStatus].push(task);
      return result;
    }, createEmptyGroups())));
  }, []);

  const getFilteredTasks = (tasks: Task[]) => {
    let result = tasks;
    if (filterTeam) result = result.filter(t => t.team === filterTeam);
    if (filterAssignee) result = result.filter(t => t.assignee === filterAssignee);
    return result;
  };

  const allAssignees = [...new Set(Object.values(grouped).flat().map(t => t.assignee))];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>任务流转看板</h2>
        <Space>
          <Select
            allowClear
            placeholder="筛选小组"
            style={{ width: 120 }}
            onChange={v => setFilterTeam(v || '')}
            options={ALL_TEAMS.map(t => ({ label: t, value: t }))}
          />
          <Select
            allowClear
            placeholder="筛选负责人"
            style={{ width: 120 }}
            onChange={v => setFilterAssignee(v || '')}
            options={allAssignees.map(a => ({ label: a, value: a }))}
          />
        </Space>
      </div>

      <div style={{ display: 'flex', gap: 12, overflow: 'auto', paddingBottom: 16 }}>
        {STATUS_COLUMNS.map(status => {
          const tasks = getFilteredTasks(grouped[status] || []);
          return (
            <div
              key={status}
              style={{
                flex: '0 0 240px',
                background: COLUMN_COLORS[status],
                borderRadius: 8,
                padding: 12,
                minHeight: 400,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 13 }}>
                {status} <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>({tasks.length})</span>
              </div>
              {tasks.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onClick={() => navigate(`/tasks/${task.id}`)}
                />
              ))}
              {!tasks.length && <div style={{ color: 'var(--ink-soft)', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>暂无任务</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
