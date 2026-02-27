export const BOARD_STATUSES = [
  "PENDING",
  "STARTED",
  "BLOCKED",
  "REVIEW",
  "COMPLETE",
] as const;

export type BoardStatus = (typeof BOARD_STATUSES)[number];

export type BoardTask = {
  id: string;
  title: string;
  version?: number;
};

export type BoardState = Record<BoardStatus, BoardTask[]>;

export type MoveTaskCardInput = {
  taskId: string;
  fromStatus: BoardStatus;
  toStatus: BoardStatus;
  toIndex: number;
};

const clampIndex = (index: number, size: number) =>
  Math.max(0, Math.min(index, size));

export const createEmptyBoardState = (): BoardState => ({
  PENDING: [],
  STARTED: [],
  BLOCKED: [],
  REVIEW: [],
  COMPLETE: [],
});

export const insertTaskIntoColumn = (
  board: BoardState,
  status: BoardStatus,
  task: BoardTask,
  index?: number,
): BoardState => {
  const nextColumn = board[status].slice();
  const targetIndex = clampIndex(index ?? nextColumn.length, nextColumn.length);
  nextColumn.splice(targetIndex, 0, task);
  return { ...board, [status]: nextColumn };
};

export const moveTaskCard = (
  board: BoardState,
  input: MoveTaskCardInput,
): BoardState => {
  const fromColumn = board[input.fromStatus];
  const movingIndex = fromColumn.findIndex((task) => task.id === input.taskId);
  if (movingIndex < 0) {
    return board;
  }

  const movingTask = fromColumn[movingIndex];
  if (!movingTask) {
    return board;
  }
  const nextFromColumn = fromColumn.filter((task) => task.id !== input.taskId);
  const toSourceColumn =
    input.fromStatus === input.toStatus ? nextFromColumn : board[input.toStatus];
  const targetIndex = clampIndex(input.toIndex, toSourceColumn.length);
  const nextToColumn = toSourceColumn.slice();
  nextToColumn.splice(targetIndex, 0, movingTask);

  if (input.fromStatus === input.toStatus) {
    return { ...board, [input.toStatus]: nextToColumn };
  }

  return {
    ...board,
    [input.fromStatus]: nextFromColumn,
    [input.toStatus]: nextToColumn,
  };
};
