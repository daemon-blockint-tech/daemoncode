import { describe, test, expect } from "bun:test"
import { runGateWithGuardedTools } from "./kernel"
import { CrystallineMemory } from "./crystalline-memory"
import { SqliteSiemSink } from "./siem"
import { loadGate } from "./gates/registry"
import type { IntentProposal, TelemetryRow } from "./types"

describe("Kernel + CrystallineMemory + routing integration", () => {
  test("blocks forbidden tool (deploy_to_prod) and returns ROLLBACK", async () => {
    const policy = loadGate("GATE_3_REMEDIATION")
    const memory = new CrystallineMemory({ policy })
    const sink = new SqliteSiemSink()

    const result = await runGateWithGuardedTools({
      policy,
      recall: memory,
      planner: async () => ({
        action_schema: "deploy_to_prod",
        target_subsystem: "OPENCODE",
        typed_arguments: {},
      }),
      sink,
    })

    expect(result.status).toBe("ROLLBACK")
    for (const trace of result.traces) {
      expect(trace.network_emitted).toBe(false)
      expect(trace.enforcer_status).not.toBe("PROCEED")
    }
    sink.close()
  })

  test("allows SOP tool after violation, then completes", async () => {
    const policy = loadGate("GATE_3_REMEDIATION")
    const memory = new CrystallineMemory({
      policy,
      semioticLinks: [
        { alias: "ship_to_production", canonical: "deploy_to_prod", relation: "synonym" },
      ],
    })
    const sink = new SqliteSiemSink()

    let step = 0
    const result = await runGateWithGuardedTools({
      policy,
      recall: memory,
      planner: async () => {
        step++
        if (step === 1) return { action_schema: "ship_to_production", target_subsystem: "OPENCODE", typed_arguments: {} }
        if (step === 2) return { action_schema: "ares_scan_directory", target_subsystem: "OPENCODE", typed_arguments: {} }
        return { action_schema: "complete_gate_task", target_subsystem: "OPENCODE", typed_arguments: {} }
      },
      sink,
    })

    expect(result.status).toBe("PROCEED")
    expect(result.traces.length).toBeGreaterThanOrEqual(3)
    // First trace should be BLOCKED (synonym of deploy_to_prod)
    expect(result.traces[0].enforcer_status).toBe("BLOCKED")
    expect(result.traces[0].network_emitted).toBe(false)
    // Second trace should be SUCCESS (SOP tool)
    expect(result.traces[1].enforcer_status).toBe("SUCCESS")
    expect(result.traces[1].network_emitted).toBe(true)
    sink.close()
  })

  test("emits telemetry to SIEM sink", async () => {
    const policy = loadGate("GATE_3_REMEDIATION")
    const memory = new CrystallineMemory({ policy })
    const sink = new SqliteSiemSink()

    await runGateWithGuardedTools({
      policy,
      recall: memory,
      planner: async () => ({
        action_schema: "deploy_to_prod",
        target_subsystem: "OPENCODE",
        typed_arguments: {},
      }),
      sink,
    })

    const rows = sink.query({ gate: "GATE_3_REMEDIATION" })
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.gate).toBe("GATE_3_REMEDIATION")
      expect(typeof row.turn).toBe("number")
      expect(typeof row.action_schema).toBe("string")
      expect(["BLOCKED", "SUCCESS", "FAILURE", "ROLLBACK", "PROCEED"]).toContain(row.enforcer_status)
    }
    sink.close()
  })

  test("synonym attack blocked via CrystallineMemory semiotic links", async () => {
    const policy = loadGate("GATE_3_REMEDIATION")
    const memory = new CrystallineMemory({
      policy,
      semioticLinks: [
        { alias: "ship_to_production", canonical: "deploy_to_prod", relation: "synonym" },
        { alias: "go_live", canonical: "deploy_to_prod", relation: "paraphrase", weight: 0.8 },
        { alias: "push_to_prod", canonical: "deploy_to_prod", relation: "synonym" },
      ],
    })

    const aliases = ["ship_to_production", "go_live", "push_to_prod"]

    for (const alias of aliases) {
      const result = await runGateWithGuardedTools({
        policy,
        recall: memory,
        planner: async () => ({
          action_schema: alias,
          target_subsystem: "OPENCODE",
          typed_arguments: {},
        }),
      })
      expect(result.status).toBe("ROLLBACK")
      for (const trace of result.traces) {
        expect(trace.network_emitted).toBe(false)
      }
    }
  })

  test("pessimistic shield blocks low-confidence SOP tools via intent.confidence", async () => {
    const policy = loadGate("GATE_3_REMEDIATION")
    const confidencePolicy = { ...policy, confidenceThreshold: 0.8 }
    const memory = new CrystallineMemory({ policy: confidencePolicy })

    let step = 0
    const result = await runGateWithGuardedTools({
      policy: confidencePolicy,
      recall: memory,
      planner: async () => {
        step++
        // Low confidence on the SOP tool triggers pessimistic shield
        return {
          action_schema: "ares_scan_directory",
          target_subsystem: "OPENCODE",
          typed_arguments: {},
          confidence: 0.3,
        }
      },
    })

    expect(result.status).toBe("ROLLBACK")
    for (const trace of result.traces) {
      expect(trace.network_emitted).toBe(false)
    }
  })

  test("all traces have consistent gate field", async () => {
    const policy = loadGate("GATE_3_REMEDIATION")
    const memory = new CrystallineMemory({ policy })

    const result = await runGateWithGuardedTools({
      policy,
      recall: memory,
      planner: async () => ({
        action_schema: "deploy_to_prod",
        target_subsystem: "OPENCODE",
        typed_arguments: {},
      }),
    })

    for (const trace of result.traces) {
      expect(trace.gate).toBe("GATE_3_REMEDIATION")
    }
  })

  test("telemetry timestamps are monotonically increasing", async () => {
    const policy = loadGate("GATE_3_REMEDIATION")
    const memory = new CrystallineMemory({ policy })
    const sink = new SqliteSiemSink()

    await runGateWithGuardedTools({
      policy,
      recall: memory,
      planner: async () => ({
        action_schema: "deploy_to_prod",
        target_subsystem: "OPENCODE",
        typed_arguments: {},
      }),
      sink,
    })

    const rows = sink.query({ gate: "GATE_3_REMEDIATION" })
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].timestamp >= rows[i - 1].timestamp).toBe(true)
    }
    sink.close()
  })
})
