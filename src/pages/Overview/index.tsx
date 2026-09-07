import { useEffect, useMemo, useState } from 'react';
import { Alert, Card, Col, DatePicker, Progress, Row, Segmented, Table, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';
import { Team } from '@/constants';
import { getTasks } from '@/services/taskService';
import { getAllDocuments } from '@/services/documentService';
import { getRescanRecords } from '@/services/rescanService';
import { getTeamOverviewFacts, getTeamTaskPeriodStatsFromSource, TeamOverviewFacts, TeamTaskPeriodStats } from '@/services/statsService';
import DifficultyStars from '@/components/DifficultyStars';
import { isGlobalManagerRole, useActor } from '@/contexts/ActorContext';
import { DateRange, formatCompanyQuarter, getPeriodRange, PeriodMode, taskOverlapsRange } from '@/utils/timeRange';

type ComparisonRow = TeamOverviewFacts['activeTaskDetails'][number] & {
  key: string;
  teamName: Team;
  leader: string;
  teamRowSpan: number;
};

const TEAM_COLORS: Record<Team, string> = {
  [Team.GROUP_B]: '#806c79', [Team.GROUP_C]: '#928e5e', [Team.GROUP_D]: '#b97d7b',
};
const STATUS_COLUMNS = [
  { key: '待开始', color: '#ddd3c9' },
  { key: '进行中', color: '#806c79' },
  { key: '待确认', color: '#c1a0ac' },
  { key: '已完成', color: '#928e5e' },
] as const;

function DifficultyBreakdown({ facts }: { facts: TeamOverviewFacts }) {
  return <div className="difficulty-breakdown">
    {[1, 2, 3, 4, 5]
      .filter(star => facts.difficultyCounts[star] > 0)
      .map(star => <Tag key={star} color={star >= 4 ? 'volcano' : undefined}>{star} 星 {facts.difficultyCounts[star]} 个</Tag>)}
    {facts.unratedTasks > 0 && <Tag color="gold">待评分 {facts.unratedTasks} 个</Tag>}
  </div>;
}

export default function Overview() {
  const [teams, setTeams] = useState<TeamOverviewFacts[]>([]);
  const [taskStatusRows, setTaskStatusRows] = useState<TeamTaskPeriodStats[]>([]);
  const [periodMode, setPeriodMode] = useState<PeriodMode>('月');
  const [anchorDate, setAnchorDate] = useState<Dayjs>(dayjs());
  const [customRange, setCustomRange] = useState<DateRange | null>(null);
  const navigate = useNavigate();
  const { actor } = useActor();
  const isGlobalManager = isGlobalManagerRole(actor.role);
  const selectedRange = useMemo(() => getPeriodRange(periodMode, anchorDate, customRange), [periodMode, anchorDate, customRange]);

  useEffect(() => {
    Promise.all([getTasks(), getAllDocuments(), getRescanRecords()]).then(async ([tasks, docs, rescans]) => {
      const scopedTasks = isGlobalManager ? tasks : actor.role === '组长' ? tasks.filter(task => task.team === actor.team) : tasks.filter(task => task.assignee === actor.name || task.participantNames?.includes(actor.name));
      const periodTasks = isGlobalManager ? scopedTasks.filter(task => taskOverlapsRange(task, selectedRange)) : scopedTasks;
      const shownTeams = isGlobalManager ? getTeamOverviewFacts(periodTasks, docs, rescans, selectedRange) : getTeamOverviewFacts(periodTasks, docs, rescans).filter(team => team.team === actor.team);
      setTeams(shownTeams);
      setTaskStatusRows(await getTeamTaskPeriodStatsFromSource(periodTasks, selectedRange[0], selectedRange[1]));
    });
  }, [actor, isGlobalManager, selectedRange]);

  const comparisonRows = useMemo<ComparisonRow[]>(() => teams.flatMap(team => {
    const groupTasks = team.activeTaskDetails;
    if (!groupTasks.length) return [{ key: `${team.team}-empty`, id: '', name: '当前无进行中任务', team: team.team, teamName: team.team, leader: team.leader, teamRowSpan: 1, ownership: '' as any, taskGroup: '', workNature: '' as any, taskType: '' as any, assignee: '', teamLeader: '', dataReporter: '', reviewer: '', dataVolume: 0, workforce: 0, createdAt: '', deadline: '', status: '' as any, progress: 0, docCompleteness: 0, alerts: [] }];
    return groupTasks.map((task, index) => ({ ...task, key: task.id, teamName: team.team, leader: team.leader, teamRowSpan: index === 0 ? groupTasks.length : 0 }));
  }), [teams]);

  const workspaceTitle = isGlobalManager ? '各组作业总览' : actor.role === '组长' ? `${actor.team}工作台` : `早上好，${actor.name}`;
  const workspaceDescription = isGlobalManager ? '用任务事实看见各组的规模、难度、平台进度和需处理事项。' : actor.role === '组长' ? '聚焦本组任务、验收与成员协作，优先处理临期和待确认事项。' : '查看我的任务、待补交付和待组长确认的工作记录。';
  const scopeLabel = isGlobalManager ? '各组' : actor.role === '组长' ? '本组' : '我的';
  const picker = periodMode === '日' ? 'date' : periodMode === '周' ? 'week' : periodMode === '月' ? 'month' : 'quarter';

  return <div>
    <div className="page-title-row"><div><div className="eyebrow">{isGlobalManager ? 'GLOBAL WORKSPACE' : 'MY WORKSPACE'}</div><h2>{workspaceTitle}</h2><p>{workspaceDescription}</p></div><div className="overview-date-note">实时任务视图<br /><strong>不含临时评分</strong></div></div>
    {isGlobalManager && <Card className="timeline-filter-card overview-period-filter">
      <div className="timeline-filter-row">
        <Segmented value={periodMode} onChange={value => setPeriodMode(value as PeriodMode)} options={['日', '周', '月', '季度', '自定义']} />
        {periodMode === '自定义'
          ? <DatePicker.RangePicker value={customRange} onChange={value => setCustomRange(value?.[0] && value?.[1] ? [value[0], value[1]] : null)} />
          : <DatePicker picker={picker as any} showWeek={periodMode === '周' ? false : undefined} format={periodMode === '季度' ? formatCompanyQuarter : undefined} inputReadOnly={periodMode === '季度'} value={anchorDate} onChange={value => value && setAnchorDate(value)} />}
        <Tag color="blue">统计区间：{selectedRange[0].format('YYYY-MM-DD')} 至 {selectedRange[1].format('YYYY-MM-DD')}</Tag>
      </div>
    </Card>}
    <Alert showIcon type="info" className="overview-info" message={actor.role === '组员' ? '工作记录提交后，需要组长确认才会计入本周工作量。' : isGlobalManager ? '下方全部板块已统一使用所选时间区间；平台进度暂显示任务的最新进度。' : '“本周管理动作”统计本组已上传文档、回扫次数及支持工时；已确认客观标签会在任务结项后计入人员工作量。'} />

    {isGlobalManager ? <Card className="overview-summary-card" title="各组任务状态明细">
      <Table rowKey="team" pagination={false} dataSource={taskStatusRows} columns={[
        { title: '小组', dataIndex: 'team', width: 180, render: (team: Team) => <strong>{team}</strong> },
        { title: '任务总量', dataIndex: 'total', width: 130, render: (value: number) => `${value} 个` },
        ...STATUS_COLUMNS.map(status => ({
          title: status.key,
          key: status.key,
          width: 130,
          render: (row: TeamTaskPeriodStats) => <Tag color={status.color}>{row.statuses[status.key]} 个</Tag>,
        })),
      ]} />
    </Card> : <Card className="overview-summary-card" title={<><span>{scopeLabel}进行中任务明细</span><small>每个任务独立展示，便于横向核对</small></>}>
      <Table size="small" rowKey="key" pagination={false} dataSource={comparisonRows} scroll={{ x: 1100 }} columns={[
        { title: '小组', dataIndex: 'teamName', width: 155, render: (team: Team, row: ComparisonRow) => <span style={{ color: TEAM_COLORS[team], fontWeight: 600 }}>{team}<br /><span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>组长：{row.leader}</span></span>, onCell: (row: ComparisonRow) => ({ rowSpan: row.teamRowSpan }) },
        { title: '任务 ID', dataIndex: 'platformTaskId', width: 185, render: (value: string) => value || <Tag>待补充</Tag> },
        { title: '任务名称', dataIndex: 'name', width: 270, render: (name: string, row: ComparisonRow) => row.id ? <a onClick={() => navigate(`/tasks/${row.id}`)}>{name}</a> : <span style={{ color: 'var(--ink-soft)' }}>{name}</span> },
        { title: '任务难度', dataIndex: 'difficulty', width: 120, render: (value: number) => value ? <DifficultyStars value={value} readOnly /> : <Tag color="gold">待评分</Tag> },
        { title: '数据量', dataIndex: 'dataVolume', width: 105, render: (value: number, row: ComparisonRow) => row.id ? `${value.toLocaleString()} 条` : '-' },
        { title: '平台进度', dataIndex: 'progress', width: 170, render: (value: number, row: ComparisonRow) => row.id ? <Progress percent={Math.round(value * 100)} size="small" /> : '-' },
        { title: '当前状态', dataIndex: 'alerts', width: 180, render: (alerts: any[], row: ComparisonRow) => !row.id ? '-' : alerts.length ? <Tag color="red">{alerts[0].type}</Tag> : <Tag color="green">正常</Tag> },
      ]} />
    </Card>}

    <Row gutter={[20, 20]}>
      {teams.map(team => <Col xs={24} xl={12} key={team.team}>
        <Card className="group-card" title={<span style={{ color: TEAM_COLORS[team.team] }}>{team.team}<Tag className="leader-tag">组长：{team.leader}</Tag></span>}>
          <Row gutter={12} className="group-metrics">
            <Col span={8}><div className="metric-label">{isGlobalManager ? '区间进行中任务' : '进行中任务'}</div><div className="metric-value">{team.activeTasks}<span className="metric-unit">个</span></div></Col>
            <Col span={8}><div className="metric-label">{isGlobalManager ? '区间数据量' : '当前数据量'}</div><div className="metric-value">{team.activeDataVolume.toLocaleString()}<span className="metric-unit">条</span></div></Col>
            <Col span={8}><div style={{ color: 'var(--ink-soft)', fontSize: 12 }}>{isGlobalManager ? '平均平台进度（最新）' : '平均平台进度'}</div><Progress type="circle" size={52} strokeColor={TEAM_COLORS[team.team]} percent={Math.round(team.avgProgress * 100)} /></Col>
          </Row>
          <div className="difficulty-panel"><span>任务难度分布</span><DifficultyBreakdown facts={team} /></div>
          <div className="action-strip"><span>{isGlobalManager ? '区间管理动作' : '本周管理动作'}</span><Tag>规则/需求文档 {team.periodActions.ruleOrRequirementUploads}</Tag><Tag>报告 {team.periodActions.reportUploads}</Tag><Tag>回扫 {team.periodActions.rescanRecords} 次</Tag><Tag>回扫支持 {team.periodActions.rescanHours} 小时</Tag></div>
          <div className="action-strip"><span>时限风险</span><Tag color={team.overdueTasks ? 'error' : 'success'}>逾期 {team.overdueTasks} 个</Tag><Tag>逾期率 {Math.round(team.overdueRate * 100)}%</Tag><Tag color={team.riskTasks ? 'warning' : 'success'}>需关注 {team.riskTasks} 个</Tag></div>
        </Card>
      </Col>)}
    </Row>

  </div>;
}
