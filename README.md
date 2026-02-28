# Tasky Workspace

Monorepo for Tasky API, web UI, CLI, and shared contracts.

## Apps

- `apps/api`: Node + Prisma API
- `apps/web`: React + Vite kanban UI
- `apps/cli`: Tasky CLI
- `packages/shared`: shared task schemas, errors, and domain helpers

## Local Runbook (Deterministic)

1. Install deps:
   - `pnpm bootstrap`
2. Apply schema to local SQLite DB (`apps/api/prisma/dev.db`):
   - `pnpm --filter @taskboard/api exec prisma migrate deploy`
3. Seed deterministic fixtures:
   - `pnpm --filter @taskboard/api exec tsx prisma/seed.ts`
4. Start API (terminal 1):
   - `API_HOST=127.0.0.1 API_PORT=4010 pnpm --filter @taskboard/api dev`
5. Start web (terminal 2):
   - `VITE_API_BASE_URL=http://127.0.0.1:4010 pnpm --filter @taskboard/web dev`
6. Use CLI (terminal 3):
   - `API_BASE_URL=http://127.0.0.1:4010 pnpm --filter taskery-cli exec node --import tsx src/bin/taskboard.ts list`
   - `API_BASE_URL=http://127.0.0.1:4010 pnpm --filter taskery-cli exec node --import tsx src/bin/taskboard.ts settings`
   - `API_BASE_URL=http://127.0.0.1:4010 pnpm --filter taskery-cli exec node --import tsx src/bin/taskboard.ts delete <taskId> --expectedVersion <version>`

## Health Checks

- API:
  - `curl -sf http://127.0.0.1:4010/api/health`
- API task list:
  - `curl -sf http://127.0.0.1:4010/api/tasks`
- CLI to API:
  - `API_BASE_URL=http://127.0.0.1:4010 pnpm --filter taskery-cli exec node --import tsx src/bin/taskboard.ts list`

## Script Index

- `pnpm bootstrap`
- `pnpm dev`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:domain`

Full operational guide (startup, reset/seed, migration recovery, Codex integration, exit-code contracts):
- `docs/codex-skill-taskboard.md`
