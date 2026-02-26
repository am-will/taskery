import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";

test("taskboard CLI exposes required command surface", () => {
  const help = spawnSync(
    "pnpm",
    ["--filter", "@taskboard/cli", "exec", "tsx", "src/bin/taskboard.ts", "--help"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );

  assert.equal(help.status, 0, `help command failed: ${help.stderr}`);
  assert.match(help.stdout, /taskboard/i);
  assert.match(help.stdout, /\bcreate\b/i);
  assert.match(help.stdout, /\blist\b/i);
  assert.match(help.stdout, /\bshow\b/i);
  assert.match(help.stdout, /\bupdate\b/i);
  assert.match(help.stdout, /\bmove\b/i);
  assert.match(help.stdout, /--json/i);
});
