import { describe, test, expect, afterEach } from "bun:test"
import { renderStats, renderRecent, renderDashboard } from "./dashboard"
import { SqliteSiemSink } from "./siem"
import type { TelemetryRow } from "./types"

function makeRow(overrides: Partial<TelemetryRow> = {}): TelemetryRow {
  return {
    gate: "GATE_3_REMEDIATION",
    turn: 1,
    action_schema: "deploy_to_prod",
    enforcer_status: "BLOCKED",
    network_emitted: false,
    timestamp: "2025-01-15T10:00:00.000Z",
    ...overrides,
  }
}

describe("renderStats", () => {
  test("empty stats renders correctly", () => {
    const output = renderStats({
      total: 0,
      byStatus: {},
      byGate: {},
      emitted: 0,
      blocked: 0,
      rollbacks: 0,
    })
    expect(output).toContain("Daemon Kernel SIEM")
    expect(output).toContain("Total decisions: 0")
    expect(output).toContain("Packets emitted: 0")
    expect(output).toContain("Blocked:         0")
    expect(output).toContain("Rollbacks:       0")
  })

  test("correct bar rendering for blocked/emitted/rollback", () => {
    const output = renderStats({
      total: 100,
      byStatus: { BLOCKED: 30, SUCCESS: 50, ROLLBACK: 20 },
      byGate: { GATE_3_REMEDIATION: 100 },
      emitted: 50,
      blocked: 30,
      rollbacks: 20,
    })
    expect(output).toContain("Total decisions: 100")
    expect(output).toContain("Packets emitted: 50")
    expect(output).toContain("Blocked:         30")
    expect(output).toContain("Rollbacks:       20")
    expect(output).toContain("BLOCKED")
    expect(output).toContain("SUCCESS")
    expect(output).toContain("ROLLBACK")
    expect(output).toContain("GATE_3_REMEDIATION")
  })
})

describe("renderRecent", () => {
  test("empty rows renders header only", () => {
    const output = renderRecent([])
    const lines = output.split("\n")
    expect(lines[0]).toContain("TIME")
    expect(lines[0]).toContain("GATE")
    expect(lines[0]).toContain("STATUS")
    expect(lines).toHaveLength(1)
  })

  test("renders rows with correct truncation", () => {
    const rows: TelemetryRow[] = [
      makeRow({ gate: "GATE_3_REMEDIATION", turn: 1, enforcer_status: "BLOCKED", network_emitted: false }),
      makeRow({ gate: "GATE_0_INGESTION", turn: 2, enforcer_status: "SUCCESS", network_emitted: true, action_schema: "validate_input" }),
    ]
    const output = renderRecent(rows)
    const lines = output.split("\n")
    expect(lines).toHaveLength(3) // header + 2 rows
    expect(lines[1]).toContain("BLOCKED")
    expect(lines[1]).toContain("GATE_3_REMEDIATION")
    expect(lines[2]).toContain("SUCCESS")
    expect(lines[2]).toContain("GATE_0_INGESTION")
    expect(lines[2]).toContain("validate_input")
  })

  test("emitted checkmark shown for network_emitted=true", () => {
    const rows: TelemetryRow[] = [makeRow({ network_emitted: true, enforcer_status: "SUCCESS" })]
    const output = renderRecent(rows)
    expect(output).toContain("✓")
  })

  test("dot shown for network_emitted=false", () => {
    const rows: TelemetryRow[] = [makeRow({ network_emitted: false, enforcer_status: "BLOCKED" })]
    const output = renderRecent(rows)
    expect(output).toContain("·")
  })
})

describe("renderDashboard", () => {
  test("no alert when safe traces", () => {
    const sink = new SqliteSiemSink()
    sink.append(makeRow({ action_schema: "ares_scan_directory", enforcer_status: "SUCCESS", network_emitted: true }))
    sink.append(makeRow({ action_schema: "deploy_to_prod", enforcer_status: "BLOCKED", network_emitted: false }))

    const output = renderDashboard(sink, ["deploy_to_prod"])
    expect(output).toContain("Daemon Kernel SIEM")
    expect(output).not.toContain("SECURITY ALERT")
    sink.close()
  })

  test("includes SECURITY ALERT when P1 violation detected", () => {
    const sink = new SqliteSiemSink()
    // Simulate P1 violation: forbidden action emitted a packet
    sink.append(makeRow({ action_schema: "deploy_to_prod", enforcer_status: "SUCCESS", network_emitted: true }))

    const output = renderDashboard(sink, ["deploy_to_prod"])
    expect(output).toContain("SECURITY ALERT")
    expect(output).toContain("P1 VIOLATION")
    sink.close()
  })

  test("respects recentLimit parameter", () => {
    const sink = new SqliteSiemSink()
    for (let i = 0; i < 10; i++) {
      sink.append(makeRow({ turn: i, enforcer_status: "SUCCESS", network_emitted: true }))
    }

    const output = renderDashboard(sink, [], 3)
    // The recent section should show at most 3 rows
    const lines = output.split("\n")
    const timeHeaderIdx = lines.findIndex((l) => l.startsWith("TIME"))
    const rowsAfterHeader = lines.slice(timeHeaderIdx + 1).filter((l) => l.trim().length > 0 && !l.startsWith("⚠"))
    expect(rowsAfterHeader.length).toBeLessThanOrEqual(3)
    sink.close()
  })
})
