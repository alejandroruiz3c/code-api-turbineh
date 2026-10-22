import { runDueReminders } from "@/reminders/service";

/**
 * Continuous tasks of the cron route (jobs.scheduled.turbineh with domain.reminders.turbineh): appointment reminders run
 * on every call — each reminder is sent once per appointment, channel and start time, whatever the calls' rhythm.
 */
export interface TaskResult {
  sent: number;
  skipped: number;
  failed: number;
}

export interface Task {
  id: string;
  run: (now: Date) => Promise<TaskResult>;
}

export const TASKS: Task[] = [{ id: "booking-reminders", run: (now) => runDueReminders(now) }];
