import "./App.css";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDroppable } from "@dnd-kit/core";
import {
  BOARD_STATUSES,
  type BoardState,
  type BoardStatus,
  type BoardTask,
  type BoardTaskPriority,
  createEmptyBoardState,
  moveTaskCard,
} from "./board/kanban-state";
import { collectScheduledReminders } from "./notifications/reminders";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:4010";
const REFRESH_INTERVAL_MS = 5000;
const EXTERNAL_MOVE_HIGHLIGHT_MS = 280;
const EXTERNAL_MOVE_TRAVEL_MS = 920;
const CARD_HOVER_POPUP_DELAY_MS = 500;
const REMINDER_STORAGE_PREFIX = "taskery:reminder:";

const statusLabels: Record<BoardStatus, string> = {
  PENDING: "Pending",
  STARTED: "Started",
  BLOCKED: "Blocked",
  REVIEW: "Review",
  COMPLETE: "Complete",
};

const priorityToApiValue = {
  Low: "LOW",
  Medium: "MEDIUM",
  High: "HIGH",
  Critical: "URGENT",
} as const;

type TaskDraftPriority = keyof typeof priorityToApiValue;
type CreateTaskDraft = {
  title: string;
  priority: TaskDraftPriority;
  dueDate: string;
  assignee: string;
  notes: string;
};
type EditTaskDraft = CreateTaskDraft & { status: BoardStatus };
type ApiTaskPriority = BoardTaskPriority;

const defaultCreateTaskDraft: CreateTaskDraft = {
  title: "",
  priority: "Medium",
  dueDate: "",
  assignee: "",
  notes: "",
};

const defaultEditTaskDraft: EditTaskDraft = {
  ...defaultCreateTaskDraft,
  status: "PENDING",
};

const apiPriorityToDraftValue: Record<ApiTaskPriority, TaskDraftPriority> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Critical",
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
  priority: ApiTaskPriority;
  dueAt: string | null;
  assignee: string | null;
  notes: string | null;
  position: number;
  version: number;
};

type ApiTaskListResponse = {
  tasks?: unknown;
};

type TaskRecord = {
  status: BoardStatus;
  task: BoardTask;
};

type DueVisualState = "today" | "overdue" | null;

type RectSnapshot = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type ExternalMoveOverlay = {
  taskId: string;
  task: BoardTask;
  fromRect: RectSnapshot;
  toRect: RectSnapshot;
  phase: "highlight" | "moving";
};

type StatusTransitionCandidate = {
  taskId: string;
  fromStatus: BoardStatus;
  toStatus: BoardStatus;
  toIndex: number;
  nextTask: BoardTask;
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

const findTaskRecord = (board: BoardState, taskId: string): TaskRecord | null => {
  const location = findTaskLocation(board, taskId);
  if (!location) {
    return null;
  }

  const task = board[location.status][location.index];
  if (!task) {
    return null;
  }

  return { status: location.status, task };
};

const toRectSnapshot = (rect: DOMRect): RectSnapshot => ({
  top: rect.top,
  left: rect.left,
  width: rect.width,
  height: rect.height,
});

const parseCssPixels = (value: string): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const findTaskCardElement = (taskId: string): HTMLElement | null => {
  const cards = document.querySelectorAll<HTMLElement>("[data-task-id]");
  for (const card of cards) {
    if (card.dataset.taskId === taskId) {
      return card;
    }
  }

  return null;
};

const findColumnBodyElement = (status: BoardStatus): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-column-status="${status}"] .column-body`);

const computeExternalMoveTargetRect = (
  status: BoardStatus,
  targetIndex: number,
  cardHeight: number,
  cardWidth: number,
): RectSnapshot | null => {
  const columnBody = findColumnBodyElement(status);
  if (!columnBody) {
    return null;
  }

  const bodyRect = columnBody.getBoundingClientRect();
  const bodyStyle = window.getComputedStyle(columnBody);
  const gap = parseCssPixels(bodyStyle.rowGap || bodyStyle.gap);
  const paddingTop = parseCssPixels(bodyStyle.paddingTop);
  const paddingBottom = parseCssPixels(bodyStyle.paddingBottom);
  const paddingLeft = parseCssPixels(bodyStyle.paddingLeft);
  const paddingRight = parseCssPixels(bodyStyle.paddingRight);
  const minTop = bodyRect.top + paddingTop;
  const minLeft = bodyRect.left + paddingLeft;
  const maxTop = Math.max(minTop, bodyRect.bottom - paddingBottom - cardHeight);
  const availableWidth = Math.max(0, bodyRect.width - paddingLeft - paddingRight);
  const width = availableWidth > 0 ? Math.min(cardWidth, availableWidth) : cardWidth;
  const maxLeft = Math.max(minLeft, bodyRect.right - paddingRight - width);
  const unclampedTop = minTop + Math.max(0, targetIndex) * (cardHeight + gap);

  return {
    top: Math.min(unclampedTop, maxTop),
    left: Math.min(minLeft, maxLeft),
    width,
    height: cardHeight,
  };
};

const findFirstStatusTransition = (
  currentBoard: BoardState,
  nextBoard: BoardState,
): StatusTransitionCandidate | null => {
  const nextTaskLocations = new Map<
    string,
    { status: BoardStatus; index: number; task: BoardTask }
  >();

  for (const status of BOARD_STATUSES) {
    nextBoard[status].forEach((task, index) => {
      nextTaskLocations.set(task.id, { status, index, task });
    });
  }

  for (const status of BOARD_STATUSES) {
    for (const task of currentBoard[status]) {
      const nextLocation = nextTaskLocations.get(task.id);
      if (!nextLocation || nextLocation.status === status) {
        continue;
      }

      return {
        taskId: task.id,
        fromStatus: status,
        toStatus: nextLocation.status,
        toIndex: nextLocation.index,
        nextTask: nextLocation.task,
      };
    }
  }

  return null;
};

const readReminderFlag = (dedupeKey: string): boolean => {
  try {
    return window.localStorage.getItem(`${REMINDER_STORAGE_PREFIX}${dedupeKey}`) === "1";
  } catch {
    return false;
  }
};

const writeReminderFlag = (dedupeKey: string): void => {
  try {
    window.localStorage.setItem(`${REMINDER_STORAGE_PREFIX}${dedupeKey}`, "1");
  } catch {
    // Ignore storage failures; reminders still dedupe within this app session.
  }
};

const sendDesktopNotification = async (
  title: string,
  body: string,
  dedupeKey: string,
): Promise<boolean> => {
  if (typeof Notification === "undefined") {
    return false;
  }

  let permission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = Notification.permission;
    }
  }

  if (permission !== "granted") {
    return false;
  }

  try {
    new Notification(title, {
      body,
      tag: dedupeKey,
    });
    return true;
  } catch {
    return false;
  }
};

const parseNullableString = (value: unknown): string | null => {
  if (value === null) {
    return null;
  }

  return typeof value === "string" ? value : null;
};

const parseApiPriority = (value: unknown): ApiTaskPriority => {
  if (value === "LOW" || value === "MEDIUM" || value === "HIGH" || value === "URGENT") {
    return value;
  }

  return "MEDIUM";
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

  return {
    id,
    title,
    status,
    priority: parseApiPriority(record.priority),
    dueAt: parseNullableString(record.dueAt),
    assignee: parseNullableString(record.assignee),
    notes: parseNullableString(record.notes),
    position,
    version,
  };
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

    nextBoard[task.status].push({
      id: task.id,
      title: task.title,
      priority: task.priority,
      dueAt: task.dueAt,
      assignee: task.assignee,
      notes: task.notes,
      version: task.version,
    });
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

const BORDER_THEMES = ["rainbow", "yellow", "blue", "red", "indigo", "green", "off"] as const;
type BorderTheme = (typeof BORDER_THEMES)[number];

const syncStatusMessage = (status: BoardSyncStatus): string => {
  if (status === "synced") {
    return "Synced";
  }

  if (status === "stale") {
    return "Not Synced";
  }

  return "Syncing";
};

const toDateInputValue = (isoDate: string | null | undefined): string => {
  if (typeof isoDate !== "string") {
    return "";
  }

  return isoDate.slice(0, 10);
};

const toApiDueAt = (dueDate: string): string | null =>
  dueDate.trim().length === 0 ? null : `${dueDate}T17:00:00.000Z`;

const toLocalDateKey = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getDueVisualState = (
  dueAt: string | null | undefined,
  status: BoardStatus,
): DueVisualState => {
  if (status === "COMPLETE") {
    return null;
  }

  const dueDate = toDateInputValue(dueAt);
  if (dueDate.length === 0) {
    return null;
  }

  const today = toLocalDateKey(new Date());
  if (dueDate < today) {
    return "overdue";
  }

  if (dueDate === today) {
    return "today";
  }

  return null;
};

const formatDueDateLabel = (dueAt: string | null | undefined): string => {
  const dueDate = toDateInputValue(dueAt);
  return dueDate.length > 0 ? dueDate : "No due date";
};

const getPriorityLabel = (priority: ApiTaskPriority | undefined): string => {
  if (priority === "LOW") {
    return "Low";
  }

  if (priority === "HIGH") {
    return "High";
  }

  if (priority === "URGENT") {
    return "Critical";
  }

  return "Medium";
};

const getAssigneeLabel = (
  assignee: string | null | undefined,
  priority: ApiTaskPriority | undefined,
): string => {
  const normalizedAssignee = assignee?.trim() ?? "";
  if (normalizedAssignee.length > 0) {
    return normalizedAssignee;
  }
  return getPriorityLabel(priority);
};

const getAssigneeFieldLabel = (assignee: string | null | undefined): string => {
  const normalizedAssignee = assignee?.trim() ?? "";
  return normalizedAssignee.length > 0 ? normalizedAssignee : "Unassigned";
};

const buildEditDraftFromTask = (task: BoardTask, status: BoardStatus) => ({
  title: task.title,
  status,
  priority: apiPriorityToDraftValue[task.priority ?? "MEDIUM"],
  dueDate: toDateInputValue(task.dueAt),
  assignee: task.assignee ?? "",
  notes: task.notes ?? "",
});

const stopEventPropagation = (event: { stopPropagation: () => void }) => {
  event.stopPropagation();
};

function SortableTaskCard({
  status,
  task,
  onDeleteTask,
  onOpenTask,
  isDeleting,
  movingTaskId,
}: {
  status: BoardStatus;
  task: BoardTask;
  onDeleteTask: (task: BoardTask) => Promise<void>;
  onOpenTask: (task: BoardTask, status: BoardStatus) => void;
  isDeleting: boolean;
  movingTaskId: string | null;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: taskDragId(task.id) });
  const [isHoverPopupVisible, setIsHoverPopupVisible] = useState(false);
  const hoverPopupTimeoutRef = useRef<number | null>(null);
  const dueVisualState = getDueVisualState(task.dueAt, status);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const clearHoverPopupTimeout = () => {
    if (hoverPopupTimeoutRef.current !== null) {
      window.clearTimeout(hoverPopupTimeoutRef.current);
      hoverPopupTimeoutRef.current = null;
    }
  };

  useEffect(
    () => () => {
      if (hoverPopupTimeoutRef.current !== null) {
        window.clearTimeout(hoverPopupTimeoutRef.current);
        hoverPopupTimeoutRef.current = null;
      }
    },
    [],
  );

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`task-card${isDragging ? " is-dragging" : ""}${
        movingTaskId === task.id ? " is-external-moving-source" : ""
      }${dueVisualState === "today" ? " is-due-today" : ""}${
        dueVisualState === "overdue" ? " is-overdue" : ""
      }`}
      data-testid={`task-card-${task.id}`}
      data-task-id={task.id}
      data-priority={task.priority ?? "MEDIUM"}
      onMouseEnter={() => {
        if (isDragging) {
          return;
        }
        clearHoverPopupTimeout();
        hoverPopupTimeoutRef.current = window.setTimeout(() => {
          setIsHoverPopupVisible(true);
          hoverPopupTimeoutRef.current = null;
        }, CARD_HOVER_POPUP_DELAY_MS);
      }}
      onMouseLeave={() => {
        clearHoverPopupTimeout();
        setIsHoverPopupVisible(false);
      }}
      onClick={() => {
        if (!isDragging) {
          onOpenTask(task, status);
        }
      }}
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
        ×
      </button>
      <p className="task-card-title">{task.title}</p>
      <div className="task-card-meta" aria-hidden="true">
        <span className="task-chip">{getAssigneeLabel(task.assignee, task.priority)}</span>
        <span className="task-chip">{formatDueDateLabel(task.dueAt)}</span>
      </div>
      {isHoverPopupVisible ? (
        <aside
          className="task-hover-popup"
          role="tooltip"
          data-testid={`task-hover-popup-${task.id}`}
          aria-label={`Task details for ${task.title}`}
        >
          <p className="task-hover-popup-title">Task Details</p>
          <dl className="task-hover-popup-list">
            <div>
              <dt>Title</dt>
              <dd>{task.title}</dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>{getPriorityLabel(task.priority)}</dd>
            </div>
            <div>
              <dt>Due Date</dt>
              <dd>{formatDueDateLabel(task.dueAt)}</dd>
            </div>
            <div>
              <dt>Assignee</dt>
              <dd>{getAssigneeFieldLabel(task.assignee)}</dd>
            </div>
            <div>
              <dt>Notes</dt>
              <dd>{(task.notes ?? "").trim().length > 0 ? task.notes : "No notes"}</dd>
            </div>
          </dl>
        </aside>
      ) : null}
    </article>
  );
}

function Column({
  status,
  tasks,
  onDeleteTask,
  onOpenTask,
  deletingTaskIds,
  movingTaskId,
}: {
  status: BoardStatus;
  tasks: BoardTask[];
  onDeleteTask: (task: BoardTask) => Promise<void>;
  onOpenTask: (task: BoardTask, status: BoardStatus) => void;
  deletingTaskIds: Set<string>;
  movingTaskId: string | null;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: columnDropId(status),
  });

  return (
    <article
      className={`workflow-column${isOver ? " is-over" : ""}`}
      role="listitem"
      data-column-status={status}
    >
      <h2>
        {statusLabels[status]}
        <span className="column-count">{tasks.length}</span>
      </h2>
      <div ref={setNodeRef} className="column-body">
        <SortableContext items={tasks.map((task) => taskDragId(task.id))} strategy={verticalListSortingStrategy}>
          {tasks.length === 0 ? <p className="empty-column">Drop tasks here</p> : null}
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              status={status}
              task={task}
              onDeleteTask={onDeleteTask}
              onOpenTask={onOpenTask}
              isDeleting={deletingTaskIds.has(task.id)}
              movingTaskId={movingTaskId}
            />
          ))}
        </SortableContext>
      </div>
    </article>
  );
}

export function App() {
  const [createTaskDraft, setCreateTaskDraft] = useState(defaultCreateTaskDraft);
  const [board, setBoard] = useState<BoardState>(createEmptyBoardState);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [externalMoveOverlay, setExternalMoveOverlay] = useState<ExternalMoveOverlay | null>(
    null,
  );
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTaskDraft, setEditTaskDraft] = useState(defaultEditTaskDraft);
  const [syncStatus, setSyncStatus] = useState<BoardSyncStatus>("syncing");
  const [borderTheme, setBorderTheme] = useState<BorderTheme>("rainbow");
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [deletingTaskIds, setDeletingTaskIds] = useState<Set<string>>(new Set());
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const reminderDedupeRef = useRef<Set<string>>(new Set());
  const boardRef = useRef<BoardState>(createEmptyBoardState());
  const isDisposedRef = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const commitBoardState = (nextBoard: BoardState) => {
    boardRef.current = nextBoard;
    setBoard(nextBoard);
  };

  const updateBoardState = (updater: (currentBoard: BoardState) => BoardState) => {
    setBoard((currentBoard) => {
      const nextBoard = updater(currentBoard);
      boardRef.current = nextBoard;
      return nextBoard;
    });
  };

  const waitForDelay = (durationMs: number): Promise<void> =>
    new Promise((resolve) => {
      window.setTimeout(resolve, durationMs);
    });

  const hasReminderFired = (dedupeKey: string): boolean => {
    if (reminderDedupeRef.current.has(dedupeKey)) {
      return true;
    }

    if (!readReminderFlag(dedupeKey)) {
      return false;
    }

    reminderDedupeRef.current.add(dedupeKey);
    return true;
  };

  const rememberReminderFired = (dedupeKey: string): void => {
    reminderDedupeRef.current.add(dedupeKey);
    writeReminderFlag(dedupeKey);
  };

  const triggerScheduledReminders = (snapshotBoard: BoardState): void => {
    const pendingReminders = collectScheduledReminders(snapshotBoard, new Date()).filter(
      (reminder) => !hasReminderFired(reminder.dedupeKey),
    );
    if (pendingReminders.length === 0) {
      return;
    }

    void (async () => {
      for (const reminder of pendingReminders) {
        await sendDesktopNotification(reminder.title, reminder.body, reminder.dedupeKey);
        rememberReminderFired(reminder.dedupeKey);
      }
    })();
  };

  const applyRefreshedBoard = async (nextBoard: BoardState): Promise<void> => {
    const currentBoard = boardRef.current;
    const transition = findFirstStatusTransition(currentBoard, nextBoard);
    if (!transition || draggingTaskId !== null) {
      setExternalMoveOverlay(null);
      commitBoardState(nextBoard);
      return;
    }

    const sourceElement = findTaskCardElement(transition.taskId);
    if (!sourceElement) {
      setExternalMoveOverlay(null);
      commitBoardState(nextBoard);
      return;
    }

    const sourceRect = toRectSnapshot(sourceElement.getBoundingClientRect());
    const targetRect = computeExternalMoveTargetRect(
      transition.toStatus,
      transition.toIndex,
      sourceRect.height,
      sourceRect.width,
    );
    if (!targetRect) {
      setExternalMoveOverlay(null);
      commitBoardState(nextBoard);
      return;
    }

    setExternalMoveOverlay({
      taskId: transition.taskId,
      task: transition.nextTask,
      fromRect: sourceRect,
      toRect: targetRect,
      phase: "highlight",
    });

    await waitForDelay(EXTERNAL_MOVE_HIGHLIGHT_MS);
    if (isDisposedRef.current) {
      return;
    }

    setExternalMoveOverlay((currentOverlay) => {
      if (!currentOverlay || currentOverlay.taskId !== transition.taskId) {
        return currentOverlay;
      }
      return { ...currentOverlay, phase: "moving" };
    });

    await waitForDelay(EXTERNAL_MOVE_TRAVEL_MS);
    if (isDisposedRef.current) {
      return;
    }

    commitBoardState(nextBoard);
    setExternalMoveOverlay(null);
  };

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
        await applyRefreshedBoard(refreshedBoard);
        triggerScheduledReminders(refreshedBoard);
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
    boardRef.current = board;
  }, [board]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let isDisposed = false;
    isDisposedRef.current = false;

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
      isDisposedRef.current = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    if (editingTaskId && !findTaskRecord(board, editingTaskId)) {
      setEditingTaskId(null);
    }
  }, [board, editingTaskId]);

  useEffect(() => {
    if (!editingTaskId) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSavingEdit) {
        setEditingTaskId(null);
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [editingTaskId, isSavingEdit]);

  const updateCreateTaskDraft = <K extends keyof CreateTaskDraft>(
    field: K,
    value: CreateTaskDraft[K],
  ) => {
    setCreateTaskDraft((current) => ({ ...current, [field]: value }));
  };

  const updateEditTaskDraft = <K extends keyof EditTaskDraft>(
    field: K,
    value: EditTaskDraft[K],
  ) => {
    setEditTaskDraft((current) => ({ ...current, [field]: value }));
  };

  const cycleBorderTheme = () => {
    setBorderTheme((current) => {
      const idx = BORDER_THEMES.indexOf(current);
      return BORDER_THEMES[(idx + 1) % BORDER_THEMES.length] ?? "rainbow";
    });
  };

  const draggingTaskRecord = draggingTaskId ? findTaskRecord(board, draggingTaskId) : null;
  const externalMoveRect =
    externalMoveOverlay === null
      ? null
      : externalMoveOverlay.phase === "moving"
        ? externalMoveOverlay.toRect
        : externalMoveOverlay.fromRect;

  const handleDragStart = (event: { active: { id: string | number } }) => {
    const parsedTaskId = parseTaskId(String(event.active.id));
    setDraggingTaskId(parsedTaskId);
  };

  const handleDragCancel = () => {
    setDraggingTaskId(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingTaskId(null);
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

      updateBoardState((currentBoard) =>
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

    if (overColumn === null) {
      return;
    }

    updateBoardState((currentBoard) =>
      moveTaskCard(currentBoard, {
        taskId: activeId,
        fromStatus: activeLocation.status,
        toStatus: overColumn,
        toIndex: currentBoard[overColumn].length,
      }),
    );
    void persistMove(activeTaskCardRecord, overColumn, board[overColumn].length);
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
    const normalizedTitle = createTaskDraft.title.trim();
    if (normalizedTitle.length === 0 || isSavingDraft) {
      return;
    }

    const priority = priorityToApiValue[createTaskDraft.priority] ?? "MEDIUM";
    const assignee = createTaskDraft.assignee.trim();
    const notes = createTaskDraft.notes.trim();
    const payload: Record<string, unknown> = {
      title: normalizedTitle,
      priority,
      status: "PENDING",
    };
    const dueAt = toApiDueAt(createTaskDraft.dueDate);
    if (dueAt !== null) {
      payload.dueAt = dueAt;
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
      setCreateTaskDraft(defaultCreateTaskDraft);
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
      setDraggingTaskId((currentTaskId) => (currentTaskId === task.id ? null : currentTaskId));
      setEditingTaskId((currentTaskId) => (currentTaskId === task.id ? null : currentTaskId));
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

  const handleOpenTaskEditor = (task: BoardTask, status: BoardStatus) => {
    setEditingTaskId(task.id);
    setEditTaskDraft(buildEditDraftFromTask(task, status));
  };

  const handleCloseTaskEditor = () => {
    if (isSavingEdit) {
      return;
    }
    setEditingTaskId(null);
  };

  const handleSaveTaskEdits = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (editingTaskId === null || isSavingEdit) {
      return;
    }

    const taskRecord = findTaskRecord(board, editingTaskId);
    if (!taskRecord) {
      setEditingTaskId(null);
      return;
    }

    const normalizedTitle = editTaskDraft.title.trim();
    if (normalizedTitle.length === 0) {
      return;
    }

    const currentTask = taskRecord.task;
    const currentStatus = taskRecord.status;
    const nextPriority = priorityToApiValue[editTaskDraft.priority] ?? "MEDIUM";
    const nextAssignee = editTaskDraft.assignee.trim();
    const nextNotes = editTaskDraft.notes.trim();
    const nextDueDate = toDateInputValue(toApiDueAt(editTaskDraft.dueDate));

    const updatePayload: Record<string, unknown> = {};
    if (normalizedTitle !== currentTask.title) {
      updatePayload.title = normalizedTitle;
    }
    if (nextPriority !== (currentTask.priority ?? "MEDIUM")) {
      updatePayload.priority = nextPriority;
    }
    if (nextDueDate !== toDateInputValue(currentTask.dueAt)) {
      updatePayload.dueAt = nextDueDate.length === 0 ? null : toApiDueAt(nextDueDate);
    }
    if (nextAssignee !== (currentTask.assignee ?? "")) {
      updatePayload.assignee = nextAssignee.length === 0 ? null : nextAssignee;
    }
    if (nextNotes !== (currentTask.notes ?? "")) {
      updatePayload.notes = nextNotes.length === 0 ? null : nextNotes;
    }

    const statusChanged = editTaskDraft.status !== currentStatus;
    if (Object.keys(updatePayload).length === 0 && !statusChanged) {
      setEditingTaskId(null);
      return;
    }

    setIsSavingEdit(true);
    setSyncStatus("syncing");

    try {
      let expectedVersion = currentTask.version ?? 1;

      if (Object.keys(updatePayload).length > 0) {
        updatePayload.expectedVersion = expectedVersion;
        const patchResponse = await fetch(`${getApiBaseUrl()}/api/tasks/${currentTask.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(updatePayload),
        });

        if (!patchResponse.ok) {
          throw new Error(`Update failed with status ${patchResponse.status}`);
        }

        const patchPayload = (await patchResponse.json()) as {
          task?: {
            version?: unknown;
          };
        };
        expectedVersion =
          typeof patchPayload.task?.version === "number"
            ? patchPayload.task.version
            : expectedVersion + 1;
      }

      if (statusChanged) {
        const nextColumnLength = board[editTaskDraft.status].length;
        const moveResponse = await fetch(`${getApiBaseUrl()}/api/tasks/${currentTask.id}/move`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            toStatus: editTaskDraft.status,
            toPosition: (nextColumnLength + 1) * 1000,
            expectedVersion,
          }),
        });

        if (!moveResponse.ok) {
          throw new Error(`Status update failed with status ${moveResponse.status}`);
        }
      }

      setEditingTaskId(null);
      await refreshBoardFromApi(false);
    } catch {
      setSyncStatus("stale");
      await refreshBoardFromApi(true);
    } finally {
      setIsSavingEdit(false);
    }
  };

  return (
    <main className="app-root" data-theme={borderTheme}>
      <section
        className="board-shell"
        data-testid="board-shell"
        data-theme="industrial-dark"
        aria-label="Task workflow board"
      >
        <header className="board-header">
          <h1>Taskery</h1>
          <div className="board-header-meta">
            <span
              className={`sync-indicator sync-${syncStatus}`}
              data-testid="sync-indicator"
              data-sync-status={syncStatus}
              aria-live="polite"
            >
              {syncStatusMessage(syncStatus)}
            </span>
            <button
              type="button"
              className={`theme-toggle theme-toggle-${borderTheme}`}
              onClick={cycleBorderTheme}
              aria-label="Cycle border theme color"
              title={`Theme: ${borderTheme}`}
            />
          </div>
        </header>

        <section className="editor-panel" aria-label="Task editor">
          <div className="editor-panel-header">
            <h2>Create Task</h2>
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
                value={createTaskDraft.title}
                onChange={(event) => updateCreateTaskDraft("title", event.target.value)}
                type="text"
              />
            </label>

            <label htmlFor="task-priority">
              Priority
              <select
                id="task-priority"
                name="priority"
                value={createTaskDraft.priority}
                onChange={(event) =>
                  updateCreateTaskDraft("priority", event.target.value as TaskDraftPriority)
                }
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
                value={createTaskDraft.dueDate}
                onChange={(event) => updateCreateTaskDraft("dueDate", event.target.value)}
                type="date"
              />
            </label>

            <label htmlFor="task-assignee">
              Assignee
              <input
                id="task-assignee"
                name="assignee"
                value={createTaskDraft.assignee}
                onChange={(event) => updateCreateTaskDraft("assignee", event.target.value)}
                type="text"
              />
            </label>

            <label htmlFor="task-notes">
              Notes
              <textarea
                id="task-notes"
                name="notes"
                value={createTaskDraft.notes}
                onChange={(event) => updateCreateTaskDraft("notes", event.target.value)}
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
                onOpenTask={handleOpenTaskEditor}
                deletingTaskIds={deletingTaskIds}
                movingTaskId={externalMoveOverlay?.taskId ?? null}
              />
            ))}
          </section>
          <DragOverlay>
            {draggingTaskRecord ? (
              <article className="task-card overlay">
                <p className="task-card-title">{draggingTaskRecord.task.title}</p>
                <div className="task-card-meta" aria-hidden="true">
                  <span className="task-chip">
                    {getAssigneeLabel(
                      draggingTaskRecord.task.assignee,
                      draggingTaskRecord.task.priority,
                    )}
                  </span>
                  <span className="task-chip">{formatDueDateLabel(draggingTaskRecord.task.dueAt)}</span>
                </div>
              </article>
            ) : null}
          </DragOverlay>
        </DndContext>

        {externalMoveOverlay && externalMoveRect ? (
          <div
            className={`external-move-overlay phase-${externalMoveOverlay.phase}`}
            style={{
              top: `${externalMoveRect.top}px`,
              left: `${externalMoveRect.left}px`,
              width: `${externalMoveRect.width}px`,
              height: `${externalMoveRect.height}px`,
            }}
            data-testid="external-move-overlay"
            aria-hidden="true"
          >
            <article className="task-card overlay external-move-card">
              <p className="task-card-title">{externalMoveOverlay.task.title}</p>
              <div className="task-card-meta">
                <span className="task-chip">
                  {getAssigneeLabel(externalMoveOverlay.task.assignee, externalMoveOverlay.task.priority)}
                </span>
                <span className="task-chip">{formatDueDateLabel(externalMoveOverlay.task.dueAt)}</span>
              </div>
            </article>
          </div>
        ) : null}
      </section>

      {editingTaskId ? (
        <div
          className="task-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              handleCloseTaskEditor();
            }
          }}
        >
          <section className="task-modal" role="dialog" aria-modal="true" aria-label="Edit task details">
            <div className="task-modal-header">
              <h2>Edit Task</h2>
              <button
                type="button"
                className="task-modal-close"
                onClick={handleCloseTaskEditor}
                disabled={isSavingEdit}
                aria-label="Close task editor"
              >
                ×
              </button>
            </div>

            <form className="task-modal-form" onSubmit={handleSaveTaskEdits}>
              <label htmlFor="edit-task-status">
                Status
                <select
                  id="edit-task-status"
                  value={editTaskDraft.status}
                  onChange={(event) =>
                    updateEditTaskDraft("status", event.target.value as BoardStatus)
                  }
                >
                  {BOARD_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {statusLabels[status]}
                    </option>
                  ))}
                </select>
              </label>

              <label htmlFor="edit-task-title">
                Title
                <input
                  id="edit-task-title"
                  value={editTaskDraft.title}
                  onChange={(event) => updateEditTaskDraft("title", event.target.value)}
                  type="text"
                />
              </label>

              <label htmlFor="edit-task-priority">
                Priority
                <select
                  id="edit-task-priority"
                  value={editTaskDraft.priority}
                  onChange={(event) =>
                    updateEditTaskDraft("priority", event.target.value as TaskDraftPriority)
                  }
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                  <option value="Critical">Critical</option>
                </select>
              </label>

              <label htmlFor="edit-task-due-date">
                Due Date
                <input
                  id="edit-task-due-date"
                  value={editTaskDraft.dueDate}
                  onChange={(event) => updateEditTaskDraft("dueDate", event.target.value)}
                  type="date"
                />
              </label>

              <label htmlFor="edit-task-assignee">
                Assignee
                <input
                  id="edit-task-assignee"
                  value={editTaskDraft.assignee}
                  onChange={(event) => updateEditTaskDraft("assignee", event.target.value)}
                  type="text"
                />
              </label>

              <label htmlFor="edit-task-notes" className="task-modal-notes">
                Notes
                <textarea
                  id="edit-task-notes"
                  value={editTaskDraft.notes}
                  onChange={(event) => updateEditTaskDraft("notes", event.target.value)}
                />
              </label>

              <div className="task-modal-actions">
                <button type="button" onClick={handleCloseTaskEditor} disabled={isSavingEdit}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="editor-save-button task-modal-save-button"
                  disabled={isSavingEdit}
                >
                  {isSavingEdit ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}
