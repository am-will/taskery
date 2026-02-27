// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const flushMicrotasks = async () => {
  await Promise.resolve();
};

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
      await flushMicrotasks();
    });
    expect(screen.getByTestId("sync-indicator").getAttribute("data-sync-status")).toBe(
      "stale",
    );

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await flushMicrotasks();
    });

    expect(screen.getByTestId("sync-indicator").getAttribute("data-sync-status")).toBe(
      "synced",
    );
  });

  it("shows syncing while retrying after stale, then returns to synced on recovery", async () => {
    vi.useFakeTimers();
    let resolveRetry: ((response: Response) => void) | null = null;
    const retryPromise = new Promise<Response>((resolve) => {
      resolveRetry = resolve;
    });

    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    fetchMock.mockReturnValueOnce(retryPromise);

    render(<App />);

    await act(async () => {
      await flushMicrotasks();
    });
    expect(screen.getByTestId("sync-indicator").getAttribute("data-sync-status")).toBe(
      "stale",
    );

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await flushMicrotasks();
    });
    expect(screen.getByTestId("sync-indicator").getAttribute("data-sync-status")).toBe(
      "syncing",
    );

    await act(async () => {
      resolveRetry?.(
        new Response(JSON.stringify({ tasks: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      await flushMicrotasks();
    });
    expect(screen.getByTestId("sync-indicator").getAttribute("data-sync-status")).toBe(
      "synced",
    );
  });

  it("recovers from overlapping strict-mode refresh and continues polling", async () => {
    vi.useFakeTimers();
    let resolveInitial: ((response: Response) => void) | null = null;
    const initialFetch = new Promise<Response>((resolve) => {
      resolveInitial = resolve;
    });

    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockReturnValueOnce(initialFetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ tasks: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await act(async () => {
      resolveInitial?.(
        new Response(JSON.stringify({ tasks: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      await flushMicrotasks();
    });

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await flushMicrotasks();
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("sync-indicator").getAttribute("data-sync-status")).toBe(
      "synced",
    );
  });
});
