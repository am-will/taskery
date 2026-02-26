import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

const migrationsDir = new URL("../prisma/migrations", import.meta.url);
const seedPath = new URL("../prisma/seed.ts", import.meta.url);

test("prisma migration and seed assets exist for all workflow statuses", async () => {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const migrationDirs = entries.filter((entry) => entry.isDirectory());

  assert.ok(
    migrationDirs.length > 0,
    "expected at least one generated migration directory",
  );

  const seedContents = await readFile(seedPath, "utf8");
  for (const status of ["PENDING", "STARTED", "BLOCKED", "REVIEW", "COMPLETE"]) {
    assert.match(seedContents, new RegExp(status), `seed should include ${status}`);
  }
});
