// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const REFRESH_INTERVAL_MS = 1000;
const EXTERNAL_MOVE_ANIMATION_MS = 1300;
const waitForTaskInColumn = async (title: string, column: string, timeoutMs = 5000) => {
  const stepMs = 100;
  let elapsedMs = 0;
  while (elapsedMs <= timeoutMs) {
    if (within(getColumn(column)).queryByText(title)) {
      return;
    }

    await act(async () => {
      vi.advanceTimersByTime(stepMs);
      await flushMicrotasks();
    });
    elapsedMs += stepMs;
  }

  throw new Error(`Task "${title}" was not found in ${column} within ${timeoutMs}ms`);
};

const flushMicrotasks = async () => {
  await Promise.resolve();
};

const jsonResponse = (tasks: unknown[]) =>
  new Response(JSON.stringify({ tasks }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const getColumn = (label: string): HTMLElement => {
  const heading = screen.getByRole("heading", { name: new RegExp(`^${label}`) });
  const column = heading.closest("[data-column-status]");
  if (!column) {
    throw new Error(`Column not found for ${label}`);
  }
  return column as HTMLElement;
};

describe("cli move animation contract", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("highlights then animates status changes discovered from polling", async () => {
    vi.useFakeTimers();
    let fetchCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return jsonResponse([
          {
            id: "task-1",
            title: "Move me via CLI",
            status: "PENDING",
            position: 1000,
            version: 1,
          },
        ]);
      }

      return jsonResponse([
        {
          id: "task-1",
          title: "Move me via CLI",
          status: "STARTED",
          position: 1000,
          version: 2,
        },
      ]);
    });

    render(<App />);

    await act(async () => {
      await flushMicrotasks();
    });

    expect(within(getColumn("Pending")).queryByText("Move me via CLI")).toBeTruthy();
    expect(within(getColumn("Started")).queryByText("Move me via CLI")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(REFRESH_INTERVAL_MS);
      await flushMicrotasks();
    });

    expect(screen.queryByTestId("external-move-overlay")).toBeTruthy();
    expect(within(getColumn("Pending")).queryByText("Move me via CLI")).toBeTruthy();

    await waitForTaskInColumn("Move me via CLI", "Started");

    expect(within(getColumn("Pending")).queryByText("Move me via CLI")).toBeNull();
    expect(within(getColumn("Started")).queryByText("Move me via CLI")).toBeTruthy();
  });

  it("animates each transitioned task when multiple tasks change in one refresh", async () => {
    vi.useFakeTimers();
    let fetchCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return jsonResponse([
          {
            id: "task-1",
            title: "Task One",
            status: "PENDING",
            position: 1000,
            version: 1,
          },
          {
            id: "task-2",
            title: "Task Two",
            status: "PENDING",
            position: 2000,
            version: 1,
          },
        ]);
      }

      return jsonResponse([
        {
          id: "task-1",
          title: "Task One",
          status: "STARTED",
          position: 1000,
          version: 2,
        },
        {
          id: "task-2",
          title: "Task Two",
          status: "STARTED",
          position: 2000,
          version: 2,
        },
      ]);
    });

    render(<App />);

    await act(async () => {
      await flushMicrotasks();
    });

    expect(within(getColumn("Pending")).queryByText("Task One")).toBeTruthy();
    expect(within(getColumn("Pending")).queryByText("Task Two")).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(REFRESH_INTERVAL_MS);
      await flushMicrotasks();
    });

    expect(screen.queryByTestId("external-move-overlay")).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(EXTERNAL_MOVE_ANIMATION_MS);
      await flushMicrotasks();
    });

    const startedAfterFirstCycle = [
      within(getColumn("Started")).queryByText("Task One"),
      within(getColumn("Started")).queryByText("Task Two"),
    ].filter(Boolean);
    const pendingAfterFirstCycle = [
      within(getColumn("Pending")).queryByText("Task One"),
      within(getColumn("Pending")).queryByText("Task Two"),
    ].filter(Boolean);

    expect(startedAfterFirstCycle.length).toBeLessThan(2);
    expect(pendingAfterFirstCycle.length).toBeGreaterThan(0);

    await waitForTaskInColumn("Task One", "Started");
    await waitForTaskInColumn("Task Two", "Started");

    expect(within(getColumn("Pending")).queryByText("Task One")).toBeNull();
    expect(within(getColumn("Pending")).queryByText("Task Two")).toBeNull();
    expect(within(getColumn("Started")).queryByText("Task One")).toBeTruthy();
    expect(within(getColumn("Started")).queryByText("Task Two")).toBeTruthy();
  });
});
