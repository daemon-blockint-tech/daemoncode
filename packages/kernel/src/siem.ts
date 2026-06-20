/**
 * SQLite-backed SIEM telemetry sink.
 *
 * Persists every kernel decision (TelemetryRow) into a queryable store for
 * security monitoring, audit, and post-incident analysis. Built on Bun's native
 * `bun:sqlite` so it carries no third-party dependency.
 *
 * The schema is append-only (no UPDATE/DELETE) to preserve non-repudiation: a
 * trace, once written, is an immutable witness of the enforcer's decision.
 */

import { Database } from "bun:sqlite"
import type { TelemetrySink } from "./telemetry"
import type { TelemetryRow, EnforcerStatus } from "./types"

export interface SiemQuery {
  gate?: string
  enforcerStatus?: EnforcerStatus
  /** Only rows where a packet was emitted (network_emitted = 1). */
  emittedOnly?: boolean
  since?: string // ISO timestamp lower bound
  limit?: number
}

export interface SiemStats {
  total: number
  byStatus: Record<string, number>
  byGate: Record<string, number>
  emitted: number
  blocked: number
  rollbacks: number
}

/**
 * Append-only SQLite sink. Pass a file path for durable storage or ":memory:"
 * for an ephemeral store (tests). Schema is created on construction.
 */
export class SqliteSiemSink implements TelemetrySink {
  private readonly db: Database
  private readonly insertStmt: ReturnType<Database["query"]>

  constructor(path = ":memory:") {
    this.db = new Database(path)
    this.db.exec("PRAGMA journal_mode = WAL;")
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kernel_telemetry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gate TEXT NOT NULL,
        turn INTEGER NOT NULL,
        action_schema TEXT NOT NULL,
        enforcer_status TEXT NOT NULL,
        network_emitted INTEGER NOT NULL,
        timestamp TEXT NOT NULL
      );
    `)
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_gate ON kernel_telemetry(gate);")
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_status ON kernel_telemetry(enforcer_status);")
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_ts ON kernel_telemetry(timestamp);")
    this.insertStmt = this.db.query(
      `INSERT INTO kernel_telemetry (gate, turn, action_schema, enforcer_status, network_emitted, timestamp)
       VALUES ($gate, $turn, $action_schema, $enforcer_status, $network_emitted, $timestamp)`,
    )
  }

  append(row: TelemetryRow): void {
    this.insertStmt.run({
      $gate: row.gate,
      $turn: row.turn,
      $action_schema: row.action_schema,
      $enforcer_status: row.enforcer_status,
      $network_emitted: row.network_emitted ? 1 : 0,
      $timestamp: row.timestamp,
    })
  }

  /** Query stored traces with optional filters. */
  query(filter: SiemQuery = {}): TelemetryRow[] {
    const clauses: string[] = []
    const params: Record<string, string | number> = {}
    if (filter.gate) {
      clauses.push("gate = $gate")
      params.$gate = filter.gate
    }
    if (filter.enforcerStatus) {
      clauses.push("enforcer_status = $status")
      params.$status = filter.enforcerStatus
    }
    if (filter.emittedOnly) {
      clauses.push("network_emitted = 1")
    }
    if (filter.since) {
      clauses.push("timestamp >= $since")
      params.$since = filter.since
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""
    const limit = filter.limit ? `LIMIT ${Math.max(1, Math.floor(filter.limit))}` : ""
    const rows = this.db
      .query(`SELECT * FROM kernel_telemetry ${where} ORDER BY id DESC ${limit}`)
      .all(params) as Array<Record<string, unknown>>
    return rows.map(this.toRow)
  }

  /** Aggregate dashboard statistics over all stored traces. */
  stats(): SiemStats {
    const total = (this.db.query("SELECT COUNT(*) as c FROM kernel_telemetry").get() as { c: number }).c
    const byStatus: Record<string, number> = {}
    const byGate: Record<string, number> = {}
    for (const r of this.db
      .query("SELECT enforcer_status, COUNT(*) as c FROM kernel_telemetry GROUP BY enforcer_status")
      .all() as Array<{ enforcer_status: string; c: number }>) {
      byStatus[r.enforcer_status] = r.c
    }
    for (const r of this.db
      .query("SELECT gate, COUNT(*) as c FROM kernel_telemetry GROUP BY gate")
      .all() as Array<{ gate: string; c: number }>) {
      byGate[r.gate] = r.c
    }
    const emitted = (
      this.db.query("SELECT COUNT(*) as c FROM kernel_telemetry WHERE network_emitted = 1").get() as { c: number }
    ).c
    return {
      total,
      byStatus,
      byGate,
      emitted,
      blocked: byStatus.BLOCKED ?? 0,
      rollbacks: byStatus.ROLLBACK ?? 0,
    }
  }

  /**
   * Security check: detect any P1 violation in the store — a forbidden action
   * that nonetheless emitted a packet. Should always return [] for a correct
   * kernel; a non-empty result is a SIEM alert.
   */
  detectUnsafeEmissions(blockedActions: string[]): TelemetryRow[] {
    if (blockedActions.length === 0) return []
    const placeholders = blockedActions.map((_, i) => `$a${i}`).join(", ")
    const params: Record<string, string> = {}
    blockedActions.forEach((a, i) => (params[`$a${i}`] = a))
    const rows = this.db
      .query(
        `SELECT * FROM kernel_telemetry WHERE network_emitted = 1 AND action_schema IN (${placeholders}) ORDER BY id DESC`,
      )
      .all(params) as Array<Record<string, unknown>>
    return rows.map(this.toRow)
  }

  close(): void {
    this.db.close()
  }

  /**
   * Export traces in structured format for compliance (SOC 2 / ISO 27001).
   * Yields lines of JSON, CSV, or NDJSON for streaming to a file or pipe.
   */
  exportAuditLog(opts: {
    format: "json" | "csv" | "ndjson"
    since?: string
    gate?: string
  }): string[] {
    const filter: SiemQuery = {}
    if (opts.since) filter.since = opts.since
    if (opts.gate) filter.gate = opts.gate
    const rows = this.query(filter)

    if (opts.format === "ndjson") {
      return rows.map((r) => JSON.stringify(r))
    }

    if (opts.format === "csv") {
      const header = "gate,turn,action_schema,enforcer_status,network_emitted,timestamp"
      const lines = rows.map(
        (r) =>
          `${r.gate},${r.turn},${r.action_schema},${r.enforcer_status},${r.network_emitted},${r.timestamp}`,
      )
      return [header, ...lines]
    }

    // JSON format
    return [JSON.stringify(rows, null, 2)]
  }

  private toRow = (r: Record<string, unknown>): TelemetryRow => ({
    gate: r.gate as string,
    turn: r.turn as number,
    action_schema: r.action_schema as string,
    enforcer_status: r.enforcer_status as EnforcerStatus,
    network_emitted: (r.network_emitted as number) === 1,
    timestamp: r.timestamp as string,
  })
}
