/**
 * The GATE_3 shielded kernel: the concrete realisation of the deterministic
 * transition function Delta_delta from `daemon_gate3_safety_model.tex`.
 *
 * The LLM is an untrusted tactical planner; this loop is the sterile enforcer.
 * Safety is a property of the kernel, not of the model's disposition:
 *   - No Unsafe Network Emission: forbidden intents never set network_emitted.
 *   - Bounded Termination: every episode ends in <= maxGateRetries + 1 turns.
 */

import type { GatePolicy } from "./policy"
import type { CrystallineRecall } from "./crystalline"
import type { ToolExecutor } from "./executor"
import { stubExecutor } from "./executor"
import { BlackBoxRecorder, type TelemetrySink } from "./telemetry"
import type { GateResult, IntentProposal, KernelRegisters, LoopConfig, LoopControl } from "./types"

export interface RunGateOptions {
  policy: GatePolicy
  recall: CrystallineRecall
  planner: (history: unknown[]) => Promise<IntentProposal>
  executor?: ToolExecutor
  initialHistory?: unknown[]
  sink?: TelemetrySink
}

/**
 * Atomic helper for hard violations (the I_bad branch). Mutating registers,
 * logging exactly one telemetry row, and deciding loop control all happen here,
 * which removes the off-by-one / missing-log class of bugs.
 */
export function applyViolationPenalty(
  ctx: { gate: string; turn: number; action_schema: string; interruptMessage: string },
  registers: KernelRegisters,
  config: LoopConfig,
  recorder: BlackBoxRecorder,
  conversationHistory: unknown[],
): LoopControl {
  registers.r_gate++
  registers.r_global++

  const terminal = registers.r_gate >= config.maxGateRetries || registers.r_global >= config.maxGlobalRetries
  const status = terminal ? "ROLLBACK" : "BLOCKED"

  recorder.record({
    gate: ctx.gate,
    turn: ctx.turn,
    action_schema: ctx.action_schema,
    enforcer_status: status,
    network_emitted: false, // I_bad => E_t = 0, always
  })

  if (terminal) return { shouldBreak: true, finalStatus: "ROLLBACK" }

  // Dual-layer cognitive injection (audit row + steering decree), non-terminal only.
  conversationHistory.push({
    role: "tool",
    content: JSON.stringify({ status: "BLOCKED_BY_KERNEL", tool: ctx.action_schema }),
  })
  conversationHistory.push({ role: "system", content: ctx.interruptMessage })

  return { shouldBreak: false, finalStatus: "PENDING" }
}

/**
 * Run one GATE_3 episode. Stochastic only in `planner`; every other transition
 * is deterministic. Returns the terminal status plus the full telemetry trace
 * (the empirical instantiation of T_t).
 */
export async function runGateWithGuardedTools(options: RunGateOptions): Promise<GateResult> {
  const { policy, recall, planner } = options
  const executor = options.executor ?? stubExecutor
  const config: LoopConfig = { maxGateRetries: policy.maxGateRetries, maxGlobalRetries: policy.maxGlobalRetries }
  const gate = policy.gate
  const sopTools = new Set(policy.sopTools)
  const threshold = policy.confidenceThreshold ?? 0

  const recorder = new BlackBoxRecorder(options.sink)
  const conversationHistory = [...(options.initialHistory ?? [])]
  const registers: KernelRegisters = { r_gate: 0, r_global: 0, turn: 1, sigma_sop: 0 }

  while (registers.r_gate < config.maxGateRetries && registers.r_global < config.maxGlobalRetries) {
    const intent = await planner(conversationHistory)
    const tool = intent.action_schema

    const memory = await recall.recall(tool)
    const isBlocked = memory.blockedActions.includes(tool)
    const isIllegalExit = tool === policy.completionTool && registers.sigma_sop === 0

    // Optional pessimistic shield: default-deny when the oracle is uncertain.
    const recallConfidence = intent.confidence ?? memory.confidence
    const isUncertain = threshold > 0 && recallConfidence !== undefined && recallConfidence < threshold

    // f_enforce == 1: hard violation
    if (isBlocked || isIllegalExit || isUncertain) {
      const interruptMessage = isIllegalExit
        ? "[SECURITY INTERRUPT] Cannot close gate. Mandatory SOP scanner missing."
        : isUncertain
          ? `[SECURITY INTERRUPT] Action '${tool}' rejected: scanner confidence below threshold (default-deny).`
          : `[SECURITY INTERRUPT] Action '${tool}' rejected by kernel shield constraints.`
      const control = applyViolationPenalty(
        { gate, turn: registers.turn, action_schema: tool, interruptMessage },
        registers,
        config,
        recorder,
        conversationHistory,
      )
      if (control.shouldBreak) return { status: "ROLLBACK", traces: recorder.getTraces() }
      registers.turn++
      continue
    }

    // f_enforce == 0: safe path
    if (sopTools.has(tool)) {
      const result = await executor.execute(intent)
      if (result.status === "SUCCESS") registers.sigma_sop = 1
      recorder.record({
        gate,
        turn: registers.turn,
        action_schema: tool,
        enforcer_status: result.status,
        network_emitted: result.networkEmitted,
      })
      if (result.status === "SUCCESS") {
        registers.r_gate = 0 // tactical reward: refresh the per-gate retry budget
        // ...but the global budget still ticks: every turn consumes it, so a
        // planner cannot loop forever by repeatedly invoking SOP tools. This is
        // the hard wall that guarantees Bounded Termination for any planner.
        registers.r_global++
        if (registers.r_global >= config.maxGlobalRetries) {
          return { status: "ROLLBACK", traces: recorder.getTraces() }
        }
        conversationHistory.push({
          role: "tool",
          content: JSON.stringify({ status: "SUCCESS", tool }),
        })
        registers.turn++
        continue
      }
      // SOP failure counts against the budget.
      registers.r_gate++
      registers.r_global++
      if (registers.r_gate >= config.maxGateRetries || registers.r_global >= config.maxGlobalRetries) {
        return { status: "ROLLBACK", traces: recorder.getTraces() }
      }
      registers.turn++
      continue
    }

    if (tool === policy.completionTool && registers.sigma_sop === 1) {
      recorder.record({
        gate,
        turn: registers.turn,
        action_schema: tool,
        enforcer_status: "PROCEED",
        network_emitted: true,
      })
      return { status: "PROCEED", traces: recorder.getTraces() }
    }

    // Unknown tool on the safe path: default-deny rather than allow an unmodelled
    // transition.
    const control = applyViolationPenalty(
      {
        gate,
        turn: registers.turn,
        action_schema: tool,
        interruptMessage: `[SECURITY INTERRUPT] Unmodelled tool '${tool}' rejected (default-deny).`,
      },
      registers,
      config,
      recorder,
      conversationHistory,
    )
    if (control.shouldBreak) return { status: "ROLLBACK", traces: recorder.getTraces() }
    registers.turn++
  }

  return { status: "ROLLBACK", traces: recorder.getTraces() }
}
