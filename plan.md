# Plan: Desktop Codex-Integrated Kanban Task Board

**Generated**: February 26, 2026

## Summary
Build a greenfield local app in `/home/willr/Applications/tasks` with:
- Desktop-only React/TSX Kanban board (dark, industrial-minimal design).
- Task workflow columns: `Pending`, `Started`, `Blocked`, `Review`, `Complete`.
- Full drag/drop across columns and within columns.
- Shared local API + SQLite/Prisma persistence.
- CLI (`taskboard ...`) that your Codex skill can call to create/manage tasks during the day.
- No Codex-run launching in v1; task-management integration only.

## Public APIs, Interfaces, and Types

### Domain types (single source of truth in `packages/shared`)
- `TaskStatus = "PENDING" | "STARTED" | "BLOCKED" | "REVIEW" | "COMPLETE"`
- `TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT"`
- `Task`:
  - `id: string`
  - `title: string`
  - `status: TaskStatus`
  - `priority: TaskPriority`
  - `dueAt: string | null`
  - `assignee: string | null`
  - `notes: string | null`
  - `position: number`
  - `version: number`
  - `createdAt: string`
  - `updatedAt: string`

### API contract (`apps/api`)
- `GET /api/health`
- `GET /api/tasks?status=&q=&limit=&cursor=`
- `POST /api/tasks`
- `PATCH /api/tasks/:id`
- `POST /api/tasks/:id/move` with `{ toStatus, toPosition, expectedVersion }`
- Error envelope: `{ ok: false, error: { code, message, details } }`
- Success envelope: `{ ok: true, data }`

### CLI contract (`apps/cli/bin/taskboard`)
- `taskboard create --title ... [--priority ...] [--due ...] [--assignee ...] [--notes ...]`
- `taskboard list [--status ...] [--json]`
- `taskboard move --id ... --to ... [--position ...] [--expected-version ...]`
- `taskboard update --id ... [--title ...] [--priority ...] [--due ...] [--assignee ...] [--notes ...]`
- `taskboard show --id ... [--json]`
- Exit codes:
  - `0` success
  - `2` validation error
  - `3` not found
  - `4` version conflict
  - `1` internal/system error
- `--json` default for Codex skill compatibility.

## Dependency Graph

```text
T0 ──> T1 ────────────────┬──────────────> T6 ──┬────> T7 ──┐
                          │                     │            │
                          └────> T2 ──┬──> T3a ┴──> T8      │
                                       │      └──> T3b ──┐   │
                                       ├──> T4 ──┬──> T5 ┴──> T9
                                       │         │
                                       │         ├──> T10b
                                       │         └──> T10c
                                       └──> T10a

T6 + T7 + T8 + T9 ──> T10d
T5 + T7 + T8 + T9 + T10a + T10b + T10c + T10d ──> T11
```

## Tasks

### T0: Runtime and Workspace Contract
- **depends_on**: []
- **status**: Completed (February 26, 2026)
- **location**: `package.json`, `pnpm-workspace.yaml`, `.env.example`, `README.md`
- **description**: Define monorepo layout, scripts, fixed ports, environment schema, and local-only CORS policy.
- **validation**: `pnpm -w install` and `pnpm -w run -r --if-present typecheck` succeed.
- **execution log**:
  - Created root `package.json` with deterministic workspace fan-out scripts: `bootstrap`, `dev`, `typecheck`, `lint`, `test`.
  - Created `pnpm-workspace.yaml` with canonical workspace globs: `apps/*` and `packages/*`.
  - Created `.env.example` with fixed local runtime contract for web/api/cli, API/WEB ports (`3011`/`3010`), and constrained local CORS origins.
  - Created `README.md` documenting fixed ports, local-only CORS policy, environment contract, and exact startup order.
- **files edited/created**:
  - `package.json` (created)
  - `pnpm-workspace.yaml` (created)
  - `.env.example` (created)
  - `README.md` (created)
  - `plan.md` (edited)

### T1: Scaffold Project Packages
- **depends_on**: [T0]
- **status**: Completed (February 26, 2026)
- **location**: `apps/web`, `apps/api`, `apps/cli`, `packages/shared`
- **description**: Initialize Vite React TS web app and TypeScript API/CLI/shared packages with consistent tooling.
- **validation**: All packages build with workspace commands and no unresolved imports.
- **execution log**:
  - Created monorepo package skeletons for `apps/web`, `apps/api`, `apps/cli`, and `packages/shared` with minimal placeholder entrypoints and deterministic script contracts.
  - Added root `tsconfig.base.json` and package-level TypeScript configs for browser (`Bundler` + `react-jsx`) and Node packages (`NodeNext`) to enforce consistent compiler behavior.
  - Added package `package.json` manifests with `dev`, `build`, `typecheck`, and `test` scripts to ensure root workspace fan-out commands run without missing-script failures.
  - Wired workspace-local shared dependency via `@taskboard/shared` in API and CLI package manifests.
  - Generated/updated workspace lockfile through `pnpm install` and validated workspace `typecheck` and recursive `build` commands.
- **files edited/created**:
  - `tsconfig.base.json` (created)
  - `apps/web/package.json` (created)
  - `apps/web/index.html` (created)
  - `apps/web/vite.config.ts` (created)
  - `apps/web/tsconfig.json` (created)
  - `apps/web/tsconfig.app.json` (created)
  - `apps/web/src/App.tsx` (created)
  - `apps/web/src/main.tsx` (created)
  - `apps/web/src/vite-env.d.ts` (created)
  - `apps/api/package.json` (created)
  - `apps/api/tsconfig.json` (created)
  - `apps/api/tsconfig.build.json` (created)
  - `apps/api/src/index.ts` (created)
  - `apps/cli/package.json` (created)
  - `apps/cli/tsconfig.json` (created)
  - `apps/cli/tsconfig.build.json` (created)
  - `apps/cli/src/index.ts` (created)
  - `apps/cli/src/bin/taskboard.ts` (created)
  - `packages/shared/package.json` (created)
  - `packages/shared/tsconfig.json` (created)
  - `packages/shared/tsconfig.build.json` (created)
  - `packages/shared/src/index.ts` (created)
  - `pnpm-lock.yaml` (edited)
  - `plan.md` (edited)

### T2: Define Domain Invariants and Shared Contracts
- **depends_on**: [T0]
- **status**: Completed (February 26, 2026)
- **location**: `packages/shared/src/*`
- **description**: Add status transition matrix, ordering rules (`position`), optimistic concurrency (`version`), DTOs, and error schema.
- **validation**: Contract tests compile and schema validation passes for sample payloads.
- **execution log**:
  - Replaced shared scaffold export with canonical task domain constants/types for statuses, priorities, versioning, and position sequencing.
  - Added deterministic status transition policy and reusable helpers for transition checks, next-position generation, and invariant normalization for `position` and `version`.
  - Implemented shared create/update/move DTO parse schemas with defaults, input constraints, and fail-fast validation semantics.
  - Added stable API/CLI error code constants and shared error envelope builder.
  - Expanded shared contract tests to cover transition edge cases, schema defaults/invalid inputs, and optimistic concurrency/order primitives.
- **files edited/created**:
  - `packages/shared/package.json` (edited)
  - `packages/shared/src/index.ts` (edited)
  - `packages/shared/src/contracts.test.ts` (edited)
  - `pnpm-lock.yaml` (edited)
  - `plan.md` (edited)

### T3a: Prisma Schema and Constraints
- **depends_on**: [T1, T2]
- **location**: `apps/api/prisma/schema.prisma`
- **description**: Create SQLite models and indexes (`status + position`, `updatedAt`, `version`) and task event/audit table.
- **validation**: `pnpm --filter api prisma validate` succeeds.

### T3b: Migrations and Seed Fixtures
- **depends_on**: [T3a]
- **location**: `apps/api/prisma/migrations/*`, `apps/api/prisma/seed.ts`
- **description**: Generate migration and deterministic seed data for all five statuses.
- **validation**: `pnpm --filter api prisma migrate dev` and seed command succeed on clean DB.

### T4: Implement Local API Server
- **depends_on**: [T1, T2, T3a]
- **location**: `apps/api/src/*`
- **description**: Build CRUD, move endpoint with `expectedVersion`, conflict handling (`409`), and health endpoint.
- **validation**: API smoke tests and manual `curl` checks for create/list/move/conflict.

### T5: Build Taskboard CLI
- **depends_on**: [T2, T4]
- **location**: `apps/cli/src/*`, `apps/cli/bin/taskboard`
- **description**: Implement commands for create/list/show/update/move against API with machine-readable JSON.
- **validation**: CLI contract tests verify JSON schema, exit codes, and deterministic output.

### T6: Build Desktop Dark UI Shell (Frontend Design Skill Direction)
- **depends_on**: [T1, T2]
- **location**: `apps/web/src/*`
- **description**: Create industrial-minimal dark board shell, desktop layout, custom typography, and clear column system.
- **validation**: Local visual check on desktop width; no mobile-specific UI commitments.

### T7: Drag-and-Drop Kanban Behavior
- **depends_on**: [T2, T4, T6]
- **location**: `apps/web/src/board/*`
- **description**: Use dnd-kit multiple container pattern with `SortableContext` per column, `DragOverlay`, pointer + keyboard sensors, cross-column and intra-column reorder, and empty-column drop zones.
- **validation**: UI test proves dragging between every status and reordering within a column; conflict rollback on stale version.

### T8: Task Create/Edit UX
- **depends_on**: [T2, T3a, T4, T6]
- **location**: `apps/web/src/task-editor/*`
- **description**: Add create/edit drawer/form for title, priority, due date, assignee, notes with validation.
- **validation**: Form tests for required fields, invalid values, and successful save/update.

### T9: CLI-to-UI Sync Strategy
- **depends_on**: [T4, T5, T6]
- **location**: `apps/web/src/sync/*`
- **description**: Implement polling-based refresh for task changes made by CLI and stale indicator/clear behavior.
- **validation**: Scenario test where CLI move is reflected in board within max staleness threshold.

### T10a: Domain Unit Tests
- **depends_on**: [T2]
- **location**: `packages/shared/src/**/*.test.ts`
- **description**: Test transitions, ordering logic, and version conflict helpers.
- **validation**: `pnpm test:domain` passes.

### T10b: API Integration Tests
- **depends_on**: [T3b, T4]
- **location**: `apps/api/test/*`
- **description**: Test CRUD, move ordering, conflict handling, and error envelopes with SQLite test DB.
- **validation**: `pnpm test:api` passes.

### T10c: CLI End-to-End Tests
- **depends_on**: [T4, T5]
- **location**: `apps/cli/test/*`
- **description**: Spawn API, run CLI commands, assert exit codes + JSON schema + persisted state.
- **validation**: `pnpm test:cli` passes.

### T10d: Web UI Regression Tests
- **depends_on**: [T6, T7, T8, T9]
- **location**: `apps/web/test/*`
- **description**: Validate drag/drop flows, conflict rollback, and editor interactions.
- **validation**: `pnpm test:web` passes.

### T11: Runbook and Codex Skill Integration Guide
- **depends_on**: [T5, T7, T8, T9, T10a, T10b, T10c, T10d]
- **location**: `README.md`, `docs/codex-skill-taskboard.md`
- **description**: Document startup sequence, CLI command examples for Codex skills, DB reset/recovery, and troubleshooting.
- **validation**: Fresh-start runbook followed successfully on clean machine profile.

## Parallel Execution Groups

| Wave | Tasks | Can Start When |
|---|---|---|
| 1 | T0 | Immediately |
| 2 | T1, T2 | T0 complete |
| 3 | T3a, T6, T10a | T1+T2 complete (or T2 for T10a) |
| 4 | T3b, T4, T8 | T3a complete (+dependencies) |
| 5 | T5, T7, T10b, T10c, T9 | T4 complete (+dependencies) |
| 6 | T10d | T6+T7+T8+T9 complete |
| 7 | T11 | All test waves and integration tasks complete |

## Test Cases and Scenarios
- Drag a task from `Pending` to `Started`, then to `Blocked`, then `Review`, then `Complete`.
- Reorder three tasks inside one status column and verify persisted `position`.
- Drop a task into an empty column.
- Simulate concurrent moves and verify API returns `409` on stale `expectedVersion`.
- Verify UI rollback and column refetch after conflict.
- Create/update tasks via CLI and confirm board reflects changes within polling window.
- Verify CLI JSON output schema and expected exit codes for validation/not-found/conflict/internal.
- Verify desktop layout rendering and interaction at standard desktop widths.

## Risks and Mitigations
- Race conditions during drag/drop updates.
  - Mitigation: optimistic concurrency with `version` and strict conflict handling.
- Drift between CLI and API contracts.
  - Mitigation: shared DTO schema package and CLI schema tests.
- Local developer setup inconsistency.
  - Mitigation: deterministic scripts, fixed ports, and runbook-first validation.

## Assumptions and Defaults
- Desktop-only v1; no mobile-specific optimization.
- Status transitions are allowed between any two of the five statuses via drag/drop.
- Codex integration in v1 is via CLI task commands only, not launching Codex sessions.
- Polling is acceptable for CLI-originated updates in v1.
- Implementation phase will persist this plan as `taskboard-codex-kanban-plan.md` in the repo root.
