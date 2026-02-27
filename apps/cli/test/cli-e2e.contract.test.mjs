import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const API_HOST = "127.0.0.1";
const API_MIGRATION_FILE = "prisma/migrations/20260226063009_init_taskboard/migration.sql";
const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const cliRoot = fileURLToPath(new URL("..", import.meta.url));
const apiRoot = fileURLToPath(new URL("../../api", import.meta.url));

async function waitForHealthyApi(apiBaseUrl, apiProc, apiLogs, maxAttempts = 60) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (apiProc.exitCode !== null) {
      throw new Error(
        `API process exited before health check passed (exit ${apiProc.exitCode})\n` +
        `stdout:\n${apiLogs.stdout}\n` +
        `stderr:\n${apiLogs.stderr}`,
      );
    }

    try {
      const response = await fetch(`${apiBaseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Ignore and retry.
    }
    await sleep(100);
  }

  throw new Error("API did not become healthy in time");
}

function runCli(args, apiBaseUrl) {
  return spawnSync("node", ["--import", "tsx", "src/bin/taskboard.ts", ...args], {
    cwd: cliRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CLI_API_BASE_URL: apiBaseUrl,
      API_BASE_URL: apiBaseUrl,
    },
  });
}

async function reserveEphemeralPort() {
  const { createServer } = await import("node:net");
  const probe = createServer();
  const port = await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, API_HOST, () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Expected TCP address object when reserving API port"));
        return;
      }
      resolve(address.port);
    });
  });
  await new Promise((resolve, reject) => {
    probe.close((error) => {
      if (error !== undefined && error !== null) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  return `${port}`;
}

function parseJsonStdout(result, failureLabel) {
  assert.notEqual(result.stdout.trim().length, 0, `${failureLabel}: expected stdout payload`);
  return JSON.parse(result.stdout);
}

async function stopProcess(processHandle) {
  if (processHandle.exitCode !== null || processHandle.signalCode !== null) {
    return;
  }

  terminateProcessTree(processHandle, "SIGTERM");
  const exitedOnTerm = await Promise.race([
    new Promise((resolve) => {
      processHandle.once("exit", () => resolve(true));
    }),
    sleep(1000).then(() => false),
  ]);

  if (exitedOnTerm) {
    return;
  }

  terminateProcessTree(processHandle, "SIGKILL");
  await Promise.race([
    new Promise((resolve) => {
      processHandle.once("exit", () => resolve());
    }),
    sleep(1000),
  ]);
}

function terminateProcessTree(processHandle, signal) {
  if (processHandle.pid !== undefined) {
    try {
      process.kill(-processHandle.pid, signal);
      return;
    } catch {
      // Fall back to direct child signal if process group signal fails.
    }
  }
  processHandle.kill(signal);
}

test("cli e2e emits json by default and maps not-found/conflict exit codes", async () => {
  const sqliteDir = await mkdtemp(join(tmpdir(), "taskboard-cli-e2e-"));
  const sqlitePath = join(sqliteDir, "cli-e2e.sqlite");
  const databaseUrl = `file:${sqlitePath}`;
  const apiPort = await reserveEphemeralPort();
  const apiBaseUrl = `http://${API_HOST}:${apiPort}`;

  execFileSync(
    "pnpm",
    [
      "--filter",
      "@taskboard/api",
      "exec",
      "prisma",
      "db",
      "execute",
      "--url",
      databaseUrl,
      "--file",
      API_MIGRATION_FILE,
    ],
    {
      cwd: apiRoot,
      encoding: "utf8",
      stdio: "pipe",
    },
  );

  const apiProc = spawn("pnpm", ["--filter", "@taskboard/api", "exec", "tsx", "src/index.ts"], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      API_PORT: apiPort,
      API_HOST,
    },
    stdio: "pipe",
    detached: true,
  });
  const apiLogs = { stdout: "", stderr: "" };
  apiProc.stdout?.on("data", (chunk) => {
    apiLogs.stdout += String(chunk);
  });
  apiProc.stderr?.on("data", (chunk) => {
    apiLogs.stderr += String(chunk);
  });

  try {
    await waitForHealthyApi(apiBaseUrl, apiProc, apiLogs);

    const created = runCli(["create", "CLI e2e seed"], apiBaseUrl);
    assert.equal(created.status, 0, created.stderr);
    const createdPayload = parseJsonStdout(created, "create");
    assert.equal(createdPayload.ok, true);
    assert.equal(createdPayload.data.title, "CLI e2e seed");

    const createdTaskId = createdPayload.data.id;
    const createdVersion = createdPayload.data.version;
    assert.equal(typeof createdTaskId, "string");
    assert.equal(typeof createdVersion, "number");

    const updated = runCli(
      ["update", createdTaskId, "--title", "CLI e2e updated", "--expectedVersion", `${createdVersion}`],
      apiBaseUrl,
    );
    assert.equal(updated.status, 0, updated.stderr);
    const updatedPayload = parseJsonStdout(updated, "update");
    assert.equal(updatedPayload.ok, true);
    assert.equal(updatedPayload.data.version, createdVersion + 1);
    const updatedVersion = updatedPayload.data.version;

    const staleMove = runCli(
      ["move", createdTaskId, "--toStatus", "STARTED", "--expectedVersion", `${createdVersion}`],
      apiBaseUrl,
    );
    assert.equal(staleMove.status, 4, staleMove.stderr);
    const staleMovePayload = parseJsonStdout(staleMove, "stale move");
    assert.equal(staleMovePayload.ok, false);
    assert.equal(staleMovePayload.error.code, "VERSION_CONFLICT");

    const missingExpectedVersionDelete = runCli(
      ["delete", createdTaskId],
      apiBaseUrl,
    );
    assert.equal(missingExpectedVersionDelete.status, 2, missingExpectedVersionDelete.stderr);
    const missingExpectedVersionDeletePayload = parseJsonStdout(
      missingExpectedVersionDelete,
      "delete missing expectedVersion",
    );
    assert.equal(missingExpectedVersionDeletePayload.ok, false);
    assert.equal(missingExpectedVersionDeletePayload.error.code, "VALIDATION_ERROR");

    const staleDelete = runCli(
      ["delete", createdTaskId, "--expectedVersion", `${createdVersion}`],
      apiBaseUrl,
    );
    assert.equal(staleDelete.status, 4, staleDelete.stderr);
    const staleDeletePayload = parseJsonStdout(staleDelete, "stale delete");
    assert.equal(staleDeletePayload.ok, false);
    assert.equal(staleDeletePayload.error.code, "VERSION_CONFLICT");

    const deleted = runCli(
      ["delete", createdTaskId, "--expectedVersion", `${updatedVersion}`],
      apiBaseUrl,
    );
    assert.equal(deleted.status, 0, deleted.stderr);
    const deletedPayload = parseJsonStdout(deleted, "delete");
    assert.equal(deletedPayload.ok, true);
    assert.equal(deletedPayload.data.id, createdTaskId);

    // Contract: deleted task maps show to exit code 3.
    const missing = runCli([
      "show",
      createdTaskId,
    ], apiBaseUrl);

    assert.equal(missing.status, 3, missing.stderr);
    const missingPayload = parseJsonStdout(missing, "missing show");
    assert.equal(missingPayload.ok, false);
    assert.equal(missingPayload.error.code, "TASK_NOT_FOUND");
  } finally {
    await stopProcess(apiProc);
  }
});
