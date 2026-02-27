import "./App.css";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { DragEndEvent } from "@dnd-kit/core";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDroppable } from "@dnd-kit/core";
import {
  BOARD_STATUSES,
  type BoardState,
  type BoardStatus,
  type BoardTask,
  createEmptyBoardState,
  moveTaskCard,
} from "./board/kanban-state";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:4010";
const REFRESH_INTERVAL_MS = 5000;

const statusLabels: Record<BoardStatus, string> = {
  PENDING: "Pending",
  STARTED: "Started",
  BLOCKED: "Blocked",
  REVIEW: "Review",
  COMPLETE: "Complete",
};

const defaultTaskDraft = {
  title: "",
  priority: "Medium",
  dueDate: "",
  assignee: "",
  notes: "",
};

const priorityToApiValue: Record<string, "LOW" | "MEDIUM" | "HIGH" | "URGENT"> = {
  Low: "LOW",
  Medium: "MEDIUM",
  High: "HIGH",
  Critical: "URGENT",
};

const taskDragId = (taskId: string) => `task:${taskId}`;
const columnDropId = (status: BoardStatus) => `column:${status}`;

const parseTaskId = (id: string): string | null =>
  id.startsWith("task:") ? id.slice("task:".length) : null;

const parseColumnStatus = (id: string): BoardStatus | null => {
  if (!id.startsWith("column:")) {
    return null;
  }

  const value = id.slice("column:".length) as BoardStatus;
  return BOARD_STATUSES.includes(value) ? value : null;
};

type BoardSyncStatus = "syncing" | "synced" | "stale";

type ApiTaskListItem = {
  id: string;
  title: string;
  status: string;
  position: number;
  version: number;
};

type ApiTaskListResponse = {
  tasks?: unknown;
};

const findTaskLocation = (board: BoardState, taskId: string) => {
  for (const status of BOARD_STATUSES) {
    const index = board[status].findIndex((task) => task.id === taskId);
    if (index >= 0) {
      return { status, index };
    }
  }
  return null;
};

const parseApiTask = (value: unknown): ApiTaskListItem | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const { id, title, status, position, version } = record;
  if (
    typeof id !== "string" ||
    typeof title !== "string" ||
    typeof status !== "string" ||
    typeof position !== "number" ||
    typeof version !== "number"
  ) {
    return null;
  }

  return { id, title, status, position, version };
};

const isBoardStatus = (value: string): value is BoardStatus =>
  BOARD_STATUSES.includes(value as BoardStatus);

const toBoardStateFromApiTasks = (tasks: ApiTaskListItem[]): BoardState => {
  const nextBoard = createEmptyBoardState();
  const sortedTasks = tasks
    .slice()
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));

  for (const task of sortedTasks) {
    if (!isBoardStatus(task.status)) {
      continue;
    }
    nextBoard[task.status].push({ id: task.id, title: task.title, version: task.version });
  }

  return nextBoard;
};

const getApiBaseUrl = (): string => {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (typeof configured !== "string") {
    return DEFAULT_API_BASE_URL;
  }

  const trimmed = configured.trim();
  if (trimmed.length === 0) {
    return DEFAULT_API_BASE_URL;
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
};

const fetchBoardSnapshot = async (): Promise<BoardState> => {
  const response = await fetch(`${getApiBaseUrl()}/api/tasks`);
  if (!response.ok) {
    throw new Error(`Task refresh failed with status ${response.status}`);
  }

  const payload = (await response.json()) as ApiTaskListResponse;
  if (!Array.isArray(payload.tasks)) {
    throw new Error("Task refresh returned an invalid payload");
  }

  const parsedTasks = payload.tasks
    .map((entry) => parseApiTask(entry))
    .filter((entry): entry is ApiTaskListItem => entry !== null);
  return toBoardStateFromApiTasks(parsedTasks);
};

const syncStatusMessage = (status: BoardSyncStatus): string => {
  if (status === "synced") {
    return "Sync current with CLI updates.";
  }

  if (status === "stale") {
    return "Sync stale. Retrying CLI update refresh.";
  }

  return "Sync in progress. Checking for CLI updates.";
};

function SortableTaskCard({
  task,
  onDeleteTask,
  isDeleting,
}: {
  task: BoardTask;
  onDeleteTask: (task: BoardTask) => Promise<void>;
  isDeleting: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: taskDragId(task.id) });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const stopEventPropagation = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`task-card${isDragging ? " is-dragging" : ""}`}
      {...attributes}
      {...listeners}
    >
      <button
        type="button"
        className="task-card-delete"
        aria-label={`Delete task ${task.title}`}
        disabled={isDeleting}
        onPointerDown={stopEventPropagation}
        onKeyDown={stopEventPropagation}
        onClick={(event) => {
          stopEventPropagation(event);
          void onDeleteTask(task);
        }}
      >
        X
      </button>
      <p>{task.title}</p>
    </article>
  );
}

function Column({
  status,
  tasks,
  onDeleteTask,
  deletingTaskIds,
}: {
  status: BoardStatus;
  tasks: BoardTask[];
  onDeleteTask: (task: BoardTask) => Promise<void>;
  deletingTaskIds: Set<string>;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: columnDropId(status),
  });

  return (
    <article className={`workflow-column${isOver ? " is-over" : ""}`} role="listitem">
      <h2>{statusLabels[status]}</h2>
      <div ref={setNodeRef} className="column-body">
        <SortableContext items={tasks.map((task) => taskDragId(task.id))} strategy={verticalListSortingStrategy}>
          {tasks.length === 0 ? <p className="empty-column">Drop tasks here</p> : null}
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              onDeleteTask={onDeleteTask}
              isDeleting={deletingTaskIds.has(task.id)}
            />
          ))}
        </SortableContext>
      </div>
    </article>
  );
}

export function App() {
  const [taskDraft, setTaskDraft] = useState(defaultTaskDraft);
  const [board, setBoard] = useState<BoardState>(createEmptyBoardState);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<BoardSyncStatus>("syncing");
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [deletingTaskIds, setDeletingTaskIds] = useState<Set<string>>(new Set());
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const refreshBoardFromApi = async (promoteFromStale: boolean): Promise<void> => {
    if (refreshPromiseRef.current !== null) {
      await refreshPromiseRef.current;
      return;
    }

    if (promoteFromStale) {
      setSyncStatus((current) => (current === "stale" ? "syncing" : current));
    }

    const refreshPromise = (async () => {
      try {
        const refreshedBoard = await fetchBoardSnapshot();
        setBoard(refreshedBoard);
        setSyncStatus("synced");
      } catch {
        setSyncStatus("stale");
      } finally {
        refreshPromiseRef.current = null;
      }
    })();

    refreshPromiseRef.current = refreshPromise;
    await refreshPromise;
  };

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let isDisposed = false;

    const pollForBoardUpdates = async () => {
      try {
        await refreshBoardFromApi(true);
      } finally {
        if (!isDisposed) {
          timer = setTimeout(pollForBoardUpdates, REFRESH_INTERVAL_MS);
        }
      }
    };

    void pollForBoardUpdates();

    return () => {
      isDisposed = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, []);

  const updateTaskDraft = (field: keyof typeof defaultTaskDraft, value: string) => {
    setTaskDraft((current) => ({ ...current, [field]: value }));
  };

  const activeTask = activeTaskId ? findTaskLocation(board, activeTaskId) : null;
  const activeTaskCard =
    activeTaskId && activeTask
      ? board[activeTask.status].find((task) => task.id === activeTaskId) ?? null
      : null;

  const handleDragStart = (event: { active: { id: string | number } }) => {
    const parsedTaskId = parseTaskId(String(event.active.id));
    setActiveTaskId(parsedTaskId);
  };

  const handleDragCancel = () => {
    setActiveTaskId(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTaskId(null);
    if (!event.over) {
      return;
    }

    const activeId = parseTaskId(String(event.active.id));
    if (!activeId) {
      return;
    }

    const activeLocation = findTaskLocation(board, activeId);
    if (!activeLocation) {
      return;
    }
    const activeTaskCardRecord = board[activeLocation.status][activeLocation.index];
    if (!activeTaskCardRecord) {
      return;
    }

    const overId = String(event.over.id);
    const overTaskId = parseTaskId(overId);
    const overColumn = parseColumnStatus(overId);

    if (!overTaskId && !overColumn) {
      return;
    }

    if (overTaskId) {
      const overLocation = findTaskLocation(board, overTaskId);
      if (!overLocation) {
        return;
      }

      setBoard((currentBoard) =>
        moveTaskCard(currentBoard, {
          taskId: activeId,
          fromStatus: activeLocation.status,
          toStatus: overLocation.status,
          toIndex: overLocation.index,
        }),
      );
      void persistMove(
        activeTaskCardRecord,
        overLocation.status,
        overLocation.index,
      );
      return;
    }

    setBoard((currentBoard) =>
      moveTaskCard(currentBoard, {
        taskId: activeId,
        fromStatus: activeLocation.status,
        toStatus: overColumn!,
        toIndex: currentBoard[overColumn!].length,
      }),
    );
    void persistMove(activeTaskCardRecord, overColumn!, board[overColumn!].length);
  };

  const persistMove = async (
    task: BoardTask,
    toStatus: BoardStatus,
    toIndex: number,
  ): Promise<void> => {
    setSyncStatus("syncing");
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/tasks/${task.id}/move`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toStatus,
          toPosition: (toIndex + 1) * 1000,
          expectedVersion: task.version ?? 1,
        }),
      });
      if (!response.ok) {
        throw new Error(`Move failed with status ${response.status}`);
      }
      await refreshBoardFromApi(false);
    } catch {
      setSyncStatus("stale");
      await refreshBoardFromApi(true);
    }
  };

  const handleCreateTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedTitle = taskDraft.title.trim();
    if (normalizedTitle.length === 0 || isSavingDraft) {
      return;
    }

    const priority = priorityToApiValue[taskDraft.priority] ?? "MEDIUM";
    const assignee = taskDraft.assignee.trim();
    const notes = taskDraft.notes.trim();
    const payload: Record<string, unknown> = {
      title: normalizedTitle,
      priority,
      status: "PENDING",
    };
    if (taskDraft.dueDate.trim().length > 0) {
      payload.dueAt = `${taskDraft.dueDate}T17:00:00.000Z`;
    }
    if (assignee.length > 0) {
      payload.assignee = assignee;
    }
    if (notes.length > 0) {
      payload.notes = notes;
    }

    setIsSavingDraft(true);
    setSyncStatus("syncing");
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`Create failed with status ${response.status}`);
      }
      setTaskDraft(defaultTaskDraft);
      await refreshBoardFromApi(false);
    } catch {
      setSyncStatus("stale");
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleDeleteTask = async (task: BoardTask): Promise<void> => {
    if (deletingTaskIds.has(task.id)) {
      return;
    }

    setDeletingTaskIds((current) => {
      const next = new Set(current);
      next.add(task.id);
      return next;
    });
    setSyncStatus("syncing");
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/tasks/${task.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion: task.version ?? 1,
        }),
      });
      if (!response.ok) {
        throw new Error(`Delete failed with status ${response.status}`);
      }
      setActiveTaskId((currentTaskId) => (currentTaskId === task.id ? null : currentTaskId));
      await refreshBoardFromApi(false);
    } catch {
      setSyncStatus("stale");
      await refreshBoardFromApi(true);
    } finally {
      setDeletingTaskIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  };

  return (
    <main className="app-root">
      <section
        className="board-shell"
        data-testid="board-shell"
        data-theme="industrial-dark"
        aria-label="Task workflow board"
      >
        <header className="board-header">
          <h1>Taskboard</h1>
          <div className="board-header-meta">
            <p>Desktop workflow shell</p>
            <p
              className={`sync-indicator sync-${syncStatus}`}
              data-testid="sync-indicator"
              data-sync-status={syncStatus}
              aria-live="polite"
            >
              {syncStatusMessage(syncStatus)}
            </p>
          </div>
        </header>

        <section className="editor-panel" aria-label="Task editor">
          <div className="editor-panel-header">
            <h2>Task Editor</h2>
            <button
              type="submit"
              form="task-editor-form"
              className="editor-save-button"
              disabled={isSavingDraft}
            >
              {isSavingDraft ? "Saving..." : "Save Task"}
            </button>
          </div>

          <form
            id="task-editor-form"
            className="task-form"
            aria-label="Create or edit task"
            onSubmit={handleCreateTask}
          >
            <label htmlFor="task-title">
              Title
              <input
                id="task-title"
                name="title"
                value={taskDraft.title}
                onChange={(event) => updateTaskDraft("title", event.target.value)}
                type="text"
              />
            </label>

            <label htmlFor="task-priority">
              Priority
              <select
                id="task-priority"
                name="priority"
                value={taskDraft.priority}
                onChange={(event) => updateTaskDraft("priority", event.target.value)}
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Critical">Critical</option>
              </select>
            </label>

            <label htmlFor="task-due-date">
              Due Date
              <input
                id="task-due-date"
                name="dueDate"
                value={taskDraft.dueDate}
                onChange={(event) => updateTaskDraft("dueDate", event.target.value)}
                type="date"
              />
            </label>

            <label htmlFor="task-assignee">
              Assignee
              <input
                id="task-assignee"
                name="assignee"
                value={taskDraft.assignee}
                onChange={(event) => updateTaskDraft("assignee", event.target.value)}
                type="text"
              />
            </label>

            <label htmlFor="task-notes">
              Notes
              <textarea
                id="task-notes"
                name="notes"
                value={taskDraft.notes}
                onChange={(event) => updateTaskDraft("notes", event.target.value)}
              />
            </label>
          </form>
        </section>

        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragCancel={handleDragCancel}
          onDragEnd={handleDragEnd}
        >
          <section className="workflow-grid" role="list" aria-label="Workflow columns">
            {BOARD_STATUSES.map((status) => (
              <Column
                key={status}
                status={status}
                tasks={board[status]}
                onDeleteTask={handleDeleteTask}
                deletingTaskIds={deletingTaskIds}
              />
            ))}
          </section>
          <DragOverlay>
            {activeTaskCard ? (
              <article className="task-card overlay">
                <p>{activeTaskCard.title}</p>
              </article>
            ) : null}
          </DragOverlay>
        </DndContext>
      </section>
    </main>
  );
}
