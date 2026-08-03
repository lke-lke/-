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
  TaskStatus.TO_ACCEPT,
  TaskStatus.DONE,
];

const COLUMN_COLORS: Record<TaskStatus, string> = {
  [TaskStatus.PENDING]: '#f2ece7',
  [TaskStatus.IN_PROGRESS]: '#eee4e7',
  [TaskStatus.DATA_DONE]: '#f0d9e4',
  [TaskStatus.TO_DELIVER]: '#f0d9e4',
  [TaskStatus.TO_ACCEPT]: '#ecc4c3',
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
      // “待交付”不再单列展示，合并进数据完成阶段，避免任务在看板中消失。
      const columnStatus = task.status === TaskStatus.TO_DELIVER ? TaskStatus.DATA_DONE : task.status;
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
    <div className="kanban-page">
      <div className="kanban-toolbar">
        <div><div className="eyebrow">TASK FLOW</div><h2>任务流转看板</h2></div>
        <Space wrap className="kanban-filters">
          <Select
            allowClear
            placeholder="筛选小组"
            className="kanban-filter"
            onChange={v => setFilterTeam(v || '')}
            options={ALL_TEAMS.map(t => ({ label: t, value: t }))}
          />
          <Select
            allowClear
            placeholder="筛选负责人"
            className="kanban-filter"
            onChange={v => setFilterAssignee(v || '')}
            options={allAssignees.map(a => ({ label: a, value: a }))}
          />
        </Space>
      </div>

      <div className="kanban-board">
        {STATUS_COLUMNS.map(status => {
          const tasks = getFilteredTasks(grouped[status] || []);
          return (
            <div
              key={status}
              className="kanban-column"
              style={{ background: COLUMN_COLORS[status] }}
            >
              <div className="kanban-column-title">
                {status} <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>({tasks.length})</span>
              </div>
              {tasks.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onClick={() => navigate(`/tasks/${task.id}`)}
                />
              ))}
              {!tasks.length && <div className="kanban-empty">暂无任务</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
