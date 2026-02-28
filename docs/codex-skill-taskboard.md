# Taskboard Runbook and Codex Skill Integration

## Deterministic Local Startup Sequence

Run from workspace root:

1. Install dependencies:
   - `pnpm bootstrap`
2. Apply migrations:
   - `pnpm --filter @taskboard/api exec prisma migrate deploy`
3. Seed deterministic local fixtures:
   - `pnpm --filter @taskboard/api exec tsx prisma/seed.ts`
4. Start API:
   - `API_HOST=127.0.0.1 API_PORT=4010 pnpm --filter @taskboard/api dev`
5. Start web:
   - `VITE_API_BASE_URL=http://127.0.0.1:4010 pnpm --filter @taskboard/web dev`
6. Use CLI:
   - `CLI_API_BASE_URL=http://127.0.0.1:4010 pnpm --filter @taskboard/cli exec tsx src/bin/taskboard.ts --help`

## Health Checks

- API liveness:
  - `curl -sf http://127.0.0.1:4010/api/health`
  - Expected: `{"status":"ok"}`
- API tasks route:
  - `curl -sf http://127.0.0.1:4010/api/tasks`
  - Expected: JSON envelope containing `tasks`
- CLI reachability to API:
  - `CLI_API_BASE_URL=http://127.0.0.1:4010 pnpm --filter @taskboard/cli exec tsx src/bin/taskboard.ts list`
  - Expected exit code `0` with JSON payload (`--json` is default)

## DB Reset and Seed

Use this for deterministic local recovery of `apps/api/prisma/dev.db`:

1. Reset DB and reapply migrations:
   - `pnpm --filter @taskboard/api exec prisma migrate reset --force --skip-seed`
2. Seed fixtures:
   - `pnpm --filter @taskboard/api exec tsx prisma/seed.ts`
3. Verify:
   - `curl -sf http://127.0.0.1:4010/api/tasks`

## Migration Recovery Steps

When local schema/migration state is broken:

1. Check status:
   - `pnpm --filter @taskboard/api exec prisma migrate status`
2. Fast recovery path (preferred for local dev DB):
   - `pnpm --filter @taskboard/api exec prisma migrate reset --force --skip-seed`
   - `pnpm --filter @taskboard/api exec tsx prisma/seed.ts`
3. If DB file is corrupted/locked, remove only local SQLite files and reapply:
   - `trash apps/api/prisma/dev.db apps/api/prisma/dev.db-journal`
   - `pnpm --filter @taskboard/api exec prisma migrate deploy --schema prisma/schema.prisma`
   - `pnpm --filter @taskboard/api exec tsx prisma/seed.ts`

## Codex Skill Integration via CLI

The CLI is deterministic for automation because it defaults to JSON output.

Examples:

- List tasks for agent parsing:
  - `CLI_API_BASE_URL=http://127.0.0.1:4010 pnpm --filter @taskboard/cli exec tsx src/bin/taskboard.ts list | jq`
- Create task:
  - `CLI_API_BASE_URL=http://127.0.0.1:4010 pnpm --filter @taskboard/cli exec tsx src/bin/taskboard.ts create "Triage prod issue" --priority HIGH --status PENDING`
- Update task with optimistic version check:
  - `CLI_API_BASE_URL=http://127.0.0.1:4010 pnpm --filter @taskboard/cli exec tsx src/bin/taskboard.ts update <taskId> --title "Updated title" --expectedVersion <version>`
- Move task:
  - `CLI_API_BASE_URL=http://127.0.0.1:4010 pnpm --filter @taskboard/cli exec tsx src/bin/taskboard.ts move <taskId> --toStatus REVIEW --expectedVersion <version>`
- Delete task:
  - `CLI_API_BASE_URL=http://127.0.0.1:4010 pnpm --filter @taskboard/cli exec tsx src/bin/taskboard.ts delete <taskId> --expectedVersion <version>`
- Human-readable output for operator use:
  - `CLI_API_BASE_URL=http://127.0.0.1:4010 pnpm --filter @taskboard/cli exec tsx src/bin/taskboard.ts list --text`

## Exit Codes and Error Behavior

CLI process exit code contract:

- `0`: success
- `1`: internal/runtime error (including API unavailable/fetch failure)
- `2`: validation error (missing/invalid flags, 400/405/422 API validation responses)
- `3`: task not found
- `4`: version conflict

Error envelope contract (`--json`, default):

```json
{
  "ok": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Request failed: fetch failed"
  },
  "exitCode": 1
}
```

API unavailable handling for automation:

1. Treat non-zero CLI exit code as failure.
2. Retry only for exit code `1`.
3. Do not retry for exit codes `2`, `3`, or `4` without input/state change.
