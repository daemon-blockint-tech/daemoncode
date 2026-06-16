import { describe, test, expect, afterEach } from "bun:test"
import { getSiemSink, resetSiemSink } from "./siem-store"

afterEach(() => resetSiemSink())

describe("SIEM Store", () => {
  test("returns undefined when DAEMON_SIEM_DB unset", () => {
    expect(getSiemSink({})).toBeUndefined()
  })

  test("returns a sink when DAEMON_SIEM_DB set", () => {
    const sink = getSiemSink({ DAEMON_SIEM_DB: ":memory:" })
    expect(sink).toBeDefined()
    expect(typeof sink?.append).toBe("function")
  })

  test("caches the same sink across calls", () => {
    const a = getSiemSink({ DAEMON_SIEM_DB: ":memory:" })
    const b = getSiemSink({ DAEMON_SIEM_DB: ":memory:" })
    expect(a).toBe(b)
  })

  test("persisted rows are queryable through the shared sink", () => {
    const sink = getSiemSink({ DAEMON_SIEM_DB: ":memory:" })
    sink!.append({
      gate: "GATE_0_INGESTION",
      turn: 1,
      action_schema: "execute_bash",
      enforcer_status: "BLOCKED",
      network_emitted: false,
      timestamp: new Date().toISOString(),
    })
    // The shared sink is a SqliteSiemSink; cast to access query in this test.
    const rows = (sink as unknown as { query: () => unknown[] }).query()
    expect(rows.length).toBe(1)
  })
})
