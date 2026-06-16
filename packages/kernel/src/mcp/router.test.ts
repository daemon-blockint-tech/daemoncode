import { describe, test, expect } from "bun:test"
import { createMcpExecutor } from "./router"
import { DeployDecision, type OrionHubClient } from "./orion"
import type { ProcessRunner } from "./process"

describe("McpExecutor Router", () => {
  test("routes ouroboros_scan to ouroboros backend", async () => {
    const mockRunner: ProcessRunner = {
      run: async () => ({
        exitCode: 0,
        stdout: `{"record_type":"scan_summary","status":"complete"}`,
        stderr: "",
        killed: false,
      }),
    }

    const executor = createMcpExecutor({
      ouroboros: {
        tool: "ouroboros_scan",
        opts: { runner: mockRunner, ouroborosBin: "ouroboros", allowedRoot: "/scan" },
      },
    })

    const result = await executor.execute({
      action_schema: "ouroboros_scan",
      target_subsystem: "OUROBOROS",
      typed_arguments: {},
    })

    expect(result.status).toBe("SUCCESS")
    expect(result.networkEmitted).toBe(true)
  })

  test("routes check_orion_policy to orion backend", async () => {
    const mockClient: OrionHubClient = {
      evaluatePolicy: async () => ({
        app_responses: [{ product_id: "app1", decision: DeployDecision.PROCEED }],
      }),
    }

    const executor = createMcpExecutor({
      orion: {
        tool: "check_orion_policy",
        opts: { client: mockClient },
      },
    })

    const result = await executor.execute({
      action_schema: "check_orion_policy",
      target_subsystem: "ORION",
      typed_arguments: { apps: [{ product_id: "app1", current_version: "1.0.0" }] },
    })

    expect(result.status).toBe("SUCCESS")
  })

  test("degrades gracefully when backend not configured", async () => {
    const executor = createMcpExecutor({})

    const result = await executor.execute({
      action_schema: "ares_scan_directory",
      target_subsystem: "ARES",
      typed_arguments: {},
    })

    expect(result.status).toBe("FAILURE")
    expect(result.summary).toContain("No MCP backend configured")
    expect(result.networkEmitted).toBe(false)
  })

  test("never emits network packet on FAILURE", async () => {
    const mockRunner: ProcessRunner = {
      run: async () => ({ exitCode: 1, stdout: "", stderr: "error", killed: false }),
    }

    const executor = createMcpExecutor({
      ouroboros: {
        tool: "ouroboros_scan",
        opts: { runner: mockRunner, ouroborosBin: "ouroboros", allowedRoot: "/scan" },
      },
    })

    const result = await executor.execute({
      action_schema: "ouroboros_scan",
      target_subsystem: "OUROBOROS",
      typed_arguments: {},
    })

    expect(result.status).toBe("FAILURE")
    expect(result.networkEmitted).toBe(false)
  })

  test("passes path argument to ares executor", async () => {
    let capturedArgs: string[] = []
    const mockRunner: ProcessRunner = {
      run: async ({ args }) => {
        capturedArgs = args
        return { exitCode: 1, stdout: "", stderr: "no report", killed: false }
      },
    }

    const executor = createMcpExecutor({
      ares: {
        tool: "ares_scan_directory",
        opts: { runner: mockRunner, aresBin: "ares", allowedRoot: "/scan" },
      },
    })

    await executor.execute({
      action_schema: "ares_scan_directory",
      target_subsystem: "ARES",
      typed_arguments: { path: "contracts" },
    })

    expect(capturedArgs).toContain("contracts")
  })
})
