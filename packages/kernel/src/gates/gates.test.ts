import { describe, test, expect } from "bun:test"
import { loadGate, GATE_POLICIES } from "./registry"
import { runPipeline } from "./pipeline"
import { createPolicyRecall } from "../crystalline"
import type { IntentProposal } from "../types"

describe("Gate Registry", () => {
  test("loads all gates", () => {
    expect(GATE_POLICIES).toHaveProperty("GATE_0_INGESTION")
    expect(GATE_POLICIES).toHaveProperty("GATE_1_CONTEXT")
    expect(GATE_POLICIES).toHaveProperty("GATE_2_CICD")
    expect(GATE_POLICIES).toHaveProperty("GATE_3_REMEDIATION")
    expect(GATE_POLICIES).toHaveProperty("GATE_4_VALIDATION")
  })

  test("loadGate returns correct policy", () => {
    const gate3 = loadGate("GATE_3_REMEDIATION")
    expect(gate3.gate).toBe("GATE_3_REMEDIATION")
    expect(gate3.blockedActions).toContain("deploy_to_prod")
    expect(gate3.sopTools).toContain("ares_scan_directory")
  })

  test("loadGate throws on unknown gate", () => {
    expect(() => loadGate("GATE_99_UNKNOWN")).toThrow("Unknown gate")
  })
})

describe("Pipeline Orchestrator", () => {
  test("returns PROCEED when all gates succeed", async () => {
    const gate = loadGate("GATE_3_REMEDIATION")
    const recall = createPolicyRecall(gate)

    let step = 0
    const successPlanner = async (): Promise<IntentProposal> => {
      step++
      // First run SOP tool to clear sigma_sop, then complete
      return step === 1
        ? { action_schema: "ares_scan_directory", target_subsystem: "KERNEL", typed_arguments: {} }
        : { action_schema: "complete_gate_task", target_subsystem: "KERNEL", typed_arguments: {} }
    }

    const result = await runPipeline({
      gates: [gate],
      recall,
      planners: { GATE_3_REMEDIATION: successPlanner },
    })

    expect(result.status).toBe("PROCEED")
    expect(result.perGate).toHaveLength(1)
    expect(result.perGate[0].status).toBe("PROCEED")
  })

  test("aborts pipeline on first ROLLBACK", async () => {
    const gate = loadGate("GATE_3_REMEDIATION")
    const recall = createPolicyRecall(gate)

    // Planner keeps trying forbidden action to force ROLLBACK after max retries
    const failingPlanner = async (): Promise<IntentProposal> => ({
      action_schema: "deploy_to_prod",
      target_subsystem: "KERNEL",
      typed_arguments: {},
    })

    const result = await runPipeline({
      gates: [gate],
      recall,
      planners: { GATE_3_REMEDIATION: failingPlanner },
    })

    expect(result.status).toBe("ROLLBACK")
    expect(result.perGate).toHaveLength(1)
    expect(result.perGate[0].status).toBe("ROLLBACK")
  })

  test("aggregates traces from all gates", async () => {
    const gate = loadGate("GATE_3_REMEDIATION")
    const recall = createPolicyRecall(gate)

    const planner = async (): Promise<IntentProposal> => ({
      action_schema: "complete_gate_task",
      target_subsystem: "KERNEL",
      typed_arguments: {},
    })

    const result = await runPipeline({
      gates: [gate],
      recall,
      planners: { GATE_3_REMEDIATION: planner },
    })

    expect(result.allTraces).toHaveLength(result.perGate[0].traceCount)
  })

  test("throws when planner not provided for gate", async () => {
    const gate = loadGate("GATE_3_REMEDIATION")
    const recall = createPolicyRecall(gate)

    try {
      await runPipeline({
        gates: [gate],
        recall,
        planners: {},
      })
      expect.unreachable()
    } catch (e) {
      expect(String(e)).toContain("No planner provided")
    }
  })
})
