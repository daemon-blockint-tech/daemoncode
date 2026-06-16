/**
 * Process-wide SIEM store for kernel telemetry.
 *
 * Lazily opens a single SqliteSiemSink when DAEMON_SIEM_DB is set, so all gate
 * decisions across sessions persist to one durable, queryable audit store.
 * When unset, returns undefined and the gate persists only to the session event
 * stream (no durable SIEM) — keeping dev sessions dependency-light.
 */

import { SqliteSiemSink, type TelemetrySink } from "../../../kernel/src/index"

let cached: SqliteSiemSink | null | undefined

/** Get the shared SIEM sink, or undefined when DAEMON_SIEM_DB is not configured. */
export function getSiemSink(env: Record<string, string | undefined> = process.env): TelemetrySink | undefined {
  if (cached !== undefined) return cached ?? undefined
  const path = env.DAEMON_SIEM_DB
  if (!path) {
    cached = null
    return undefined
  }
  cached = new SqliteSiemSink(path)
  return cached
}

/** Reset the cached sink (test isolation). */
export function resetSiemSink(): void {
  if (cached) cached.close()
  cached = undefined
}
