import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";

test("taskery CLI exposes required command surface", () => {
  const help = spawnSync(
    "pnpm",
    ["--filter", "taskery-cli", "exec", "tsx", "src/bin/taskboard.ts", "--help"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );

  assert.equal(help.status, 0, `help command failed: ${help.stderr}`);
  assert.match(help.stdout, /taskery/i);
  assert.doesNotMatch(help.stdout, /\btaskboard\b/i);
  assert.doesNotMatch(help.stdout, /\btasky\b/i);
  assert.match(help.stdout, /\bcreate\b/i);
  assert.match(help.stdout, /\blist\b/i);
  assert.match(help.stdout, /\bshow\b/i);
  assert.match(help.stdout, /\bupdate\b/i);
  assert.match(help.stdout, /\bmove\b/i);
  assert.match(help.stdout, /\bdelete\b/i);
  assert.match(help.stdout, /\bsettings\b/i);
  assert.match(help.stdout, /--json/i);
  assert.match(help.stdout, /--text/i);
  assert.match(help.stdout, /--create/i);
  assert.match(help.stdout, /--move/i);
  assert.match(help.stdout, /--settings/i);
  assert.match(help.stdout, /CLI_API_BASE_URL/i);
  assert.match(help.stdout, /Exit Codes/i);

  const jsonHelp = spawnSync(
    "pnpm",
    ["--filter", "taskery-cli", "exec", "tsx", "src/bin/taskboard.ts", "--json", "--help"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );
  assert.equal(jsonHelp.status, 0, `json help command failed: ${jsonHelp.stderr}`);
  assert.match(jsonHelp.stdout, /Usage:/i);
  assert.doesNotMatch(jsonHelp.stdout, /\"ok\"\s*:\s*true/i);
});
