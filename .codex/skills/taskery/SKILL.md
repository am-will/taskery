---
name: taskery
description: Generate concise but complete instructions that teach any model how to use every Taskery feature across CLI, API, and web board workflows.
metadata:
  short-description: Full Taskery model instructions
---

# Taskery Full Operator

Use this skill when the user wants a reusable instruction set/prompt that teaches another model how to operate Taskery end-to-end.

## Defaults

Unless the user specifies otherwise, assume:
- API base URL: `http://127.0.0.1:4010`
- Web board URL: `http://127.0.0.1:3010`
- Preferred CLI: `taskery <command>`
- Source-repo CLI fallback: `pnpm --filter taskery exec node --import tsx src/bin/taskboard.ts <command>`

## Output Rules

Return one concise Markdown guide that is still complete. Keep it practical and command-first.

You must cover all of the following facets:
- Core lifecycle: create, inspect, update, move across statuses, review, complete, delete
- CLI commands: `create`, `list`, `show`, `update`, `move`, `delete`, `settings`, `up`
- CLI filters/flags, including `--status`, `--priority`, `--assignee`, `--titleContains`, and notification settings flags
- Optimistic concurrency with `expectedVersion` (required for `move` and `delete`, recommended for `update`)
- Conflict handling (`VERSION_CONFLICT` => re-fetch and retry once)
- Status and priority enums
- JSON-first behavior and exit codes (`0..4`)
- API route surface and payload shapes
- Web board features (drag/drop, edit modal, due dates, sync indicator, notification settings)
- Environment variables and run-mode differences (`taskery up` vs API/web dev split)

## Required Structure In Generated Guide

Use these section headings in order:
1. `Taskery At A Glance`
2. `Operating Rules For Models`
3. `CLI Commands`
4. `Task Lifecycle Playbooks`
5. `Notification Settings`
6. `API Surface`
7. `Web Board Features`
8. `Run Modes And Env`
9. `Failure Handling`

## Canonical Facts To Include

- Statuses: `PENDING | STARTED | BLOCKED | REVIEW | COMPLETE`
- Priorities: `LOW | MEDIUM | HIGH | URGENT`
- CLI defaults to JSON output; `--text` is optional for humans
- CLI exit codes:
  - `0`: success
  - `1`: internal/runtime error
  - `2`: validation error
  - `3`: task not found
  - `4`: version conflict
- API endpoints:
  - `GET /api/health`
  - `GET /api/tasks`
  - `POST /api/tasks`
  - `PATCH /api/tasks/:id`
  - `POST /api/tasks/:id/move`
  - `DELETE /api/tasks/:id`
  - `GET /api/settings/notifications`
  - `PATCH /api/settings/notifications`
- API response shapes:
  - `GET /api/tasks` => `{ tasks, notificationSettings }`
  - task mutations => `{ task }`
  - settings routes => `{ settings }`
  - errors => `{ code, message, details? }`

## Instruction Quality Bar

- Keep it concise, but do not omit any feature category above.
- Prefer executable examples over prose.
- Do not invent unsupported endpoints or commands.
- For any write operation, instruct models to verify state afterward with `list` or `show`.
- State explicitly that `show` obtains the current `version` for safe writes.
