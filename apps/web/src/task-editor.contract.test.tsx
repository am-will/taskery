// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
});
