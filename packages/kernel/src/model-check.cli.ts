/**
 * CI model-checking entry point ("PRISM phase").
 *
 * PRISM binaries are not available in CI, so this runs the in-repo
 * verification equivalents over every gate policy (GATE_0..GATE_4) and the
 * combined pipeline:
 *
 *   1. modelCheckGate  — explicit-state MDP enumeration; asserts
 *      Pmax[F unsafe_emission] = 0 (P1) and bounded termination (P2).
 *   2. verifyGate      — bounded-exhaustive drive of the *real* kernel with an
 *      adversarial planner; asserts P1/P2 on every reachable path.
 *
 * Exits non-zero (failing the build) if any policy violates P1 or P2. The
 * PRISM/PCTL models in `verification/` remain the human-readable specification;
 * this script is their machine-checked, CI-enforced counterpart.
 */

import { GATE_POLICIES } from "./gates"
import { modelCheckGate } from "./model-check"
import { verifyGate } from "./verification"
import type { GatePolicy } from "./policy"

interface GateReport {
  gate: string
  p1: boolean
  p2: boolean
  statesVisited: number
  maxEpisodeLength: number
  pathsChecked: number
  violations: string[]
}

async function checkPolicy(policy: GatePolicy): Promise<GateReport> {
  const mc = modelCheckGate(policy)
  const ver = await verifyGate(policy)

  const violations: string[] = []
  if (!mc.p1Holds) violations.push("model-check: P1 (unsafe emission) FAILED")
  if (!mc.p2Holds) violations.push("model-check: P2 (bounded termination) FAILED")
  violations.push(...mc.violations.map((v) => `model-check: ${v}`))
  violations.push(...ver.violations.map((v) => `verifier: ${v.property} — ${v.detail}`))

  return {
    gate: policy.gate,
    p1: mc.p1Holds && ver.violations.every((v) => v.property !== "P1_NO_UNSAFE_NETWORK_EMISSION"),
    p2: mc.p2Holds && ver.violations.every((v) => v.property !== "P2_BOUNDED_TERMINATION"),
    statesVisited: mc.statesVisited,
    maxEpisodeLength: mc.maxEpisodeLength,
    pathsChecked: ver.pathsChecked,
    violations,
  }
}

export async function runModelCheck(): Promise<{ ok: boolean; reports: GateReport[] }> {
  const reports: GateReport[] = []
  for (const policy of Object.values(GATE_POLICIES)) {
    reports.push(await checkPolicy(policy))
  }
  const ok = reports.every((r) => r.violations.length === 0)
  return { ok, reports }
}

function render(reports: GateReport[]): string {
  const lines: string[] = []
  lines.push("Daemon Kernel — Model-Checking (PRISM phase, CI-enforced)")
  lines.push("=".repeat(60))
  for (const r of reports) {
    const mark = r.violations.length === 0 ? "✓" : "✗"
    lines.push(
      `${mark} ${r.gate.padEnd(22)} P1=${r.p1 ? "✓" : "✗"} P2=${r.p2 ? "✓" : "✗"} ` +
        `states=${r.statesVisited} maxLen=${r.maxEpisodeLength} paths=${r.pathsChecked}`,
    )
    for (const v of r.violations) lines.push(`    ! ${v}`)
  }
  lines.push("=".repeat(60))
  return lines.join("\n")
}

// Run when invoked directly (bun src/model-check.cli.ts).
if (import.meta.main) {
  const { ok, reports } = await runModelCheck()
  console.log(render(reports))
  if (!ok) {
    console.error("\nMODEL-CHECK FAILED: one or more gate policies violate P1/P2.")
    process.exit(1)
  }
  console.log(`\nAll ${reports.length} gate policies satisfy P1 (no unsafe emission) and P2 (bounded termination).`)
}
