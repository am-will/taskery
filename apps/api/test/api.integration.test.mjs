import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, after, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const apiRoot = fileURLToPath(new URL("..", import.meta.url));
const sqliteDir = await mkdtemp(join(tmpdir(), "taskboard-api-it-"));
const sqlitePath = join(sqliteDir, "integration.sqlite");
const databaseUrl = `file:${sqlitePath}`;

process.env.DATABASE_URL = databaseUrl;

const { createApiServer } = await import("../src/index.ts");

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl,
    },
  },
});

let server;
let baseUrl;

before(async () => {
  execFileSync(
    "pnpm",
    [
      "prisma",
      "db",
      "execute",
      "--url",
      databaseUrl,
      "--file",
      "prisma/migrations/20260226063009_init_taskboard/migration.sql",
    ],
    {
    cwd: apiRoot,
    stdio: "pipe",
  },
  );

  server = createApiServer();
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected API server to bind to an ephemeral TCP port");
  }

  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  await prisma.taskEvent.deleteMany();
  await prisma.task.deleteMany();
});

after(async () => {
  await new Promise((resolve, reject) => {
    if (server === undefined) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error !== undefined && error !== null) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  await prisma.$disconnect();
});

async function requestJson(pathname, init = {}) {
  const hasBody = init.body !== undefined;
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

  const raw = await response.text();
  const body = raw.length === 0 ? null : JSON.parse(raw);
  return { response, body };
}

async function createTask(overrides = {}) {
  const payload = {
    title: "Write integration tests",
    status: "PENDING",
    priority: "MEDIUM",
    ...overrides,
  };

  const { response, body } = await requestJson("/api/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  assert.equal(response.status, 201);
  assert.equal(body.task.title, payload.title);
  return body.task;
}

test("GET /api/health returns status ok", async () => {
  const { response, body } = await requestJson("/api/health");

  assert.equal(response.status, 200);
  assert.deepEqual(body, { status: "ok" });
});

test("CORS allows loopback dev origins on non-default ports", async () => {
  const origin = "http://127.0.0.1:3012";
  const preflight = await fetch(`${baseUrl}/api/tasks`, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });

  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
  assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /POST/);
  assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /DELETE/);
  assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /content-type/i);
});

test("POST /api/tasks creates a task and GET /api/tasks lists it", async () => {
  const task = await createTask({
    title: "Create + list coverage",
    assignee: "alice",
    notes: "deterministic",
  });

  assert.equal(task.version, 1);
  assert.equal(task.position, 1000);

  const { response, body } = await requestJson("/api/tasks");

  assert.equal(response.status, 200);
  assert.equal(body.tasks.length, 1);
  assert.equal(body.tasks[0].id, task.id);
  assert.equal(body.tasks[0].title, "Create + list coverage");
});

test("PATCH /api/tasks/:id updates a task successfully", async () => {
  const task = await createTask({ title: "Before update" });

  const { response, body } = await requestJson(`/api/tasks/${task.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: "After update",
      expectedVersion: task.version,
      notes: "updated",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(body.task.id, task.id);
  assert.equal(body.task.title, "After update");
  assert.equal(body.task.notes, "updated");
  assert.equal(body.task.version, task.version + 1);
});

test("POST /api/tasks/:id/move moves a task successfully", async () => {
  const task = await createTask({ title: "Move me", status: "PENDING" });

  const { response, body } = await requestJson(`/api/tasks/${task.id}/move`, {
    method: "POST",
    body: JSON.stringify({
      toStatus: "STARTED",
      expectedVersion: task.version,
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(body.task.id, task.id);
  assert.equal(body.task.status, "STARTED");
  assert.equal(body.task.version, task.version + 1);
  assert.equal(body.task.position, 1000);
});

test("POST /api/tasks/:id/move returns 409 conflict for stale expectedVersion", async () => {
  const task = await createTask({ title: "Conflict path" });

  const patchResult = await requestJson(`/api/tasks/${task.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: "Version bump",
      expectedVersion: task.version,
    }),
  });
  assert.equal(patchResult.response.status, 200);

  const { response, body } = await requestJson(`/api/tasks/${task.id}/move`, {
    method: "POST",
    body: JSON.stringify({
      toStatus: "STARTED",
      expectedVersion: task.version,
    }),
  });

  assert.equal(response.status, 409);
  assert.equal(body.code, "VERSION_CONFLICT");
  assert.match(body.message, /stale expectedVersion/);
  assert.deepEqual(body.details, {
    expectedVersion: 1,
    actualVersion: 2,
  });
});

test("DELETE /api/tasks/:id deletes a task with expectedVersion", async () => {
  const task = await createTask({ title: "Delete me" });

  const { response, body } = await requestJson(`/api/tasks/${task.id}`, {
    method: "DELETE",
    body: JSON.stringify({
      expectedVersion: task.version,
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(body.task.id, task.id);
  assert.equal(body.task.version, task.version);

  const listResult = await requestJson("/api/tasks");
  assert.equal(listResult.response.status, 200);
  assert.equal(listResult.body.tasks.length, 0);
});

test("DELETE /api/tasks/:id returns 409 conflict for stale expectedVersion", async () => {
  const task = await createTask({ title: "Delete conflict path" });

  const patchResult = await requestJson(`/api/tasks/${task.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: "Version bump before delete",
      expectedVersion: task.version,
    }),
  });
  assert.equal(patchResult.response.status, 200);

  const { response, body } = await requestJson(`/api/tasks/${task.id}`, {
    method: "DELETE",
    body: JSON.stringify({
      expectedVersion: task.version,
    }),
  });

  assert.equal(response.status, 409);
  assert.equal(body.code, "VERSION_CONFLICT");
  assert.match(body.message, /stale expectedVersion/);
  assert.deepEqual(body.details, {
    expectedVersion: 1,
    actualVersion: 2,
  });
});

test("DELETE /api/tasks/:id validates expectedVersion before persistence checks", async () => {
  const task = await createTask({ title: "Delete validation path" });

  const { response, body } = await requestJson(`/api/tasks/${task.id}`, {
    method: "DELETE",
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 400);
  assert.equal(body.code, "VALIDATION_ERROR");
  assert.match(body.message, /expectedVersion is required/);

  const dbTask = await prisma.task.findUnique({ where: { id: task.id } });
  assert.notEqual(dbTask, null);
});

test("task endpoints return 404 TASK_NOT_FOUND for missing task ids", async () => {
  const missingTaskId = "task_does_not_exist";

  const patchResult = await requestJson(`/api/tasks/${missingTaskId}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: "No-op",
      expectedVersion: 1,
    }),
  });

  assert.equal(patchResult.response.status, 404);
  assert.equal(patchResult.body.code, "TASK_NOT_FOUND");
  assert.match(patchResult.body.message, /task_does_not_exist/);

  const moveResult = await requestJson(`/api/tasks/${missingTaskId}/move`, {
    method: "POST",
    body: JSON.stringify({
      toStatus: "STARTED",
      expectedVersion: 1,
    }),
  });

  assert.equal(moveResult.response.status, 404);
  assert.equal(moveResult.body.code, "TASK_NOT_FOUND");
  assert.match(moveResult.body.message, /task_does_not_exist/);

  const deleteResult = await requestJson(`/api/tasks/${missingTaskId}`, {
    method: "DELETE",
    body: JSON.stringify({
      expectedVersion: 1,
    }),
  });

  assert.equal(deleteResult.response.status, 404);
  assert.equal(deleteResult.body.code, "TASK_NOT_FOUND");
  assert.match(deleteResult.body.message, /task_does_not_exist/);
});
