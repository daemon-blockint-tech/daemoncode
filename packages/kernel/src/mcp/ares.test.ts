import { describe, test, expect } from "bun:test"
import { createAresExecutor } from "./ares"
import type { ProcessRunner } from "./process"

describe("AresExecutor", () => {
  test("returns FAILURE when scan timeout", async () => {
    const mockRunner: ProcessRunner = {
      run: async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        killed: true,
      }),
    }

    const executor = createAresExecutor({
      runner: mockRunner,
      aresBin: "ares",
      allowedRoot: "/scan",
    })

    const result = await executor("./target")
    expect(result.status).toBe("FAILURE")
    expect(result.summary).toContain("timeout")
  })

  test("rejects path traversal", async () => {
    const mockRunner: ProcessRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", killed: false }),
    }

    const executor = createAresExecutor({
      runner: mockRunner,
      aresBin: "ares",
      allowedRoot: "/scan",
    })

    const result = await executor("../../etc/passwd")
    expect(result.status).toBe("FAILURE")
    expect(result.summary).toContain("Invalid target path")
  })

  test("returns FAILURE when scan exits with error", async () => {
    const mockRunner: ProcessRunner = {
      run: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "scan error",
        killed: false,
      }),
    }

    const executor = createAresExecutor({
      runner: mockRunner,
      aresBin: "ares",
      allowedRoot: "/scan",
    })

    const result = await executor("./target")
    expect(result.status).toBe("FAILURE")
    expect(result.summary).toContain("failed")
  })
})
