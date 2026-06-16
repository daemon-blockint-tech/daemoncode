/**
 * Minimal Crystalline recall. The kernel consults this external "memory" for
 * the constraints in force, rather than hard-coding them. This step ships an
 * in-memory implementation derived from the gate policy; richer five-layer
 * memory (semiotic links, episodic precedents) is on the roadmap.
 */

import type { GatePolicy } from "./policy"

export interface RecallResult {
  /** Tool schemas forbidden in the current gate (the active I_bad set). */
  blockedActions: string[]
  /** Human-readable principle summaries for cognitive-interrupt messages. */
  principles: string[]
  /** Optional confidence in [0, 1] for the pessimistic shield. */
  confidence?: number
}

export interface CrystallineRecall {
  recall(action: string): Promise<RecallResult>
}

/** Build a recall backed entirely by an in-memory gate policy. */
export function createPolicyRecall(policy: GatePolicy): CrystallineRecall {
  const blockedActions = [...policy.blockedActions]
  const principles = policy.principles ? [...policy.principles] : []
  return {
    async recall(): Promise<RecallResult> {
      return { blockedActions, principles }
    },
  }
}
