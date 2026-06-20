import { describe, test, expect } from "bun:test"
import { checkKernelHealth } from "./health"
import { SqliteSiemSink } from "./siem"

describe("checkKernelHealth", () => {
  test("returns healthy when all checks pass", async () => {
    const sink = new SqliteSiemSink()
    const health = await checkKernelHealth({
      siem: sink,
      skipModelCheck: true,
      mcpBackends: ["ares", "ouroboros"],
    })
    expect(health.status).toBe("healthy")
    expect(health.telemetrySinkConnected).toBe(true)
    expect(health.mcpBackendsAvailable).toEqual(["ares", "ouroboros"])
    expect(health.lastModelCheck).toBeTruthy()
    sink.close()
  })

  test("degrades when SIEM sink is closed", async () => {
    const sink = new SqliteSiemSink()
    sink.close()
    const health = await checkKernelHealth({ siem: sink, skipModelCheck: true })
    expect(health.status).toBe("unhealthy")
    expect(health.telemetrySinkConnected).toBe(false)
  })

  test("skips model check when skipModelCheck=true", async () => {
    const health = await checkKernelHealth({ skipModelCheck: true })
    expect(health.gatesVerified).toBe(true)
    expect(health.status).toBe("healthy")
  })

  test("runs model check by default", async () => {
    const health = await checkKernelHealth({ skipModelCheck: false })
    expect(health.gatesVerified).toBe(true)
  })
})
