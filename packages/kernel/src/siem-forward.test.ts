import { describe, test, expect } from "bun:test"
import { SiemForwarder, teeSink } from "./siem-forward"
import type { TelemetryRow } from "./types"
import type { TelemetrySink } from "./telemetry"

function row(overrides: Partial<TelemetryRow> = {}): TelemetryRow {
  return {
    gate: "GATE_3_REMEDIATION",
    turn: 1,
    action_schema: "deploy_to_prod",
    enforcer_status: "BLOCKED",
    network_emitted: false,
    timestamp: "2026-06-16T00:00:00.000Z",
    ...overrides,
  }
}

interface Captured {
  url: string
  body: string
  headers: Record<string, string>
}

function fakeFetch(captured: Captured[], status = 200): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    captured.push({
      url: String(url),
      body: String(init.body),
      headers: init.headers as Record<string, string>,
    })
    return new Response(null, { status }) as Response
  }) as unknown as typeof fetch
}

describe("SiemForwarder", () => {
  test("flushes a full batch and encodes Splunk HEC format", async () => {
    const captured: Captured[] = []
    const fwd = new SiemForwarder({
      endpoint: "https://splunk.example/services/collector",
      format: "splunk-hec",
      token: "abc",
      batchSize: 2,
      flushIntervalMs: 0,
      fetchImpl: fakeFetch(captured),
    })

    fwd.append(row())
    fwd.append(row({ turn: 2 }))
    await fwd.close()

    expect(captured).toHaveLength(1)
    expect(captured[0].headers["authorization"]).toBe("Splunk abc")
    // Two newline-delimited "event"-wrapped objects
    const lines = captured[0].body.trim().split("\n")
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]).event.action_schema).toBe("deploy_to_prod")
    expect(JSON.parse(lines[0]).sourcetype).toBe("daemon:kernel")
  })

  test("encodes Elasticsearch bulk format with index action lines", async () => {
    const captured: Captured[] = []
    const fwd = new SiemForwarder({
      endpoint: "https://es.example/_bulk",
      format: "elastic-bulk",
      token: "key",
      index: "kernel-audit",
      batchSize: 1,
      flushIntervalMs: 0,
      fetchImpl: fakeFetch(captured),
    })

    fwd.append(row())
    await fwd.close()

    expect(captured[0].headers["authorization"]).toBe("ApiKey key")
    expect(captured[0].headers["content-type"]).toBe("application/x-ndjson")
    const lines = captured[0].body.trim().split("\n")
    expect(JSON.parse(lines[0])).toEqual({ index: { _index: "kernel-audit" } })
    expect(JSON.parse(lines[1]).action_schema).toBe("deploy_to_prod")
  })

  test("does not flush below batch size until close", async () => {
    const captured: Captured[] = []
    const fwd = new SiemForwarder({
      endpoint: "https://x",
      format: "splunk-hec",
      batchSize: 10,
      flushIntervalMs: 0,
      fetchImpl: fakeFetch(captured),
    })

    fwd.append(row())
    expect(captured).toHaveLength(0)
    await fwd.close()
    expect(captured).toHaveLength(1)
  })

  test("retries transient 500s then succeeds", async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      return new Response(null, { status: calls < 3 ? 500 : 200 })
    }) as unknown as typeof fetch

    const fwd = new SiemForwarder({
      endpoint: "https://x",
      format: "splunk-hec",
      batchSize: 1,
      flushIntervalMs: 0,
      maxRetries: 3,
      retryBackoffMs: 1,
      fetchImpl,
    })

    fwd.append(row())
    await fwd.close()
    expect(calls).toBe(3)
  })

  test("drops batch after exhausting retries and calls onDrop", async () => {
    const dropped: TelemetryRow[][] = []
    const fetchImpl = (async () => new Response(null, { status: 500 })) as unknown as typeof fetch

    const fwd = new SiemForwarder({
      endpoint: "https://x",
      format: "splunk-hec",
      batchSize: 1,
      flushIntervalMs: 0,
      maxRetries: 2,
      retryBackoffMs: 1,
      fetchImpl,
      onDrop: (rows) => dropped.push(rows),
    })

    fwd.append(row())
    await fwd.close()
    expect(dropped).toHaveLength(1)
    expect(dropped[0]).toHaveLength(1)
  })

  test("does not retry on non-429 4xx", async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      return new Response(null, { status: 400 })
    }) as unknown as typeof fetch

    const fwd = new SiemForwarder({
      endpoint: "https://x",
      format: "splunk-hec",
      batchSize: 1,
      flushIntervalMs: 0,
      maxRetries: 5,
      retryBackoffMs: 1,
      fetchImpl,
    })

    fwd.append(row())
    await fwd.close()
    expect(calls).toBe(1)
  })

  test("append never throws on a network error", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch

    const fwd = new SiemForwarder({
      endpoint: "https://x",
      format: "splunk-hec",
      batchSize: 1,
      flushIntervalMs: 0,
      maxRetries: 1,
      retryBackoffMs: 1,
      fetchImpl,
    })

    expect(() => fwd.append(row())).not.toThrow()
    await fwd.close()
  })
})

describe("teeSink", () => {
  test("fans out to all sinks", () => {
    const a: TelemetryRow[] = []
    const b: TelemetryRow[] = []
    const sinkA: TelemetrySink = { append: (r) => void a.push(r) }
    const sinkB: TelemetrySink = { append: (r) => void b.push(r) }

    const tee = teeSink(sinkA, sinkB)
    tee.append(row())

    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
  })

  test("a failing sink does not affect the others", () => {
    const ok: TelemetryRow[] = []
    const bad: TelemetrySink = {
      append: () => {
        throw new Error("boom")
      },
    }
    const good: TelemetrySink = { append: (r) => void ok.push(r) }

    const tee = teeSink(bad, good)
    expect(() => tee.append(row())).not.toThrow()
    expect(ok).toHaveLength(1)
  })
})
