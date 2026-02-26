import { ERROR_CODES, type Task, type TaskErrorCode } from "@taskboard/shared";

const EXIT_CODE_SUCCESS = 0;
const EXIT_CODE_INTERNAL = 1;
const EXIT_CODE_VALIDATION = 2;
const EXIT_CODE_NOT_FOUND = 3;
const EXIT_CODE_CONFLICT = 4;

const DEFAULT_API_BASE_URL = "http://127.0.0.1:4010";

type CommandName = "create" | "list" | "show" | "update" | "move";

type ParsedArgs = {
  json: boolean;
  command: CommandName | null;
  positional: string[];
  flags: Map<string, string | boolean>;
};

type CliSuccess = {
  ok: true;
  value: unknown;
};

type CliFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  exitCode: number;
};

type CliResult = CliSuccess | CliFailure;

type ApiErrorEnvelope = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
};

type ApiTasksResponse = {
  tasks: Task[];
};

type ApiTaskResponse = {
  task: Task;
};

function resolveApiBaseUrl(): string {
  const rawBaseUrl = process.env.CLI_API_BASE_URL ?? process.env.API_BASE_URL ?? DEFAULT_API_BASE_URL;
  return rawBaseUrl.endsWith("/") ? rawBaseUrl.slice(0, -1) : rawBaseUrl;
}

function parseArgs(argv: string[]): ParsedArgs {
  let json = false;
  let command: CommandName | null = null;
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "-h" || token === "--help") {
      flags.set("help", true);
      continue;
    }

    if (token.startsWith("--")) {
      const maybeInlineValueIndex = token.indexOf("=");
      if (maybeInlineValueIndex >= 0) {
        const key = token.slice(2, maybeInlineValueIndex);
        const value = token.slice(maybeInlineValueIndex + 1);
        flags.set(key, value);
        continue;
      }

      const key = token.slice(2);
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(key, next);
        index += 1;
        continue;
      }

      flags.set(key, true);
      continue;
    }

    if (command === null) {
      if (isCommandName(token)) {
        command = token;
      } else {
        positional.push(token);
      }
      continue;
    }

    positional.push(token);
  }

  return { json, command, positional, flags };
}

function isCommandName(value: string): value is CommandName {
  return value === "create" || value === "list" || value === "show" || value === "update" || value === "move";
}

function buildHelpText(): string {
  return [
    "taskboard CLI",
    "",
    "Usage:",
    "  taskboard [--json] <command> [arguments] [--flags]",
    "",
    "Commands:",
    "  create   Create a task",
    "  list     List tasks",
    "  show     Show one task",
    "  update   Update a task",
    "  move     Move a task between statuses",
    "",
    "Global flags:",
    "  --json   Emit machine-readable JSON output",
    "  --help   Show help",
    "",
    "Examples:",
    "  taskboard create \"Ship CLI\" --priority HIGH",
    "  taskboard list --status STARTED",
    "  taskboard show task_123",
    "  taskboard update task_123 --title \"Rename\" --expectedVersion 2",
    "  taskboard move task_123 --toStatus REVIEW --expectedVersion 3",
    "",
  ].join("\n");
}

function toCliFailure(code: string, message: string, exitCode: number, details?: unknown): CliFailure {
  const failure: CliFailure = {
    ok: false,
    error: { code, message },
    exitCode,
  };

  if (details !== undefined) {
    failure.error.details = details;
  }

  return failure;
}

function readStringFlag(flags: Map<string, string | boolean>, name: string): string | undefined {
  const value = flags.get(name);
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function parseIntegerFlag(
  flags: Map<string, string | boolean>,
  name: string,
): number | CliFailure | undefined {
  const raw = readStringFlag(flags, name);
  if (raw === undefined) {
    return undefined;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    return toCliFailure(
      ERROR_CODES.VALIDATION_ERROR,
      `Flag --${name} must be an integer`,
      EXIT_CODE_VALIDATION,
    );
  }

  return parsed;
}

function parseNullableStringFlag(
  flags: Map<string, string | boolean>,
  name: string,
): string | null | undefined {
  const raw = readStringFlag(flags, name);
  if (raw === undefined) {
    return undefined;
  }
  return raw.toLowerCase() === "null" ? null : raw;
}

function parseRequiredString(
  value: string | undefined,
  field: string,
): string | CliFailure {
  if (value === undefined || value.trim().length === 0) {
    return toCliFailure(
      ERROR_CODES.VALIDATION_ERROR,
      `${field} is required`,
      EXIT_CODE_VALIDATION,
    );
  }
  return value;
}

async function callApi<T>(
  baseUrl: string,
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
): Promise<{ ok: true; value: T } | { ok: false; failure: CliFailure }> {
  const url = `${baseUrl}${path}`;

  let response: Response;
  try {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(body);
    }
    response = await fetch(url, init);
  } catch (error) {
    return {
      ok: false,
      failure: toCliFailure(
        ERROR_CODES.INTERNAL_ERROR,
        `Request failed: ${error instanceof Error ? error.message : "unknown error"}`,
        EXIT_CODE_INTERNAL,
      ),
    };
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    if (!response.ok) {
      return {
        ok: false,
        failure: toCliFailure(
          ERROR_CODES.INTERNAL_ERROR,
          `API returned status ${response.status} with non-JSON body`,
          mapStatusToExitCode(response.status, undefined),
        ),
      };
    }
  }

  if (!response.ok) {
    const errorEnvelope = payload as ApiErrorEnvelope | null;
    const code = parseErrorCode(errorEnvelope?.code);
    const message = typeof errorEnvelope?.message === "string"
      ? errorEnvelope.message
      : `API request failed with status ${response.status}`;
    return {
      ok: false,
      failure: toCliFailure(
        code ?? ERROR_CODES.INTERNAL_ERROR,
        message,
        mapStatusToExitCode(response.status, code),
        errorEnvelope?.details,
      ),
    };
  }

  return { ok: true, value: payload as T };
}

function parseErrorCode(value: unknown): TaskErrorCode | undefined {
  if (
    value === ERROR_CODES.VALIDATION_ERROR ||
    value === ERROR_CODES.TASK_NOT_FOUND ||
    value === ERROR_CODES.VERSION_CONFLICT ||
    value === ERROR_CODES.INTERNAL_ERROR
  ) {
    return value;
  }
  return undefined;
}

function mapStatusToExitCode(status: number, code: TaskErrorCode | undefined): number {
  if (code === ERROR_CODES.VALIDATION_ERROR || status === 400 || status === 405 || status === 422) {
    return EXIT_CODE_VALIDATION;
  }
  if (code === ERROR_CODES.TASK_NOT_FOUND || status === 404) {
    return EXIT_CODE_NOT_FOUND;
  }
  if (code === ERROR_CODES.VERSION_CONFLICT || status === 409) {
    return EXIT_CODE_CONFLICT;
  }
  return EXIT_CODE_INTERNAL;
}

function printResult(result: CliResult, json: boolean): void {
  if (json) {
    const payload = result.ok
      ? { ok: true, data: result.value }
      : { ok: false, error: result.error, exitCode: result.exitCode };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }

  if (!result.ok) {
    process.stderr.write(`${result.error.code}: ${result.error.message}\n`);
    return;
  }

  process.stdout.write(`${formatTextSuccess(result.value)}\n`);
}

function formatTextSuccess(value: unknown): string {
  if (isTask(value)) {
    return formatTask(value);
  }
  if (isTaskList(value)) {
    if (value.length === 0) {
      return "No tasks found.";
    }
    return value.map((task) => formatTask(task)).join("\n\n");
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function isTask(value: unknown): value is Task {
  return typeof value === "object" && value !== null && "id" in value && "title" in value && "status" in value;
}

function isTaskList(value: unknown): value is Task[] {
  return Array.isArray(value) && value.every((entry) => isTask(entry));
}

function formatTask(task: Task): string {
  const lines = [
    `id: ${task.id}`,
    `title: ${task.title}`,
    `status: ${task.status}`,
    `priority: ${task.priority}`,
    `position: ${task.position}`,
    `version: ${task.version}`,
    `assignee: ${task.assignee ?? "null"}`,
    `dueAt: ${task.dueAt ?? "null"}`,
    `notes: ${task.notes ?? "null"}`,
    `createdAt: ${task.createdAt}`,
    `updatedAt: ${task.updatedAt}`,
  ];
  return lines.join("\n");
}

async function runCreate(
  baseUrl: string,
  positional: string[],
  flags: Map<string, string | boolean>,
): Promise<CliResult> {
  const title = readStringFlag(flags, "title") ?? positional[0];
  const parsedTitle = parseRequiredString(title, "title");
  if (typeof parsedTitle !== "string") {
    return parsedTitle;
  }

  const parsedPosition = parseIntegerFlag(flags, "position");
  if (isCliFailure(parsedPosition)) {
    return parsedPosition;
  }

  const body: Record<string, unknown> = { title: parsedTitle };
  const status = readStringFlag(flags, "status");
  const priority = readStringFlag(flags, "priority");
  const dueAt = parseNullableStringFlag(flags, "dueAt");
  const assignee = parseNullableStringFlag(flags, "assignee");
  const notes = parseNullableStringFlag(flags, "notes");

  if (status !== undefined) {
    body.status = status;
  }
  if (priority !== undefined) {
    body.priority = priority;
  }
  if (dueAt !== undefined) {
    body.dueAt = dueAt;
  }
  if (assignee !== undefined) {
    body.assignee = assignee;
  }
  if (notes !== undefined) {
    body.notes = notes;
  }
  if (parsedPosition !== undefined) {
    body.position = parsedPosition;
  }

  const response = await callApi<ApiTaskResponse>(baseUrl, "POST", "/api/tasks", body);
  if (!response.ok) {
    return response.failure;
  }
  return { ok: true, value: response.value.task };
}

function filterTasks(tasks: Task[], flags: Map<string, string | boolean>): Task[] {
  const status = readStringFlag(flags, "status");
  const priority = readStringFlag(flags, "priority");
  const assignee = readStringFlag(flags, "assignee");
  const titleContains = readStringFlag(flags, "titleContains");

  return tasks.filter((task) => {
    if (status !== undefined && task.status !== status) {
      return false;
    }
    if (priority !== undefined && task.priority !== priority) {
      return false;
    }
    if (assignee !== undefined) {
      if (assignee.toLowerCase() === "null") {
        if (task.assignee !== null) {
          return false;
        }
      } else if (task.assignee !== assignee) {
        return false;
      }
    }
    if (titleContains !== undefined && !task.title.toLowerCase().includes(titleContains.toLowerCase())) {
      return false;
    }
    return true;
  });
}

async function runList(baseUrl: string, flags: Map<string, string | boolean>): Promise<CliResult> {
  const response = await callApi<ApiTasksResponse>(baseUrl, "GET", "/api/tasks");
  if (!response.ok) {
    return response.failure;
  }

  const filtered = filterTasks(response.value.tasks, flags);
  return { ok: true, value: filtered };
}

async function runShow(
  baseUrl: string,
  positional: string[],
  flags: Map<string, string | boolean>,
): Promise<CliResult> {
  const taskId = readStringFlag(flags, "id") ?? positional[0];
  const parsedTaskId = parseRequiredString(taskId, "task id");
  if (typeof parsedTaskId !== "string") {
    return parsedTaskId;
  }

  const response = await callApi<ApiTasksResponse>(baseUrl, "GET", "/api/tasks");
  if (!response.ok) {
    return response.failure;
  }

  const found = response.value.tasks.find((task) => task.id === parsedTaskId);
  if (found === undefined) {
    return toCliFailure(
      ERROR_CODES.TASK_NOT_FOUND,
      `Task ${parsedTaskId} was not found`,
      EXIT_CODE_NOT_FOUND,
    );
  }

  return { ok: true, value: found };
}

async function runUpdate(
  baseUrl: string,
  positional: string[],
  flags: Map<string, string | boolean>,
): Promise<CliResult> {
  const taskId = readStringFlag(flags, "id") ?? positional[0];
  const parsedTaskId = parseRequiredString(taskId, "task id");
  if (typeof parsedTaskId !== "string") {
    return parsedTaskId;
  }

  const expectedVersion = parseIntegerFlag(flags, "expectedVersion");
  if (isCliFailure(expectedVersion)) {
    return expectedVersion;
  }

  const body: Record<string, unknown> = {};
  const title = readStringFlag(flags, "title");
  const priority = readStringFlag(flags, "priority");
  const dueAt = parseNullableStringFlag(flags, "dueAt");
  const assignee = parseNullableStringFlag(flags, "assignee");
  const notes = parseNullableStringFlag(flags, "notes");

  if (title !== undefined) {
    body.title = title;
  }
  if (priority !== undefined) {
    body.priority = priority;
  }
  if (dueAt !== undefined) {
    body.dueAt = dueAt;
  }
  if (assignee !== undefined) {
    body.assignee = assignee;
  }
  if (notes !== undefined) {
    body.notes = notes;
  }
  if (expectedVersion !== undefined) {
    body.expectedVersion = expectedVersion;
  }

  if (Object.keys(body).length === 0) {
    return toCliFailure(
      ERROR_CODES.VALIDATION_ERROR,
      "update requires at least one update flag",
      EXIT_CODE_VALIDATION,
    );
  }

  const response = await callApi<ApiTaskResponse>(baseUrl, "PATCH", `/api/tasks/${encodeURIComponent(parsedTaskId)}`, body);
  if (!response.ok) {
    return response.failure;
  }

  return { ok: true, value: response.value.task };
}

async function runMove(
  baseUrl: string,
  positional: string[],
  flags: Map<string, string | boolean>,
): Promise<CliResult> {
  const taskId = readStringFlag(flags, "id") ?? positional[0];
  const parsedTaskId = parseRequiredString(taskId, "task id");
  if (typeof parsedTaskId !== "string") {
    return parsedTaskId;
  }

  const toStatus = readStringFlag(flags, "toStatus");
  const parsedStatus = parseRequiredString(toStatus, "toStatus");
  if (typeof parsedStatus !== "string") {
    return parsedStatus;
  }

  const expectedVersion = parseIntegerFlag(flags, "expectedVersion");
  if (isCliFailure(expectedVersion)) {
    return expectedVersion;
  }
  if (expectedVersion === undefined) {
    return toCliFailure(
      ERROR_CODES.VALIDATION_ERROR,
      "expectedVersion is required",
      EXIT_CODE_VALIDATION,
    );
  }

  const toPosition = parseIntegerFlag(flags, "toPosition");
  if (isCliFailure(toPosition)) {
    return toPosition;
  }

  const body: Record<string, unknown> = {
    toStatus: parsedStatus,
    expectedVersion,
  };
  if (toPosition !== undefined) {
    body.toPosition = toPosition;
  }

  const response = await callApi<ApiTaskResponse>(
    baseUrl,
    "POST",
    `/api/tasks/${encodeURIComponent(parsedTaskId)}/move`,
    body,
  );
  if (!response.ok) {
    return response.failure;
  }

  return { ok: true, value: response.value.task };
}

function isCliFailure(value: number | CliFailure | undefined): value is CliFailure {
  return typeof value === "object" && value !== null && value.ok === false;
}

export async function runTaskboardCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(argv);
  const showHelp = parsed.flags.get("help") === true;

  if (showHelp || parsed.command === null) {
    const helpText = buildHelpText();
    if (parsed.json) {
      process.stdout.write(`${JSON.stringify({ ok: true, data: { help: helpText } })}\n`);
    } else {
      process.stdout.write(helpText);
    }
    return EXIT_CODE_SUCCESS;
  }

  const baseUrl = resolveApiBaseUrl();
  let result: CliResult;

  switch (parsed.command) {
    case "create":
      result = await runCreate(baseUrl, parsed.positional, parsed.flags);
      break;
    case "list":
      result = await runList(baseUrl, parsed.flags);
      break;
    case "show":
      result = await runShow(baseUrl, parsed.positional, parsed.flags);
      break;
    case "update":
      result = await runUpdate(baseUrl, parsed.positional, parsed.flags);
      break;
    case "move":
      result = await runMove(baseUrl, parsed.positional, parsed.flags);
      break;
  }

  printResult(result, parsed.json);
  return result.ok ? EXIT_CODE_SUCCESS : result.exitCode;
}
