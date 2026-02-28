// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "./App";

const jsonResponse = (tasks: unknown[]) =>
  new Response(JSON.stringify({ tasks }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("task hover popup contract", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows a task details popup after 500ms hover and hides on mouse leave", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse([
        {
          id: "task-1",
          title: "Draft AI newsletter kickoff brief",
          status: "PENDING",
          priority: "HIGH",
          dueAt: "2026-03-20T17:00:00.000Z",
          assignee: "Gabriela Gomez Miranda",
          notes: "Include timeline and owner mapping",
          position: 1000,
          version: 1,
        },
      ]),
    );

    render(<App />);

    await act(async () => {
      await Promise.resolve();
    });
    const card = screen.getByTestId("task-card-task-1");
    fireEvent.mouseEnter(card);

    expect(screen.queryByTestId("task-hover-popup-task-1")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(499);
    });
    expect(screen.queryByTestId("task-hover-popup-task-1")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    const popup = screen.getByTestId("task-hover-popup-task-1");
    const popupQueries = within(popup);
    expect(popupQueries.getByText("Task Details")).toBeTruthy();
    expect(popupQueries.getByText("Title")).toBeTruthy();
    expect(popupQueries.getByText("Priority")).toBeTruthy();
    expect(popupQueries.getByText("Due Date")).toBeTruthy();
    expect(popupQueries.getByText("Assignee")).toBeTruthy();
    expect(popupQueries.getByText("Notes")).toBeTruthy();
    expect(popupQueries.getByText("Draft AI newsletter kickoff brief")).toBeTruthy();
    expect(popupQueries.getByText("High")).toBeTruthy();
    expect(popupQueries.getByText("Gabriela Gomez Miranda")).toBeTruthy();
    expect(popupQueries.getByText("Include timeline and owner mapping")).toBeTruthy();

    fireEvent.mouseLeave(card);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("task-hover-popup-task-1")).toBeNull();
  });

  it("flips popup to the left when hovering cards near the right edge", async () => {
    vi.useFakeTimers();
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1000,
      writable: true,
    });
    try {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse([
          {
            id: "task-1",
            title: "Right edge hover card",
            status: "COMPLETE",
            priority: "MEDIUM",
            dueAt: null,
            assignee: null,
            notes: null,
            position: 1000,
            version: 1,
          },
        ]),
      );

      const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
      rectSpy.mockImplementation(function mockRect(this: HTMLElement) {
        if (this.getAttribute("data-testid") === "task-card-task-1") {
          return {
            x: 900,
            y: 80,
            width: 80,
            height: 72,
            top: 80,
            right: 980,
            bottom: 152,
            left: 900,
            toJSON: () => ({}),
          } as DOMRect;
        }

        return {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          toJSON: () => ({}),
        } as DOMRect;
      });

      render(<App />);

      await act(async () => {
        await Promise.resolve();
      });

      const card = screen.getByTestId("task-card-task-1");
      fireEvent.mouseEnter(card);

      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
      });

      expect(screen.getByTestId("task-hover-popup-task-1").className).toContain(
        "is-flipped-left",
      );
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
        writable: true,
      });
    }
  });
});
