import { describe, expect, it } from "vitest";
import {
  createEmptyBoardState,
  insertTaskIntoColumn,
  moveTaskCard,
} from "./kanban-state";

describe("kanban drag-drop state transitions", () => {
  it("moves a task from Pending to Started and preserves ordering", () => {
    const board = createEmptyBoardState();
    const withTasks = insertTaskIntoColumn(
      insertTaskIntoColumn(board, "PENDING", { id: "t1", title: "A" }),
      "PENDING",
      { id: "t2", title: "B" },
    );

    const moved = moveTaskCard(withTasks, {
      taskId: "t1",
      fromStatus: "PENDING",
      toStatus: "STARTED",
      toIndex: 0,
    });

    expect(moved.PENDING.map((task) => task.id)).toEqual(["t2"]);
    expect(moved.STARTED.map((task) => task.id)).toEqual(["t1"]);
  });

  it("supports reordering within a single column", () => {
    const board = createEmptyBoardState();
    const withTasks = insertTaskIntoColumn(
      insertTaskIntoColumn(
        insertTaskIntoColumn(board, "REVIEW", { id: "t1", title: "A" }),
        "REVIEW",
        { id: "t2", title: "B" },
      ),
      "REVIEW",
      { id: "t3", title: "C" },
    );

    const moved = moveTaskCard(withTasks, {
      taskId: "t1",
      fromStatus: "REVIEW",
      toStatus: "REVIEW",
      toIndex: 2,
    });

    expect(moved.REVIEW.map((task) => task.id)).toEqual(["t2", "t3", "t1"]);
  });
});
