/**
 * Black-box flight recorder for the kernel. The recorder owns the single point
 * at which a `TelemetryRow` is produced, so every gate decision is logged
 * exactly once. Persistence is delegated to a pluggable `TelemetrySink` so the
 * sterile kernel never touches I/O directly.
 */

import type { TelemetryRow } from "./types"

export interface TelemetrySink {
  append(row: TelemetryRow): void | Promise<void>
}

export class BlackBoxRecorder {
  private traces: TelemetryRow[] = []

  constructor(private readonly sink?: TelemetrySink) {}

  record(row: Omit<TelemetryRow, "timestamp">): void {
    const entry: TelemetryRow = { ...row, timestamp: new Date().toISOString() }
    this.traces.push(entry)
    if (this.sink) void this.sink.append(entry)
  }

  getTraces(): TelemetryRow[] {
    return [...this.traces]
  }
}

/**
 * Append-only NDJSON sink (one JSON object per line). Resilient default for
 * durable traces without a database dependency.
 */
export class NdjsonFileSink implements TelemetrySink {
  constructor(private readonly path: string) {}

  async append(row: TelemetryRow): Promise<void> {
    const file = Bun.file(this.path)
    const prev = (await file.exists()) ? await file.text() : ""
    await Bun.write(this.path, prev + JSON.stringify(row) + "\n")
  }
}
