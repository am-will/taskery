import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

const apiEntrypoint = new URL("../src/index.ts", import.meta.url);

test("api entrypoint defines required route contracts", async () => {
  const source = await readFile(apiEntrypoint, "utf8");

  assert.match(source, /\/api\/health/);
  assert.match(source, /\/api\/tasks/);
  assert.match(source, /\/api\/tasks\/:id\/move/);
  assert.match(source, /expectedVersion/);
  assert.match(source, /VERSION_CONFLICT|409/);
});
