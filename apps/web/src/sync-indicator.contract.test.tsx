// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

describe("board sync indicator", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("renders a sync status indicator for cli-originated updates", () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ tasks: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<App />);

    const indicator = screen.getByTestId("sync-indicator");
    expect(indicator).toBeTruthy();
    expect(indicator.textContent?.toLowerCase()).toContain("sync");
  });

  it("clears stale sync state after a successful refresh", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ tasks: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<App />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("sync-indicator").getAttribute("data-sync-status")).toBe(
      "stale",
    );

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(screen.getByTestId("sync-indicator").getAttribute("data-sync-status")).toBe(
      "synced",
    );
  });
});
