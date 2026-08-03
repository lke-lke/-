import { useEffect, useMemo, useState } from 'react';
import { Alert, Card, DatePicker, Segmented, Table, Tag } from 'antd';
import ReactECharts from 'echarts-for-react';
import dayjs, { Dayjs } from 'dayjs';
import { ALL_TEAMS, Team } from '@/constants';
import { getTasks } from '@/services/taskService';
import { getRescanRecords } from '@/services/rescanService';
import { getTeamTaskPeriodStats, TaskBoardStatus, TeamTaskPeriodStats } from '@/services/statsService';

type PeriodMode = '日' | '周' | '月' | '季度' | '自定义';
const STATUSES: TaskBoardStatus[] = ['待开始', '进行中', '回扫中', '待确认', '已完成'];
const STATUS_COLORS: Record<TaskBoardStatus, string> = { 待开始: '#ddd3c9', 进行中: '#806c79', 回扫中: '#b97d7b', 待确认: '#c1a0ac', 已完成: '#928e5e' };
// 公司财年：Q1=4–6月，Q2=7–9月，Q3=10–12月，Q4=1–3月。
const getCompanyQuarter = (date: Dayjs) => (Math.floor(date.month() / 3) + 3) % 4 + 1;
const formatCompanyQuarter = (date: Dayjs) => `${date.year()}-Q${getCompanyQuarter(date)}`;

function getRange(mode: PeriodMode, date: Dayjs, customRange: [Dayjs, Dayjs] | null): [Dayjs, Dayjs] {
  if (mode === '自定义') return customRange || [date.startOf('day'), date.endOf('day')];
  if (mode === '日') return [date.startOf('day'), date.endOf('day')];
  if (mode === '周') return [date.startOf('week'), date.endOf('week')];
  if (mode === '月') return [date.startOf('month'), date.endOf('month')];
  const quarterStartMonth = Math.floor(date.month() / 3) * 3;
  return [date.startOf('month').month(quarterStartMonth), date.startOf('month').month(quarterStartMonth + 2).endOf('month')];
}

export default function TaskTimeline() {
  const [mode, setMode] = useState<PeriodMode>('月');
  const [anchorDate, setAnchorDate] = useState<Dayjs>(dayjs());
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [stats, setStats] = useState<TeamTaskPeriodStats[]>([]);
  const [range, setRange] = useState<[Dayjs, Dayjs]>(getRange('月', dayjs(), null));

  useEffect(() => {
    const nextRange = getRange(mode, anchorDate, customRange);
    setRange(nextRange);
    Promise.all([getTasks(), getRescanRecords()]).then(([tasks, rescans]) => setStats(getTeamTaskPeriodStats(tasks, rescans, nextRange[0], nextRange[1])));
  }, [mode, anchorDate, customRange]);

  const chartOption = useMemo(() => ({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: STATUSES },
    grid: { left: 100, right: 28, top: 45, bottom: 18 },
    xAxis: { type: 'value', name: '任务数', minInterval: 1 },
    yAxis: { type: 'category', data: ALL_TEAMS },
    series: STATUSES.map(status => ({ name: status, type: 'bar', stack: '任务', data: ALL_TEAMS.map(team => stats.find(item => item.team === team)?.statuses[status] || 0), itemStyle: { color: STATUS_COLORS[status] } })),
  }), [stats]);

  const picker = mode === '日' ? 'date' : mode === '周' ? 'week' : mode === '月' ? 'month' : 'quarter';
  return <div>
    <div className="page-title-row"><div><div className="eyebrow">TASK CALENDAR</div><h2>时间任务看板</h2><p>选择任意时间区间，比较四组的任务总量与当前状态分布。</p></div></div>
    <Card className="timeline-filter-card">
      <div className="timeline-filter-row">
        <Segmented value={mode} onChange={value => setMode(value as PeriodMode)} options={['日', '周', '月', '季度', '自定义']} />
        {mode === '自定义' ? <DatePicker.RangePicker value={customRange as any} onChange={value => setCustomRange(value?.[0] && value?.[1] ? [value[0], value[1]] : null)} /> : <DatePicker picker={picker as any} showWeek={mode === '周' ? false : undefined} format={mode === '季度' ? formatCompanyQuarter : undefined} inputReadOnly={mode === '季度'} value={anchorDate} onChange={value => value && setAnchorDate(value)} />}
        <Tag color="blue">统计区间：{range[0].format('YYYY-MM-DD')} 至 {range[1].format('YYYY-MM-DD')}</Tag>
      </div>
    </Card>
    <Alert showIcon type="info" className="overview-info" message="回扫中：关联存在尚未完成或未验收回扫记录的任务。待确认：数据完成、文档齐套后等待验收的任务。" />
    <Card className="timeline-chart-card" title="四组任务状态对比"><div className="status-legend">{STATUSES.map(status => <span key={status}><i className="legend-dot" style={{ background: STATUS_COLORS[status] }} />{status}</span>)}</div><ReactECharts option={{ ...chartOption, legend: { show: false }}} style={{ height: 300 }} /></Card>
    <Card className="overview-summary-card" title="四组任务状态明细">
      <Table rowKey="team" pagination={false} dataSource={stats} columns={[
        { title: '小组', dataIndex: 'team', width: 140, render: (team: Team) => <strong>{team}</strong> }, { title: '任务总量', dataIndex: 'total', width: 100, render: (value: number) => `${value} 个` },
        ...STATUSES.map(status => ({ title: status, key: status, width: 110, render: (row: TeamTaskPeriodStats) => <Tag color={STATUS_COLORS[status]}>{row.statuses[status]} 个</Tag> })),
      ]} />
    </Card>
  </div>;
}
