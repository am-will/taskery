import { spawnSync } from "node:child_process";
import type { Server } from "node:http";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ERROR_CODES,
  type NotificationSettings,
  type Task,
  type TaskErrorCode,
} from "taskery-shared";

const EXIT_CODE_SUCCESS = 0;
const EXIT_CODE_INTERNAL = 1;
const EXIT_CODE_VALIDATION = 2;
const EXIT_CODE_NOT_FOUND = 3;
const EXIT_CODE_CONFLICT = 4;

const DEFAULT_API_BASE_URL = "http://127.0.0.1:4010";
const DEFAULT_APP_HOST = "127.0.0.1";
const DEFAULT_APP_PORT = 4010;
const DEFAULT_TASKERY_DATA_DIR_NAME = ".taskery";

type CommandName = "create" | "list" | "show" | "update" | "move" | "delete" | "settings" | "up";

type ParsedArgs = {
  json: boolean;
  command: CommandName | null;
  positional: string[];
  flags: Map<string, string | boolean>;
};

type ActionFlagMapping = {
  flag: string;
  command: CommandName;
  positionalName: string;
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

type ApiNotificationSettingsResponse = {
  settings: NotificationSettings;
};

function formatListenError(error: Error, host: string, port: number): string {
  const maybeErrno = error as NodeJS.ErrnoException;
  if (maybeErrno.code === "EADDRINUSE") {
    return `Port ${host}:${port} is already in use. Stop the existing process or run taskery up --port <port>.`;
  }
  return `Failed to start Taskery server: ${error.message}`;
}

function resolveApiBaseUrl(): string {
  const rawBaseUrl = process.env.CLI_API_BASE_URL ?? process.env.API_BASE_URL ?? DEFAULT_API_BASE_URL;
  return rawBaseUrl.endsWith("/") ? rawBaseUrl.slice(0, -1) : rawBaseUrl;
}

function parseArgs(argv: string[]): ParsedArgs {
  let json = true;
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
    if (token === "--text") {
      json = false;
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
  return (
    value === "create" ||
    value === "list" ||
    value === "show" ||
    value === "update" ||
    value === "move" ||
    value === "delete" ||
    value === "settings" ||
    value === "up"
  );
}

const ACTION_FLAG_MAPPINGS: ActionFlagMapping[] = [
  { flag: "create", command: "create", positionalName: "title" },
  { flag: "list", command: "list", positionalName: "unused" },
  { flag: "show", command: "show", positionalName: "task id" },
  { flag: "update", command: "update", positionalName: "task id" },
  { flag: "move", command: "move", positionalName: "task id" },
  { flag: "delete", command: "delete", positionalName: "task id" },
  { flag: "settings", command: "settings", positionalName: "unused" },
  { flag: "up", command: "up", positionalName: "unused" },
];

function normalizeActionFlagCommand(parsed: ParsedArgs): CliFailure | null {
  if (parsed.command !== null) {
    return null;
  }

  const matched = ACTION_FLAG_MAPPINGS.filter((entry) => parsed.flags.has(entry.flag));
  if (matched.length === 0) {
    return null;
  }
  if (matched.length > 1) {
    return toCliFailure(
      ERROR_CODES.VALIDATION_ERROR,
      `Only one command flag is allowed (${matched.map((entry) => `--${entry.flag}`).join(", ")})`,
      EXIT_CODE_VALIDATION,
    );
  }

  const selected = matched[0];
  if (!selected) {
    return null;
  }
  parsed.command = selected.command;

  const rawValue = parsed.flags.get(selected.flag);
  if (typeof rawValue === "string") {
    parsed.positional.unshift(rawValue);
  } else if (
    rawValue === true &&
    selected.command !== "list" &&
    selected.command !== "settings" &&
    selected.command !== "up"
  ) {
    const implicitValue = readStringFlag(parsed.flags, "id");
    if (implicitValue === undefined && selected.command !== "create") {
      return toCliFailure(
        ERROR_CODES.VALIDATION_ERROR,
        `${selected.positionalName} is required`,
        EXIT_CODE_VALIDATION,
      );
    }
  }

  parsed.flags.delete(selected.flag);
  return null;
}

function buildHelpText(): string {
  return [
    "Taskery CLI",
    "",
    "Usage:",
    "  taskery [--json|--text] <command> [args] [--flags]",
    "  taskery [--json|--text] --<action> [value] [--flags]",
    "",
    "Commands:",
    "  create <title>    Create a task",
    "  list              List tasks",
    "  show <taskId>     Show one task",
    "  update <taskId>   Update a task",
    "  move <taskId>     Move task to another status",
    "  delete <taskId>   Delete a task",
    "  settings          Show or update notification settings",
    "  up                Run Taskery API + Web UI in one process",
    "",
    "Global Flags:",
    "  --json   Emit machine-readable JSON output (default)",
    "  --text   Emit human-readable text output",
    "  --help   Show help",
    "",
    "Action Flags:",
    "  --create | --list | --show | --update | --move | --delete | --up",
    "  --settings",
    "",
    "Command Flags:",
    "  create:",
    "    --title <text>       Alternate for positional <title>",
    "    --status <STATUS>    Initial status",
    "    --priority <LEVEL>   Initial priority",
    "    --dueAt <ISO|null>   Due date/time ISO-8601, or null",
    "    --assignee <text|null>",
    "    --notes <text|null>",
    "    --position <int>     Insert position in destination column",
    "  list:",
    "    --status <STATUS>",
    "    --priority <LEVEL>",
    "    --assignee <text|null>",
    "    --titleContains <text>",
    "  show:",
    "    --id <taskId>        Alternate for positional <taskId>",
    "  update:",
    "    --id <taskId>        Alternate for positional <taskId>",
    "    --title <text>",
    "    --priority <LEVEL>",
    "    --dueAt <ISO|null>",
    "    --assignee <text|null>",
    "    --notes <text|null>",
    "    --expectedVersion <int> (optional optimistic concurrency)",
    "  move:",
    "    --id <taskId>        Alternate for positional <taskId>",
    "    --toStatus <STATUS>  Required",
    "    --toPosition <int>   Optional destination position",
    "    --expectedVersion <int> Required",
    "  delete:",
    "    --id <taskId>        Alternate for positional <taskId>",
    "    --expectedVersion <int> Required",
    "  settings:",
    "    No flags: fetch current notification settings",
    "    --enabled <bool>",
    "    --dailyEnabled <bool>",
    "    --dailyHours <csv-hours> (example: 10,13)",
    "    --weeklyEnabled <bool>",
    "    --weeklyDay <0-6> (0=Sunday, 1=Monday)",
    "    --weeklyHour <0-23>",
    "    --windowMinutes <1-60>",
    "  up:",
    "    --host <hostname>   Default 127.0.0.1",
    "    --port <1-65535>    Default 4010",
    "    --dataDir <path>    Default ~/.taskery",
    "",
    "Allowed Values:",
    "  STATUS = PENDING | STARTED | BLOCKED | REVIEW | COMPLETE",
    "  LEVEL  = LOW | MEDIUM | HIGH | URGENT",
    "",
    "Environment:",
    "  CLI_API_BASE_URL       Base URL for API requests",
    "  API_BASE_URL           Fallback if CLI_API_BASE_URL is unset",
    "  TASKERY_HOME           Data directory (default ~/.taskery)",
    "  DATABASE_URL           Optional explicit SQLite URL override",
    "",
    "Exit Codes:",
    "  0 success",
    "  1 internal error",
    "  2 validation error",
    "  3 task not found",
    "  4 version conflict",
    "",
    "Examples:",
    "  taskery create \"Ship CLI\" --priority HIGH --status PENDING",
    "  taskery --create \"Ship CLI\" --priority HIGH",
    "  taskery list --status STARTED --titleContains ship",
    "  taskery show task_123",
    "  taskery update task_123 --title \"Rename\" --expectedVersion 2",
    "  taskery move task_123 --toStatus REVIEW --expectedVersion 3",
    "  taskery delete task_123 --expectedVersion 4",
    "  taskery up --port 4010",
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

function parseBooleanFlag(
  flags: Map<string, string | boolean>,
  name: string,
): boolean | CliFailure | undefined {
  const raw = flags.get(name);
  if (raw === undefined) {
    return undefined;
  }
  if (raw === true) {
    return true;
  }
  if (raw === false) {
    return false;
  }

  const normalized = raw.toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }

  return toCliFailure(
    ERROR_CODES.VALIDATION_ERROR,
    `Flag --${name} must be a boolean (true/false)`,
    EXIT_CODE_VALIDATION,
  );
}

function parseIntegerListFlag(
  flags: Map<string, string | boolean>,
  name: string,
): number[] | CliFailure | undefined {
  const raw = readStringFlag(flags, name);
  if (raw === undefined) {
    return undefined;
  }

  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length === 0) {
    return toCliFailure(
      ERROR_CODES.VALIDATION_ERROR,
      `Flag --${name} must include at least one integer value`,
      EXIT_CODE_VALIDATION,
    );
  }

  const parsed: number[] = [];
  for (const entry of entries) {
    const numeric = Number(entry);
    if (!Number.isInteger(numeric)) {
      return toCliFailure(
        ERROR_CODES.VALIDATION_ERROR,
        `Flag --${name} must be a comma-separated list of integers`,
        EXIT_CODE_VALIDATION,
      );
    }
    parsed.push(numeric);
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

type BundledAppPaths = {
  apiEntryPath: string;
  prismaSchemaPath: string;
  webDistDir: string;
};

function resolveRuntimeRoot(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const bundledRuntime = resolve(moduleDirectory, "runtime");
  if (existsSync(bundledRuntime)) {
    return bundledRuntime;
  }
  return resolve(moduleDirectory, "../dist/runtime");
}

function resolveBundledAppPaths(): BundledAppPaths | CliFailure {
  const runtimeRoot = resolveRuntimeRoot();
  const apiEntryPath = resolve(runtimeRoot, "api/index.js");
  const prismaSchemaPath = resolve(runtimeRoot, "api/prisma/schema.prisma");
  const webDistDir = resolve(runtimeRoot, "web");

  if (!existsSync(apiEntryPath) || !existsSync(prismaSchemaPath) || !existsSync(webDistDir)) {
    return toCliFailure(
      ERROR_CODES.INTERNAL_ERROR,
      "Bundled runtime assets are missing. Reinstall taskery or rebuild this workspace package.",
      EXIT_CODE_INTERNAL,
    );
  }

  return { apiEntryPath, prismaSchemaPath, webDistDir };
}

function resolveDataDirectory(flags: Map<string, string | boolean>): string {
  const fromFlag = readStringFlag(flags, "dataDir");
  if (typeof fromFlag === "string" && fromFlag.trim().length > 0) {
    return resolve(fromFlag);
  }

  const fromEnv = process.env.TASKERY_HOME;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return resolve(fromEnv);
  }

  return resolve(homedir(), DEFAULT_TASKERY_DATA_DIR_NAME);
}

function resolveDatabaseUrl(dataDirectory: string): string {
  const explicitDatabaseUrl = process.env.DATABASE_URL;
  if (typeof explicitDatabaseUrl === "string" && explicitDatabaseUrl.trim().length > 0) {
    return explicitDatabaseUrl.trim();
  }
  return `file:${resolve(dataDirectory, "taskery.db")}`;
}

function resolvePrismaCliPath(): string | CliFailure {
  let prismaCliPath: string;
  try {
    const require = createRequire(import.meta.url);
    prismaCliPath = require.resolve("prisma/build/index.js");
  } catch {
    return toCliFailure(
      ERROR_CODES.INTERNAL_ERROR,
      "Unable to locate Prisma CLI runtime. Reinstall taskery to restore dependencies.",
      EXIT_CODE_INTERNAL,
    );
  }
  return prismaCliPath;
}

function runPrismaGenerate(databaseUrl: string, schemaPath: string): CliFailure | null {
  const prismaCliPath = resolvePrismaCliPath();
  if (isCliFailure(prismaCliPath)) {
    return prismaCliPath;
  }

  const generate = spawnSync(
    process.execPath,
    [prismaCliPath, "generate", "--schema", schemaPath],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
    },
  );
  if (generate.status === 0) {
    return null;
  }

  const stderr = generate.stderr.trim();
  const stdout = generate.stdout.trim();
  const details = stderr.length > 0 ? stderr : stdout;
  return toCliFailure(
    ERROR_CODES.INTERNAL_ERROR,
    details.length > 0 ? `Prisma client generation failed: ${details}` : "Prisma client generation failed",
    EXIT_CODE_INTERNAL,
  );
}

function runPrismaMigrations(databaseUrl: string, schemaPath: string): CliFailure | null {
  const prismaCliPath = resolvePrismaCliPath();
  if (isCliFailure(prismaCliPath)) {
    return prismaCliPath;
  }

  const migrate = spawnSync(
    process.execPath,
    [prismaCliPath, "migrate", "deploy", "--schema", schemaPath],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
    },
  );
  if (migrate.status === 0) {
    return null;
  }

  const stderr = migrate.stderr.trim();
  const stdout = migrate.stdout.trim();
  const details = stderr.length > 0 ? stderr : stdout;
  return toCliFailure(
    ERROR_CODES.INTERNAL_ERROR,
    details.length > 0 ? `Database migration failed: ${details}` : "Database migration failed",
    EXIT_CODE_INTERNAL,
  );
}

async function runUp(flags: Map<string, string | boolean>): Promise<number> {
  const host = readStringFlag(flags, "host") ?? process.env.API_HOST ?? DEFAULT_APP_HOST;
  const parsedPort = parseIntegerFlag(flags, "port");
  if (isCliFailure(parsedPort)) {
    printResult(parsedPort, false);
    return parsedPort.exitCode;
  }
  const port = parsedPort ?? DEFAULT_APP_PORT;
  if (port < 1 || port > 65535) {
    const failure = toCliFailure(
      ERROR_CODES.VALIDATION_ERROR,
      "Flag --port must be an integer between 1 and 65535",
      EXIT_CODE_VALIDATION,
    );
    printResult(failure, false);
    return failure.exitCode;
  }

  const bundledPaths = resolveBundledAppPaths();
  if (isCliFailure(bundledPaths)) {
    printResult(bundledPaths, false);
    return bundledPaths.exitCode;
  }

  const dataDirectory = resolveDataDirectory(flags);
  await mkdir(dataDirectory, { recursive: true });
  const databaseUrl = resolveDatabaseUrl(dataDirectory);

  const generateFailure = runPrismaGenerate(databaseUrl, bundledPaths.prismaSchemaPath);
  if (generateFailure !== null) {
    printResult(generateFailure, false);
    return generateFailure.exitCode;
  }

  const migrationFailure = runPrismaMigrations(databaseUrl, bundledPaths.prismaSchemaPath);
  if (migrationFailure !== null) {
    printResult(migrationFailure, false);
    return migrationFailure.exitCode;
  }

  process.env.API_HOST = host;
  process.env.API_PORT = String(port);
  process.env.DATABASE_URL = databaseUrl;
  process.env.TASKERY_WEB_DIST_DIR = bundledPaths.webDistDir;

  let apiModule: Record<string, unknown>;
  try {
    apiModule = (await import(pathToFileURL(bundledPaths.apiEntryPath).href)) as Record<string, unknown>;
  } catch (error) {
    const failure = toCliFailure(
      ERROR_CODES.INTERNAL_ERROR,
      `Failed to load bundled API module: ${error instanceof Error ? error.message : "unknown error"}`,
      EXIT_CODE_INTERNAL,
    );
    printResult(failure, false);
    return failure.exitCode;
  }
  if (typeof apiModule.createApiServer !== "function") {
    const failure = toCliFailure(
      ERROR_CODES.INTERNAL_ERROR,
      "Bundled API module is invalid (missing createApiServer export).",
      EXIT_CODE_INTERNAL,
    );
    printResult(failure, false);
    return failure.exitCode;
  }

  const server = (apiModule.createApiServer as () => Server)();
  const listenFailure = await new Promise<CliFailure | null>((resolvePromise) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      resolvePromise(
        toCliFailure(ERROR_CODES.INTERNAL_ERROR, formatListenError(error, host, port), EXIT_CODE_INTERNAL),
      );
    };
    const onListening = () => {
      server.off("error", onError);
      resolvePromise(null);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
  if (listenFailure !== null) {
    printResult(listenFailure, false);
    return listenFailure.exitCode;
  }

  const appUrl = `http://${host}:${port}`;
  process.stdout.write(`Taskery is running.\n`);
  process.stdout.write(`Web UI: ${appUrl}\n`);
  process.stdout.write(`API: ${appUrl}/api/health\n`);
  process.stdout.write(`Data directory: ${dataDirectory}\n`);
  process.stdout.write("Press Ctrl+C to stop.\n");
  const onServerError = (error: Error) => {
    process.stderr.write(`Taskery server error: ${error.message}\n`);
  };
  server.on("error", onServerError);

  return await new Promise<number>((resolvePromise) => {
    let resolved = false;
    const finalize = (exitCode: number) => {
      if (resolved) {
        return;
      }
      resolved = true;
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      server.off("error", onServerError);
      resolvePromise(exitCode);
    };
    const shutdown = (signal: "SIGINT" | "SIGTERM") => {
      process.stdout.write(`\nReceived ${signal}, stopping Taskery...\n`);
      server.close((error) => {
        if (error) {
          process.stderr.write(`Failed to stop cleanly: ${error.message}\n`);
          finalize(EXIT_CODE_INTERNAL);
          return;
        }
        finalize(EXIT_CODE_SUCCESS);
      });
    };
    const onSigint = () => shutdown("SIGINT");
    const onSigterm = () => shutdown("SIGTERM");
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
  });
}

async function callApi<T>(
  baseUrl: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
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
  if (isNotificationSettings(value)) {
    return formatNotificationSettings(value);
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

function isNotificationSettings(value: unknown): value is NotificationSettings {
  return (
    typeof value === "object" &&
    value !== null &&
    "enabled" in value &&
    "dailyEnabled" in value &&
    "dailyHours" in value &&
    "weeklyEnabled" in value &&
    "weeklyDay" in value &&
    "weeklyHour" in value &&
    "windowMinutes" in value
  );
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

function formatNotificationSettings(settings: NotificationSettings): string {
  const lines = [
    `enabled: ${settings.enabled}`,
    `dailyEnabled: ${settings.dailyEnabled}`,
    `dailyHours: ${settings.dailyHours.join(",")}`,
    `weeklyEnabled: ${settings.weeklyEnabled}`,
    `weeklyDay: ${settings.weeklyDay}`,
    `weeklyHour: ${settings.weeklyHour}`,
    `windowMinutes: ${settings.windowMinutes}`,
    `updatedAt: ${settings.updatedAt ?? "null"}`,
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

async function runDelete(
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
  if (expectedVersion === undefined) {
    return toCliFailure(
      ERROR_CODES.VALIDATION_ERROR,
      "expectedVersion is required",
      EXIT_CODE_VALIDATION,
    );
  }

  const response = await callApi<ApiTaskResponse>(
    baseUrl,
    "DELETE",
    `/api/tasks/${encodeURIComponent(parsedTaskId)}`,
    { expectedVersion },
  );
  if (!response.ok) {
    return response.failure;
  }

  return { ok: true, value: response.value.task };
}

async function runSettings(
  baseUrl: string,
  flags: Map<string, string | boolean>,
): Promise<CliResult> {
  const enabled = parseBooleanFlag(flags, "enabled");
  if (isCliFailure(enabled)) {
    return enabled;
  }
  const dailyEnabled = parseBooleanFlag(flags, "dailyEnabled");
  if (isCliFailure(dailyEnabled)) {
    return dailyEnabled;
  }
  const weeklyEnabled = parseBooleanFlag(flags, "weeklyEnabled");
  if (isCliFailure(weeklyEnabled)) {
    return weeklyEnabled;
  }

  const dailyHours = parseIntegerListFlag(flags, "dailyHours");
  if (isCliFailure(dailyHours)) {
    return dailyHours;
  }
  const weeklyDay = parseIntegerFlag(flags, "weeklyDay");
  if (isCliFailure(weeklyDay)) {
    return weeklyDay;
  }
  const weeklyHour = parseIntegerFlag(flags, "weeklyHour");
  if (isCliFailure(weeklyHour)) {
    return weeklyHour;
  }
  const windowMinutes = parseIntegerFlag(flags, "windowMinutes");
  if (isCliFailure(windowMinutes)) {
    return windowMinutes;
  }

  const updateBody: Record<string, unknown> = {};
  if (enabled !== undefined) {
    updateBody.enabled = enabled;
  }
  if (dailyEnabled !== undefined) {
    updateBody.dailyEnabled = dailyEnabled;
  }
  if (dailyHours !== undefined) {
    updateBody.dailyHours = dailyHours;
  }
  if (weeklyEnabled !== undefined) {
    updateBody.weeklyEnabled = weeklyEnabled;
  }
  if (weeklyDay !== undefined) {
    updateBody.weeklyDay = weeklyDay;
  }
  if (weeklyHour !== undefined) {
    updateBody.weeklyHour = weeklyHour;
  }
  if (windowMinutes !== undefined) {
    updateBody.windowMinutes = windowMinutes;
  }

  if (Object.keys(updateBody).length === 0) {
    const readResponse = await callApi<ApiNotificationSettingsResponse>(
      baseUrl,
      "GET",
      "/api/settings/notifications",
    );
    if (!readResponse.ok) {
      return readResponse.failure;
    }
    return { ok: true, value: readResponse.value.settings };
  }

  const updateResponse = await callApi<ApiNotificationSettingsResponse>(
    baseUrl,
    "PATCH",
    "/api/settings/notifications",
    updateBody,
  );
  if (!updateResponse.ok) {
    return updateResponse.failure;
  }
  return { ok: true, value: updateResponse.value.settings };
}

function isCliFailure(value: unknown): value is CliFailure {
  if (typeof value !== "object" || value === null || !("ok" in value)) {
    return false;
  }
  return value.ok === false;
}

export async function runTaskboardCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(argv);
  const actionFlagError = normalizeActionFlagCommand(parsed);
  if (actionFlagError) {
    printResult(actionFlagError, parsed.json);
    return actionFlagError.exitCode;
  }
  const showHelp = parsed.flags.get("help") === true;

  if (showHelp || parsed.command === null) {
    const helpText = buildHelpText();
    process.stdout.write(helpText);
    return EXIT_CODE_SUCCESS;
  }

  if (parsed.command === "up") {
    return runUp(parsed.flags);
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
    case "delete":
      result = await runDelete(baseUrl, parsed.positional, parsed.flags);
      break;
    case "settings":
      result = await runSettings(baseUrl, parsed.flags);
      break;
  }

  printResult(result, parsed.json);
  return result.ok ? EXIT_CODE_SUCCESS : result.exitCode;
}
