import { describe, test, expect } from "bun:test"
import { runModelCheck } from "./model-check.cli"

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
