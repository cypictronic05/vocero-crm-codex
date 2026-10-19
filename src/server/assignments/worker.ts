import { sweepConversationAssignments } from "@/server/assignments/service";

const INTERVAL_MS = 60_000;

const globalForAssignmentWorker = globalThis as unknown as {
  __voceroAssignmentWorker?: ReturnType<typeof setInterval>;
  __voceroAssignmentSweepRunning?: boolean;
};

export async function runAssignmentSweep(): Promise<void> {
  if (globalForAssignmentWorker.__voceroAssignmentSweepRunning) return;
  globalForAssignmentWorker.__voceroAssignmentSweepRunning = true;
  try {
    await sweepConversationAssignments();
  } catch (error) {
    console.error("[assignments] no se pudo completar el relevo:", error);
  } finally {
    globalForAssignmentWorker.__voceroAssignmentSweepRunning = false;
  }
}

export function startAssignmentWorker(): void {
  if (globalForAssignmentWorker.__voceroAssignmentWorker) return;
  void runAssignmentSweep();
  const timer = setInterval(() => void runAssignmentSweep(), INTERVAL_MS);
  timer.unref?.();
  globalForAssignmentWorker.__voceroAssignmentWorker = timer;
}
