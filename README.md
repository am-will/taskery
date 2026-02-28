# Taskery

A task board that both you and your AI coding agents can use at the same time.

Taskery is a local Kanban board with a web UI, a CLI, and an API — all pointing at the same SQLite database. You drag cards around in the browser while your agents create, move, and close tasks from the terminal. Everything stays in sync.

## Why

Most task trackers are built for humans only. When you start working with AI agents (Claude Code, Codex, Cursor, etc.), you need a shared surface where agents can read and write tasks without stepping on your work. Taskery handles that with optimistic concurrency — if two things try to change the same task at once, the second one gets a clear conflict error instead of silently overwriting.

## What You Get

- **Web board** — drag-and-drop Kanban columns (Pending, Started, Blocked, Review, Complete)
- **CLI** — JSON-first commands that agents and scripts can call directly
- **API** — REST endpoints for anything that needs deeper integration
- **Notifications** — optional browser reminders for tasks approaching their due dates

---

## Quick Start

You need **Node.js 18+** and **pnpm**.

```bash
git clone <your-repo-url> && cd tasks

# Install everything
pnpm bootstrap

# Set up the database
pnpm --filter @taskboard/api exec prisma migrate deploy
pnpm --filter @taskboard/api exec tsx prisma/seed.ts
```

Then start the API and web UI (two terminals, or use something like `tmux`):

```bash
# Terminal 1 — API
pnpm --filter @taskboard/api dev

# Terminal 2 — Web UI
pnpm --filter @taskboard/web dev
```

Open **http://localhost:3010** and you should see a board with a few sample tasks.

The API runs at **http://localhost:4010**. You can verify with:

```bash
curl http://localhost:4010/api/health
```

---

## Using the CLI

The CLI outputs JSON by default so agents can parse it. Add `--text` for a human-readable view.

```bash
# See all tasks
pnpm --filter taskery-cli exec taskery list

# Human-readable output
pnpm --filter taskery-cli exec taskery list --text

# Create a task
pnpm --filter taskery-cli exec taskery create "Write launch blog post" \
  --assignee "Alex" \
  --priority HIGH \
  --dueAt "2026-03-10"

# Look at a specific task (you'll need the version number for updates)
pnpm --filter taskery-cli exec taskery show <taskId>

# Move a task to a new column
pnpm --filter taskery-cli exec taskery move <taskId> \
  --toStatus REVIEW \
  --expectedVersion <version>

# Update a task
pnpm --filter taskery-cli exec taskery update <taskId> \
  --title "Updated title" \
  --expectedVersion <version>

# Delete a task
pnpm --filter taskery-cli exec taskery delete <taskId> \
  --expectedVersion <version>
```

### Why `--expectedVersion`?

This prevents race conditions. Before you move, update, or delete a task, you run `show` to get its current `version`. Then you pass that version along with your change. If someone (or some agent) changed the task in between, you'll get a `VERSION_CONFLICT` error instead of blindly overwriting their work. It's the same idea as ETags in HTTP.

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Something broke (API unreachable, runtime error) |
| `2` | Bad input (validation failed) |
| `3` | Task not found |
| `4` | Version conflict — re-fetch and try again |

---

## Using Taskery with AI Coding Agents

This is the main reason Taskery exists. Here's how to set it up with different agents.

### Claude Code

Add this to your project's `CLAUDE.md` (or paste it at the start of a conversation):

```markdown
## Task Management

Use Taskery to track work. The API is running at http://localhost:4010.

To run CLI commands:
pnpm --filter taskery-cli exec taskery <command> [flags]

Available commands: list, show, create, update, move, delete

Rules:
- Always use JSON output (no --text flag) so you can parse the response.
- Before move/update/delete, run `show <taskId>` first to get the current version.
- Pass that version as --expectedVersion on the write command.
- If you get a VERSION_CONFLICT (exit code 4), re-fetch with `show` and retry once.
- After making changes, run `list` to confirm the board state.

Statuses: PENDING, STARTED, BLOCKED, REVIEW, COMPLETE
Priorities: LOW, MEDIUM, HIGH, URGENT
```

Claude Code will then be able to create tasks from your conversations, move them as it completes work, and keep the board updated as it goes.

### Codex / Other Terminal Agents

Any agent that can run shell commands can use Taskery. The pattern is the same:

```text
Task board CLI: pnpm --filter taskery-cli exec taskery <command>
API: http://localhost:4010

Commands:
  list                          List all tasks (JSON)
  show <id>                     Get one task (includes version)
  create "title" [--flags]      Create a task
  update <id> --expectedVersion <v> [--flags]   Update fields
  move <id> --toStatus STATUS --expectedVersion <v>   Change column
  delete <id> --expectedVersion <v>   Remove a task

Always fetch current version before writing. Handle exit code 4 by retrying.
```

### Direct API Access

If your agent prefers HTTP over shell commands, hit the API directly:

| Method | Endpoint | What it does |
|--------|----------|-------------|
| `GET` | `/api/tasks` | List all tasks |
| `POST` | `/api/tasks` | Create a task |
| `PATCH` | `/api/tasks/:id` | Update a task |
| `POST` | `/api/tasks/:id/move` | Move to a new status |
| `DELETE` | `/api/tasks/:id` | Delete a task |
| `GET` | `/api/health` | Health check |

All responses follow the same envelope:

```json
// Success
{ "ok": true, "data": { ... } }

// Error
{ "ok": false, "error": { "code": "VERSION_CONFLICT", "message": "..." } }
```

---

## Typical Workflow

1. **You** open the web board, create tasks for a feature you're building.
2. **Your agent** runs `list` to see what's on the board.
3. **Your agent** picks up a task, runs `move <id> --toStatus STARTED --expectedVersion <v>`.
4. The agent does the work (writes code, runs tests, etc.).
5. **Your agent** moves the task to `REVIEW` when done.
6. **You** see it land in the Review column on the web board (auto-syncs every 5 seconds).
7. **You** review the work and drag it to Complete — or back to Started with a note.

This loop works because the board is always in sync. The web UI polls every 5 seconds, and the CLI/API changes show up on the next poll.

---

## Project Structure

```
tasks/
├── apps/
│   ├── api/       # Node.js API server + Prisma + SQLite
│   ├── cli/       # taskery CLI
│   └── web/       # React + Vite board UI
└── packages/
    └── shared/    # Types, validation, error codes (shared across all apps)
```

## Development

```bash
pnpm dev          # Start API + Web in parallel
pnpm typecheck    # Type-check all packages
pnpm lint         # Lint all packages
pnpm test         # Run all tests
```

## Troubleshooting

**Database out of sync?** Reset it:

```bash
pnpm --filter @taskboard/api exec prisma migrate reset --force --skip-seed
pnpm --filter @taskboard/api exec tsx prisma/seed.ts
```

**Port mismatch?** The API defaults to port `4010` and the web UI to `3010`. If things aren't connecting, set the ports explicitly:

```bash
API_HOST=127.0.0.1 API_PORT=4010 pnpm --filter @taskboard/api dev
VITE_API_BASE_URL=http://127.0.0.1:4010 pnpm --filter @taskboard/web dev
```

**API unreachable from CLI?** Set the base URL:

```bash
API_BASE_URL=http://127.0.0.1:4010 pnpm --filter taskery-cli exec taskery list
```

---

## License

MIT
