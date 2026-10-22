/**
 * Continuous tasks (component jobs.scheduled.turbineh): work another component hands to the cron route, run on every
 * call (e.g. appointment reminders that fall due between two calls). A task has no cron of its own and is not claimed
 * per occurrence like a job: each task is idempotent by its own records (domain.reminders.turbineh keeps one reminder
 * per appointment, channel and start time). A component adds its tasks by replacing this file through
 * files-with/jobs.scheduled.turbineh/src/jobs/tasks.ts.
 */
export interface TaskResult {
  sent: number;
  skipped: number;
  failed: number;
}

export interface Task {
  /** Lowercase id, selectable with /api/cron/run?task=<id>. */
  id: string;
  run: (now: Date) => Promise<TaskResult>;
}

export const TASKS: Task[] = [];
