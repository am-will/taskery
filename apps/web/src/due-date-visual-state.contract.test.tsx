// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const jsonResponse = (tasks: unknown[]) =>
  new Response(JSON.stringify({ tasks }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const flushMicrotasks = async () => {
  await Promise.resolve();
};

describe("due date visual state", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("renders due today as yellow and overdue as red while ignoring completed overdue tasks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-28T10:00:00.000Z"));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse([
        {
          id: "due-today",
          title: "Due today",
          status: "PENDING",
          dueAt: "2026-02-28T17:00:00.000Z",
          position: 1000,
          version: 1,
        },
        {
          id: "overdue",
          title: "Past due",
          status: "STARTED",
          dueAt: "2026-02-27T17:00:00.000Z",
          position: 2000,
          version: 1,
        },
        {
          id: "complete-overdue",
          title: "Done already",
          status: "COMPLETE",
          dueAt: "2026-02-27T17:00:00.000Z",
          position: 3000,
          version: 1,
        },
      ]),
    );

    render(<App />);

    await act(async () => {
      await flushMicrotasks();
    });

    expect(screen.getByTestId("task-card-due-today").className).toContain("is-due-today");
    expect(screen.getByTestId("task-card-overdue").className).toContain("is-overdue");
    expect(screen.getByTestId("task-card-complete-overdue").className).not.toContain(
      "is-overdue",
    );
  });
});
