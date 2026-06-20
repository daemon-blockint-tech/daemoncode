import { describe, test, expect } from "bun:test"
import { runModelCheck } from "./model-check.cli"
import { modelCheckGate } from "./model-check"
import { verifyGate } from "./verification"
import type { GatePolicy } from "./policy"

describe("Model-check CI runner", () => {
  test("all gate policies satisfy P1 and P2", async () => {
    const { ok, reports } = await runModelCheck()
    expect(ok).toBe(true)
    expect(reports.length).toBeGreaterThanOrEqual(5)
    for (const r of reports) {
      expect(r.p1).toBe(true)
      expect(r.p2).toBe(true)
      expect(r.violations).toEqual([])
    }
  })

  test("covers all five gates", async () => {
    const { reports } = await runModelCheck()
    const gates = reports.map((r) => r.gate)
    expect(gates).toContain("GATE_0_INGESTION")
    expect(gates).toContain("GATE_1_CONTEXT")
    expect(gates).toContain("GATE_2_CICD")
    expect(gates).toContain("GATE_3_REMEDIATION")
    expect(gates).toContain("GATE_4_VALIDATION")
  })
})

describe("Model-check edge cases", () => {
  test("reports violations when verifier finds a P1 breach", async () => {
    // Craft a policy where the verifier would detect an issue:
    // Use maxGateRetries=1, maxGlobalRetries=1 with an empty SOP list.
    // The planner cannot clear sigma_sop, so completionTool is an illegal exit
    // → BLOCKED, then ROLLBACK immediately. This stresses the boundary.
    const edgePolicy: GatePolicy = {
      gate: "GATE_EDGE_MINIMAL",
      blockedActions: ["deploy_to_prod"],
      sopTools: [],
      completionTool: "complete_gate_task",
      maxGateRetries: 1,
      maxGlobalRetries: 1,
    }

    const mc = modelCheckGate(edgePolicy)
    const ver = await verifyGate(edgePolicy)

    // P1 should still hold (forbidden actions never emit in correct kernel)
    expect(mc.p1Holds).toBe(true)
    expect(ver.violations.every((v) => v.property !== "P1_NO_UNSAFE_NETWORK_EMISSION")).toBe(true)

    // With maxRetries=1, any violation leads to immediate ROLLBACK
    expect(mc.p2Holds).toBe(true)
    expect(mc.maxEpisodeLength).toBeLessThanOrEqual(1)
  })

  test("model-check output contains gate names and pass/fail marks", async () => {
    const { ok, reports } = await runModelCheck()
    expect(ok).toBe(true)

    for (const r of reports) {
      expect(r.gate).toMatch(/^GATE_[0-4]_/)
      expect(typeof r.p1).toBe("boolean")
      expect(typeof r.p2).toBe("boolean")
      expect(typeof r.statesVisited).toBe("number")
      expect(r.statesVisited).toBeGreaterThan(0)
      expect(typeof r.maxEpisodeLength).toBe("number")
      expect(r.maxEpisodeLength).toBeGreaterThan(0)
    }
  })

  test("policy with empty blockedActions still satisfies P1", () => {
    const policy: GatePolicy = {
      gate: "GATE_EMPTY_BLOCKED",
      blockedActions: [],
      sopTools: ["scan_tool"],
      completionTool: "done",
      maxGateRetries: 3,
      maxGlobalRetries: 10,
    }

    const mc = modelCheckGate(policy)
    expect(mc.p1Holds).toBe(true)
    expect(mc.violations).toEqual([])
  })
})
