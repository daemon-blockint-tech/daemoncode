import { describe, test, expect } from "bun:test"
import { readBackendEnv, buildMcpConfig, buildLiveExecutor } from "./backends"

describe("Kernel Backends (Phase 5)", () => {
  test("readBackendEnv reads configured binaries", () => {
    const env = readBackendEnv({
      DAEMON_ARES_BIN: "/usr/bin/ares",
      DAEMON_OUROBOROS_BIN: "/usr/bin/ouroboros",
      DAEMON_SCAN_ROOT: "/workspace",
    })

    expect(env.aresBin).toBe("/usr/bin/ares")
    expect(env.ouroborosBin).toBe("/usr/bin/ouroboros")
    expect(env.scanRoot).toBe("/workspace")
  })

  test("readBackendEnv defaults scanRoot to cwd", () => {
    const env = readBackendEnv({})
    expect(env.scanRoot).toBe(process.cwd())
    expect(env.aresBin).toBeUndefined()
  })

  test("buildMcpConfig wires only configured backends", () => {
    const config = buildMcpConfig({
      aresBin: "/usr/bin/ares",
      scanRoot: "/workspace",
    })

    expect(config.ares).toBeDefined()
    expect(config.ares?.tool).toBe("ares_scan_directory")
    expect(config.ouroboros).toBeUndefined()
    expect(config.orion).toBeUndefined()
  })

  test("buildMcpConfig wires orion when client supplied", () => {
    const config = buildMcpConfig({
      orionClient: { evaluatePolicy: async () => ({ app_responses: [] }) },
    })

    expect(config.orion).toBeDefined()
    expect(config.orion?.tool).toBe("check_orion_policy")
  })

  test("buildLiveExecutor returns undefined with no backend (stub fallback)", () => {
    const executor = buildLiveExecutor({ scanRoot: "/workspace" })
    expect(executor).toBeUndefined()
  })

  test("buildLiveExecutor returns executor when a backend is configured", () => {
    const executor = buildLiveExecutor({
      ouroborosBin: "/usr/bin/ouroboros",
      scanRoot: "/workspace",
    })
    expect(executor).toBeDefined()
    expect(typeof executor?.execute).toBe("function")
  })

  test("live executor degrades unconfigured SOP tool to FAILURE", async () => {
    // Only ouroboros configured; an ares_scan call must not succeed.
    const executor = buildLiveExecutor({
      ouroborosBin: "/usr/bin/ouroboros",
      scanRoot: "/workspace",
    })

    const result = await executor!.execute({
      action_schema: "ares_scan_directory",
      target_subsystem: "ARES",
      typed_arguments: {},
    })

    expect(result.status).toBe("FAILURE")
    expect(result.networkEmitted).toBe(false)
  })
})
