import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, Progress, Select, Space, Tag, Tree } from 'antd';
import { FolderOpenOutlined, RightOutlined, TeamOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { ALL_TEAMS, Team } from '@/constants';
import { Task, TaskRelation } from '@/types';
import { getTasks } from '@/services/taskService';
import { getTaskRelations } from '@/services/taskRelationService';
import StatusTag from '@/components/StatusTag';
import dayjs from 'dayjs';

const taskMatch = (task: Task, relation: TaskRelation) => task.relationId === relation.id || task.linkedTask === relation.linkedTask || task.taskGroup === relation.linkedTask || task.name.includes(relation.linkedTask);

export default function TeamTasks() {
  const [team, setTeam] = useState<Team>(Team.GROUP_A); const [tasks, setTasks] = useState<Task[]>([]); const [relations, setRelations] = useState<TaskRelation[]>([]); const navigate = useNavigate();
  useEffect(() => { getTasks().then(setTasks); getTaskRelations().then(setRelations); }, []);
  const groupTasks = useMemo(() => tasks.filter(task => task.team === team), [tasks, team]);
  const tree = useMemo<any[]>(() => {
    const rendered = new Set<string>();
    const activeRelations = relations.filter(relation => groupTasks.some(task => taskMatch(task, relation)));
    const ownerships = Array.from(new Set(activeRelations.map(relation => relation.ownership)));
    const hierarchy: any[] = ownerships.map(ownership => {
      const ownedRelations = activeRelations.filter(relation => relation.ownership === ownership);
      const mains = Array.from(new Set(ownedRelations.map(relation => relation.mainTask)));
      const childNodes = mains.map(mainTask => {
        const linked = ownedRelations.filter(relation => relation.mainTask === mainTask);
        const children = linked.map(relation => {
          const task = groupTasks.find(item => taskMatch(item, relation)); if (task) rendered.add(task.id);
          return { key: relation.id, title: <TaskNode relation={relation} task={task} onOpen={() => task && navigate(`/tasks/${task.id}`)} /> };
        });
        return { key: `${ownership}-${mainTask}`, title: <span className="tree-main-title">{mainTask === '-' ? '临时任务' : mainTask}（{children.length}）</span>, children };
      });
      return { key: ownership, title: <strong className="tree-ownership-title">{ownership}（{ownedRelations.length}）</strong>, children: childNodes };
    });
    const unmatched = groupTasks.filter(task => !rendered.has(task.id));
    const independent: any[] = unmatched.length ? [{ key: 'independent', title: <strong className="tree-ownership-title">临时任务（{unmatched.length}）</strong>, children: unmatched.map(task => ({ key: task.id, title: <TaskNode task={task} onOpen={() => navigate(`/tasks/${task.id}`)} /> })) }] : [];
    return [...hierarchy, ...independent];
  }, [relations, groupTasks, navigate]);
  return <div><div className="page-title-row"><div><span className="eyebrow">TEAM TASK VIEW</span><h2>小组任务视图</h2><p>按任务归属、主任务和关联任务查看组内成员正在推进的事项；无从属关系的任务单列。</p></div><Select value={team} onChange={setTeam} style={{ width: 180 }} options={ALL_TEAMS.map(value => ({ label: value, value }))} /></div><Card title={<><TeamOutlined /> {team} · 任务全貌</>} extra={<Tag color="processing">组内实际任务 {groupTasks.length} 个</Tag>}><div className="team-tree-note">仅展示本组成员参与的实际任务；已挂链任务按主任务归类，未挂链或主任务为“-”的任务会落入“临时任务”。</div>{tree.length ? <Tree defaultExpandAll selectable={false} treeData={tree} className="team-task-tree" /> : <Empty description="当前小组暂无任务" />}</Card></div>;
}

function TaskNode({ relation, task, onOpen }: { relation?: TaskRelation; task?: Task; onOpen: () => void }) {
  const overdue = task && task.status !== '已完成' && task.deadline && dayjs().isAfter(dayjs(task.deadline), 'day');
  return <div className="team-task-node"><div><strong>{relation?.linkedTask || task?.name}</strong>{task ? <div className="team-task-meta"><span>{task.assignee}</span><span>{task.dataVolume ? `${task.dataVolume} 条` : '待补数据量'}</span><span>截止 {task.deadline}</span>{overdue && <Tag color="error">逾期</Tag>}</div> : <div className="team-task-meta">尚未登记实际任务</div>}</div>{task ? <Space><StatusTag status={task.status} /><Progress percent={Math.round(task.progress * 100)} size="small" showInfo={false} style={{ width: 70 }} /><Button size="small" type="link" icon={<RightOutlined />} onClick={onOpen}>详情</Button></Space> : <Tag>待开始</Tag>}</div>;
}
