import { OverviewStats, Member, Task, Document, RescanRecord } from '@/types';
import { DocType, TaskStatus, DIFFICULTY_POINTS, ALL_TEAMS, TEAM_MEMBERS, TEAM_LEADERS, Team } from '@/constants';
import dayjs from 'dayjs';
import { DateRange, isDateInRange } from '@/utils/timeRange';

const TODAY = dayjs();

export type TimeRange = 'week' | 'month' | 'quarter';

export interface TeamWorkload {
  team: Team;
  leader: string;
  members: string[];
  week: PeriodStat;
  month: PeriodStat;
  quarter: PeriodStat;
}

export interface PeriodStat {
  dispatched: number;      // 该周期内下发的任务数
  completed: number;       // 该周期内完成的任务数
  inProgress: number;      // 当前进行中任务数
  dataVolume: number;      // 该周期内任务的数据量级合计
  difficultyPoints: number; // 进行中任务难度点数
}

export interface TeamOverviewFacts {
  team: Team;
  leader: string;
  activeTasks: number;
  activeDataVolume: number;
  riskTasks: number;
  overdueTasks: number;
  overdueRate: number;
  avgProgress: number;
  difficultyCounts: Record<number, number>;
  unratedTasks: number;
  periodActions: { ruleOrRequirementUploads: number; reportUploads: number; rescanRecords: number };
  activeTaskDetails: Task[];
  tasks: Task[];
}

export type TaskBoardStatus = '待开始' | '进行中' | '回扫中' | '待确认' | '已完成';

export interface TeamTaskPeriodStats {
  team: Team;
  total: number;
  statuses: Record<TaskBoardStatus, number>;
}

function buildTeamTaskStatusStats(tasks: Task[], rescans: RescanRecord[]): TeamTaskPeriodStats[] {
  const hasActiveRescan = (taskId: string) => rescans.some(record => record.originalTaskId === taskId && !record.actualDone && record.accepted !== true);
  const getStatus = (task: Task): TaskBoardStatus => {
    if (task.status === TaskStatus.DONE) return '已完成';
    if (hasActiveRescan(task.id)) return '回扫中';
    if (task.status === TaskStatus.TO_ACCEPT) return '待确认';
    if (task.status === TaskStatus.PENDING || task.status === TaskStatus.PENDING_INFO) return '待开始';
    return '进行中';
  };
  return ALL_TEAMS.map(team => {
    const groupTasks = tasks.filter(task => task.team === team);
    const statuses: Record<TaskBoardStatus, number> = { 待开始: 0, 进行中: 0, 回扫中: 0, 待确认: 0, 已完成: 0 };
    groupTasks.forEach(task => { statuses[getStatus(task)] += 1; });
    return { team, total: groupTasks.length, statuses };
  });
}

export function getTeamTaskStatusStats(tasks: Task[], rescans: RescanRecord[]): TeamTaskPeriodStats[] {
  return buildTeamTaskStatusStats(tasks, rescans);
}

export function getTeamTaskPeriodStats(tasks: Task[], rescans: RescanRecord[], start: dayjs.Dayjs, end: dayjs.Dayjs): TeamTaskPeriodStats[] {
  const inRangeTasks = tasks.filter(task => {
    const date = dayjs(task.createdAt);
    return (date.isAfter(start.subtract(1, 'day')) || date.isSame(start, 'day')) && (date.isBefore(end.add(1, 'day')) || date.isSame(end, 'day'));
  });
  return buildTeamTaskStatusStats(inRangeTasks, rescans);
}

export function getTeamOverviewFacts(tasks: Task[], docs: Document[], rescans: RescanRecord[], range?: DateRange): TeamOverviewFacts[] {
  const byTaskId = new Map(tasks.map(task => [task.id, task]));
  const actionRange: DateRange = range || [TODAY.startOf('week'), TODAY.endOf('week')];
  const riskReferenceDate = range?.[1] || TODAY;
  return ALL_TEAMS.map(team => {
    const teamTasks = tasks.filter(task => task.team === team);
    const active = teamTasks.filter(task => task.status !== TaskStatus.DONE);
    const teamDocs = docs.filter(doc => byTaskId.get(doc.taskId)?.team === team && isDateInRange(doc.uploadedAt, actionRange));
    const teamRescanRecords = rescans.filter(record => byTaskId.get(record.originalTaskId)?.team === team && isDateInRange(record.actualDone || record.createdAt, actionRange));
    const difficultyCounts = [1, 2, 3, 4, 5].reduce((counts, star) => {
      counts[star] = teamTasks.filter(task => task.difficulty === star).length;
      return counts;
    }, {} as Record<number, number>);
    const sortedTasks = [...active].sort((a, b) => {
      const risk = b.alerts.length - a.alerts.length;
      return risk || a.progress - b.progress || (b.difficulty || 1) - (a.difficulty || 1);
    });
    const overdueTasks = active.filter(task => task.deadline && dayjs(task.deadline).isBefore(riskReferenceDate, 'day')).length;
    return {
      team, leader: TEAM_LEADERS[team], activeTasks: active.length,
      activeDataVolume: teamTasks.reduce((sum, task) => sum + task.dataVolume, 0),
      riskTasks: active.filter(task => task.alerts.length > 0 || (task.deadline && dayjs(task.deadline).isBefore(riskReferenceDate, 'day'))).length,
      overdueTasks,
      overdueRate: active.length ? overdueTasks / active.length : 0,
      avgProgress: active.length ? active.reduce((sum, task) => sum + task.progress, 0) / active.length : 1,
      difficultyCounts, unratedTasks: teamTasks.filter(task => !task.difficulty).length,
      periodActions: {
        ruleOrRequirementUploads: teamDocs.filter(doc => [DocType.RULE, DocType.REQUIREMENT].includes(doc.docType)).length,
        reportUploads: teamDocs.filter(doc => [DocType.EVAL_REPORT, DocType.OTHER].includes(doc.docType)).length,
        rescanRecords: teamRescanRecords.length,
      },
      activeTaskDetails: sortedTasks,
      tasks: sortedTasks.slice(0, 4),
    };
  }).sort((a, b) => b.activeTasks - a.activeTasks || b.activeDataVolume - a.activeDataVolume);
}

function getRangeStart(range: TimeRange): dayjs.Dayjs {
  if (range === 'week') return TODAY.startOf('week');
  if (range === 'month') return TODAY.startOf('month');
  // 公司季度边界与自然季度相同，但季度编号为：4–6月 Q1、7–9月 Q2、10–12月 Q3、1–3月 Q4。
  return TODAY.startOf('month').month(Math.floor(TODAY.month() / 3) * 3);
}

function getPeriodStat(tasks: Task[], team: Team, range: TimeRange): PeriodStat {
  const start = getRangeStart(range);
  const teamTasks = tasks.filter(t => t.team === team);
  const periodTasks = teamTasks.filter(t => dayjs(t.createdAt).isAfter(start.subtract(1, 'day')));
  const dispatched = periodTasks.length;
  const completed = periodTasks.filter(t => t.status === TaskStatus.DONE).length;
  const inProgress = teamTasks.filter(t => t.status !== TaskStatus.DONE).length;
  const dataVolume = periodTasks.reduce((s, t) => s + (t.dataVolume || 0), 0);
  const difficultyPoints = teamTasks
    .filter(t => t.status !== TaskStatus.DONE)
    .reduce((s, t) => s + (t.difficulty ? DIFFICULTY_POINTS[t.difficulty] : 1), 0);
  return { dispatched, completed, inProgress, dataVolume, difficultyPoints };
}

export function getTeamWorkloads(tasks: Task[]): TeamWorkload[] {
  return ALL_TEAMS.map(team => ({
    team,
    leader: TEAM_LEADERS[team],
    members: TEAM_MEMBERS[team],
    week: getPeriodStat(tasks, team, 'week'),
    month: getPeriodStat(tasks, team, 'month'),
    quarter: getPeriodStat(tasks, team, 'quarter'),
  }));
}

export function getOverviewStats(tasks: Task[]): OverviewStats {
  const total = tasks.length;
  const completed = tasks.filter(t => t.status === TaskStatus.DONE).length;
  const inProgress = tasks.filter(t => t.status !== TaskStatus.DONE).length;
  const overdue = tasks.filter(t => t.status !== TaskStatus.DONE && dayjs(t.deadline).isBefore(TODAY)).length;
  const completedWithDeadline = tasks.filter(t => t.status === TaskStatus.DONE);
  const onTimeRate = completedWithDeadline.length > 0
    ? completedWithDeadline.filter(t => !dayjs(t.createdAt).isAfter(dayjs(t.deadline))).length / completedWithDeadline.length
    : 1;
  const dataDoneTasks = tasks.filter(t => [TaskStatus.DATA_DONE, TaskStatus.TO_DELIVER, TaskStatus.TO_ACCEPT, TaskStatus.DONE].includes(t.status));
  const docComplete = dataDoneTasks.filter(t => t.docCompleteness === 1).length;
  const docCompleteRate = dataDoneTasks.length > 0 ? docComplete / dataDoneTasks.length : 0;
  const alertTasks = tasks.filter(t => t.alerts.length > 0).length;
  const alertRate = inProgress > 0 ? alertTasks / inProgress : 0;
  return { totalDispatched: total, totalCompleted: completed, inProgress, overdue, onTimeRate, docCompleteRate, alertRate };
}

export function getTeamStats(tasks: Task[]) {
  return ALL_TEAMS.map(team => {
    const activeTasks = tasks.filter(t => t.team === team && t.status !== TaskStatus.DONE);
    const points = activeTasks.reduce((s, t) => s + (t.difficulty ? DIFFICULTY_POINTS[t.difficulty] : 0), 0);
    const completed = tasks.filter(t => t.team === team && t.status === TaskStatus.DONE).length;
    const total = tasks.filter(t => t.team === team).length;
    return { team, activeTasks: activeTasks.length, difficultyPoints: points, onTimeRate: total > 0 ? completed / total : 0 };
  });
}

export function getMemberWorkload(tasks: Task[]): Member[] {
  return ALL_TEAMS.flatMap(team => TEAM_MEMBERS[team].map(name => {
    const memberTasks = tasks.filter(t => t.team === team && t.assignee === name);
    const points = (task: Task) => task.difficulty ? DIFFICULTY_POINTS[task.difficulty] : 1;
    return {
      id: `${team}-${name}`,
      name,
      team,
      role: name === TEAM_LEADERS[team] ? 'leader' as const : 'assistant' as const,
      activeTasks: memberTasks.filter(t => t.status !== TaskStatus.DONE).length,
      difficultyPoints: memberTasks.filter(t => t.status !== TaskStatus.DONE).reduce((sum, task) => sum + points(task), 0),
      completedPoints4w: memberTasks
        .filter(t => t.status === TaskStatus.DONE && dayjs(t.createdAt).isAfter(TODAY.subtract(4, 'week')))
        .reduce((sum, task) => sum + points(task), 0),
    };
  }));
}
