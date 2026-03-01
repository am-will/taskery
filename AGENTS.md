# Taskery Agent Brief

## What Taskery Is
Taskery is a local-first Kanban system with three operator surfaces:
- Web board (`apps/web`) for drag/drop workflow management.
- API (`apps/api`) for persistence, validation, and concurrency control.
- CLI (`apps/cli`, command: `taskery`) for automation/Codex-driven task ops.

## Repo Structure
- `apps/api`: Node HTTP server + Prisma + SQLite (`apps/api/prisma/dev.db`)
- `apps/web`: React + Vite board UI, dnd-kit drag/drop, polling sync
- `apps/cli`: API client CLI with machine-readable JSON output by default
- `packages/shared`: canonical domain types, validation parsers, error codes, helpers

## Architecture Notes That Matter
- `packages/shared/src/index.ts` is the domain source of truth:
  - statuses: `PENDING | STARTED | BLOCKED | REVIEW | COMPLETE`
  - priorities: `LOW | MEDIUM | HIGH | URGENT`
  - input parsing/validation and error code constants
- API owns business invariants and writes:
  - routes: `GET /api/health`, `GET /api/tasks`, `POST /api/tasks`,
    `PATCH /api/tasks/:id`, `POST /api/tasks/:id/move`, `DELETE /api/tasks/:id`
  - optimistic concurrency via `expectedVersion`
  - stale writes return `409 VERSION_CONFLICT`
- Web behavior:
  - updates local board state, then persists via API
  - polls `/api/tasks` every 5s to reconcile CLI/API changes
  - sync indicator states: `syncing`, `synced`, `stale`
- CLI behavior:
  - invoke CLI with `pnpm --filter taskery exec node --import tsx src/bin/taskboard.ts <command> [flags]`
  - command surface: `create`, `list`, `show`, `update`, `move`, `delete`, `settings`, `up`
  - default output is JSON (use `--text` for human output)
  - use `API_BASE_URL` for non-default API targets in docs/examples
  - exit codes: `0 success`, `1 internal`, `2 validation`, `3 not found`, `4 conflict`

## Key Files To Read First
- `README.md`
- `docs/codex-skill-taskboard.md`
- `packages/shared/src/index.ts`
- `apps/api/src/index.ts`
- `apps/web/src/App.tsx`
- `apps/cli/src/index.ts`

## Operational Notes
- Deterministic local run sequence is documented in `README.md` and `docs/codex-skill-taskboard.md`.
- Current defaults in code use API `4010`, while `.env.example` shows `3011`; set explicit env vars when running to avoid mismatch.
- Release from repo root using:
  - `pnpm run release:patch`
  - `pnpm run release:publish`
- Contract/integration tests exist under:
  - `apps/api/test`
  - `apps/web/src/*.test.tsx` and `apps/web/src/board/*.test.ts`
  - `apps/cli/test`
