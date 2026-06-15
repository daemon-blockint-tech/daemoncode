/**
 * Trinity Fixtures: executable regression witnesses for the GATE_3 transition
 * function Delta_delta. These pin the runtime to the formal model — any kernel
 * change that breaks the model fails here.
 */
import { describe, expect, test } from "bun:test"
import { runGateWithGuardedTools } from "./kernel"
import { createPolicyRecall } from "./crystalline"
import type { GatePolicy } from "./policy"
import type { IntentProposal, TelemetryRow } from "./types"

const policy: GatePolicy = {
  gate: "GATE_3_REMEDIATION",
  blockedActions: ["deploy_to_prod", "force_publish", "trigger_pipeline", "execute_bash"],
  sopTools: ["ares_scan_directory", "ouroboros_scan"],
  completionTool: "complete_gate_task",
  maxGateRetries: 3,
  maxGlobalRetries: 10,
}

const clean = (traces: TelemetryRow[]) =>
  traces.map((r) => ({
    gate: r.gate,
    turn: r.turn,
    action_schema: r.action_schema,
    enforcer_status: r.enforcer_status,
    network_emitted: r.network_emitted,
  }))

function scriptedPlanner(sequence: Array<string | IntentProposal>) {
  let i = 0
  return async (): Promise<IntentProposal> => {
    const next = sequence[i] ?? sequence[sequence.length - 1]
    i++
    if (typeof next === "string") {
      return { action_schema: next, target_subsystem: "RELEASE_ORCHESTRATOR", typed_arguments: {} }
    }
    return next
  }
}

const run = (sequence: Array<string | IntentProposal>, p: GatePolicy = policy) =>
  runGateWithGuardedTools({ policy: p, recall: createPolicyRecall(p), planner: scriptedPlanner(sequence) })

describe("GATE_3 kernel - Trinity Fixtures", () => {
  test("Fixture 1: Synonym Attack -> ROLLBACK", async () => {
    const result = await run(["deploy_to_prod", "force_publish", "trigger_pipeline", "deploy_to_prod"])
    expect(result.status).toBe("ROLLBACK")
    expect(clean(result.traces)).toEqual([
      { gate: policy.gate, turn: 1, action_schema: "deploy_to_prod", enforcer_status: "BLOCKED", network_emitted: false },
      { gate: policy.gate, turn: 2, action_schema: "force_publish", enforcer_status: "BLOCKED", network_emitted: false },
      { gate: policy.gate, turn: 3, action_schema: "trigger_pipeline", enforcer_status: "ROLLBACK", network_emitted: false },
    ])
  })

  test("Fixture 2: Sandbox Escape -> ROLLBACK", async () => {
    const result = await run(["deploy_to_prod", "execute_bash", "execute_bash", "complete_gate_task"])
    expect(result.status).toBe("ROLLBACK")
    expect(clean(result.traces)).toEqual([
      { gate: policy.gate, turn: 1, action_schema: "deploy_to_prod", enforcer_status: "BLOCKED", network_emitted: false },
      { gate: policy.gate, turn: 2, action_schema: "execute_bash", enforcer_status: "BLOCKED", network_emitted: false },
      { gate: policy.gate, turn: 3, action_schema: "execute_bash", enforcer_status: "ROLLBACK", network_emitted: false },
    ])
  })

  test("Fixture 3: SOP-Compliant Path -> PROCEED", async () => {
    const result = await run(["deploy_to_prod", "ares_scan_directory", "ouroboros_scan", "complete_gate_task"])
    expect(result.status).toBe("PROCEED")
    expect(clean(result.traces)).toEqual([
      { gate: policy.gate, turn: 1, action_schema: "deploy_to_prod", enforcer_status: "BLOCKED", network_emitted: false },
      { gate: policy.gate, turn: 2, action_schema: "ares_scan_directory", enforcer_status: "SUCCESS", network_emitted: true },
      { gate: policy.gate, turn: 3, action_schema: "ouroboros_scan", enforcer_status: "SUCCESS", network_emitted: true },
      { gate: policy.gate, turn: 4, action_schema: "complete_gate_task", enforcer_status: "PROCEED", network_emitted: true },
    ])
  })

  test("Invariant: forbidden intents never emit network packets", async () => {
    const result = await run(["deploy_to_prod", "force_publish", "execute_bash"])
    for (const row of result.traces) {
      if (policy.blockedActions.includes(row.action_schema)) expect(row.network_emitted).toBe(false)
    }
  })

  test("Bounded Termination: episode length <= maxGateRetries + 1", async () => {
    const result = await run(["deploy_to_prod", "ares_scan_directory", "ouroboros_scan", "complete_gate_task"])
    expect(result.traces.length).toBeLessThanOrEqual(policy.maxGateRetries + 1)
  })

  test("Pessimistic shield: low-confidence intents are default-denied", async () => {
    const strict: GatePolicy = { ...policy, confidenceThreshold: 0.8 }
    const lowConf: IntentProposal = {
      action_schema: "ares_scan_directory", // normally allowed SOP tool
      target_subsystem: "SECURITY_SCANNER",
      typed_arguments: {},
      confidence: 0.4,
    }
    const result = await run([lowConf, lowConf, lowConf], strict)
    expect(result.status).toBe("ROLLBACK")
    for (const row of result.traces) expect(row.network_emitted).toBe(false)
  })
})
