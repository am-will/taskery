-- CreateTable
CREATE TABLE "NotificationSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'global',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "dailyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "dailyHoursCsv" TEXT NOT NULL DEFAULT '10,13',
    "weeklyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "weeklyDay" INTEGER NOT NULL DEFAULT 1,
    "weeklyHour" INTEGER NOT NULL DEFAULT 10,
    "windowMinutes" INTEGER NOT NULL DEFAULT 15,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "NotificationSettings" (
  "id",
  "enabled",
  "dailyEnabled",
  "dailyHoursCsv",
  "weeklyEnabled",
  "weeklyDay",
  "weeklyHour",
  "windowMinutes",
  "updatedAt"
)
VALUES (
  'global',
  true,
  true,
  '10,13',
  true,
  1,
  10,
  15,
  CURRENT_TIMESTAMP
);
