/**
 * Process-wide SIEM store for kernel telemetry.
 *
 * Composes up to two destinations, both optional and independent:
 *   - DAEMON_SIEM_DB           durable, queryable SQLite audit store
 *   - DAEMON_SIEM_FORWARD_URL  external SIEM (Splunk HEC / Elasticsearch bulk)
 *
 * When both are set, decisions are tee'd to the durable store AND forwarded.
 * When only one is set, only that destination is used. When neither is set,
 * returns undefined and the gate persists only to the session event stream —
 * keeping dev sessions dependency-light. Forwarding is fire-and-forget and can
 * never block or affect enforcement.
 */

import {
  SqliteSiemSink,
  SiemForwarder,
  teeSink,
  type TelemetrySink,
  type SiemFormat,
} from "../../../kernel/src/index"

interface SiemHandles {
  sink: TelemetrySink | null
  db?: SqliteSiemSink
  forwarder?: SiemForwarder
}

let cached: SiemHandles | undefined

function parseFormat(value: string | undefined): SiemFormat {
  return value === "elastic-bulk" ? "elastic-bulk" : "splunk-hec"
}

function build(env: Record<string, string | undefined>): SiemHandles {
  const dbPath = env.DAEMON_SIEM_DB
  const forwardUrl = env.DAEMON_SIEM_FORWARD_URL

  const db = dbPath ? new SqliteSiemSink(dbPath) : undefined
  const forwarder = forwardUrl
    ? new SiemForwarder({
        endpoint: forwardUrl,
        format: parseFormat(env.DAEMON_SIEM_FORWARD_FORMAT),
        token: env.DAEMON_SIEM_FORWARD_TOKEN,
        index: env.DAEMON_SIEM_FORWARD_INDEX,
      })
    : undefined

  const sinks: TelemetrySink[] = []
  if (db) sinks.push(db)
  if (forwarder) sinks.push(forwarder)

  const sink = sinks.length === 0 ? null : sinks.length === 1 ? sinks[0] : teeSink(...sinks)
  return { sink, db, forwarder }
}

/** Get the shared SIEM sink, or undefined when no destination is configured. */
export function getSiemSink(env: Record<string, string | undefined> = process.env): TelemetrySink | undefined {
  if (cached === undefined) cached = build(env)
  return cached.sink ?? undefined
}

/** Flush and close any open SIEM destinations (graceful shutdown / tests). */
export async function closeSiemSink(): Promise<void> {
  if (!cached) return
  cached.db?.close()
  if (cached.forwarder) await cached.forwarder.close()
  cached = undefined
}

/** Reset the cached sink, discarding any unsent telemetry (test isolation). */
export function resetSiemSink(): void {
  if (cached?.db) cached.db.close()
  cached?.forwarder?.dispose()
  cached = undefined
}
