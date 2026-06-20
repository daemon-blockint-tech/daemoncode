import { describe, test, expect } from "bun:test"
import { RollbackAlertMonitor } from "./alerting"
import type { TelemetryRow } from "./types"

function makeRow(status: TelemetryRow["enforcer_status"], offsetMs = 0): TelemetryRow {
  return {
    gate: "GATE_3_REMEDIATION",
    turn: 1,
    action_schema: "deploy_to_prod",
    enforcer_status: status,
    network_emitted: false,
    timestamp: new Date(Date.now() + offsetMs).toISOString(),
  }
}

describe("RollbackAlertMonitor", () => {
  test("does not alert below threshold", async () => {
    let alerted = false
    const monitor = new RollbackAlertMonitor({
      threshold: 3,
      windowMs: 10_000,
      webhook: "http://localhost:9999/alert",
      fetchImpl: async () => {
        alerted = true
        return new Response("ok")
      },
    })

    monitor.onTelemetryRow(makeRow("ROLLBACK"))
    monitor.onTelemetryRow(makeRow("ROLLBACK"))
    // Only 2, threshold is 3
    expect(alerted).toBe(false)
  })

  test("alerts when threshold exceeded", async () => {
    let alertBody = ""
    const monitor = new RollbackAlertMonitor({
      threshold: 2,
      windowMs: 10_000,
      webhook: "http://localhost:9999/alert",
      fetchImpl: async (_url, init) => {
        alertBody = init?.body as string
        return new Response("ok")
      },
    })

    monitor.onTelemetryRow(makeRow("ROLLBACK"))
    monitor.onTelemetryRow(makeRow("ROLLBACK"))
    monitor.onTelemetryRow(makeRow("ROLLBACK"))

    // Wait for async delivery
    await new Promise((r) => setTimeout(r, 10))
    expect(alertBody).toContain("ROLLBACK")
    expect(alertBody).toContain("threshold")
  })

  test("prunes old entries outside window", () => {
    const monitor = new RollbackAlertMonitor({
      threshold: 100,
      windowMs: 1000,
      webhook: "http://localhost:9999/alert",
    })

    // Add old entries
    for (let i = 0; i < 5; i++) {
      monitor.onTelemetryRow(makeRow("ROLLBACK", -5000))
    }

    // Should not alert (threshold is 100)
    // No fetch call made
  })

  test("does not alert twice within cooldown", async () => {
    let alertCount = 0
    const monitor = new RollbackAlertMonitor({
      threshold: 1,
      windowMs: 10_000,
      webhook: "http://localhost:9999/alert",
      fetchImpl: async () => {
        alertCount++
        return new Response("ok")
      },
    })

    monitor.onTelemetryRow(makeRow("ROLLBACK"))
    monitor.onTelemetryRow(makeRow("ROLLBACK"))
    monitor.onTelemetryRow(makeRow("ROLLBACK"))

    await new Promise((r) => setTimeout(r, 10))
    // Should only alert once due to cooldown
    expect(alertCount).toBe(1)
  })
})
