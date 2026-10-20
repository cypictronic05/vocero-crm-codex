import { z } from "zod";
import { pickLeastLoadedMember, type AssignmentCandidate } from "@/lib/assignment";

export const ASSIGNMENT_MODES = ["manual", "automatic"] as const;
export const assignmentModeSchema = z.enum(ASSIGNMENT_MODES);
export type AssignmentMode = z.infer<typeof assignmentModeSchema>;

export type AssignmentDecision =
  | { action: "preserve" }
  | { action: "assign"; targetMemberId: string | null };

/**
 * Decisión pura usada dentro del lock transaccional de asignación.
 * Una asignación explícita siempre gana; el modo solo gobierna automatismos.
 */
export function decideAutomaticAssignment(input: {
  mode: AssignmentMode;
  currentMemberId: string | null;
  currentMemberAvailable: boolean;
  candidates: AssignmentCandidate[];
  loads: ReadonlyMap<string, number>;
}): AssignmentDecision {
  if (input.currentMemberId && input.currentMemberAvailable) {
    return { action: "preserve" };
  }
  if (input.mode === "manual") {
    return input.currentMemberId === null
      ? { action: "preserve" }
      : { action: "assign", targetMemberId: null };
  }
  return {
    action: "assign",
    targetMemberId: pickLeastLoadedMember(input.candidates, input.loads),
  };
}
