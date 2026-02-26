import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  INITIAL_TASK_VERSION,
  POSITION_STEP,
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  buildTaskError,
  getNextPosition,
  isTransitionAllowed,
  normalizePosition,
  normalizeVersion,
  taskCreateInputSchema,
  taskMoveInputSchema,
  taskUpdateInputSchema,
} from "./index.js";

describe("task domain contracts", () => {
  it("exposes canonical statuses and priorities", () => {
    expect(TASK_STATUS_VALUES).toEqual([
      "PENDING",
      "STARTED",
      "BLOCKED",
      "REVIEW",
      "COMPLETE",
    ]);

    expect(TASK_PRIORITY_VALUES).toEqual(["LOW", "MEDIUM", "HIGH", "URGENT"]);
  });

  it("enforces transition policy", () => {
    expect(isTransitionAllowed("PENDING", "STARTED")).toBe(true);
    expect(isTransitionAllowed("STARTED", "COMPLETE")).toBe(true);
    expect(isTransitionAllowed("COMPLETE", "PENDING")).toBe(false);
    expect(isTransitionAllowed("COMPLETE", "COMPLETE")).toBe(true);
  });

  it("calculates next position from ordered and unordered values", () => {
    expect(getNextPosition([])).toBe(POSITION_STEP);
    expect(getNextPosition([POSITION_STEP, POSITION_STEP * 2])).toBe(
      POSITION_STEP * 3,
    );
    expect(
      getNextPosition([POSITION_STEP * 3, POSITION_STEP, POSITION_STEP * 2]),
    ).toBe(POSITION_STEP * 4);
  });

  it("validates create, move and update DTOs", () => {
    expect(
      taskCreateInputSchema.parse({
        title: "Write release notes",
        priority: "HIGH",
      }),
    ).toMatchObject({
      title: "Write release notes",
      priority: "HIGH",
      status: "PENDING",
    });

    expect(
      taskCreateInputSchema.parse({
        title: "   keep text trimmed   ",
      }),
    ).toMatchObject({
      title: "keep text trimmed",
      priority: "MEDIUM",
      status: "PENDING",
    });

    expect(() =>
      taskMoveInputSchema.parse({
        toStatus: "NOPE",
        expectedVersion: 2,
      }),
    ).toThrowError();

    expect(() =>
      taskMoveInputSchema.parse({
        toStatus: "STARTED",
      }),
    ).toThrowError();

    expect(
      taskUpdateInputSchema.parse({
        assignee: "will",
        notes: "follow-up",
      }),
    ).toMatchObject({
      assignee: "will",
      notes: "follow-up",
    });
  });

  it("validates optimistic concurrency and position primitives", () => {
    expect(normalizeVersion(INITIAL_TASK_VERSION)).toBe(INITIAL_TASK_VERSION);
    expect(() => normalizeVersion(0)).toThrowError();
    expect(normalizePosition(POSITION_STEP)).toBe(POSITION_STEP);
    expect(() => normalizePosition(999)).toThrowError();
  });

  it("builds stable API/CLI error envelopes", () => {
    const error = buildTaskError(
      ERROR_CODES.VERSION_CONFLICT,
      "Version mismatch",
      { expected: 3, actual: 4 },
    );

    expect(error).toEqual({
      code: "VERSION_CONFLICT",
      message: "Version mismatch",
      details: { expected: 3, actual: 4 },
    });
  });
});
