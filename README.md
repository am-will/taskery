# Taskboard Workspace Contract (T0)

This repository root defines the runtime/workspace contract for downstream tasks T1/T2.

## Workspace Layout

- `apps/*` for runnable applications (`web`, `api`, `cli` in T1)
- `packages/*` for shared libraries (`shared` in T1/T2)

## Fixed Local Runtime Ports

- Web: `3010`
- API: `3011`

## Local-Only CORS Policy

API CORS must allow only these desktop-local origins:

- `http://localhost:3010`
- `http://127.0.0.1:3010`

Canonical env key: `CORS_ALLOWED_ORIGINS=http://localhost:3010,http://127.0.0.1:3010`

## Environment Contract

Copy `.env.example` to `.env` and keep these values aligned across web/api/cli:

- `API_PORT=3011`
- `WEB_PORT=3010`
- `API_BASE_URL=http://127.0.0.1:3011`
- `CLI_API_BASE_URL=http://127.0.0.1:3011`
- `CORS_ALLOWED_ORIGINS=http://localhost:3010,http://127.0.0.1:3010`

## Root Scripts

- `pnpm bootstrap`: install workspace dependencies
- `pnpm dev`: run `dev` scripts across workspace packages in parallel
- `pnpm typecheck`: run `typecheck` across workspace packages (`--if-present`)
- `pnpm lint`: run `lint` across workspace packages (`--if-present`)
- `pnpm test`: run `test` across workspace packages (`--if-present`, deterministic single-package concurrency)

## Startup Order (Exact)

1. `pnpm bootstrap`
2. `pnpm --filter ./apps/api dev` (API on `http://127.0.0.1:3011`)
3. `pnpm --filter ./apps/web dev` (Web on `http://127.0.0.1:3010`)
4. Optional combined mode after T1 scaffolding: `pnpm dev`

Notes:
- T0 does not scaffold `apps/*` or `packages/*`; those are created in T1/T2.
- CLI uses `CLI_API_BASE_URL` and should target API port `3011`.
