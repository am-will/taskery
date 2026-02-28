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
import {
  DEFAULT_NOTIFICATION_SCHEDULE_CONFIG,
  notificationScheduleConfigSchema,
  type NotificationSettings,
} from "taskery-shared";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:4010";
const REFRESH_INTERVAL_MS = 1000;
const EXTERNAL_MOVE_HIGHLIGHT_MS = 280;
const EXTERNAL_MOVE_TRAVEL_MS = 920;
const CARD_HOVER_POPUP_DELAY_MS = 500;
const HOVER_POPUP_GAP_PX = 8;
const HOVER_POPUP_EDGE_PADDING_PX = 12;
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
  notificationSettings?: unknown;
};

type BoardSnapshot = {
  board: BoardState;
  notificationSettings: NotificationSettings;
};

type NotificationSettingsDraft = {
  enabled: boolean;
  dailyEnabled: boolean;
  dailyHoursText: string;
  weeklyEnabled: boolean;
  weeklyDayText: string;
  weeklyHourText: string;
  windowMinutesText: string;
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

const WEEKDAY_OPTIONS = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
] as const;

const createDefaultNotificationSettings = (): NotificationSettings => ({
  ...DEFAULT_NOTIFICATION_SCHEDULE_CONFIG,
  dailyHours: [...DEFAULT_NOTIFICATION_SCHEDULE_CONFIG.dailyHours],
  updatedAt: null,
});

const toNotificationSettingsDraft = (
  settings: NotificationSettings,
): NotificationSettingsDraft => ({
  enabled: settings.enabled,
  dailyEnabled: settings.dailyEnabled,
  dailyHoursText: settings.dailyHours.join(","),
  weeklyEnabled: settings.weeklyEnabled,
  weeklyDayText: String(settings.weeklyDay),
  weeklyHourText: String(settings.weeklyHour),
  windowMinutesText: String(settings.windowMinutes),
});

const sortUniqueHours = (hours: number[]): number[] =>
  Array.from(new Set(hours)).sort((left, right) => left - right);

const sameNumberArray = (left: number[], right: number[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

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

const parseApiNotificationSettings = (value: unknown): NotificationSettings => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return createDefaultNotificationSettings();
  }

  const record = value as Record<string, unknown>;
  try {
    const schedule = notificationScheduleConfigSchema.parse({
      enabled: record.enabled,
      dailyEnabled: record.dailyEnabled,
      dailyHours: record.dailyHours,
      weeklyEnabled: record.weeklyEnabled,
      weeklyDay: record.weeklyDay,
      weeklyHour: record.weeklyHour,
      windowMinutes: record.windowMinutes,
    });
    return {
      ...schedule,
      updatedAt: parseNullableString(record.updatedAt),
    };
  } catch {
    return createDefaultNotificationSettings();
  }
};

const parseDailyHoursText = (value: string): number[] | null => {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    return null;
  }

  const parsed: number[] = [];
  for (const entry of entries) {
    const hour = Number(entry);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      return null;
    }
    parsed.push(hour);
  }

  return sortUniqueHours(parsed);
};

const parseBoundedIntegerText = (
  value: string,
  minimum: number,
  maximum: number,
): number | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return null;
  }
  return parsed;
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
  if (typeof configured === "string") {
    const trimmed = configured.trim();
    if (trimmed.length > 0) {
      return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
    }
  }

  const location = globalThis.location;
  if (location !== undefined) {
    if (location.port === "3010") {
      return `${location.protocol}//${location.hostname}:4010`;
    }
    return location.origin;
  }

  return DEFAULT_API_BASE_URL;
};

const fetchBoardSnapshot = async (): Promise<BoardSnapshot> => {
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
  return {
    board: toBoardStateFromApiTasks(parsedTasks),
    notificationSettings: parseApiNotificationSettings(payload.notificationSettings),
  };
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

const shouldFlipHoverPopupLeft = (cardRect: DOMRect): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  const popupWidth = Math.min(320, window.innerWidth * 0.6);
  const rightSpace =
    window.innerWidth - cardRect.right - HOVER_POPUP_GAP_PX - HOVER_POPUP_EDGE_PADDING_PX;
  const leftSpace = cardRect.left - HOVER_POPUP_GAP_PX - HOVER_POPUP_EDGE_PADDING_PX;
  return leftSpace > rightSpace;
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
  const [isHoverPopupFlippedLeft, setIsHoverPopupFlippedLeft] = useState(false);
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
      onMouseEnter={(event) => {
        if (isDragging) {
          return;
        }
        setIsHoverPopupFlippedLeft(
          shouldFlipHoverPopupLeft(event.currentTarget.getBoundingClientRect()),
        );
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
          className={`task-hover-popup${isHoverPopupFlippedLeft ? " is-flipped-left" : ""}`}
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
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(
    createDefaultNotificationSettings,
  );
  const [settingsDraft, setSettingsDraft] = useState<NotificationSettingsDraft>(() =>
    toNotificationSettingsDraft(createDefaultNotificationSettings()),
  );
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [deletingTaskIds, setDeletingTaskIds] = useState<Set<string>>(new Set());
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const reminderDedupeRef = useRef<Set<string>>(new Set());
  const boardRef = useRef<BoardState>(createEmptyBoardState());
  const notificationSettingsRef = useRef<NotificationSettings>(createDefaultNotificationSettings());
  const isOptionsOpenRef = useRef(false);
  const isSavingSettingsRef = useRef(false);
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

  const applyNotificationSettings = (nextSettings: NotificationSettings) => {
    notificationSettingsRef.current = nextSettings;
    setNotificationSettings(nextSettings);
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
    const pendingReminders = collectScheduledReminders(
      snapshotBoard,
      new Date(),
      notificationSettingsRef.current,
    ).filter((reminder) => !hasReminderFired(reminder.dedupeKey));
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
        const snapshot = await fetchBoardSnapshot();
        applyNotificationSettings(snapshot.notificationSettings);
        if (!isOptionsOpenRef.current && !isSavingSettingsRef.current) {
          setSettingsDraft(toNotificationSettingsDraft(snapshot.notificationSettings));
        }
        await applyRefreshedBoard(snapshot.board);
        triggerScheduledReminders(snapshot.board);
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
    isOptionsOpenRef.current = isOptionsOpen;
  }, [isOptionsOpen]);

  useEffect(() => {
    isSavingSettingsRef.current = isSavingSettings;
  }, [isSavingSettings]);

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

  const updateSettingsDraft = <K extends keyof NotificationSettingsDraft>(
    field: K,
    value: NotificationSettingsDraft[K],
  ) => {
    setSettingsDraft((current) => ({ ...current, [field]: value }));
  };

  const cycleBorderTheme = () => {
    setBorderTheme((current) => {
      const idx = BORDER_THEMES.indexOf(current);
      return BORDER_THEMES[(idx + 1) % BORDER_THEMES.length] ?? "rainbow";
    });
  };

  const toggleOptionsMenu = () => {
    setIsOptionsOpen((current) => {
      const next = !current;
      isOptionsOpenRef.current = next;
      if (next) {
        setSettingsError(null);
        setSettingsDraft(toNotificationSettingsDraft(notificationSettingsRef.current));
      }
      return next;
    });
  };

  const handleSaveNotificationSettings = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    if (isSavingSettings) {
      return;
    }

    const parsedDailyHours = parseDailyHoursText(settingsDraft.dailyHoursText);
    if (parsedDailyHours === null) {
      setSettingsError("Daily reminder hours must be comma-separated 0-23 values.");
      return;
    }

    const parsedWeeklyDay = parseBoundedIntegerText(settingsDraft.weeklyDayText, 0, 6);
    if (parsedWeeklyDay === null) {
      setSettingsError("Weekly day must be a value from 0 (Sunday) to 6 (Saturday).");
      return;
    }

    const parsedWeeklyHour = parseBoundedIntegerText(settingsDraft.weeklyHourText, 0, 23);
    if (parsedWeeklyHour === null) {
      setSettingsError("Weekly hour must be a value from 0 to 23.");
      return;
    }

    const parsedWindowMinutes = parseBoundedIntegerText(settingsDraft.windowMinutesText, 1, 60);
    if (parsedWindowMinutes === null) {
      setSettingsError("Reminder window must be between 1 and 60 minutes.");
      return;
    }

    const nextSettings = {
      enabled: settingsDraft.enabled,
      dailyEnabled: settingsDraft.dailyEnabled,
      dailyHours: parsedDailyHours,
      weeklyEnabled: settingsDraft.weeklyEnabled,
      weeklyDay: parsedWeeklyDay,
      weeklyHour: parsedWeeklyHour,
      windowMinutes: parsedWindowMinutes,
    };
    const currentSettings = notificationSettingsRef.current;
    const updatePayload: Record<string, unknown> = {};

    if (nextSettings.enabled !== currentSettings.enabled) {
      updatePayload.enabled = nextSettings.enabled;
    }
    if (nextSettings.dailyEnabled !== currentSettings.dailyEnabled) {
      updatePayload.dailyEnabled = nextSettings.dailyEnabled;
    }
    if (!sameNumberArray(nextSettings.dailyHours, currentSettings.dailyHours)) {
      updatePayload.dailyHours = nextSettings.dailyHours;
    }
    if (nextSettings.weeklyEnabled !== currentSettings.weeklyEnabled) {
      updatePayload.weeklyEnabled = nextSettings.weeklyEnabled;
    }
    if (nextSettings.weeklyDay !== currentSettings.weeklyDay) {
      updatePayload.weeklyDay = nextSettings.weeklyDay;
    }
    if (nextSettings.weeklyHour !== currentSettings.weeklyHour) {
      updatePayload.weeklyHour = nextSettings.weeklyHour;
    }
    if (nextSettings.windowMinutes !== currentSettings.windowMinutes) {
      updatePayload.windowMinutes = nextSettings.windowMinutes;
    }

    if (Object.keys(updatePayload).length === 0) {
      setSettingsError(null);
      isOptionsOpenRef.current = false;
      setIsOptionsOpen(false);
      return;
    }

    isSavingSettingsRef.current = true;
    setIsSavingSettings(true);
    setSettingsError(null);
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/settings/notifications`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updatePayload),
      });
      if (!response.ok) {
        throw new Error(`Settings update failed with status ${response.status}`);
      }

      const payload = (await response.json()) as { settings?: unknown };
      const parsedSettings = parseApiNotificationSettings(payload.settings);
      applyNotificationSettings(parsedSettings);
      setSettingsDraft(toNotificationSettingsDraft(parsedSettings));
      isOptionsOpenRef.current = false;
      setIsOptionsOpen(false);
    } catch {
      setSettingsError("Unable to save notification settings. Please try again.");
    } finally {
      isSavingSettingsRef.current = false;
      setIsSavingSettings(false);
    }
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
            <div className="board-actions">
              <button
                type="button"
                className="options-toggle"
                onClick={toggleOptionsMenu}
                aria-haspopup="dialog"
                aria-expanded={isOptionsOpen}
                aria-controls="notification-options"
              >
                Options
              </button>
              {isOptionsOpen ? (
                <section
                  id="notification-options"
                  className="options-menu"
                  role="dialog"
                  aria-label="Notification options"
                >
                  <form className="options-form" onSubmit={handleSaveNotificationSettings}>
                    <label className="options-checkbox">
                      <input
                        type="checkbox"
                        checked={settingsDraft.enabled}
                        onChange={(event) =>
                          updateSettingsDraft("enabled", event.target.checked)
                        }
                      />
                      Enable desktop reminders
                    </label>
                    <label className="options-checkbox">
                      <input
                        type="checkbox"
                        checked={settingsDraft.dailyEnabled}
                        onChange={(event) =>
                          updateSettingsDraft("dailyEnabled", event.target.checked)
                        }
                      />
                      Enable daily reminders
                    </label>
                    <label>
                      Daily hours (comma-separated)
                      <input
                        type="text"
                        value={settingsDraft.dailyHoursText}
                        onChange={(event) =>
                          updateSettingsDraft("dailyHoursText", event.target.value)
                        }
                        placeholder="10,13"
                      />
                    </label>
                    <label className="options-checkbox">
                      <input
                        type="checkbox"
                        checked={settingsDraft.weeklyEnabled}
                        onChange={(event) =>
                          updateSettingsDraft("weeklyEnabled", event.target.checked)
                        }
                      />
                      Enable weekly reminders
                    </label>
                    <label>
                      Weekly day
                      <select
                        value={settingsDraft.weeklyDayText}
                        onChange={(event) =>
                          updateSettingsDraft("weeklyDayText", event.target.value)
                        }
                      >
                        {WEEKDAY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Weekly hour (0-23)
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={settingsDraft.weeklyHourText}
                        onChange={(event) =>
                          updateSettingsDraft("weeklyHourText", event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Reminder window (minutes)
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={settingsDraft.windowMinutesText}
                        onChange={(event) =>
                          updateSettingsDraft("windowMinutesText", event.target.value)
                        }
                      />
                    </label>
                    <p className="options-meta">
                      Last updated: {notificationSettings.updatedAt ?? "default settings"}
                    </p>
                    {settingsError ? (
                      <p className="options-error" role="alert">
                        {settingsError}
                      </p>
                    ) : null}
                    <div className="options-actions">
                      <button
                        type="button"
                        onClick={() => {
                          isOptionsOpenRef.current = false;
                          setIsOptionsOpen(false);
                        }}
                        disabled={isSavingSettings}
                      >
                        Cancel
                      </button>
                      <button type="submit" disabled={isSavingSettings}>
                        {isSavingSettings ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </form>
                </section>
              ) : null}
            </div>
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
