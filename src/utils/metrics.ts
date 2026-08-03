import { Task, Member } from '@/types';
import { DIFFICULTY_POINTS, TaskStatus } from '@/constants';
import dayjs from 'dayjs';

export function calcTaskCycle(task: Task): number | null {
  if (task.status !== TaskStatus.DONE) return null;
  return dayjs(task.deadline).diff(dayjs(task.createdAt), 'day');
}

export function calcCurrentLoad(tasks: Task[]): number {
  return tasks
    .filter(t => t.status !== TaskStatus.DONE)
    .reduce((sum, t) => sum + (t.difficulty ? DIFFICULTY_POINTS[t.difficulty] : 1), 0);
}

export function isOverloaded(member: Member, avgPoints: number): boolean {
  return member.difficultyPoints > avgPoints * 1.5;
}

export function isUnderloaded(member: Member, avgPoints: number): boolean {
  return member.difficultyPoints < avgPoints * 0.5;
}
