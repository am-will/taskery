export const TASK_STATUS_VALUES = [
  "PENDING",
  "STARTED",
  "BLOCKED",
  "REVIEW",
  "COMPLETE",
] as const;

export type TaskStatus = (typeof TASK_STATUS_VALUES)[number];

export const TASK_PRIORITY_VALUES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export type TaskPriority = (typeof TASK_PRIORITY_VALUES)[number];

export const POSITION_STEP = 1000;
export const MIN_POSITION = POSITION_STEP;

export const INITIAL_TASK_VERSION = 1;
export const DEFAULT_REMINDER_WINDOW_MINUTES = 15;
export const DEFAULT_DAILY_REMINDER_HOURS = [10, 13] as const;
export const DEFAULT_WEEKLY_REMINDER_DAY = 1;
export const DEFAULT_WEEKLY_REMINDER_HOUR = 10;

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  assignee: string | null;
  notes: string | null;
  position: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

type TaskTransitionPolicy = {
  readonly [K in TaskStatus]: readonly TaskStatus[];
};

export const TASK_TRANSITION_POLICY: TaskTransitionPolicy = {
  PENDING: ["PENDING", "STARTED", "BLOCKED", "REVIEW", "COMPLETE"],
  STARTED: ["PENDING", "STARTED", "BLOCKED", "REVIEW", "COMPLETE"],
  BLOCKED: ["PENDING", "STARTED", "BLOCKED", "REVIEW", "COMPLETE"],
  REVIEW: ["PENDING", "STARTED", "BLOCKED", "REVIEW", "COMPLETE"],
  COMPLETE: ["PENDING", "STARTED", "BLOCKED", "REVIEW", "COMPLETE"],
};

export function isTransitionAllowed(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITION_POLICY[from].includes(to);
}

export function getNextPosition(positions: readonly number[]): number {
  if (positions.length === 0) {
    return MIN_POSITION;
  }

  const maxPosition = Math.max(...positions);
  return maxPosition + POSITION_STEP;
}

export function normalizePosition(position: number): number {
  if (!Number.isInteger(position) || position < MIN_POSITION) {
    throw new Error("position must be an integer greater than or equal to 1000");
  }

  return position;
}

export function normalizeVersion(version: number): number {
  if (!Number.isInteger(version) || version < INITIAL_TASK_VERSION) {
    throw new Error("version must be a positive integer");
  }

  return version;
}

export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  TASK_NOT_FOUND: "TASK_NOT_FOUND",
  VERSION_CONFLICT: "VERSION_CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type TaskErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface TaskErrorEnvelope {
  code: TaskErrorCode;
  message: string;
  details?: unknown;
}

export function buildTaskError(
  code: TaskErrorCode,
  message: string,
  details?: unknown,
): TaskErrorEnvelope {
  const envelope: TaskErrorEnvelope = { code, message };
  if (details !== undefined) {
    envelope.details = details;
  }

  return envelope;
}

type Schema<T> = {
  parse(input: unknown): T;
};

type TaskCreateInput = {
  title: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt?: string | null;
  assignee?: string | null;
  notes?: string | null;
  position?: number;
};

type TaskUpdateInput = {
  title?: string;
  priority?: TaskPriority;
  dueAt?: string | null;
  assignee?: string | null;
  notes?: string | null;
  expectedVersion?: number;
};

type TaskMoveInput = {
  toStatus: TaskStatus;
  toPosition?: number;
  expectedVersion: number;
};

type TaskDeleteInput = {
  expectedVersion: number;
};

export type NotificationScheduleConfig = {
  enabled: boolean;
  dailyEnabled: boolean;
  dailyHours: number[];
  weeklyEnabled: boolean;
  weeklyDay: number;
  weeklyHour: number;
  windowMinutes: number;
};

export type NotificationSettings = NotificationScheduleConfig & {
  updatedAt: string | null;
};

type NotificationSettingsUpdateInput = {
  enabled?: boolean;
  dailyEnabled?: boolean;
  dailyHours?: number[];
  weeklyEnabled?: boolean;
  weeklyDay?: number;
  weeklyHour?: number;
  windowMinutes?: number;
};

export const DEFAULT_NOTIFICATION_SCHEDULE_CONFIG: NotificationScheduleConfig = {
  enabled: true,
  dailyEnabled: true,
  dailyHours: [...DEFAULT_DAILY_REMINDER_HOURS],
  weeklyEnabled: true,
  weeklyDay: DEFAULT_WEEKLY_REMINDER_DAY,
  weeklyHour: DEFAULT_WEEKLY_REMINDER_HOUR,
  windowMinutes: DEFAULT_REMINDER_WINDOW_MINUTES,
};

const STATUS_SET = new Set<string>(TASK_STATUS_VALUES);
const PRIORITY_SET = new Set<string>(TASK_PRIORITY_VALUES);

function expectObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("input must be an object");
  }

  return value as Record<string, unknown>;
}

function parseNonEmptyTrimmedString(
  value: unknown,
  field: string,
  maxLength = 255,
): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${field} cannot be empty`);
  }

  if (trimmed.length > maxLength) {
    throw new Error(`${field} exceeds max length of ${maxLength}`);
  }

  return trimmed;
}

function parseNullableString(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${field} must be a string or null`);
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`${field} exceeds max length of ${maxLength}`);
  }

  return trimmed;
}

function parseStatus(value: unknown, field: string): TaskStatus {
  if (typeof value !== "string" || !STATUS_SET.has(value)) {
    throw new Error(`${field} must be a valid task status`);
  }

  return value as TaskStatus;
}

function parsePriority(value: unknown, field: string): TaskPriority {
  if (typeof value !== "string" || !PRIORITY_SET.has(value)) {
    throw new Error(`${field} must be a valid task priority`);
  }

  return value as TaskPriority;
}

function parseOptionalPosition(value: unknown, field: string): number {
  if (typeof value !== "number") {
    throw new Error(`${field} must be a number`);
  }

  return normalizePosition(value);
}

function parseIsoDateString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${field} must be a string or null`);
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`${field} must be an ISO-8601 date string`);
  }

  return value;
}

function parseIntegerRange(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${field} must be an integer`);
  }
  if (value < minimum || value > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

function parseDailyHours(value: unknown, field: string): number[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array of integers`);
  }
  if (value.length === 0) {
    throw new Error(`${field} must contain at least one hour`);
  }

  const parsed = value.map((entry) => parseIntegerRange(entry, `${field}[]`, 0, 23));
  const uniqueSorted = Array.from(new Set(parsed)).sort((left, right) => left - right);
  return uniqueSorted;
}

export const taskCreateInputSchema: Schema<TaskCreateInput> = {
  parse(input: unknown): TaskCreateInput {
    const object = expectObject(input);

    const title = parseNonEmptyTrimmedString(object.title, "title", 200);
    const priority =
      object.priority === undefined
        ? "MEDIUM"
        : parsePriority(object.priority, "priority");
    const status =
      object.status === undefined ? "PENDING" : parseStatus(object.status, "status");

    const output: TaskCreateInput = {
      title,
      priority,
      status,
    };

    if (object.dueAt !== undefined) {
      output.dueAt = parseIsoDateString(object.dueAt, "dueAt");
    }
    if (object.assignee !== undefined) {
      output.assignee = parseNullableString(object.assignee, "assignee", 120);
    }
    if (object.notes !== undefined) {
      output.notes = parseNullableString(object.notes, "notes", 5000);
    }
    if (object.position !== undefined) {
      output.position = parseOptionalPosition(object.position, "position");
    }

    return output;
  },
};

export const taskUpdateInputSchema: Schema<TaskUpdateInput> = {
  parse(input: unknown): TaskUpdateInput {
    const object = expectObject(input);
    const output: TaskUpdateInput = {};

    if (object.title !== undefined) {
      output.title = parseNonEmptyTrimmedString(object.title, "title", 200);
    }
    if (object.priority !== undefined) {
      output.priority = parsePriority(object.priority, "priority");
    }
    if (object.dueAt !== undefined) {
      output.dueAt = parseIsoDateString(object.dueAt, "dueAt");
    }
    if (object.assignee !== undefined) {
      output.assignee = parseNullableString(object.assignee, "assignee", 120);
    }
    if (object.notes !== undefined) {
      output.notes = parseNullableString(object.notes, "notes", 5000);
    }
    if (object.expectedVersion !== undefined) {
      if (typeof object.expectedVersion !== "number") {
        throw new Error("expectedVersion must be a number");
      }
      output.expectedVersion = normalizeVersion(object.expectedVersion);
    }

    if (Object.keys(output).length === 0) {
      throw new Error("update payload must include at least one field");
    }

    return output;
  },
};

export const taskMoveInputSchema: Schema<TaskMoveInput> = {
  parse(input: unknown): TaskMoveInput {
    const object = expectObject(input);

    if (object.expectedVersion === undefined) {
      throw new Error("expectedVersion is required");
    }
    if (typeof object.expectedVersion !== "number") {
      throw new Error("expectedVersion must be a number");
    }

    const toStatus = parseStatus(object.toStatus, "toStatus");
    const output: TaskMoveInput = {
      toStatus,
      expectedVersion: normalizeVersion(object.expectedVersion),
    };

    if (object.toPosition !== undefined) {
      output.toPosition = parseOptionalPosition(object.toPosition, "toPosition");
    }

    return output;
  },
};

export const taskDeleteInputSchema: Schema<TaskDeleteInput> = {
  parse(input: unknown): TaskDeleteInput {
    const object = expectObject(input);

    if (object.expectedVersion === undefined) {
      throw new Error("expectedVersion is required");
    }
    if (typeof object.expectedVersion !== "number") {
      throw new Error("expectedVersion must be a number");
    }

    return {
      expectedVersion: normalizeVersion(object.expectedVersion),
    };
  },
};

export const notificationScheduleConfigSchema: Schema<NotificationScheduleConfig> = {
  parse(input: unknown): NotificationScheduleConfig {
    const object = expectObject(input);
    return {
      enabled: parseBoolean(object.enabled, "enabled"),
      dailyEnabled: parseBoolean(object.dailyEnabled, "dailyEnabled"),
      dailyHours: parseDailyHours(object.dailyHours, "dailyHours"),
      weeklyEnabled: parseBoolean(object.weeklyEnabled, "weeklyEnabled"),
      weeklyDay: parseIntegerRange(object.weeklyDay, "weeklyDay", 0, 6),
      weeklyHour: parseIntegerRange(object.weeklyHour, "weeklyHour", 0, 23),
      windowMinutes: parseIntegerRange(object.windowMinutes, "windowMinutes", 1, 60),
    };
  },
};

export const notificationSettingsUpdateInputSchema: Schema<NotificationSettingsUpdateInput> = {
  parse(input: unknown): NotificationSettingsUpdateInput {
    const object = expectObject(input);
    const output: NotificationSettingsUpdateInput = {};

    if (object.enabled !== undefined) {
      output.enabled = parseBoolean(object.enabled, "enabled");
    }
    if (object.dailyEnabled !== undefined) {
      output.dailyEnabled = parseBoolean(object.dailyEnabled, "dailyEnabled");
    }
    if (object.dailyHours !== undefined) {
      output.dailyHours = parseDailyHours(object.dailyHours, "dailyHours");
    }
    if (object.weeklyEnabled !== undefined) {
      output.weeklyEnabled = parseBoolean(object.weeklyEnabled, "weeklyEnabled");
    }
    if (object.weeklyDay !== undefined) {
      output.weeklyDay = parseIntegerRange(object.weeklyDay, "weeklyDay", 0, 6);
    }
    if (object.weeklyHour !== undefined) {
      output.weeklyHour = parseIntegerRange(object.weeklyHour, "weeklyHour", 0, 23);
    }
    if (object.windowMinutes !== undefined) {
      output.windowMinutes = parseIntegerRange(object.windowMinutes, "windowMinutes", 1, 60);
    }

    if (Object.keys(output).length === 0) {
      throw new Error("settings update payload must include at least one field");
    }

    return output;
  },
};

export type {
  NotificationSettingsUpdateInput,
  TaskCreateInput,
  TaskDeleteInput,
  TaskMoveInput,
  TaskUpdateInput,
};
