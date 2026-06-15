/**
 * Machine-checked safety: exhaustively verifies that the real kernel satisfies
 * No-Unsafe-Network-Emission (P1) and Bounded-Termination (P2) over every
 * adversarial action sequence, for several policies. Replaces "proof by
 * inspection" with an enumeration enforced in CI.
 */
import { describe, expect, test } from "bun:test"
import { verifyGate } from "./verification"
import type { GatePolicy } from "./policy"

const base: GatePolicy = {
  gate: "GATE_3_REMEDIATION",
  blockedActions: ["deploy_to_prod", "force_publish", "trigger_pipeline", "execute_bash"],
  sopTools: ["ares_scan_directory", "ouroboros_scan"],
  completionTool: "complete_gate_task",
  maxGateRetries: 3,
  maxGlobalRetries: 10,
}

describe("GATE_3 exhaustive verification", () => {
  test("default policy: no P1/P2 violations over all adversarial paths", async () => {
    const report = await verifyGate(base)
    expect(report.violations).toEqual([])
    expect(report.pathsChecked).toBeGreaterThan(0)
  })

  test("forbidden actions never reach a terminal PROCEED", async () => {
    // Any path that only ever proposes forbidden actions must ROLLBACK.
    const report = await verifyGate(base, ["deploy_to_prod"])
    expect(report.violations).toEqual([])
  })

  test("property holds across a range of retry budgets", async () => {
    for (const k of [1, 2, 3, 5]) {
      const report = await verifyGate({ ...base, maxGateRetries: k, maxGlobalRetries: 8 })
      expect(report.violations).toEqual([])
      expect(report.enumDepth).toBe(k + 1)
      expect(report.terminationBound).toBe(8)
    }
  })

  test("termination is bounded even under unbounded SOP looping", async () => {
    // A planner that only ever calls an SOP tool must still terminate, bounded
    // by the global turn budget (this is the regression the fix addresses).
    const report = await verifyGate(base, ["ares_scan_directory"])
    expect(report.violations).toEqual([])
  })

  test("property holds under the pessimistic shield", async () => {
    const report = await verifyGate({ ...base, confidenceThreshold: 0.8 })
    expect(report.violations).toEqual([])
  })

  test("reachable enforcer states are exercised", async () => {
    const report = await verifyGate(base)
    expect(report.statesCovered).toContain("BLOCKED")
    expect(report.statesCovered).toContain("ROLLBACK")
    expect(report.statesCovered).toContain("SUCCESS")
    expect(report.statesCovered).toContain("PROCEED")
  })
})
