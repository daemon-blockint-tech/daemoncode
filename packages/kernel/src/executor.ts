/**
 * The boundary at which an allowed (shield-passing) tool actually runs. In
 * production this is the MCP / API-gateway call (g_exec in the formal model);
 * here it is an interface with a deterministic stub so the kernel and the
 * Trinity Fixtures stay hermetic. Real MCP wiring is roadmap.
 */

import type { IntentProposal } from "./types"

export interface ExecutionResult {
  status: "SUCCESS" | "FAILURE"
  /** Whether a physical network packet was emitted (E_t for the safe path). */
  networkEmitted?: boolean
  /** Optional execution summary (findings count, scan status, policy decision). */
  summary?: string
}

export interface ToolExecutor {
  execute(intent: IntentProposal): Promise<ExecutionResult>
}

/** Default executor: every allowed tool succeeds and emits one packet. */
export const stubExecutor: ToolExecutor = {
  async execute(): Promise<ExecutionResult> {
    return { status: "SUCCESS", networkEmitted: true }
  },
}
