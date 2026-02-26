// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("desktop kanban shell", () => {
  it("renders dark board container with all workflow columns", () => {
    render(<App />);

    expect(screen.getByTestId("board-shell").getAttribute("data-theme")).toBe(
      "industrial-dark",
    );

    for (const column of ["Pending", "Started", "Blocked", "Review", "Complete"]) {
      expect(screen.getByRole("heading", { name: column })).toBeTruthy();
    }
  });
});
