import { describe, test, expect } from "bun:test"
import { SqliteSiemSink } from "./siem"
import { renderStats, renderDashboard } from "./dashboard"
import type { TelemetryRow } from "./types"

function row(overrides: Partial<TelemetryRow>): TelemetryRow {
  return {
    gate: "GATE_3_REMEDIATION",
    turn: 1,
    action_schema: "ares_scan_directory",
    enforcer_status: "SUCCESS",
    network_emitted: true,
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

describe("SqliteSiemSink", () => {
  test("persists and queries rows", () => {
    const sink = new SqliteSiemSink()
    sink.append(row({ action_schema: "ares_scan_directory" }))
    sink.append(row({ action_schema: "deploy_to_prod", enforcer_status: "BLOCKED", network_emitted: false }))

    const all = sink.query()
    expect(all).toHaveLength(2)
    sink.close()
  })

  test("filters by gate and status", () => {
    const sink = new SqliteSiemSink()
    sink.append(row({ gate: "GATE_0_INGESTION" }))
    sink.append(row({ gate: "GATE_3_REMEDIATION", enforcer_status: "ROLLBACK", network_emitted: false }))

    expect(sink.query({ gate: "GATE_0_INGESTION" })).toHaveLength(1)
    expect(sink.query({ enforcerStatus: "ROLLBACK" })).toHaveLength(1)
    expect(sink.query({ emittedOnly: true })).toHaveLength(1)
    sink.close()
  })

  test("computes aggregate stats", () => {
    const sink = new SqliteSiemSink()
    sink.append(row({ enforcer_status: "SUCCESS", network_emitted: true }))
    sink.append(row({ enforcer_status: "BLOCKED", network_emitted: false }))
    sink.append(row({ enforcer_status: "BLOCKED", network_emitted: false }))
    sink.append(row({ enforcer_status: "ROLLBACK", network_emitted: false }))

    const stats = sink.stats()
    expect(stats.total).toBe(4)
    expect(stats.blocked).toBe(2)
    expect(stats.rollbacks).toBe(1)
    expect(stats.emitted).toBe(1)
    expect(stats.byStatus.BLOCKED).toBe(2)
    sink.close()
  })

  test("detectUnsafeEmissions returns empty for safe traces", () => {
    const sink = new SqliteSiemSink()
    // Forbidden action that was correctly blocked (no emission)
    sink.append(row({ action_schema: "deploy_to_prod", enforcer_status: "BLOCKED", network_emitted: false }))
    // Safe action that emitted
    sink.append(row({ action_schema: "ares_scan_directory", enforcer_status: "SUCCESS", network_emitted: true }))

    const alerts = sink.detectUnsafeEmissions(["deploy_to_prod", "execute_bash"])
    expect(alerts).toHaveLength(0)
    sink.close()
  })

  test("detectUnsafeEmissions flags a P1 violation", () => {
    const sink = new SqliteSiemSink()
    // Simulated violation: forbidden action emitted a packet
    sink.append(row({ action_schema: "deploy_to_prod", enforcer_status: "SUCCESS", network_emitted: true }))

    const alerts = sink.detectUnsafeEmissions(["deploy_to_prod"])
    expect(alerts).toHaveLength(1)
    expect(alerts[0].action_schema).toBe("deploy_to_prod")
    sink.close()
  })

  test("respects query limit", () => {
    const sink = new SqliteSiemSink()
    for (let i = 0; i < 10; i++) sink.append(row({ turn: i }))
    expect(sink.query({ limit: 3 })).toHaveLength(3)
    sink.close()
  })
})

describe("Dashboard", () => {
  test("renders stats block", () => {
    const sink = new SqliteSiemSink()
    sink.append(row({ enforcer_status: "SUCCESS" }))
    sink.append(row({ enforcer_status: "BLOCKED", network_emitted: false }))

    const out = renderStats(sink.stats())
    expect(out).toContain("Daemon Kernel SIEM")
    expect(out).toContain("Total decisions")
    sink.close()
  })

  test("full dashboard includes security alert on violation", () => {
    const sink = new SqliteSiemSink()
    sink.append(row({ action_schema: "deploy_to_prod", enforcer_status: "SUCCESS", network_emitted: true }))

    const out = renderDashboard(sink, ["deploy_to_prod"])
    expect(out).toContain("SECURITY ALERT")
    sink.close()
  })

  test("full dashboard omits alert when safe", () => {
    const sink = new SqliteSiemSink()
    sink.append(row({ action_schema: "ares_scan_directory", enforcer_status: "SUCCESS", network_emitted: true }))

    const out = renderDashboard(sink, ["deploy_to_prod"])
    expect(out).not.toContain("SECURITY ALERT")
    sink.close()
  })
})

describe("Audit Log Export", () => {
  test("exports as NDJSON", () => {
    const sink = new SqliteSiemSink()
    sink.append(row({ action_schema: "tool_a" }))
    sink.append(row({ action_schema: "tool_b" }))

    const lines = sink.exportAuditLog({ format: "ndjson" })
    expect(lines).toHaveLength(2)
    const parsed = JSON.parse(lines[0])
    expect(parsed.action_schema).toBeTruthy()
    sink.close()
  })

  test("exports as CSV with header", () => {
    const sink = new SqliteSiemSink()
    sink.append(row({ action_schema: "tool_a" }))

    const lines = sink.exportAuditLog({ format: "csv" })
    expect(lines[0]).toBe("gate,turn,action_schema,enforcer_status,network_emitted,timestamp")
    expect(lines).toHaveLength(2) // header + 1 row
    sink.close()
  })

  test("exports as JSON array", () => {
    const sink = new SqliteSiemSink()
    sink.append(row({ action_schema: "tool_a" }))

    const lines = sink.exportAuditLog({ format: "json" })
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0])
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(1)
    sink.close()
  })

  test("filters by gate and since", () => {
    const sink = new SqliteSiemSink()
    sink.append(row({ gate: "GATE_0_INGESTION", action_schema: "tool_a" }))
    sink.append(row({ gate: "GATE_3_REMEDIATION", action_schema: "tool_b" }))

    const lines = sink.exportAuditLog({ format: "ndjson", gate: "GATE_0_INGESTION" })
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]).gate).toBe("GATE_0_INGESTION")
    sink.close()
  })
})
