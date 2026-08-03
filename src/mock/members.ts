import { Member } from '@/types';
import { Team, TEAM_MEMBERS, TEAM_LEADERS, DIFFICULTY_POINTS, TaskStatus } from '@/constants';
import { mockTasks } from './tasks';

export const mockMembers: Member[] = Object.values(Team).flatMap(team =>
  TEAM_MEMBERS[team].map(name => {
    const tasks = mockTasks.filter(t => t.team === team && t.assignee === name);
    const activeTasks = tasks.filter(t => t.status !== TaskStatus.DONE).length;
    const difficultyPoints = tasks
      .filter(t => t.status !== TaskStatus.DONE)
      .reduce((s, t) => s + (t.difficulty ? DIFFICULTY_POINTS[t.difficulty] : 1), 0);
    const completedPoints4w = tasks
      .filter(t => t.status === TaskStatus.DONE)
      .reduce((s, t) => s + (t.difficulty ? DIFFICULTY_POINTS[t.difficulty] : 1), 0);
    return {
      id: `${team}-${name}`,
      name,
      team,
      role: name === TEAM_LEADERS[team] ? 'leader' as const : 'assistant' as const,
      activeTasks,
      difficultyPoints,
      completedPoints4w,
    };
  })
);

export const mockTeams = Object.values(Team);
