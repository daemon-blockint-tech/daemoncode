import { describe, test, expect } from "bun:test"
import { createOuroborosExecutor } from "./ouroboros"
import type { ProcessRunner } from "./process"

describe("OuroborosExecutor", () => {
  test("returns SUCCESS when scan complete with no blocking findings", async () => {
    const mockRunner: ProcessRunner = {
      run: async () => ({
        exitCode: 0,
        stdout: `{"record_type":"package","catalog_id":"npm/lodash"}\n{"record_type":"finding","severity":"Low","catalog_id":"npm/lodash:xss"}\n{"record_type":"scan_summary","status":"complete"}`,
        stderr: "",
        killed: false,
      }),
    }

    const executor = createOuroborosExecutor({
      runner: mockRunner,
      ouroborosBin: "ouroboros",
      allowedRoot: "/scan",
    })

    const result = await executor()
    expect(result.status).toBe("SUCCESS")
  })

  test("returns FAILURE when HIGH severity finding present after complete", async () => {
    const mockRunner: ProcessRunner = {
      run: async () => ({
        exitCode: 0,
        stdout: `{"record_type":"scan_summary","status":"complete"}\n{"record_type":"finding","severity":"High","catalog_id":"cve-2024-1234"}`,
        stderr: "",
        killed: false,
      }),
    }

    const executor = createOuroborosExecutor({
      runner: mockRunner,
      ouroborosBin: "ouroboros",
      allowedRoot: "/scan",
    })

    const result = await executor()
    expect(result.status).toBe("FAILURE")
    expect(result.summary).toContain("blocking")
  })

  test("enforces promotion rule: ignores findings before scan_summary", async () => {
    const mockRunner: ProcessRunner = {
      run: async () => ({
        exitCode: 0,
        stdout: `{"record_type":"finding","severity":"Critical","catalog_id":"fake-critical"}\n{"record_type":"scan_summary","status":"complete"}`,
        stderr: "",
        killed: false,
      }),
    }

    const executor = createOuroborosExecutor({
      runner: mockRunner,
      ouroborosBin: "ouroboros",
      allowedRoot: "/scan",
    })

    const result = await executor()
    expect(result.status).toBe("SUCCESS")
  })

  test("returns FAILURE when scan incomplete", async () => {
    const mockRunner: ProcessRunner = {
      run: async () => ({
        exitCode: 0,
        stdout: `{"record_type":"package","catalog_id":"npm/lodash"}\n{"record_type":"finding","severity":"Low"}`,
        stderr: "",
        killed: false,
      }),
    }

    const executor = createOuroborosExecutor({
      runner: mockRunner,
      ouroborosBin: "ouroboros",
      allowedRoot: "/scan",
    })

    const result = await executor()
    expect(result.status).toBe("FAILURE")
    expect(result.summary).toContain("did not complete")
  })

  test("returns FAILURE on timeout", async () => {
    const mockRunner: ProcessRunner = {
      run: async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        killed: true,
      }),
    }

    const executor = createOuroborosExecutor({
      runner: mockRunner,
      ouroborosBin: "ouroboros",
      allowedRoot: "/scan",
    })

    const result = await executor()
    expect(result.status).toBe("FAILURE")
    expect(result.summary).toContain("timeout")
  })
})
