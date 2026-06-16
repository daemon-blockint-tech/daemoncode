/**
 * Shielded kernel gate: enforces GATE_3 safety properties before write operations.
 *
 * Acts as a deterministic enforcer (σ, Δ) between the LLM planner and tool execution.
 * Blocks forbidden actions; requires SOP (ARES/ouroboros) before remediation completion.
 * All kernel decisions are telemetry-emitted for audit trail.
 */

import { Effect } from "effect"
import type { SessionID } from "@/session/schema"
import { EventV2Bridge } from "@/event-v2-bridge"
import type { Interface } from "@daemon-protocol/core/event"
import {
  runGateWithGuardedTools,
  loadGate,
  createPolicyRecall,
  type IntentProposal,
  type TelemetryRow,
  type ToolExecutor,
} from "../../../kernel/src/index"
import { buildLiveExecutor } from "./backends"

export interface KernelGateInput {
  events: Interface
  sessionID: SessionID
  tool: string
  callID?: string
  messageID: string
  conversationHistory: unknown[] // Message history for planner context
  ask: (req: {
    permission: string
    patterns: string[]
    always: string[]
    metadata: Record<string, unknown>
  }) => Effect.Effect<void, unknown>
  /**
   * Real MCP tool-boundary executor (ARES/ouroboros/Orion). When omitted, it is
   * resolved from the environment; if no backend is configured the kernel falls
   * back to its deterministic stub executor so dev sessions still function.
   */
  executor?: ToolExecutor
}

export interface KernelGateResult {
  blocked?: string // Blocked reason; undefined = allowed
  traces: TelemetryRow[]
  finalStatus: "PROCEED" | "ROLLBACK"
}

/**
 * Deterministic planner that proposes the current tool call.
 * In production, this bridges the LLM's intent to the kernel's decision logic.
 */
function createToolPlanner(tool: string): (history: unknown[]) => Promise<IntentProposal> {
  return async () => ({
    action_schema: tool,
    target_subsystem: "OPENCODE",
    typed_arguments: {},
  })
}

export const gateToolWithKernel = Effect.fn("KernelGate.gateToolWithKernel")(
  function* (input: KernelGateInput): Effect.Effect<KernelGateResult, unknown> {
    // Load GATE_3 policy for remediation workflows
    const policy = loadGate("GATE_3_REMEDIATION")
    const recall = createPolicyRecall(policy)
    const planner = createToolPlanner(input.tool)

    // Real MCP tool-boundary executor; undefined → kernel uses its safe stub.
    const executor = input.executor ?? buildLiveExecutor()

    // Session-scoped telemetry sink: emits kernel decisions to audit trail
    const traces: TelemetryRow[] = []
    const eventBridge = yield* EventV2Bridge.Service

    const telemetrySink = {
      append: (row: TelemetryRow) => {
        traces.push(row)
        // Emit to session event stream for real-time audit (fire-and-forget)
        Promise.resolve().then(() => {
          eventBridge.emit({
            type: "kernel_decision",
            sessionID: input.sessionID,
            callID: input.callID,
            tool: row.action_schema,
            enforcer_status: row.enforcer_status,
            network_emitted: row.network_emitted,
            turn: row.turn,
            timestamp: row.timestamp,
          } as unknown as Parameters<Interface['emit']>[0]).catch(() => {
            // Ignore telemetry errors
          })
        })
      },
    }

    // Run kernel gate: deterministic enforcement loop
    const result = yield* Effect.promise(() =>
      runGateWithGuardedTools({
        policy,
        recall,
        planner,
        ...(executor ? { executor } : {}),
        initialHistory: input.conversationHistory,
        sink: telemetrySink,
      }),
    )

    // Extract blocking decision
    const lastTrace = traces[traces.length - 1]
    const isBlocked = result.status === "ROLLBACK" && lastTrace?.enforcer_status !== "PROCEED"

    if (isBlocked) {
      // Ask for escalation (HITL approval) when kernel blocks (fire-and-forget)
      Promise.resolve().then(() => {
        input.ask({
          permission: "kernel_escalation",
          patterns: [`kernel:${lastTrace?.action_schema ?? input.tool}`],
          always: [`kernel:${lastTrace?.action_schema ?? input.tool}`],
          metadata: {
            gate: "GATE_3_REMEDIATION",
            enforcer_status: lastTrace?.enforcer_status,
            turn: lastTrace?.turn,
            reason: "Kernel blocked action: SOP tools may be required or action forbidden",
          },
        }).catch(() => {
          // User denied escalation; remain blocked
        })
      })

      return {
        blocked: `Kernel GATE_3 enforcer: ${lastTrace?.enforcer_status ?? "BLOCKED"}. SOP tools (ares_scan_directory, ouroboros_scan) may be required before proceeding.`,
        traces,
        finalStatus: result.status,
      }
    }

    return {
      blocked: undefined,
      traces,
      finalStatus: result.status,
    }
  },
)
