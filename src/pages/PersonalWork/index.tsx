import { useEffect, useMemo, useState } from 'react';
import { Card, DatePicker, Empty, message, Segmented, Select, Statistic, Table, Tag } from 'antd';
import dayjs from 'dayjs';
import { ALL_MEMBERS, ALL_TEAMS, TEAM_MEMBERS, Team } from '@/constants';
import { Task, TaskContribution } from '@/types';
import { getAllTaskContributions, getMemberWorkSummary, MemberWorkSummaryRow } from '@/services/settlementService';
import { getTasks } from '@/services/taskService';
import { isGlobalManagerRole, useActor } from '@/contexts/ActorContext';

type PeriodMode = '日' | '周' | '月';

interface MemberSummary extends MemberWorkSummaryRow {
  key: string;
}

export default function PersonalWork() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [items, setItems] = useState<TaskContribution[]>([]);
  const [summaries, setSummaries] = useState<MemberWorkSummaryRow[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [member, setMember] = useState<string>();
  const [team, setTeam] = useState<Team>();
  const [periodMode, setPeriodMode] = useState<PeriodMode>('周');
  const [anchorDate, setAnchorDate] = useState(dayjs());
  const { actor } = useActor();

  useEffect(() => {
    getTasks().then(setTasks);
    getAllTaskContributions().then(setItems);
  }, []);

  const start = periodMode === '日' ? anchorDate.startOf('day') : periodMode === '周' ? anchorDate.startOf('week') : anchorDate.startOf('month');
  const end = periodMode === '日' ? anchorDate.endOf('day') : periodMode === '周' ? anchorDate.endOf('week') : anchorDate.endOf('month');
  const grain = periodMode === '日' ? 'day' : periodMode === '周' ? 'week' : 'month';
  const periodLabel = periodMode === '日' ? '当日' : periodMode === '周' ? '本周' : '本月';
  const startKey = start.format('YYYY-MM-DD');
  const endKey = end.format('YYYY-MM-DD');

  useEffect(() => {
    let active = true;
    setSummaryLoading(true);
    getMemberWorkSummary(tasks, items, start, end, grain)
      .then(data => { if (active) setSummaries(data); })
      .catch(() => { if (active) { setSummaries([]); message.error('工作量汇总读取失败，请稍后重试'); } })
      .finally(() => { if (active) setSummaryLoading(false); });
    return () => { active = false; };
  }, [tasks, items, startKey, endKey, grain]);

  const taskMap = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks]);
  const permittedTeams = isGlobalManagerRole(actor.role) ? ALL_TEAMS : actor.team ? [actor.team] : [];
  const selectedTeam = actor.role === '组长' ? actor.team : team;
  const memberOptions = selectedTeam ? TEAM_MEMBERS[selectedTeam] : ALL_MEMBERS;

  const rows = useMemo(() => items
    .filter(item => item.status === 'confirmed')
    .filter(item => actor.role !== '组员' || item.member === actor.name)
    .filter(item => !member || item.member === member)
    .filter(item => {
      const task = taskMap.get(item.taskId);
      const permittedTeam = isGlobalManagerRole(actor.role) || task?.team === actor.team;
      return permittedTeam && (!selectedTeam || task?.team === selectedTeam);
    })
    .filter(item => {
      const date = dayjs(item.confirmedAt || item.attachedAt);
      return !date.isBefore(start, 'day') && !date.isAfter(end, 'day');
    })
    .map(item => ({ ...item, task: taskMap.get(item.taskId) })),
  [items, member, selectedTeam, taskMap, actor, startKey, endKey]);

  const memberSummaries = useMemo<MemberSummary[]>(() => {
    const grouped = new Map<string, MemberSummary>();
    summaries
      .filter(item => actor.role !== '组员' || item.member === actor.name)
      .filter(item => isGlobalManagerRole(actor.role) || item.team === actor.team)
      .filter(item => !selectedTeam || item.team === selectedTeam)
      .filter(item => !member || item.member === member)
      .forEach(item => {
        const key = `${item.team}|${item.member}`;
        const current = grouped.get(key) || { ...item, key, confirmedTags: 0, workloadPoints: 0 };
        current.confirmedTags += item.confirmedTags;
        current.workloadPoints += item.workloadPoints;
        grouped.set(key, current);
      });
    return [...grouped.values()]
      .map(item => ({ ...item, workloadPoints: Number(item.workloadPoints.toFixed(2)) }))
      .sort((a, b) => b.workloadPoints - a.workloadPoints || b.confirmedTags - a.confirmedTags);
  }, [summaries, actor, selectedTeam, member]);

  const tagCounts = useMemo(() => rows.reduce((result, item) => {
    result[item.tag] = (result[item.tag] || 0) + 1;
    return result;
  }, {} as Record<string, number>), [rows]);
  const totalWorkload = memberSummaries.reduce((sum, item) => sum + item.workloadPoints, 0);
  const confirmedTags = memberSummaries.reduce((sum, item) => sum + item.confirmedTags, 0);
  const isMember = actor.role === '组员';
  const isLeader = actor.role === '组长';
  const pageTitle = isMember ? '我的工作记录' : isLeader ? '本组工作记录' : '人员作业明细';

  return <div>
    <div className="page-title-row"><div><span className="eyebrow">PERSONAL OUTPUT</span><h2>{pageTitle}</h2><p>主指标只统计区间内完成结项的工作量；任务难度点按每位成员已确认的客观工作标签数量占比分配。</p></div></div>
    <Card className="personal-filter-card"><div className="timeline-filter-row">
      {!isMember && <Select allowClear placeholder="筛选小组" style={{ width: 160 }} value={selectedTeam} disabled={isLeader} onChange={setTeam} options={permittedTeams.map(value => ({ value, label: value }))} />}
      {!isMember && <Select allowClear showSearch optionFilterProp="label" placeholder="筛选成员" style={{ width: 160 }} value={member} onChange={setMember} options={memberOptions.map(value => ({ value, label: value }))} />}
      <Segmented value={periodMode} onChange={value => setPeriodMode(value as PeriodMode)} options={['日', '周', '月']} />
      <DatePicker picker={periodMode === '日' ? 'date' : periodMode === '周' ? 'week' : 'month'} value={anchorDate} onChange={value => value && setAnchorDate(value)} />
      <Tag color="purple">统计区间：{startKey} 至 {endKey}</Tag>
    </div></Card>
    <div className="personal-summary">
      <Card><Statistic title={`${periodLabel}完成工作量`} value={Number(totalWorkload.toFixed(2))} suffix="点" /></Card>
      <Card><Statistic title="计入分配的客观标签" value={confirmedTags} suffix="项" /></Card>
      <Card><Statistic title="区间内确认标签明细" value={rows.length} suffix="条" /></Card>
      <Card><Statistic title={isMember ? '涉及任务' : '完成人数'} value={isMember ? new Set(rows.map(item => item.taskId)).size : memberSummaries.length} suffix={isMember ? '个' : '人'} /></Card>
    </div>
    <Card title={`${periodLabel}成员客观工作量汇总`} style={{ marginTop: 20 }}>
      <Table<MemberSummary> size="small" rowKey="key" loading={summaryLoading} dataSource={memberSummaries} locale={{ emptyText: <Empty description="该时间范围暂无已结项工作量" /> }} pagination={false} columns={[
        { title: '排名', width: 80, render: (_value, _item, index) => index + 1 },
        { title: '成员', dataIndex: 'member' },
        { title: '小组', dataIndex: 'team' },
        { title: '已确认客观标签', dataIndex: 'confirmedTags', render: value => `${value} 项` },
        { title: '完成工作量', dataIndex: 'workloadPoints', render: value => <strong>{Number(value).toFixed(2)} 点</strong> },
      ]} />
    </Card>
    <Card title={`${periodLabel}确认标签类型分布`} style={{ marginTop: 20 }}><div className="work-tag-summary">{Object.keys(tagCounts).length ? Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).map(([tag, count]) => <Tag key={tag} color="purple">{tag} {count} 项</Tag>) : <span className="empty-task-state">暂无可统计的已确认工作项</span>}</div></Card>
    <Card title={`${startKey} 至 ${endKey} · 标签确认明细`} style={{ marginTop: 20 }}><Table size="small" rowKey="id" dataSource={rows} locale={{ emptyText: <Empty description="该时间范围暂无已确认工作记录" /> }} pagination={false} scroll={{ x: 950 }} columns={[
      { title: '成员', dataIndex: 'member', width: 100 },
      { title: '关联任务', width: 240, render: (item: any) => item.task?.name || item.taskId },
      { title: '小组', width: 130, render: (item: any) => item.task?.team || '-' },
      { title: '工作内容', dataIndex: 'tag', render: (value: string) => <Tag color="purple">{value}</Tag> },
      { title: '确认人/时间', width: 180, render: (item: TaskContribution) => `${item.confirmedBy || '-'} · ${item.confirmedAt || '-'}` },
      { title: '备注', dataIndex: 'note', width: 180 },
    ]} /></Card>
  </div>;
}
