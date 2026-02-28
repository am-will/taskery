import prismaClient from "@prisma/client";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import {
  type PrismaClient as PrismaClientType,
  type Prisma,
  type NotificationSettings as PrismaNotificationSettings,
  type Task as PrismaTask,
} from "@prisma/client";
import {
  DEFAULT_NOTIFICATION_SCHEDULE_CONFIG,
  ERROR_CODES,
  buildTaskError,
  getNextPosition,
  isTransitionAllowed,
  notificationScheduleConfigSchema,
  notificationSettingsUpdateInputSchema,
  taskCreateInputSchema,
  taskDeleteInputSchema,
  taskMoveInputSchema,
  taskUpdateInputSchema,
  type NotificationScheduleConfig,
  type NotificationSettings,
  type Task,
  type TaskErrorCode,
  type TaskStatus,
} from "taskery-shared";

const { PrismaClient } = prismaClient as typeof import("@prisma/client");

const DEFAULT_API_HOST = "127.0.0.1";
const DEFAULT_API_PORT = 4010;
const DEFAULT_DATABASE_URL = new URL("../prisma/dev.db", import.meta.url).href;
const DEFAULT_CORS_ALLOWED_ORIGINS = [
  "http://127.0.0.1:3010",
  "http://localhost:3010",
];
const TASK_ID_ROUTE_TEMPLATE = "/api/tasks/:id";
const TASK_MOVE_ROUTE_TEMPLATE = "/api/tasks/:id/move";
const NOTIFICATION_SETTINGS_ROUTE = "/api/settings/notifications";
const NOTIFICATION_SETTINGS_ID = "global";
const STATIC_INDEX_FILE = "index.html";
const STATIC_CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};
const TASK_MUTATION_EVENT_TYPES = {
  TASK_CREATED: "TASK_CREATED",
  TASK_UPDATED: "TASK_UPDATED",
  TASK_MOVED: "TASK_MOVED",
  TASK_DELETED: "TASK_DELETED",
} as const;

type TaskMutationEventType =
  (typeof TASK_MUTATION_EVENT_TYPES)[keyof typeof TASK_MUTATION_EVENT_TYPES];

function createPrismaClient(): PrismaClientType {
  const configuredDatabaseUrl = process.env.DATABASE_URL;
  const databaseUrl =
    configuredDatabaseUrl !== undefined && configuredDatabaseUrl.trim().length > 0
      ? configuredDatabaseUrl
      : DEFAULT_DATABASE_URL;

  return new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });
}

const prisma = createPrismaClient();

class ApiError extends Error {
  readonly statusCode: number;
  readonly code: TaskErrorCode;
  readonly details?: unknown;

  constructor(statusCode: number, code: TaskErrorCode, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_API_PORT;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error("API_PORT must be an integer between 1 and 65535");
  }

  return parsed;
}

function parseAllowedOrigins(value: string | undefined): Set<string> {
  if (value === undefined || value.trim().length === 0) {
    return new Set(DEFAULT_CORS_ALLOWED_ORIGINS);
  }

  const origins = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (origins.length === 0) {
    return new Set(DEFAULT_CORS_ALLOWED_ORIGINS);
  }

  return new Set(origins);
}

const allowedOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);

function isLoopbackOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:") {
      return false;
    }
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

function applyCors(request: IncomingMessage, response: ServerResponse): void {
  const requestOrigin = request.headers.origin;
  if (
    typeof requestOrigin === "string" &&
    (allowedOrigins.has(requestOrigin) || isLoopbackOrigin(requestOrigin))
  ) {
    response.setHeader("access-control-allow-origin", requestOrigin);
    response.setHeader("vary", "Origin");
  }

  response.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body).toString(),
  });
  response.end(body);
}

function sendApiError(
  response: ServerResponse,
  statusCode: number,
  code: TaskErrorCode,
  message: string,
  details?: unknown,
): void {
  sendJson(response, statusCode, buildTaskError(code, message, details));
}

function sendRaw(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  body: Buffer,
  method: string,
): void {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "content-length": body.byteLength.toString(),
  });
  if (method === "HEAD") {
    response.end();
    return;
  }
  response.end(body);
}

function resolveWebDistDir(): string | null {
  const raw = process.env.TASKERY_WEB_DIST_DIR;
  if (raw === undefined) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return resolve(trimmed);
}

function toStaticFilePath(webDistDir: string, requestPathname: string): string | null {
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(requestPathname);
  } catch {
    return null;
  }
  if (decodedPathname.includes("\0")) {
    return null;
  }

  const normalizedPathname = decodedPathname === "/" ? `/${STATIC_INDEX_FILE}` : decodedPathname;
  const resolvedPath = resolve(webDistDir, `.${normalizedPathname}`);
  if (resolvedPath === webDistDir || resolvedPath.startsWith(`${webDistDir}${sep}`)) {
    return resolvedPath;
  }
  return null;
}

async function readStaticFileIfPresent(pathname: string): Promise<{ body: Buffer; contentType: string } | null> {
  if (pathname.startsWith("/api/")) {
    return null;
  }

  const webDistDir = resolveWebDistDir();
  if (webDistDir === null) {
    return null;
  }

  const staticPath = toStaticFilePath(webDistDir, pathname);
  if (staticPath !== null) {
    try {
      const staticFile = await stat(staticPath);
      if (staticFile.isFile()) {
        const extension = extname(staticPath).toLowerCase();
        const contentType = STATIC_CONTENT_TYPES[extension] ?? "application/octet-stream";
        const body = await readFile(staticPath);
        return { body, contentType };
      }
    } catch {
      // Fall back to SPA index for non-file routes.
    }
  }

  if (extname(pathname) !== "") {
    return null;
  }

  const indexPath = resolve(webDistDir, STATIC_INDEX_FILE);
  try {
    const body = await readFile(indexPath);
    return { body, contentType: "text/html; charset=utf-8" };
  } catch {
    return null;
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
      continue;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    throw new ApiError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "Request body is required and must be valid JSON",
    );
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, "Malformed JSON request body");
  }
}

function toTaskDto(record: PrismaTask): Task {
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    priority: record.priority,
    dueAt: record.dueAt?.toISOString() ?? null,
    assignee: record.assignee,
    notes: record.notes,
    position: record.position,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toTaskEventSnapshot(record: PrismaTask): Record<string, unknown> {
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    priority: record.priority,
    dueAt: record.dueAt?.toISOString() ?? null,
    assignee: record.assignee,
    notes: record.notes,
    position: record.position,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function parseDailyHoursCsv(value: string): number[] {
  const rawHours = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => Number(entry));
  const uniqueSorted = Array.from(new Set(rawHours)).sort((left, right) => left - right);
  return uniqueSorted;
}

function toDailyHoursCsv(hours: number[]): string {
  return hours.join(",");
}

function toNotificationScheduleConfig(
  record: PrismaNotificationSettings | null,
): NotificationScheduleConfig {
  const candidate: NotificationScheduleConfig =
    record === null
      ? {
        ...DEFAULT_NOTIFICATION_SCHEDULE_CONFIG,
        dailyHours: [...DEFAULT_NOTIFICATION_SCHEDULE_CONFIG.dailyHours],
      }
      : {
        enabled: record.enabled,
        dailyEnabled: record.dailyEnabled,
        dailyHours: parseDailyHoursCsv(record.dailyHoursCsv),
        weeklyEnabled: record.weeklyEnabled,
        weeklyDay: record.weeklyDay,
        weeklyHour: record.weeklyHour,
        windowMinutes: record.windowMinutes,
      };

  try {
    return notificationScheduleConfigSchema.parse(candidate);
  } catch {
    return {
      ...DEFAULT_NOTIFICATION_SCHEDULE_CONFIG,
      dailyHours: [...DEFAULT_NOTIFICATION_SCHEDULE_CONFIG.dailyHours],
    };
  }
}

function toNotificationSettingsDto(
  record: PrismaNotificationSettings | null,
): NotificationSettings {
  const schedule = toNotificationScheduleConfig(record);
  return {
    ...schedule,
    updatedAt: record?.updatedAt.toISOString() ?? null,
  };
}

function toNotificationSettingsUpdateData(
  input: ReturnType<typeof notificationSettingsUpdateInputSchema.parse>,
): Prisma.NotificationSettingsUpdateInput {
  const data: Prisma.NotificationSettingsUpdateInput = {};

  if (input.enabled !== undefined) {
    data.enabled = input.enabled;
  }
  if (input.dailyEnabled !== undefined) {
    data.dailyEnabled = input.dailyEnabled;
  }
  if (input.dailyHours !== undefined) {
    data.dailyHoursCsv = toDailyHoursCsv(input.dailyHours);
  }
  if (input.weeklyEnabled !== undefined) {
    data.weeklyEnabled = input.weeklyEnabled;
  }
  if (input.weeklyDay !== undefined) {
    data.weeklyDay = input.weeklyDay;
  }
  if (input.weeklyHour !== undefined) {
    data.weeklyHour = input.weeklyHour;
  }
  if (input.windowMinutes !== undefined) {
    data.windowMinutes = input.windowMinutes;
  }

  return data;
}

function toDefaultNotificationSettingsCreateData(): Prisma.NotificationSettingsCreateInput {
  return {
    id: NOTIFICATION_SETTINGS_ID,
    enabled: DEFAULT_NOTIFICATION_SCHEDULE_CONFIG.enabled,
    dailyEnabled: DEFAULT_NOTIFICATION_SCHEDULE_CONFIG.dailyEnabled,
    dailyHoursCsv: toDailyHoursCsv(DEFAULT_NOTIFICATION_SCHEDULE_CONFIG.dailyHours),
    weeklyEnabled: DEFAULT_NOTIFICATION_SCHEDULE_CONFIG.weeklyEnabled,
    weeklyDay: DEFAULT_NOTIFICATION_SCHEDULE_CONFIG.weeklyDay,
    weeklyHour: DEFAULT_NOTIFICATION_SCHEDULE_CONFIG.weeklyHour,
    windowMinutes: DEFAULT_NOTIFICATION_SCHEDULE_CONFIG.windowMinutes,
  };
}

function toNotificationSettingsCreateData(
  input: ReturnType<typeof notificationSettingsUpdateInputSchema.parse>,
): Prisma.NotificationSettingsCreateInput {
  const data = toDefaultNotificationSettingsCreateData();

  if (input.enabled !== undefined) {
    data.enabled = input.enabled;
  }
  if (input.dailyEnabled !== undefined) {
    data.dailyEnabled = input.dailyEnabled;
  }
  if (input.dailyHours !== undefined) {
    data.dailyHoursCsv = toDailyHoursCsv(input.dailyHours);
  }
  if (input.weeklyEnabled !== undefined) {
    data.weeklyEnabled = input.weeklyEnabled;
  }
  if (input.weeklyDay !== undefined) {
    data.weeklyDay = input.weeklyDay;
  }
  if (input.weeklyHour !== undefined) {
    data.weeklyHour = input.weeklyHour;
  }
  if (input.windowMinutes !== undefined) {
    data.windowMinutes = input.windowMinutes;
  }

  return data;
}

async function readNotificationSettings(): Promise<NotificationSettings> {
  const record = await prisma.notificationSettings.findUnique({
    where: { id: NOTIFICATION_SETTINGS_ID },
  });
  return toNotificationSettingsDto(record);
}

async function appendTaskMutationEvent(
  tx: Prisma.TransactionClient,
  taskId: string | null,
  eventType: TaskMutationEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.taskEvent.create({
    data: {
      taskId,
      eventType,
      payload: JSON.stringify(payload),
    },
  });
}

function extractTaskId(pathname: string): string | null {
  const match = /^\/api\/tasks\/([^/]+)$/.exec(pathname);
  return match?.[1] ?? null;
}

function extractMoveTaskId(pathname: string): string | null {
  const match = /^\/api\/tasks\/([^/]+)\/move$/.exec(pathname);
  return match?.[1] ?? null;
}

async function getNextTaskPositionForStatus(status: TaskStatus, excludeTaskId?: string): Promise<number> {
  const where: Prisma.TaskWhereInput = { status };
  if (excludeTaskId !== undefined) {
    where.id = { not: excludeTaskId };
  }

  const topTask = await prisma.task.findFirst({
    where,
    orderBy: { position: "desc" },
    select: { position: true },
  });

  return getNextPosition(topTask === null ? [] : [topTask.position]);
}

function toPrismaUpdateData(
  payload: ReturnType<typeof taskUpdateInputSchema.parse>,
): Prisma.TaskUpdateInput {
  const data: Prisma.TaskUpdateInput = {
    version: { increment: 1 },
  };

  if (payload.title !== undefined) {
    data.title = payload.title;
  }
  if (payload.priority !== undefined) {
    data.priority = payload.priority;
  }
  if (payload.dueAt !== undefined) {
    data.dueAt = payload.dueAt === null ? null : new Date(payload.dueAt);
  }
  if (payload.assignee !== undefined) {
    data.assignee = payload.assignee;
  }
  if (payload.notes !== undefined) {
    data.notes = payload.notes;
  }

  return data;
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");
  const { pathname } = url;

  if (method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (method === "GET" && pathname === "/api/tasks") {
    const [tasks, notificationSettings] = await Promise.all([
      prisma.task.findMany({
        orderBy: [{ status: "asc" }, { position: "asc" }, { createdAt: "asc" }],
      }),
      readNotificationSettings(),
    ]);
    sendJson(response, 200, {
      tasks: tasks.map(toTaskDto),
      notificationSettings,
    });
    return;
  }

  if (method === "GET" && pathname === NOTIFICATION_SETTINGS_ROUTE) {
    const settings = await readNotificationSettings();
    sendJson(response, 200, { settings });
    return;
  }

  if (method === "PATCH" && pathname === NOTIFICATION_SETTINGS_ROUTE) {
    const body = await readJsonBody(request);
    const input = notificationSettingsUpdateInputSchema.parse(body);

    const updated = await prisma.notificationSettings.upsert({
      where: { id: NOTIFICATION_SETTINGS_ID },
      update: toNotificationSettingsUpdateData(input),
      create: toNotificationSettingsCreateData(input),
    });

    sendJson(response, 200, { settings: toNotificationSettingsDto(updated) });
    return;
  }

  if (method === "POST" && pathname === "/api/tasks") {
    const body = await readJsonBody(request);
    const input = taskCreateInputSchema.parse(body);
    const position =
      input.position ?? (await getNextTaskPositionForStatus(input.status));
    const data: Prisma.TaskCreateInput = {
      title: input.title,
      priority: input.priority,
      status: input.status,
      position,
    };

    if (input.dueAt !== undefined) {
      data.dueAt = input.dueAt === null ? null : new Date(input.dueAt);
    }
    if (input.assignee !== undefined) {
      data.assignee = input.assignee;
    }
    if (input.notes !== undefined) {
      data.notes = input.notes;
    }

    const created = await prisma.$transaction(async (tx) => {
      const createdTask = await tx.task.create({
        data,
      });

      await appendTaskMutationEvent(
        tx,
        createdTask.id,
        TASK_MUTATION_EVENT_TYPES.TASK_CREATED,
        {
          mutation: "create",
          input,
          task: toTaskEventSnapshot(createdTask),
        },
      );

      return createdTask;
    });

    sendJson(response, 201, { task: toTaskDto(created) });
    return;
  }

  if (method === "PATCH") {
    const taskId = extractTaskId(pathname);
    if (taskId !== null) {
      const body = await readJsonBody(request);
      const input = taskUpdateInputSchema.parse(body);

      if (input.expectedVersion !== undefined) {
        const updated = await prisma.$transaction(async (tx) => {
          const current = await tx.task.findUnique({
            where: { id: taskId },
            select: { id: true, version: true },
          });

          if (current === null) {
            throw new ApiError(404, ERROR_CODES.TASK_NOT_FOUND, `Task ${taskId} was not found`);
          }
          if (current.version !== input.expectedVersion) {
            throw new ApiError(
              409,
              ERROR_CODES.VERSION_CONFLICT,
              `Task ${taskId} has a stale expectedVersion`,
              { expectedVersion: input.expectedVersion, actualVersion: current.version },
            );
          }

          const updatedTask = await tx.task.update({
            where: { id: taskId },
            data: toPrismaUpdateData(input),
          });

          await appendTaskMutationEvent(
            tx,
            updatedTask.id,
            TASK_MUTATION_EVENT_TYPES.TASK_UPDATED,
            {
              mutation: "update",
              input,
              previousVersion: current.version,
              task: toTaskEventSnapshot(updatedTask),
            },
          );

          return updatedTask;
        });

        sendJson(response, 200, { task: toTaskDto(updated) });
        return;
      }

      try {
        const updated = await prisma.$transaction(async (tx) => {
          const updatedTask = await tx.task.update({
            where: { id: taskId },
            data: toPrismaUpdateData(input),
          });

          await appendTaskMutationEvent(
            tx,
            updatedTask.id,
            TASK_MUTATION_EVENT_TYPES.TASK_UPDATED,
            {
              mutation: "update",
              input,
              previousVersion: updatedTask.version - 1,
              task: toTaskEventSnapshot(updatedTask),
            },
          );

          return updatedTask;
        });
        sendJson(response, 200, { task: toTaskDto(updated) });
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2025"
        ) {
          throw new ApiError(404, ERROR_CODES.TASK_NOT_FOUND, `Task ${taskId} was not found`);
        }
        throw error;
      }
      return;
    }
  }

  if (method === "POST") {
    const taskId = extractMoveTaskId(pathname);
    if (taskId !== null) {
      const body = await readJsonBody(request);
      const input = taskMoveInputSchema.parse(body);

      const moved = await prisma.$transaction(async (tx) => {
        const current = await tx.task.findUnique({ where: { id: taskId } });
        if (current === null) {
          throw new ApiError(404, ERROR_CODES.TASK_NOT_FOUND, `Task ${taskId} was not found`);
        }
        if (current.version !== input.expectedVersion) {
          throw new ApiError(
            409,
            ERROR_CODES.VERSION_CONFLICT,
            `Task ${taskId} has a stale expectedVersion`,
            { expectedVersion: input.expectedVersion, actualVersion: current.version },
          );
        }
        if (!isTransitionAllowed(current.status, input.toStatus)) {
          throw new ApiError(
            400,
            ERROR_CODES.VALIDATION_ERROR,
            `Transition from ${current.status} to ${input.toStatus} is not allowed`,
          );
        }

        let position = input.toPosition;
        if (position === undefined) {
          const topTask = await tx.task.findFirst({
            where: {
              status: input.toStatus,
              id: { not: current.id },
            },
            orderBy: { position: "desc" },
            select: { position: true },
          });
          position = getNextPosition(topTask === null ? [] : [topTask.position]);
        }

        const movedTask = await tx.task.update({
          where: { id: taskId },
          data: {
            status: input.toStatus,
            position,
            version: { increment: 1 },
          },
        });

        await appendTaskMutationEvent(
          tx,
          movedTask.id,
          TASK_MUTATION_EVENT_TYPES.TASK_MOVED,
          {
            mutation: "move",
            input,
            fromStatus: current.status,
            fromPosition: current.position,
            task: toTaskEventSnapshot(movedTask),
          },
        );

        return movedTask;
      });

      sendJson(response, 200, { task: toTaskDto(moved) });
      return;
    }
  }

  if (method === "DELETE") {
    const taskId = extractTaskId(pathname);
    if (taskId !== null) {
      const body = await readJsonBody(request);
      const input = taskDeleteInputSchema.parse(body);

      const deleted = await prisma.$transaction(async (tx) => {
        const current = await tx.task.findUnique({
          where: { id: taskId },
        });
        if (current === null) {
          throw new ApiError(404, ERROR_CODES.TASK_NOT_FOUND, `Task ${taskId} was not found`);
        }
        if (current.version !== input.expectedVersion) {
          throw new ApiError(
            409,
            ERROR_CODES.VERSION_CONFLICT,
            `Task ${taskId} has a stale expectedVersion`,
            { expectedVersion: input.expectedVersion, actualVersion: current.version },
          );
        }

        await appendTaskMutationEvent(
          tx,
          current.id,
          TASK_MUTATION_EVENT_TYPES.TASK_DELETED,
          {
            mutation: "delete",
            input,
            task: toTaskEventSnapshot(current),
          },
        );

        return tx.task.delete({
          where: { id: taskId },
        });
      });

      sendJson(response, 200, { task: toTaskDto(deleted) });
      return;
    }
  }

  if (
    pathname === "/api/health" ||
    pathname === "/api/tasks" ||
    pathname === NOTIFICATION_SETTINGS_ROUTE ||
    pathname === TASK_ID_ROUTE_TEMPLATE ||
    pathname === TASK_MOVE_ROUTE_TEMPLATE ||
    extractTaskId(pathname) !== null ||
    extractMoveTaskId(pathname) !== null
  ) {
    sendApiError(
      response,
      405,
      ERROR_CODES.VALIDATION_ERROR,
      `Method ${method} is not supported for ${pathname}`,
    );
    return;
  }

  if (method === "GET" || method === "HEAD") {
    const staticAsset = await readStaticFileIfPresent(pathname);
    if (staticAsset !== null) {
      sendRaw(response, 200, staticAsset.contentType, staticAsset.body, method);
      return;
    }
  }

  sendApiError(response, 404, ERROR_CODES.VALIDATION_ERROR, `Route ${pathname} was not found`);
}

export function createApiServer(): Server {
  return createServer(async (request, response) => {
    applyCors(request, response);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    try {
      await handleRequest(request, response);
    } catch (error) {
      if (error instanceof ApiError) {
        sendApiError(response, error.statusCode, error.code, error.message, error.details);
        return;
      }

      if (error instanceof Error) {
        sendApiError(response, 400, ERROR_CODES.VALIDATION_ERROR, error.message);
        return;
      }

      sendApiError(response, 500, ERROR_CODES.INTERNAL_ERROR, "Unhandled API server error");
    }
  });
}

export function startApiServer(): Server {
  const server = createApiServer();
  const host = process.env.API_HOST ?? DEFAULT_API_HOST;
  const port = parsePort(process.env.API_PORT);

  server.listen(port, host, () => {
    process.stdout.write(`Taskery API listening on http://${host}:${port}\n`);
  });

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startApiServer();
}
