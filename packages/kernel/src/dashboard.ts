/**
 * Text dashboard for kernel SIEM telemetry. Renders aggregate statistics and
 * recent decisions as a terminal-friendly report (no UI dependency). Suitable
 * for CLI inspection, CI summaries, or piping into a log aggregator.
 */

import type { SqliteSiemSink, SiemStats } from "./siem"
import type { TelemetryRow } from "./types"

function bar(count: number, total: number, width = 20): string {
  if (total === 0) return ""
  const filled = Math.round((count / total) * width)
  return "█".repeat(filled) + "░".repeat(width - filled)
}

/** Render an aggregate stats block. */
export function renderStats(stats: SiemStats): string {
  const lines: string[] = []
  lines.push("┌─ Daemon Kernel SIEM ─────────────────────────────┐")
  lines.push(`│ Total decisions: ${String(stats.total).padEnd(33)}│`)
  lines.push(`│ Packets emitted: ${String(stats.emitted).padEnd(33)}│`)
  lines.push(`│ Blocked:         ${String(stats.blocked).padEnd(33)}│`)
  lines.push(`│ Rollbacks:       ${String(stats.rollbacks).padEnd(33)}│`)
  lines.push("├─ By status ──────────────────────────────────────┤")
  for (const [status, count] of Object.entries(stats.byStatus).sort((a, b) => b[1] - a[1])) {
    lines.push(`│ ${status.padEnd(9)} ${bar(count, stats.total)} ${String(count).padStart(4)} │`)
  }
  lines.push("├─ By gate ────────────────────────────────────────┤")
  for (const [gate, count] of Object.entries(stats.byGate).sort((a, b) => b[1] - a[1])) {
    lines.push(`│ ${gate.slice(0, 22).padEnd(22)} ${String(count).padStart(5)}${" ".repeat(20)}│`)
  }
  lines.push("└──────────────────────────────────────────────────┘")
  return lines.join("\n")
}

/** Render a table of recent decisions. */
export function renderRecent(rows: TelemetryRow[]): string {
  const lines: string[] = []
  lines.push("TIME                 GATE                 TURN STATUS    EMIT ACTION")
  for (const r of rows) {
    lines.push(
      [
        r.timestamp.slice(0, 19),
        r.gate.slice(0, 20).padEnd(20),
        String(r.turn).padStart(4),
        r.enforcer_status.padEnd(9),
        r.network_emitted ? " ✓ " : " · ",
        r.action_schema,
      ].join(" "),
    )
  }
  return lines.join("\n")
}

/** Full dashboard: stats + recent rows + any P1 security alerts. */
export function renderDashboard(sink: SqliteSiemSink, blockedActions: string[] = [], recentLimit = 20): string {
  const parts = [renderStats(sink.stats()), "", renderRecent(sink.query({ limit: recentLimit }))]
  const alerts = sink.detectUnsafeEmissions(blockedActions)
  if (alerts.length > 0) {
    parts.push("", "⚠️  SECURITY ALERT — P1 VIOLATION (forbidden action emitted a packet):")
    parts.push(renderRecent(alerts))
  }
  return parts.join("\n")
}
