import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_SCHEDULE_CONFIG,
  ERROR_CODES,
  INITIAL_TASK_VERSION,
  MIN_POSITION,
  POSITION_STEP,
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  TASK_TRANSITION_POLICY,
  buildTaskError,
  getNextPosition,
  isTransitionAllowed,
  normalizePosition,
  normalizeVersion,
  notificationScheduleConfigSchema,
  notificationSettingsUpdateInputSchema,
  taskCreateInputSchema,
  taskDeleteInputSchema,
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
    expect(isTransitionAllowed("BLOCKED", "PENDING")).toBe(true);
    expect(isTransitionAllowed("REVIEW", "PENDING")).toBe(true);
    expect(isTransitionAllowed("COMPLETE", "PENDING")).toBe(true);
    expect(isTransitionAllowed("COMPLETE", "COMPLETE")).toBe(true);
    expect(TASK_TRANSITION_POLICY.COMPLETE).toEqual([
      "PENDING",
      "STARTED",
      "BLOCKED",
      "REVIEW",
      "COMPLETE",
    ]);
  });

  it("calculates next position from ordered and unordered values", () => {
    expect(getNextPosition([])).toBe(POSITION_STEP);
    expect(getNextPosition([POSITION_STEP, POSITION_STEP * 2])).toBe(
      POSITION_STEP * 3,
    );
    expect(
      getNextPosition([POSITION_STEP * 3, POSITION_STEP, POSITION_STEP * 2]),
    ).toBe(POSITION_STEP * 4);
    expect(
      getNextPosition([
        POSITION_STEP * 3,
        POSITION_STEP * 2,
        POSITION_STEP * 3,
        POSITION_STEP,
      ]),
    ).toBe(POSITION_STEP * 4);
  });

  it("validates create, move, update and delete DTOs", () => {
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
        expectedVersion: INITIAL_TASK_VERSION,
      }),
    ).toMatchObject({
      assignee: "will",
      notes: "follow-up",
      expectedVersion: INITIAL_TASK_VERSION,
    });

    expect(() => taskUpdateInputSchema.parse({})).toThrowError();

    expect(
      taskDeleteInputSchema.parse({
        expectedVersion: INITIAL_TASK_VERSION,
      }),
    ).toMatchObject({
      expectedVersion: INITIAL_TASK_VERSION,
    });

    expect(() => taskDeleteInputSchema.parse({})).toThrowError();
    expect(() =>
      taskDeleteInputSchema.parse({
        expectedVersion: "1",
      }),
    ).toThrowError();
  });

  it("validates optimistic concurrency and position primitives", () => {
    expect(normalizeVersion(INITIAL_TASK_VERSION)).toBe(INITIAL_TASK_VERSION);
    expect(normalizeVersion(INITIAL_TASK_VERSION + 1)).toBe(
      INITIAL_TASK_VERSION + 1,
    );
    expect(() => normalizeVersion(0)).toThrowError();
    expect(() => normalizeVersion(1.2)).toThrowError();
    expect(normalizePosition(MIN_POSITION)).toBe(MIN_POSITION);
    expect(normalizePosition(POSITION_STEP)).toBe(POSITION_STEP);
    expect(() => normalizePosition(999)).toThrowError();
    expect(() => normalizePosition(POSITION_STEP + 1)).not.toThrowError();
    expect(() => normalizePosition(1000.5)).toThrowError();
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

  it("validates notification settings defaults and update payloads", () => {
    expect(
      notificationScheduleConfigSchema.parse({
        ...DEFAULT_NOTIFICATION_SCHEDULE_CONFIG,
      }),
    ).toEqual(DEFAULT_NOTIFICATION_SCHEDULE_CONFIG);

    expect(
      notificationSettingsUpdateInputSchema.parse({
        enabled: false,
        dailyHours: [13, 10, 13],
        weeklyDay: 5,
      }),
    ).toEqual({
      enabled: false,
      dailyHours: [10, 13],
      weeklyDay: 5,
    });

    expect(() => notificationSettingsUpdateInputSchema.parse({})).toThrowError();
    expect(() =>
      notificationSettingsUpdateInputSchema.parse({
        dailyHours: ["10"],
      }),
    ).toThrowError();
    expect(() =>
      notificationScheduleConfigSchema.parse({
        ...DEFAULT_NOTIFICATION_SCHEDULE_CONFIG,
        weeklyHour: 24,
      }),
    ).toThrowError();
  });
});
