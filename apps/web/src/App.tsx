import "./App.css";
import { useState } from "react";
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
  insertTaskIntoColumn,
  moveTaskCard,
} from "./board/kanban-state";

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

const findTaskLocation = (board: BoardState, taskId: string) => {
  for (const status of BOARD_STATUSES) {
    const index = board[status].findIndex((task) => task.id === taskId);
    if (index >= 0) {
      return { status, index };
    }
  }
  return null;
};

const initialBoardState = insertTaskIntoColumn(
  insertTaskIntoColumn(
    insertTaskIntoColumn(
      insertTaskIntoColumn(createEmptyBoardState(), "PENDING", {
        id: "task-1",
        title: "Finalize onboarding checklist",
      }),
      "PENDING",
      {
        id: "task-2",
        title: "Backfill sprint metrics dashboard",
      },
    ),
    "STARTED",
    { id: "task-3", title: "QA pass for release candidate" },
  ),
  "REVIEW",
  { id: "task-4", title: "Approve payment retry copy" },
);

function SortableTaskCard({ task }: { task: BoardTask }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: taskDragId(task.id) });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`task-card${isDragging ? " is-dragging" : ""}`}
      {...attributes}
      {...listeners}
    >
      <p>{task.title}</p>
    </article>
  );
}

function Column({
  status,
  tasks,
}: {
  status: BoardStatus;
  tasks: BoardTask[];
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
            <SortableTaskCard key={task.id} task={task} />
          ))}
        </SortableContext>
      </div>
    </article>
  );
}

export function App() {
  const [taskDraft, setTaskDraft] = useState(defaultTaskDraft);
  const [board, setBoard] = useState<BoardState>(initialBoardState);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

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
          <p>Desktop workflow shell</p>
        </header>

        <section className="editor-panel" aria-label="Task editor">
          <div className="editor-panel-header">
            <h2>Task Editor</h2>
            <button
              type="button"
              className="new-task-button"
              onClick={() => setTaskDraft(defaultTaskDraft)}
            >
              New Task
            </button>
          </div>

          <form className="task-form" aria-label="Create or edit task">
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
              <Column key={status} status={status} tasks={board[status]} />
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
