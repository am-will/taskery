import { BOARD_STATUSES, type BoardState } from "../board/kanban-state";

const REMINDER_WINDOW_MINUTES = 15;
const DAILY_REMINDER_HOURS = [10, 13] as const;
const WEEKLY_REMINDER_HOUR = 10;
const WEEKDAY_MONDAY = 1;

export type ScheduledReminder = {
  dedupeKey: string;
  title: string;
  body: string;
};

const toLocalDateKey = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const toDueDateKey = (dueAt: string | null | undefined): string | null => {
  if (typeof dueAt !== "string") {
    return null;
  }

  const trimmed = dueAt.slice(0, 10);
  return trimmed.length === 10 ? trimmed : null;
};

const isOpenStatus = (status: string): boolean => status !== "COMPLETE";

const listTitles = (titles: string[]): string => {
  const preview = titles.slice(0, 3);
  if (preview.length === 0) {
    return "";
  }

  if (titles.length > 3) {
    return `${preview.join(", ")}, +${titles.length - 3} more`;
  }

  return preview.join(", ");
};

const isInReminderWindow = (now: Date, hour: number): boolean =>
  now.getHours() === hour && now.getMinutes() < REMINDER_WINDOW_MINUTES;

const startOfWeekMonday = (now: Date): Date => {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  const offset = day === 0 ? -6 : WEEKDAY_MONDAY - day;
  start.setDate(start.getDate() + offset);
  return start;
};

const endOfWeekSunday = (monday: Date): Date => {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return sunday;
};

const listDueTaskTitles = (
  board: BoardState,
  filter: (dueDate: string) => boolean,
): string[] => {
  const titles: string[] = [];

  for (const status of BOARD_STATUSES) {
    if (!isOpenStatus(status)) {
      continue;
    }

    for (const task of board[status]) {
      const dueDate = toDueDateKey(task.dueAt);
      if (!dueDate || !filter(dueDate)) {
        continue;
      }
      titles.push(task.title);
    }
  }

  return titles;
};

export const collectScheduledReminders = (
  board: BoardState,
  now: Date,
): ScheduledReminder[] => {
  const reminders: ScheduledReminder[] = [];
  const today = toLocalDateKey(now);

  for (const hour of DAILY_REMINDER_HOURS) {
    if (!isInReminderWindow(now, hour)) {
      continue;
    }

    const dueTodayTitles = listDueTaskTitles(board, (dueDate) => dueDate === today);
    if (dueTodayTitles.length === 0) {
      continue;
    }

    reminders.push({
      dedupeKey: `daily:${today}:${hour}`,
      title: `Tasky due-today reminder (${hour === 10 ? "10:00" : "13:00"})`,
      body: `${dueTodayTitles.length} task${dueTodayTitles.length === 1 ? "" : "s"} due today: ${listTitles(dueTodayTitles)}.`,
    });
  }

  if (now.getDay() !== WEEKDAY_MONDAY || !isInReminderWindow(now, WEEKLY_REMINDER_HOUR)) {
    return reminders;
  }

  const monday = startOfWeekMonday(now);
  const sunday = endOfWeekSunday(monday);
  const mondayKey = toLocalDateKey(monday);
  const sundayKey = toLocalDateKey(sunday);
  const dueThisWeekTitles = listDueTaskTitles(
    board,
    (dueDate) => dueDate >= mondayKey && dueDate <= sundayKey,
  );
  if (dueThisWeekTitles.length === 0) {
    return reminders;
  }

  reminders.push({
    dedupeKey: `weekly:${mondayKey}:${WEEKLY_REMINDER_HOUR}`,
    title: "Tasky weekly due-date reminder (Monday 10:00)",
    body: `${dueThisWeekTitles.length} task${dueThisWeekTitles.length === 1 ? "" : "s"} due this week: ${listTitles(dueThisWeekTitles)}.`,
  });

  return reminders;
};
