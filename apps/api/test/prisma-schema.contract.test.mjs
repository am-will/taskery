import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

const schemaPath = new URL("../prisma/schema.prisma", import.meta.url);

test("prisma schema defines task core models and constraints", async () => {
  const schema = await readFile(schemaPath, "utf8");

  assert.match(schema, /model\s+Task\s+\{/);
  assert.match(schema, /model\s+TaskEvent\s+\{/);
  assert.match(schema, /model\s+NotificationSettings\s+\{/);
  assert.match(schema, /status\s+TaskStatus/);
  assert.match(schema, /position\s+Int/);
  assert.match(schema, /version\s+Int/);
  assert.match(schema, /dailyHoursCsv\s+String/);
  assert.match(schema, /@@index\(\[status,\s*position\]\)/);
  assert.match(schema, /@@index\(\[updatedAt\]\)/);
  assert.match(schema, /enum\s+TaskStatus\s+\{/);
  assert.match(schema, /eventType\s+String/);
});
