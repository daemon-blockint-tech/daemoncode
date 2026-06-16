/**
 * Real MCP backend wiring for the live kernel gate (Phase 5).
 *
 * Builds a ToolExecutor backed by the real ARES, ouroboros, and Orion executors,
 * configured from environment variables. When a backend is not configured, its
 * SOP tool degrades to FAILURE (the kernel treats an unconfigured scanner as an
 * unsatisfied SOP — it cannot be used to clear the gate). This keeps the safety
 * properties intact whether or not the physical backends are present.
 *
 * Environment:
 *   DAEMON_ARES_BIN        path to the `ares` binary (enables ares_scan_directory)
 *   DAEMON_OUROBOROS_BIN   path to the `ouroboros` binary (enables ouroboros_scan)
 *   DAEMON_SCAN_ROOT       allowlisted root for scans (default: cwd)
 *   DAEMON_ORION_ADDR      Orion hub address (enables check_orion_policy; gRPC
 *                          transport supplied by the caller — see makeOrionClient)
 */

import {
  createMcpExecutor,
  createBunProcessRunner,
  type McpExecutorConfig,
  type ToolExecutor,
  type OrionHubClient,
} from "../../../kernel/src/index"

export interface BackendEnv {
  aresBin?: string
  ouroborosBin?: string
  scanRoot?: string
  orionAddr?: string
  /** Caller-supplied gRPC client; transport stays out of this package. */
  orionClient?: OrionHubClient
}

/** Read backend configuration from process environment. */
export function readBackendEnv(env: Record<string, string | undefined> = process.env): BackendEnv {
  return {
    aresBin: env.DAEMON_ARES_BIN,
    ouroborosBin: env.DAEMON_OUROBOROS_BIN,
    scanRoot: env.DAEMON_SCAN_ROOT ?? process.cwd(),
    orionAddr: env.DAEMON_ORION_ADDR,
  }
}

/**
 * Build the MCP executor config from environment. Only backends with a
 * configured binary/client are wired; the rest degrade to FAILURE.
 */
export function buildMcpConfig(env: BackendEnv): McpExecutorConfig {
  const config: McpExecutorConfig = {}
  const scanRoot = env.scanRoot ?? process.cwd()

  if (env.aresBin) {
    const runner = createBunProcessRunner({
      allowedBinaries: new Set([env.aresBin]),
      allowedRoot: scanRoot,
    })
    config.ares = {
      tool: "ares_scan_directory",
      opts: { runner, aresBin: env.aresBin, allowedRoot: scanRoot },
    }
  }

  if (env.ouroborosBin) {
    const runner = createBunProcessRunner({
      allowedBinaries: new Set([env.ouroborosBin]),
      allowedRoot: scanRoot,
    })
    config.ouroboros = {
      tool: "ouroboros_scan",
      opts: { runner, ouroborosBin: env.ouroborosBin, allowedRoot: scanRoot },
    }
  }

  if (env.orionClient) {
    config.orion = {
      tool: "check_orion_policy",
      opts: { client: env.orionClient },
    }
  }

  return config
}

/**
 * Build a ToolExecutor for the live gate. Returns undefined when no backend is
 * configured, so the caller can fall back to the deterministic stub (which keeps
 * read-only/dev environments working without real scanners).
 */
export function buildLiveExecutor(env: BackendEnv = readBackendEnv()): ToolExecutor | undefined {
  const config = buildMcpConfig(env)
  const hasBackend = Boolean(config.ares || config.ouroboros || config.orion)
  if (!hasBackend) return undefined
  return createMcpExecutor(config)
}
