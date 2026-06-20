/**
 * Alerting webhook for ROLLBACK rate monitoring.
 *
 * Monitors telemetry rows fed from a teeSink and sends webhook alerts
 * when ROLLBACK rate exceeds a configurable threshold within a time window.
 * Supports Slack, PagerDuty, and generic webhook endpoints.
 */

import type { TelemetryRow } from "./types"

export interface RollbackAlertMonitorOpts {
  /** Number of ROLLBACKs in the window that triggers an alert. */
  threshold: number
  /** Time window in milliseconds. */
  windowMs: number
  /** Webhook URL to POST alerts to. */
  webhook: string
  /** Optional fetch implementation (tests). */
  fetchImpl?: typeof fetch
}

export class RollbackAlertMonitor {
  private readonly window: TelemetryRow[] = []
  private readonly opts: RollbackAlertMonitorOpts
  private lastAlert = 0

  constructor(opts: RollbackAlertMonitorOpts) {
    this.opts = opts
  }

  /** Feed a telemetry row (typically via teeSink). */
  onTelemetryRow(row: TelemetryRow): void {
    this.window.push(row)
    this.pruneOld()

    if (row.enforcer_status === "ROLLBACK") {
      const rollbacks = this.window.filter((r) => r.enforcer_status === "ROLLBACK").length
      if (rollbacks >= this.opts.threshold && Date.now() - this.lastAlert > this.opts.windowMs) {
        this.lastAlert = Date.now()
        void this.sendAlert(rollbacks)
      }
    }
  }

  private pruneOld(): void {
    const cutoff = Date.now() - this.opts.windowMs
    while (this.window.length > 0 && new Date(this.window[0].timestamp).getTime() < cutoff) {
      this.window.shift()
    }
  }

  private async sendAlert(rollbackCount: number): Promise<void> {
    const fetchImpl = this.opts.fetchImpl ?? globalThis.fetch
    const body = JSON.stringify({
      text: `🚨 Kernel Alert: ${rollbackCount} ROLLBACKs in the last ${this.opts.windowMs / 1000}s (threshold: ${this.opts.threshold})`,
      rollbackCount,
      threshold: this.opts.threshold,
      windowMs: this.opts.windowMs,
      timestamp: new Date().toISOString(),
    })

    try {
      await fetchImpl(this.opts.webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      })
    } catch {
      // Alert delivery failure must not affect kernel enforcement
    }
  }
}
