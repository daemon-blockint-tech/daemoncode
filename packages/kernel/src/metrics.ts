/**
 * Prometheus-compatible metrics export for the kernel.
 *
 * Renders kernel telemetry and verification state as Prometheus text format
 * without any external dependency. Suitable for scraping by Prometheus,
 * Grafana Agent, or any OpenMetrics-compatible collector.
 */

import type { SiemStats } from "./siem"

export interface VerificationMetrics {
  gatesChecked: number
  p1Violations: number
  p2Violations: number
}

/** Render Prometheus text-format metrics from kernel telemetry + verification. */
export function renderMetrics(stats: SiemStats, verification: VerificationMetrics): string {
  const lines: string[] = []

  lines.push("# HELP kernel_decisions_total Total kernel gate decisions by status.")
  lines.push("# TYPE kernel_decisions_total counter")
  for (const [status, count] of Object.entries(stats.byStatus)) {
    lines.push(`kernel_decisions_total{status="${status}"} ${count}`)
  }

  lines.push("# HELP kernel_network_emitted_total Total network packets emitted by gate.")
  lines.push("# TYPE kernel_network_emitted_total counter")
  for (const [gate, count] of Object.entries(stats.byGate)) {
    lines.push(`kernel_network_emitted_total{gate="${gate}"} ${stats.emitted}`)
  }

  lines.push("# HELP kernel_blocked_total Total blocked actions.")
  lines.push("# TYPE kernel_blocked_total counter")
  lines.push(`kernel_blocked_total ${stats.blocked}`)

  lines.push("# HELP kernel_rollbacks_total Total rollback events.")
  lines.push("# TYPE kernel_rollbacks_total counter")
  lines.push(`kernel_rollbacks_total ${stats.rollbacks}`)

  lines.push("# HELP kernel_verification_states_covered Number of states covered by model checker.")
  lines.push("# TYPE kernel_verification_states_covered gauge")
  lines.push(`kernel_verification_states_covered ${verification.gatesChecked}`)

  lines.push("# HELP kernel_verification_p1_violations Number of P1 violations found.")
  lines.push("# TYPE kernel_verification_p1_violations gauge")
  lines.push(`kernel_verification_p1_violations ${verification.p1Violations}`)

  lines.push("# HELP kernel_verification_p2_violations Number of P2 violations found.")
  lines.push("# TYPE kernel_verification_p2_violations gauge")
  lines.push(`kernel_verification_p2_violations ${verification.p2Violations}`)

  return lines.join("\n") + "\n"
}
