// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("task editor contract", () => {
  it("renders create/edit task controls with required fields", () => {
    render(<App />);

    expect(screen.getByRole("button", { name: /new task/i })).toBeTruthy();
    expect(screen.getByLabelText(/title/i)).toBeTruthy();
    expect(screen.getByLabelText(/priority/i)).toBeTruthy();
    expect(screen.getByLabelText(/due date/i)).toBeTruthy();
    expect(screen.getByLabelText(/assignee/i)).toBeTruthy();
    expect(screen.getByLabelText(/notes/i)).toBeTruthy();
  });
});
