import dayjs, { Dayjs } from 'dayjs';

export type PeriodMode = '日' | '周' | '月' | '季度' | '自定义';
export type DateRange = [Dayjs, Dayjs];

// 公司财年：Q1=4–6月，Q2=7–9月，Q3=10–12月，Q4=1–3月。
export const getCompanyQuarter = (date: Dayjs) => (Math.floor(date.month() / 3) + 3) % 4 + 1;
export const formatCompanyQuarter = (date: Dayjs) => `${date.year()}-Q${getCompanyQuarter(date)}`;

export function getPeriodRange(mode: PeriodMode, date: Dayjs, customRange: DateRange | null): DateRange {
  if (mode === '自定义') return customRange || [date.startOf('day'), date.endOf('day')];
  if (mode === '日') return [date.startOf('day'), date.endOf('day')];
  if (mode === '周') return [date.startOf('week'), date.endOf('week')];
  if (mode === '月') return [date.startOf('month'), date.endOf('month')];
  const quarterStartMonth = Math.floor(date.month() / 3) * 3;
  return [date.startOf('month').month(quarterStartMonth), date.startOf('month').month(quarterStartMonth + 2).endOf('month')];
}

export function isDateInRange(value: string | undefined, range: DateRange): boolean {
  if (!value) return false;
  const date = dayjs(value);
  return !date.isBefore(range[0], 'day') && !date.isAfter(range[1], 'day');
}

export function taskOverlapsRange(
  task: { createdAt: string; deadline?: string; expectedDeadline?: string },
  range: DateRange,
): boolean {
  const taskStart = dayjs(task.createdAt);
  const taskEndValue = task.deadline || task.expectedDeadline;
  const startsBeforeRangeEnds = !taskStart.isAfter(range[1], 'day');
  const endsAfterRangeStarts = !taskEndValue || !dayjs(taskEndValue).isBefore(range[0], 'day');
  return startsBeforeRangeEnds && endsAfterRangeStarts;
}
