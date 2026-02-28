PRAGMA foreign_keys=OFF;

CREATE TABLE "new_TaskEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT,
    "eventType" TEXT NOT NULL,
    "payload" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_TaskEvent" ("createdAt", "eventType", "id", "payload", "taskId")
SELECT "createdAt", "eventType", "id", "payload", "taskId"
FROM "TaskEvent";

DROP TABLE "TaskEvent";
ALTER TABLE "new_TaskEvent" RENAME TO "TaskEvent";

CREATE INDEX "TaskEvent_taskId_createdAt_idx" ON "TaskEvent"("taskId", "createdAt");

PRAGMA foreign_keys=ON;
