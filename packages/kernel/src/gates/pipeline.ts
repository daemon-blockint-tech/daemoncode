/**
 * Multi-gate pipeline orchestrator.
 *
 * Runs a sequence of gates via the kernel loop. Each gate either:
 * - PROCEED → advance to next gate
 * - ROLLBACK → abort pipeline immediately; downstream gates not run
 *
 * Returns aggregated status and per-gate traces.
 */

import { runGateWithGuardedTools } from "../kernel"
import type { GatePolicy } from "../policy"
import type { CrystallineRecall } from "../crystalline"
import type { IntentProposal, TelemetryRow } from "../types"

export interface PipelineOpts {
  gates: GatePolicy[]
  recall: CrystallineRecall
  planners: { [gateName: string]: (history: unknown[]) => Promise<IntentProposal> }
  sink?: { append(row: TelemetryRow): void | Promise<void> }
}

export interface PipelineResult {
  status: "PROCEED" | "ROLLBACK"
  perGate: Array<{
    gate: string
    status: "PROCEED" | "ROLLBACK"
    traceCount: number
  }>
  allTraces: TelemetryRow[]
}

export async function runPipeline(opts: PipelineOpts): Promise<PipelineResult> {
  const { gates, recall, planners, sink } = opts
  const allTraces: TelemetryRow[] = []
  const perGate: Array<{ gate: string; status: "PROCEED" | "ROLLBACK"; traceCount: number }> = []

  for (const gate of gates) {
    const planner = planners[gate.gate]
    if (!planner) {
      throw new Error(`No planner provided for gate ${gate.gate}`)
    }

    const result = await runGateWithGuardedTools({
      policy: gate,
      recall,
      planner,
      sink,
    })

    allTraces.push(...result.traces)
    perGate.push({
      gate: gate.gate,
      status: result.status,
      traceCount: result.traces.length,
    })

    // Abort pipeline on first ROLLBACK
    if (result.status === "ROLLBACK") {
      return {
        status: "ROLLBACK",
        perGate,
        allTraces,
      }
    }
  }

  return {
    status: "PROCEED",
    perGate,
    allTraces,
  }
}

