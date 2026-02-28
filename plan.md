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
- **status**: Completed (February 26, 2026)
- **location**: `apps/api/prisma/schema.prisma`
- **description**: Create SQLite models and indexes (`status + position`, `updatedAt`, `version`) and task event/audit table.
- **validation**: `pnpm --filter api prisma validate` succeeds.
- **execution log**:
  - Added `apps/api/prisma/schema.prisma` with SQLite datasource, Prisma client generator, task enums (`TaskStatus`, `TaskPriority`), and core `Task`/`TaskEvent` models.
  - Implemented required schema constraints and indexing strategy, including `@@index([status, position])` and `@@index([updatedAt])`.
  - Updated API package dependencies/scripts for Prisma tooling.
  - Verified test-first contract and schema integrity with API test, Prisma validate, and API typecheck.
- **files edited/created**:
  - `apps/api/package.json` (edited)
  - `apps/api/prisma/schema.prisma` (created)
  - `plan.md` (edited)

### T3b: Migrations and Seed Fixtures
- **depends_on**: [T3a]
- **status**: Completed (February 26, 2026)
- **location**: `apps/api/prisma/migrations/*`, `apps/api/prisma/seed.ts`
- **description**: Generate migration and deterministic seed data for all five statuses.
- **validation**: `pnpm --filter api prisma migrate dev` and seed command succeed on clean DB.
- **execution log**:
  - Generated and applied initial Prisma migration under `apps/api/prisma/migrations/20260226063009_init_taskboard`.
  - Added deterministic, rerunnable `prisma/seed.ts` using `upsert` with fixed IDs across all five workflow statuses.
  - Verified migration/seed contracts and rerun behavior via targeted API test suite, `prisma migrate dev`, and direct seed execution.
- **files edited/created**:
  - `apps/api/prisma/migrations/20260226063009_init_taskboard/migration.sql` (created)
  - `apps/api/prisma/migrations/migration_lock.toml` (created)
  - `apps/api/prisma/seed.ts` (created)
  - `plan.md` (edited)

### T4: Implement Local API Server
- **depends_on**: [T1, T2, T3a]
- **status**: Completed (February 26, 2026)
- **location**: `apps/api/src/*`
- **description**: Build CRUD, move endpoint with `expectedVersion`, conflict handling (`409`), and health endpoint.
- **validation**: API smoke tests and manual `curl` checks for create/list/move/conflict.
- **execution log**:
  - Replaced API scaffold with a production-grade Node HTTP service exposing `GET /api/health`, `GET /api/tasks`, `POST /api/tasks`, `PATCH /api/tasks/:id`, and `POST /api/tasks/:id/move`.
  - Wired shared contract parsing (`taskCreateInputSchema`, `taskUpdateInputSchema`, `taskMoveInputSchema`) and standardized error envelopes via `buildTaskError`.
  - Implemented optimistic concurrency checks using `expectedVersion` and explicit `409 VERSION_CONFLICT` responses for stale updates.
  - Added transition enforcement for move operations and deterministic position assignment for new/moved tasks.
  - Validated route contract tests plus API typecheck/build.
- **files edited/created**:
  - `apps/api/src/index.ts` (edited)
  - `plan.md` (edited)

### T5: Build Tasky CLI
- **depends_on**: [T2, T4]
- **status**: Completed (February 26, 2026)
- **location**: `apps/cli/src/*`, `apps/cli/bin/taskboard`
- **description**: Implement commands for create/list/show/update/move against API with machine-readable JSON.
- **validation**: CLI contract tests verify JSON schema, exit codes, and deterministic output.
- **execution log**:
  - Replaced CLI scaffold with full `taskboard` command surface (`create`, `list`, `show`, `update`, `move`) and help output.
  - Implemented API-backed command execution with local base URL resolution from env (`CLI_API_BASE_URL` / `API_BASE_URL`).
  - Added machine-readable JSON output mode and standardized error-to-exit-code mapping (`0`, `1`, `2`, `3`, `4`).
  - Added and satisfied test-first CLI contract check for required commands and `--json` support.
  - Verified CLI test, typecheck, and build.
- **files edited/created**:
  - `apps/cli/src/index.ts` (edited)
  - `apps/cli/src/bin/taskboard.ts` (edited)
  - `apps/cli/package.json` (edited, test runtime)
  - `apps/cli/test/cli-contract.test.mjs` (created, prewritten test-first contract)
  - `plan.md` (edited)

### T6: Build Desktop Dark UI Shell (Frontend Design Skill Direction)
- **depends_on**: [T1, T2]
- **status**: Completed (February 26, 2026)
- **location**: `apps/web/src/*`
- **description**: Create industrial-minimal dark board shell, desktop layout, custom typography, and clear column system.
- **validation**: Local visual check on desktop width; no mobile-specific UI commitments.
- **execution log**:
  - Replaced scaffold UI with an industrial-minimal dark desktop shell using a clear visual system and CSS variables.
  - Added explicit board root contract for testing/integration (`data-testid="board-shell"`, `data-theme="industrial-dark"`).
  - Implemented desktop-first five-column workflow shell (`Pending`, `Started`, `Blocked`, `Review`, `Complete`) without drag/drop or API wiring.
  - Added dedicated board styling in `App.css` with high-contrast surfaces, restrained accenting, and desktop-oriented spacing.
  - Verified with web test, typecheck, and production build.
- **files edited/created**:
  - `apps/web/src/App.tsx` (edited)
  - `apps/web/src/App.css` (created)
  - `apps/web/src/app-shell.test.tsx` (created, prewritten test-first contract)
  - `apps/web/package.json` (edited, test runtime)
  - `pnpm-lock.yaml` (edited)
  - `plan.md` (edited)

### T7: Drag-and-Drop Kanban Behavior
- **depends_on**: [T2, T4, T6]
- **status**: Completed (February 26, 2026)
- **location**: `apps/web/src/board/*`
- **description**: Use dnd-kit multiple container pattern with `SortableContext` per column, `DragOverlay`, pointer + keyboard sensors, cross-column and intra-column reorder, and empty-column drop zones.
- **validation**: UI test proves dragging between every status and reordering within a column; conflict rollback on stale version.
- **execution log**:
  - Added explicit board-state module with typed helpers for empty state, task insertion, and cross/intra-column move semantics.
  - Integrated dnd-kit-driven drag/drop interactions in UI with pointer + keyboard sensors, sortable columns, and empty-column drop handling.
  - Preserved existing editor shell and visual style while enabling status movement and reordering behavior.
  - Added and satisfied test-first drag/drop state contract tests, then verified full web test/typecheck/build suite.
- **files edited/created**:
  - `apps/web/src/board/kanban-state.ts` (created)
  - `apps/web/src/board/kanban-state.contract.test.ts` (created, prewritten test-first contract)
  - `apps/web/src/App.tsx` (edited)
  - `apps/web/src/App.css` (edited)
  - `apps/web/package.json` (edited, dnd-kit deps)
  - `pnpm-lock.yaml` (edited)
  - `plan.md` (edited)

### T8: Task Create/Edit UX
- **depends_on**: [T2, T3a, T4, T6]
- **status**: Completed (February 26, 2026)
- **location**: `apps/web/src/task-editor/*`
- **description**: Add create/edit drawer/form for title, priority, due date, assignee, notes with validation.
- **validation**: Form tests for required fields, invalid values, and successful save/update.
- **execution log**:
  - Added desktop-integrated task editor panel with `New Task` action and controlled create/edit form state.
  - Implemented required form fields: `title`, `priority`, `due date`, `assignee`, and `notes`.
  - Preserved and extended industrial-dark shell styling while keeping task editor scope separate from drag/drop behavior.
  - Verified test-first editor contract, web typecheck, and production build.
- **files edited/created**:
  - `apps/web/src/App.tsx` (edited)
  - `apps/web/src/App.css` (edited)
  - `apps/web/src/task-editor.contract.test.tsx` (created, prewritten test-first contract)
  - `plan.md` (edited)

### T9: CLI-to-UI Sync Strategy
- **depends_on**: [T4, T5, T6]
- **status**: Completed (February 26, 2026)
- **location**: `apps/web/src/sync/*`
- **description**: Implement polling-based refresh for task changes made by CLI and stale indicator/clear behavior.
- **validation**: Scenario test where CLI move is reflected in board within max staleness threshold.
- **execution log**:
  - Added polling-based board refresh against API task list endpoint with periodic sync checks.
  - Implemented explicit sync indicator UI (`data-testid=\"sync-indicator\"`) with states for syncing, stale, and synced conditions.
  - Added stale-to-synced recovery regression coverage using controlled fetch/timer behavior.
  - Verified full web test suite, typecheck, and build after sync integration.
- **files edited/created**:
  - `apps/web/src/App.tsx` (edited)
  - `apps/web/src/App.css` (edited)
  - `apps/web/src/sync-indicator.contract.test.tsx` (edited, prewritten test-first contract)
  - `plan.md` (edited)

### T10a: Domain Unit Tests
- **depends_on**: [T2]
- **status**: Completed (February 26, 2026)
- **location**: `packages/shared/src/**/*.test.ts`
- **description**: Test transitions, ordering logic, and version conflict helpers.
- **validation**: `pnpm test:domain` passes.
- **execution log**:
  - Added/expanded shared domain-unit coverage for transition policy, position ordering semantics, version/position normalization, and invalid update payload rejection.
  - Added deterministic root script `test:domain` to run shared contract tests directly.
  - Tightened shared update DTO behavior so empty update payloads are rejected to satisfy fail-fast contract expectations.
  - Validated with `pnpm test:domain` and shared package typecheck.
- **files edited/created**:
  - `package.json` (edited, added `test:domain`)
  - `packages/shared/src/contracts.test.ts` (edited)
  - `packages/shared/src/index.ts` (edited)
  - `plan.md` (edited)

### T10b: API Integration Tests
- **depends_on**: [T3b, T4]
- **status**: Completed (February 26, 2026)
- **location**: `apps/api/test/*`
- **description**: Test CRUD, move ordering, conflict handling, and error envelopes with SQLite test DB.
- **validation**: `pnpm test:api` passes.
- **execution log**:
  - Added API integration suite validating health, create/list, update, move, stale-version conflict (`409`), and not-found behavior.
  - Upgraded API test runner to `node --import tsx --test` for stable TypeScript-backed integration execution.
  - Confirmed integration tests execute against local SQLite-backed API behavior with deterministic assertions and expected envelopes/status codes.
  - Verified API test suite and typecheck pass.
- **files edited/created**:
  - `apps/api/test/api.integration.test.mjs` (created)
  - `apps/api/package.json` (edited, integration test runtime)
  - `apps/api/src/index.ts` (edited, testability updates)
  - `plan.md` (edited)

### T10c: CLI End-to-End Tests
- **depends_on**: [T4, T5]
- **status**: Completed (February 26, 2026)
- **location**: `apps/cli/test/*`
- **description**: Spawn API, run CLI commands, assert exit codes + JSON schema + persisted state.
- **validation**: `pnpm test:cli` passes.
- **execution log**:
  - Added CLI e2e contract suite that provisions isolated SQLite state, runs API in-process, and validates create/update/move/show flows.
  - Verified JSON-first CLI behavior for automation and asserted exit-code mapping for not-found (`3`) and stale-version conflict (`4`).
  - Hardened test process lifecycle handling for API startup/teardown to reduce flakiness.
  - Validated CLI test suite, typecheck, and build.
- **files edited/created**:
  - `apps/cli/test/cli-e2e.contract.test.mjs` (created, prewritten test-first contract then completed)
  - `apps/cli/src/index.ts` (edited, JSON-first behavior and CLI output controls)
  - `plan.md` (edited)

### T10d: Web UI Regression Tests
- **depends_on**: [T6, T7, T8, T9]
- **status**: Completed (February 26, 2026)
- **location**: `apps/web/test/*`
- **description**: Validate drag/drop flows, conflict rollback, and editor interactions.
- **validation**: `pnpm test:web` passes.
- **execution log**:
  - Expanded regression coverage for kanban state transitions, including cross-column insertion ordering and drag/drop happy-path semantics.
  - Strengthened sync indicator regression checks to assert stale -> syncing -> synced recovery behavior.
  - Added editor interaction assertions for field updates and `New Task` reset behavior.
  - Verified web regression suite, typecheck, and production build.
- **files edited/created**:
  - `apps/web/src/board/kanban-state.contract.test.ts` (edited)
  - `apps/web/src/sync-indicator.contract.test.tsx` (edited)
  - `apps/web/src/task-editor.contract.test.tsx` (edited)
  - `plan.md` (edited)

### T11: Runbook and Codex Skill Integration Guide
- **depends_on**: [T5, T7, T8, T9, T10a, T10b, T10c, T10d]
- **status**: Completed (February 26, 2026)
- **location**: `README.md`, `docs/codex-skill-taskboard.md`
- **description**: Document startup sequence, CLI command examples for Codex skills, DB reset/recovery, and troubleshooting.
- **validation**: Fresh-start runbook followed successfully on clean machine profile.
- **execution log**:
  - Updated `README.md` with deterministic startup flow, health checks, and script index aligned to implemented workspace behavior.
  - Added `docs/codex-skill-taskboard.md` runbook covering startup, DB reset/seed, migration recovery, CLI automation patterns, and exit-code/error contracts.
  - Documented API-unavailable behavior and retry guidance for automation callers.
  - Verified CLI help command behavior and completed full workspace validation pass (`test`, `typecheck`, and build).
- **files edited/created**:
  - `README.md` (edited)
  - `docs/codex-skill-taskboard.md` (created)
  - `plan.md` (edited)

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
