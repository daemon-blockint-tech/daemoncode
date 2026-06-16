import { describe, test, expect } from "bun:test"
import { createBunProcessRunner } from "./process"

describe("ProcessRunner", () => {
  test("rejects disallowed binary", async () => {
    const runner = createBunProcessRunner({
      allowedBinaries: new Set(["echo"]),
    })

    const result = await runner.run({
      bin: "rm",
      args: ["-rf", "/"],
      cwd: ".",
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("not allowed")
  })

  test("rejects path traversal in cwd", async () => {
    const runner = createBunProcessRunner({
      allowedBinaries: new Set(["cat"]),
      allowedRoot: "/scan",
    })

    const result = await runner.run({
      bin: "cat",
      args: ["file.txt"],
      cwd: "../etc",
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("traversal")
  })
})
