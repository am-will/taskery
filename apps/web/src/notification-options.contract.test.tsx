// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";

const taskSnapshot = {
  tasks: [],
  notificationSettings: {
    enabled: true,
    dailyEnabled: true,
    dailyHours: [10, 13],
    weeklyEnabled: true,
    weeklyDay: 1,
    weeklyHour: 10,
    windowMinutes: 15,
    updatedAt: "2026-03-01T12:00:00.000Z",
  },
};

describe("notification options contract", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("persists settings changes through the notification settings endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    let patchPayload: Record<string, unknown> | null = null;

    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/tasks") && method === "GET") {
        return new Response(JSON.stringify(taskSnapshot), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.endsWith("/api/settings/notifications") && method === "PATCH") {
        patchPayload = JSON.parse((init?.body ?? "{}") as string) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            settings: {
              ...taskSnapshot.notificationSettings,
              dailyHours: [9, 14],
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response("{}", { status: 404 });
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /options/i }));
    fireEvent.change(screen.getByLabelText(/daily hours/i), {
      target: { value: "9,14" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(patchPayload).toEqual({ dailyHours: [9, 14] });
    });
  });
});
