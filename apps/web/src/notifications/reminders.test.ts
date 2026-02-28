import { describe, expect, it } from "vitest";
import { createEmptyBoardState, type BoardState } from "../board/kanban-state";
import { collectScheduledReminders } from "./reminders";

const withTasks = (
  entries: Array<{ id: string; title: string; status: keyof BoardState; dueAt?: string | null }>,
): BoardState => {
  const board = createEmptyBoardState();
  for (const entry of entries) {
    board[entry.status].push({
      id: entry.id,
      title: entry.title,
      dueAt: entry.dueAt ?? null,
    });
  }
  return board;
};

describe("collectScheduledReminders", () => {
  it("returns a 10am daily reminder for due-today open tasks", () => {
    const reminders = collectScheduledReminders(
      withTasks([
        { id: "1", title: "Ship release", status: "PENDING", dueAt: "2026-03-03T17:00:00.000Z" },
      ]),
      new Date("2026-03-03T10:05:00.000"),
    );

    expect(reminders.length).toBe(1);
    expect(reminders[0]?.dedupeKey).toBe("daily:2026-03-03:10");
  });

  it("returns a 1pm daily reminder and excludes complete tasks", () => {
    const reminders = collectScheduledReminders(
      withTasks([
        { id: "1", title: "Open task", status: "STARTED", dueAt: "2026-03-03T17:00:00.000Z" },
        { id: "2", title: "Done task", status: "COMPLETE", dueAt: "2026-03-03T17:00:00.000Z" },
      ]),
      new Date("2026-03-03T13:04:00.000"),
    );

    expect(reminders.length).toBe(1);
    expect(reminders[0]?.dedupeKey).toBe("daily:2026-03-03:13");
    expect(reminders[0]?.body).toContain("1 task due today");
  });

  it("returns a monday 10am weekly reminder for this week's due tasks", () => {
    const reminders = collectScheduledReminders(
      withTasks([
        { id: "1", title: "Tue due", status: "PENDING", dueAt: "2026-03-03T17:00:00.000Z" },
        { id: "2", title: "Sun due", status: "REVIEW", dueAt: "2026-03-08T17:00:00.000Z" },
      ]),
      new Date("2026-03-02T10:03:00.000"),
    );

    expect(reminders.some((reminder) => reminder.dedupeKey === "weekly:2026-03-02:10")).toBe(
      true,
    );
  });

  it("returns no reminders outside configured windows", () => {
    const reminders = collectScheduledReminders(
      withTasks([
        { id: "1", title: "Ship release", status: "PENDING", dueAt: "2026-03-03T17:00:00.000Z" },
      ]),
      new Date("2026-03-03T15:30:00.000"),
    );

    expect(reminders).toEqual([]);
  });
});
