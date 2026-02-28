// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "./App";

const jsonResponse = (tasks: unknown[]) =>
  new Response(JSON.stringify({ tasks }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("task editor contract", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders create/edit task controls with required fields", () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([]));

    render(<App />);

    expect(screen.queryByRole("button", { name: /new task/i })).toBeNull();
    const saveButton = screen.getByRole("button", { name: /save task/i });
    expect(saveButton.getAttribute("form")).toBe("task-editor-form");
    expect(saveButton.className).toContain("editor-save-button");
    expect(screen.getByLabelText(/title/i)).toBeTruthy();
    expect(screen.getByLabelText(/priority/i)).toBeTruthy();
    expect(screen.getByLabelText(/due date/i)).toBeTruthy();
    expect(screen.getByLabelText(/assignee/i)).toBeTruthy();
    expect(screen.getByLabelText(/notes/i)).toBeTruthy();
  });

  it("renders a delete control per card and removes card content when clicked", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: "task-1",
            title: "Ship regression tests",
            status: "PENDING",
            position: 1000,
            version: 1,
          },
        ]),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            task: {
              id: "task-1",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(jsonResponse([]));

    render(<App />);

    await screen.findByText("Ship regression tests");
    const deleteButton = await screen.findByRole("button", {
      name: /delete task ship regression tests/i,
    });

    fireEvent.pointerDown(deleteButton);
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(screen.queryByText("Ship regression tests")).toBeNull();
    });

    const deleteCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        typeof url === "string" &&
        url.endsWith("/api/tasks/task-1") &&
        init !== undefined &&
        init.method === "DELETE",
    );
    expect(deleteCall).toBeTruthy();
    const requestInit = deleteCall?.[1];
    expect(typeof requestInit?.body).toBe("string");
    expect(JSON.parse(requestInit?.body as string)).toEqual({
      expectedVersion: 1,
    });
  });

  it("opens modal on card click and persists full detail edits", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    let patchPayload: Record<string, unknown> | null = null;
    let movePayload: Record<string, unknown> | null = null;
    let tasksGetCount = 0;

    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/api/tasks") && method === "GET") {
        tasksGetCount += 1;
        if (tasksGetCount === 1) {
          return jsonResponse([
            {
              id: "task-1",
              title: "Ship regression tests",
              status: "PENDING",
              priority: "MEDIUM",
              dueAt: "2026-03-18T17:00:00.000Z",
              assignee: "Taylor",
              notes: "Original notes",
              position: 1000,
              version: 3,
            },
          ]);
        }

        return jsonResponse([
          {
            id: "task-1",
            title: "Ship full editor regression tests",
            status: "STARTED",
            priority: "URGENT",
            dueAt: "2026-03-20T17:00:00.000Z",
            assignee: "Grace Hopper",
            notes: "Updated notes",
            position: 1000,
            version: 7,
          },
        ]);
      }

      if (url.endsWith("/api/tasks/task-1") && method === "PATCH") {
        patchPayload = JSON.parse((init?.body ?? "{}") as string) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            task: {
              id: "task-1",
              version: 7,
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url.endsWith("/api/tasks/task-1/move") && method === "POST") {
        movePayload = JSON.parse((init?.body ?? "{}") as string) as Record<string, unknown>;
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response("{}", { status: 404 });
    });

    render(<App />);

    const card = await screen.findByTestId("task-card-task-1");
    fireEvent.click(card);

    const dialog = await screen.findByRole("dialog", { name: /edit task details/i });
    const dialogQueries = within(dialog);
    fireEvent.change(dialogQueries.getByLabelText(/status/i), {
      target: { value: "STARTED" },
    });
    fireEvent.change(dialogQueries.getByLabelText(/title/i), {
      target: { value: "Ship full editor regression tests" },
    });
    fireEvent.change(dialogQueries.getByLabelText(/priority/i), {
      target: { value: "Critical" },
    });
    fireEvent.change(dialogQueries.getByLabelText(/due date/i), {
      target: { value: "2026-03-20" },
    });
    fireEvent.change(dialogQueries.getByLabelText(/assignee/i), {
      target: { value: "Grace Hopper" },
    });
    fireEvent.change(dialogQueries.getByLabelText(/notes/i), {
      target: { value: "Updated notes" },
    });
    fireEvent.click(dialogQueries.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /edit task details/i })).toBeNull();
    });

    expect(patchPayload).toEqual({
      title: "Ship full editor regression tests",
      priority: "URGENT",
      dueAt: "2026-03-20T17:00:00.000Z",
      assignee: "Grace Hopper",
      notes: "Updated notes",
      expectedVersion: 3,
    });
    expect(movePayload).toEqual({
      toStatus: "STARTED",
      toPosition: 1000,
      expectedVersion: 7,
    });
    expect(tasksGetCount).toBeGreaterThanOrEqual(2);
  });
});
