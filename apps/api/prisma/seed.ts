import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const seededTasks = [
  {
    id: "task_seed_pending",
    title: "Seed: triage backlog",
    status: "PENDING" as const,
    priority: "MEDIUM" as const,
    position: 100,
    assignee: "alex",
    notes: "Deterministic fixture task for pending work.",
  },
  {
    id: "task_seed_started",
    title: "Seed: implement API contracts",
    status: "STARTED" as const,
    priority: "HIGH" as const,
    position: 200,
    assignee: "sam",
    notes: "Deterministic fixture task for active implementation.",
  },
  {
    id: "task_seed_blocked",
    title: "Seed: unblock dependency issue",
    status: "BLOCKED" as const,
    priority: "URGENT" as const,
    position: 300,
    assignee: "jordan",
    notes: "Deterministic fixture task for blocked state.",
  },
  {
    id: "task_seed_review",
    title: "Seed: review migration changes",
    status: "REVIEW" as const,
    priority: "HIGH" as const,
    position: 400,
    assignee: "casey",
    notes: "Deterministic fixture task for review queue.",
  },
  {
    id: "task_seed_complete",
    title: "Seed: close validated task",
    status: "COMPLETE" as const,
    priority: "LOW" as const,
    position: 500,
    assignee: "drew",
    notes: "Deterministic fixture task for completed work.",
  },
];

async function main(): Promise<void> {
  for (const task of seededTasks) {
    await prisma.task.upsert({
      where: { id: task.id },
      update: {
        title: task.title,
        status: task.status,
        priority: task.priority,
        position: task.position,
        assignee: task.assignee,
        notes: task.notes,
      },
      create: task,
    });
  }
}

main()
  .catch((error) => {
    console.error("Prisma seed failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
