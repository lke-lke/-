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
  TaskStatus.DATA_DONE,
  TaskStatus.TO_DELIVER,
  TaskStatus.TO_ACCEPT,
  TaskStatus.DONE,
];

const COLUMN_COLORS: Record<TaskStatus, string> = {
  [TaskStatus.PENDING]: '#f0eef2',
  [TaskStatus.IN_PROGRESS]: '#e9e6f3',
  [TaskStatus.DATA_DONE]: '#eeeaf7',
  [TaskStatus.TO_DELIVER]: '#f7dfd7',
  [TaskStatus.TO_ACCEPT]: '#f6b3a0',
  [TaskStatus.DONE]: '#d0cce5',
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
      result[task.status].push(task);
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
