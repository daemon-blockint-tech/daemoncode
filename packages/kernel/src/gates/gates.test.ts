import { describe, test, expect } from "bun:test"
import { loadGate, GATE_POLICIES } from "./registry"
import { runPipeline } from "./pipeline"
import { createPolicyRecall } from "../crystalline"
import { CrystallineMemory } from "../crystalline-memory"
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

describe("Pipeline + CrystallineMemory integration", () => {
  test("blocks synonym attacks across gates via semiotic links", async () => {
    const gate = loadGate("GATE_3_REMEDIATION")
    const memory = new CrystallineMemory({
      policy: gate,
      semioticLinks: [
        { alias: "ship_to_production", canonical: "deploy_to_prod", relation: "synonym" },
        { alias: "push_live", canonical: "deploy_to_prod", relation: "paraphrase" },
      ],
    })

    // Planner tries synonym aliases for deploy_to_prod
    const synonymPlanner = async (): Promise<IntentProposal> => ({
      action_schema: "ship_to_production",
      target_subsystem: "KERNEL",
      typed_arguments: {},
    })

    const result = await runPipeline({
      gates: [gate],
      recall: memory,
      planners: { GATE_3_REMEDIATION: synonymPlanner },
    })

    expect(result.status).toBe("ROLLBACK")
    for (const trace of result.allTraces) {
      expect(trace.network_emitted).toBe(false)
    }
  })

  test("aborts pipeline on first ROLLBACK (GATE_0 proceeds, GATE_3 rolls back)", async () => {
    const gate0 = loadGate("GATE_0_INGESTION")
    const gate3 = loadGate("GATE_3_REMEDIATION")

    let gate0Step = 0
    const gate0Planner = async (): Promise<IntentProposal> => {
      gate0Step++
      return gate0Step === 1
        ? { action_schema: "validate_input", target_subsystem: "KERNEL", typed_arguments: {} }
        : { action_schema: "complete_gate_task", target_subsystem: "KERNEL", typed_arguments: {} }
    }

    const gate3FailingPlanner = async (): Promise<IntentProposal> => ({
      action_schema: "deploy_to_prod",
      target_subsystem: "KERNEL",
      typed_arguments: {},
    })

    const result = await runPipeline({
      gates: [gate0, gate3],
      recall: createPolicyRecall(gate3),
      planners: {
        GATE_0_INGESTION: gate0Planner,
        GATE_3_REMEDIATION: gate3FailingPlanner,
      },
    })

    expect(result.status).toBe("ROLLBACK")
    expect(result.perGate).toHaveLength(2)
    expect(result.perGate[0].status).toBe("PROCEED")
    expect(result.perGate[1].status).toBe("ROLLBACK")
  })

  test("pessimistic shield rejects low-confidence SOP tools", async () => {
    const gate: import("../policy").GatePolicy = {
      ...loadGate("GATE_3_REMEDIATION"),
      confidenceThreshold: 0.8,
    }
    const memory = new CrystallineMemory({ policy: gate })

    const lowConfPlanner = async (): Promise<IntentProposal> => ({
      action_schema: "ares_scan_directory",
      target_subsystem: "SECURITY_SCANNER",
      typed_arguments: {},
      confidence: 0.3,
    })

    const result = await runPipeline({
      gates: [gate],
      recall: memory,
      planners: { GATE_3_REMEDIATION: lowConfPlanner },
    })

    expect(result.status).toBe("ROLLBACK")
    for (const trace of result.allTraces) {
      expect(trace.network_emitted).toBe(false)
    }
  })

  test("all 5 gates run full sequence (GATE_0 → GATE_4)", async () => {
    const gates = [
      loadGate("GATE_0_INGESTION"),
      loadGate("GATE_1_CONTEXT"),
      loadGate("GATE_2_CICD"),
      loadGate("GATE_3_REMEDIATION"),
      loadGate("GATE_4_VALIDATION"),
    ]

    const planners: Record<string, (h: unknown[]) => Promise<IntentProposal>> = {}
    for (const gate of gates) {
      let step = 0
      const sop = gate.sopTools[0]
      planners[gate.gate] = async () => {
        step++
        return step === 1
          ? { action_schema: sop, target_subsystem: "KERNEL", typed_arguments: {} }
          : { action_schema: "complete_gate_task", target_subsystem: "KERNEL", typed_arguments: {} }
      }
    }

    const result = await runPipeline({
      gates,
      recall: createPolicyRecall(gates[0]),
      planners,
    })

    expect(result.status).toBe("PROCEED")
    expect(result.perGate).toHaveLength(5)
    for (const pg of result.perGate) {
      expect(pg.status).toBe("PROCEED")
    }
  })
})
