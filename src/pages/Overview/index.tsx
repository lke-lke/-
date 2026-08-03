import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Card, Col, Progress, Row, Table, Tag } from 'antd';
import { WarningFilled } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { Team } from '@/constants';
import { getTasks } from '@/services/taskService';
import { getAllDocuments } from '@/services/documentService';
import { getRescanRecords } from '@/services/rescanService';
import { getTeamOverviewFacts, TeamOverviewFacts } from '@/services/statsService';
import DifficultyStars from '@/components/DifficultyStars';

type ComparisonRow = TeamOverviewFacts['activeTaskDetails'][number] & {
  key: string;
  teamName: Team;
  leader: string;
  teamRowSpan: number;
};

const TEAM_COLORS: Record<Team, string> = {
  [Team.GROUP_A]: '#806c79', [Team.GROUP_B]: '#928e5e', [Team.GROUP_C]: '#b97d7b', [Team.GROUP_D]: '#c1a0ac',
};

function taskAction(task: TeamOverviewFacts['tasks'][number]) {
  if (task.alerts.length) return task.alerts[0].message;
  if (task.progress < 1) return '跟进作业平台进度';
  if (task.docCompleteness < 1) return '补齐交付文档';
  return '等待验收/结项确认';
}

function DifficultyBreakdown({ facts }: { facts: TeamOverviewFacts }) {
  return <div className="difficulty-breakdown">
    {[1, 2, 3, 4, 5].map(star => <Tag key={star} color={star >= 4 ? 'volcano' : undefined}>{star} 星 {facts.difficultyCounts[star]} 个</Tag>)}
    {facts.unratedTasks > 0 && <Tag color="gold">待评分 {facts.unratedTasks} 个</Tag>}
  </div>;
}

export default function Overview() {
  const [teams, setTeams] = useState<TeamOverviewFacts[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([getTasks(), getAllDocuments(), getRescanRecords()])
      .then(([tasks, docs, rescans]) => setTeams(getTeamOverviewFacts(tasks, docs, rescans)));
  }, []);

  const riskRows = useMemo(() => teams.flatMap(team => team.tasks.filter(task => task.alerts.length).map(task => ({ ...task, teamName: team.team })))
    .sort((a, b) => b.alerts.length - a.alerts.length || a.progress - b.progress), [teams]);
  const comparisonRows = useMemo<ComparisonRow[]>(() => teams.flatMap(team => {
    const groupTasks = team.activeTaskDetails;
    if (!groupTasks.length) return [{ key: `${team.team}-empty`, id: '', name: '当前无进行中任务', team: team.team, teamName: team.team, leader: team.leader, teamRowSpan: 1, ownership: '' as any, taskGroup: '', workNature: '' as any, taskType: '' as any, assignee: '', teamLeader: '', dataReporter: '', reviewer: '', dataVolume: 0, workforce: 0, createdAt: '', deadline: '', status: '' as any, progress: 0, docCompleteness: 0, alerts: [] }];
    return groupTasks.map((task, index) => ({ ...task, key: task.id, teamName: team.team, leader: team.leader, teamRowSpan: index === 0 ? groupTasks.length : 0 }));
  }), [teams]);

  return <div>
    <div className="page-title-row"><div><div className="eyebrow">OPERATIONS OVERVIEW</div><h2>四组作业总览</h2><p>用任务事实看见各组的规模、难度、平台进度和需处理事项。</p></div><div className="overview-date-note">实时任务视图<br /><strong>不含临时评分</strong></div></div>
    <Alert showIcon type="info" className="overview-info" message="“本周管理动作”仅统计已上传文档和已登记回扫；文档验收和标准工作量规则接入后，将在此基础上补充。" />

    <Card className="overview-summary-card" title={<><span>四组进行中任务明细</span><small>每个任务独立展示，便于横向核对</small></>}>
      <Table size="small" rowKey="key" pagination={false} dataSource={comparisonRows} scroll={{ x: 1100 }} columns={[
        { title: '小组', dataIndex: 'teamName', width: 155, render: (team: Team, row: ComparisonRow) => <span style={{ color: TEAM_COLORS[team], fontWeight: 600 }}>{team}<br /><span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>组长：{row.leader}</span></span>, onCell: (row: ComparisonRow) => ({ rowSpan: row.teamRowSpan }) },
        { title: '任务 ID', dataIndex: 'platformTaskId', width: 185, render: (value: string) => value || <Tag>待补充</Tag> },
        { title: '任务名称', dataIndex: 'name', width: 270, render: (name: string, row: ComparisonRow) => row.id ? <a onClick={() => navigate(`/tasks/${row.id}`)}>{name}</a> : <span style={{ color: 'var(--ink-soft)' }}>{name}</span> },
        { title: '任务难度', dataIndex: 'difficulty', width: 120, render: (value: number) => value ? <DifficultyStars value={value} readOnly /> : <Tag color="gold">待评分</Tag> },
        { title: '数据量', dataIndex: 'dataVolume', width: 105, render: (value: number, row: ComparisonRow) => row.id ? `${value.toLocaleString()} 条` : '-' },
        { title: '平台进度', dataIndex: 'progress', width: 170, render: (value: number, row: ComparisonRow) => row.id ? <Progress percent={Math.round(value * 100)} size="small" /> : '-' },
        { title: '当前状态', dataIndex: 'alerts', width: 180, render: (alerts: any[], row: ComparisonRow) => !row.id ? '-' : alerts.length ? <Tag color="red">{alerts[0].type}</Tag> : <Tag color="green">正常</Tag> },
      ]} />
    </Card>

    <Row gutter={[20, 20]}>
      {teams.map(team => <Col xs={24} xl={12} key={team.team}>
        <Card className="group-card" title={<span style={{ color: TEAM_COLORS[team.team] }}>{team.team}<Tag className="leader-tag">组长：{team.leader}</Tag></span>}>
          <Row gutter={12} className="group-metrics">
            <Col span={8}><div className="metric-label">进行中任务</div><div className="metric-value">{team.activeTasks}<span className="metric-unit">个</span></div></Col>
            <Col span={8}><div className="metric-label">当前数据量</div><div className="metric-value">{team.activeDataVolume.toLocaleString()}<span className="metric-unit">条</span></div></Col>
            <Col span={8}><div style={{ color: 'var(--ink-soft)', fontSize: 12 }}>平均平台进度</div><Progress type="circle" size={52} strokeColor={TEAM_COLORS[team.team]} percent={Math.round(team.avgProgress * 100)} /></Col>
          </Row>
          <div className="difficulty-panel"><span>任务难度分布</span><DifficultyBreakdown facts={team} /></div>
          <div className="action-strip"><span>本周管理动作</span><Tag>规则/需求文档 {team.weeklyActions.ruleOrRequirementUploads}</Tag><Tag>报告 {team.weeklyActions.reportUploads}</Tag><Tag>回扫 {team.weeklyActions.rescanRecords}</Tag></div>
          <div className="section-kicker">当前重点任务</div>
          {team.tasks.length ? team.tasks.map(task => <div key={task.id} onClick={() => navigate(`/tasks/${task.id}`)} className={`task-focus-item ${task.alerts.length ? 'is-risk' : ''}`}>
            <div className="task-focus-head"><span>{task.name}</span>{task.alerts.length ? <WarningFilled /> : null}</div>
            <div className="task-focus-meta"><DifficultyStars value={task.difficulty} readOnly /><span>{task.dataVolume.toLocaleString()} 条 · 平台进度 {Math.round(task.progress * 100)}%</span></div>
            <div className="task-focus-action">{taskAction(task)}</div>
          </div>) : <div className="empty-task-state">当前无进行中任务</div>}
        </Card>
      </Col>)}
    </Row>

    <Card className="overview-summary-card global-risk-card" title={<><span>全局重点任务</span><small>优先查看进度、时限或文档存在风险的任务</small></>}>
      <Table size="small" rowKey="id" pagination={false} dataSource={riskRows} locale={{ emptyText: '当前没有风险任务' }} columns={[
        { title: '小组', dataIndex: 'teamName', width: 120 }, { title: '任务名称', dataIndex: 'name', width: 260, render: (name: string, task: any) => <a onClick={() => navigate(`/tasks/${task.id}`)}>{name}</a> },
        { title: '难度', dataIndex: 'difficulty', width: 115, render: (value: number) => <DifficultyStars value={value} readOnly /> }, { title: '数据量', dataIndex: 'dataVolume', width: 90, render: (value: number) => `${value.toLocaleString()} 条` },
        { title: '平台进度', dataIndex: 'progress', width: 130, render: (value: number) => <Progress percent={Math.round(value * 100)} size="small" /> },
        { title: '当前卡点', dataIndex: 'alerts', render: (alerts: any[]) => alerts[0]?.message },
      ]} />
    </Card>
  </div>;
}
