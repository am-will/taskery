// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "./App";

describe("task editor contract", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders create/edit task controls with required fields", () => {
    render(<App />);

    expect(screen.getByRole("button", { name: /new task/i })).toBeTruthy();
    expect(screen.getByLabelText(/title/i)).toBeTruthy();
    expect(screen.getByLabelText(/priority/i)).toBeTruthy();
    expect(screen.getByLabelText(/due date/i)).toBeTruthy();
    expect(screen.getByLabelText(/assignee/i)).toBeTruthy();
    expect(screen.getByLabelText(/notes/i)).toBeTruthy();
  });

  it("updates draft fields and clears values when creating a new task", () => {
    render(<App />);

    const titleInput = screen.getByLabelText(/title/i) as HTMLInputElement;
    const prioritySelect = screen.getByLabelText(/priority/i) as HTMLSelectElement;
    const notesInput = screen.getByLabelText(/notes/i) as HTMLTextAreaElement;

    fireEvent.change(titleInput, { target: { value: "Ship regression tests" } });
    fireEvent.change(prioritySelect, { target: { value: "Critical" } });
    fireEvent.change(notesInput, { target: { value: "Cover stale sync recovery." } });

    expect(titleInput.value).toBe("Ship regression tests");
    expect(prioritySelect.value).toBe("Critical");
    expect(notesInput.value).toBe("Cover stale sync recovery.");

    fireEvent.click(screen.getByRole("button", { name: /new task/i }));

    expect(titleInput.value).toBe("");
    expect(prioritySelect.value).toBe("Medium");
    expect(notesInput.value).toBe("");
  });
});
