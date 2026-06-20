import { describe, test, expect } from "bun:test"
import { renderMetrics } from "./metrics"
import type { SiemStats } from "./siem"
import type { VerificationMetrics } from "./metrics"

const stats: SiemStats = {
  total: 100,
  byStatus: { BLOCKED: 30, SUCCESS: 50, ROLLBACK: 20 },
  byGate: { GATE_3_REMEDIATION: 60, GATE_0_INGESTION: 40 },
  emitted: 50,
  blocked: 30,
  rollbacks: 20,
}

const verification: VerificationMetrics = {
  gatesChecked: 5,
  p1Violations: 0,
  p2Violations: 0,
}

describe("renderMetrics", () => {
  test("renders all metric families", () => {
    const output = renderMetrics(stats, verification)
    expect(output).toContain("kernel_decisions_total")
    expect(output).toContain("kernel_network_emitted_total")
    expect(output).toContain("kernel_blocked_total")
    expect(output).toContain("kernel_rollbacks_total")
    expect(output).toContain("kernel_verification_states_covered")
    expect(output).toContain("kernel_verification_p1_violations")
    expect(output).toContain("kernel_verification_p2_violations")
  })

  test("includes HELP and TYPE annotations", () => {
    const output = renderMetrics(stats, verification)
    expect(output).toContain("# HELP kernel_decisions_total")
    expect(output).toContain("# TYPE kernel_decisions_total counter")
    expect(output).toContain("# TYPE kernel_verification_states_covered gauge")
  })

  test("renders status labels correctly", () => {
    const output = renderMetrics(stats, verification)
    expect(output).toContain('kernel_decisions_total{status="BLOCKED"} 30')
    expect(output).toContain('kernel_decisions_total{status="SUCCESS"} 50')
    expect(output).toContain('kernel_decisions_total{status="ROLLBACK"} 20')
  })

  test("renders gate labels correctly", () => {
    const output = renderMetrics(stats, verification)
    expect(output).toContain('kernel_network_emitted_total{gate="GATE_3_REMEDIATION"}')
    expect(output).toContain('kernel_network_emitted_total{gate="GATE_0_INGESTION"}')
  })

  test("renders zero violations correctly", () => {
    const output = renderMetrics(stats, verification)
    expect(output).toContain("kernel_verification_p1_violations 0")
    expect(output).toContain("kernel_verification_p2_violations 0")
  })

  test("renders non-zero violations", () => {
    const output = renderMetrics(stats, { ...verification, p1Violations: 2 })
    expect(output).toContain("kernel_verification_p1_violations 2")
  })

  test("empty stats renders without errors", () => {
    const emptyStats: SiemStats = {
      total: 0,
      byStatus: {},
      byGate: {},
      emitted: 0,
      blocked: 0,
      rollbacks: 0,
    }
    const output = renderMetrics(emptyStats, verification)
    expect(output).toContain("kernel_blocked_total 0")
    expect(output).toContain("kernel_rollbacks_total 0")
  })
})
