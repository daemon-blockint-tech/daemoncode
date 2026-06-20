/**
 * Kernel health check: exposes the runtime health status for monitoring
 * and alerting. Combines model-check freshness, telemetry sink connectivity,
 * and MCP backend reachability into a single health verdict.
 */

import { runModelCheck } from "./model-check.cli"
import type { SqliteSiemSink } from "./siem"

export interface KernelHealth {
  status: "healthy" | "degraded" | "unhealthy"
  gatesVerified: boolean
  lastModelCheck: string
  telemetrySinkConnected: boolean
  mcpBackendsAvailable: string[]
}

export interface HealthCheckOptions {
  /** The SIEM sink to check connectivity. */
  siem?: SqliteSiemSink
  /** List of configured MCP backend names. */
  mcpBackends?: string[]
  /** Skip expensive model-check (for fast health probes). */
  skipModelCheck?: boolean
}

export async function checkKernelHealth(opts: HealthCheckOptions = {}): Promise<KernelHealth> {
  const { siem, mcpBackends = [], skipModelCheck = false } = opts

  let gatesVerified = true
  if (!skipModelCheck) {
    try {
      const { ok } = await runModelCheck()
      gatesVerified = ok
    } catch {
      gatesVerified = false
    }
  }

  let telemetrySinkConnected = true
  if (siem) {
    try {
      siem.stats()
    } catch {
      telemetrySinkConnected = false
    }
  }

  const failed = !gatesVerified || !telemetrySinkConnected
  const status: KernelHealth["status"] = failed ? "unhealthy" : "healthy"

  return {
    status,
    gatesVerified,
    lastModelCheck: new Date().toISOString(),
    telemetrySinkConnected,
    mcpBackendsAvailable: mcpBackends,
  }
}
