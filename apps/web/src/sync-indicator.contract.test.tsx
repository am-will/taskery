// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("board sync indicator", () => {
  it("renders a sync status indicator for cli-originated updates", () => {
    render(<App />);

    const indicator = screen.getByTestId("sync-indicator");
    expect(indicator).toBeTruthy();
    expect(indicator.textContent?.toLowerCase()).toContain("sync");
  });
});
