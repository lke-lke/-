import { Task } from '@/types';
import { TaskStatus } from '@/constants';

export function computeNextStatus(task: Task, progress: number, docCompleteness: number): TaskStatus {
  if (task.status === TaskStatus.DONE) return TaskStatus.DONE;

  if (progress === 0 && docCompleteness === 0) return TaskStatus.PENDING;
  if (progress > 0 && progress < 1) return TaskStatus.IN_PROGRESS;
  if (progress >= 1 && docCompleteness < 1) {
    return docCompleteness > 0 ? TaskStatus.TO_DELIVER : TaskStatus.DATA_DONE;
  }
  if (progress >= 1 && docCompleteness >= 1) return TaskStatus.TO_ACCEPT;

  return task.status;
}
