/**
 * External SIEM forwarder for kernel telemetry.
 *
 * Ships TelemetryRow events to an external SIEM (Splunk HEC or Elasticsearch
 * bulk API) over HTTP. Built on the global `fetch` so it adds no third-party
 * dependency. Designed for safety-critical use:
 *
 *   - Batching: rows are buffered and flushed by size or interval.
 *   - Retry with backoff: transient HTTP failures are retried; persistent
 *     failures are dropped after maxRetries (never block the kernel).
 *   - Graceful degradation: a forwarder failure can NEVER affect enforcement.
 *     append() is fire-and-forget; the kernel does not await the network.
 *
 * The forwarder implements TelemetrySink, so it can be passed directly to the
 * kernel or composed behind the durable SqliteSiemSink (store-and-forward).
 */

import type { TelemetrySink } from "./telemetry"
import type { TelemetryRow } from "./types"

export type SiemFormat = "splunk-hec" | "elastic-bulk"

export interface SiemForwarderOptions {
  /** Target SIEM endpoint URL. */
  endpoint: string
  /** Wire format. Splunk HTTP Event Collector or Elasticsearch _bulk. */
  format: SiemFormat
  /** Auth token. Splunk: HEC token; Elastic: API key (sent as configured). */
  token?: string
  /** Elastic index name (elastic-bulk only). Default: "daemon-kernel". */
  index?: string
  /** Flush when this many rows are buffered. Default: 50. */
  batchSize?: number
  /** Flush at most this often, in ms. Default: 5000. 0 disables the timer. */
  flushIntervalMs?: number
  /** Max send attempts per batch before dropping. Default: 3. */
  maxRetries?: number
  /** Base backoff in ms (doubled each retry). Default: 200. */
  retryBackoffMs?: number
  /** Injectable fetch (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch
  /** Optional sink invoked when a batch is permanently dropped (observability). */
  onDrop?: (rows: TelemetryRow[], error: unknown) => void
}

export class SiemForwarder implements TelemetrySink {
  private readonly opts: Required<
    Omit<SiemForwarderOptions, "token" | "fetchImpl" | "onDrop" | "index">
  > &
    Pick<SiemForwarderOptions, "token" | "fetchImpl" | "onDrop"> & { index: string }
  private buffer: TelemetryRow[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private inFlight: Promise<void> = Promise.resolve()
  private closed = false

  constructor(options: SiemForwarderOptions) {
    this.opts = {
      endpoint: options.endpoint,
      format: options.format,
      token: options.token,
      index: options.index ?? "daemon-kernel",
      batchSize: options.batchSize ?? 50,
      flushIntervalMs: options.flushIntervalMs ?? 5000,
      maxRetries: options.maxRetries ?? 3,
      retryBackoffMs: options.retryBackoffMs ?? 200,
      fetchImpl: options.fetchImpl,
      onDrop: options.onDrop,
    }
    if (this.opts.flushIntervalMs > 0) {
      this.timer = setInterval(() => void this.flush(), this.opts.flushIntervalMs)
      // Do not keep the process alive solely for the flush timer.
      if (typeof this.timer === "object" && "unref" in this.timer) {
        ;(this.timer as { unref: () => void }).unref()
      }
    }
  }

  /** Buffer a row; flush when the batch is full. Never throws, never blocks. */
  append(row: TelemetryRow): void {
    if (this.closed) return
    this.buffer.push(row)
    if (this.buffer.length >= this.opts.batchSize) {
      void this.flush()
    }
  }

  /** Flush the current buffer to the SIEM. Resolves once the send settles. */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return
    const batch = this.buffer
    this.buffer = []
    const send = this.sendWithRetry(batch)
    // Chain so concurrent flushes serialize and close() can await all of them.
    this.inFlight = this.inFlight.then(() => send).catch(() => {})
    return send
  }

  /** Flush remaining rows, await in-flight sends, and stop the timer. */
  async close(): Promise<void> {
    this.closed = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    await this.flush()
    await this.inFlight
  }

  /**
   * Stop the timer and drop any buffered rows WITHOUT flushing to the network.
   * For teardown where unsent telemetry can be discarded (e.g. test isolation).
   */
  dispose(): void {
    this.closed = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.buffer = []
  }

  private async sendWithRetry(batch: TelemetryRow[]): Promise<void> {
    const fetchImpl = this.opts.fetchImpl ?? globalThis.fetch
    const { body, contentType } = this.encode(batch)
    let attempt = 0
    let lastError: unknown
    while (attempt <= this.opts.maxRetries) {
      try {
        const res = await fetchImpl(this.opts.endpoint, {
          method: "POST",
          headers: this.headers(contentType),
          body,
        })
        if (res.ok) return
        lastError = new Error(`SIEM responded ${res.status}`)
        // 4xx (except 429) is not retryable — bad request/auth.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) break
      } catch (e) {
        lastError = e
      }
      attempt++
      if (attempt <= this.opts.maxRetries) {
        await delay(this.opts.retryBackoffMs * 2 ** (attempt - 1))
      }
    }
    // Permanent failure: drop (never block enforcement) but surface via onDrop.
    this.opts.onDrop?.(batch, lastError)
  }

  private headers(contentType: string): Record<string, string> {
    const h: Record<string, string> = { "content-type": contentType }
    if (this.opts.token) {
      h["authorization"] =
        this.opts.format === "splunk-hec" ? `Splunk ${this.opts.token}` : `ApiKey ${this.opts.token}`
    }
    return h
  }

  /** Encode a batch into the target SIEM wire format. Uses string builder to avoid intermediate arrays. */
  private encode(batch: TelemetryRow[]): { body: string; contentType: string } {
    if (this.opts.format === "splunk-hec") {
      let body = ""
      for (const row of batch) {
        body += JSON.stringify({ event: row, sourcetype: "daemon:kernel", source: row.gate }) + "\n"
      }
      return { body, contentType: "application/json" }
    }
    let body = ""
    for (const row of batch) {
      body += JSON.stringify({ index: { _index: this.opts.index } }) + "\n" + JSON.stringify(row) + "\n"
    }
    return { body, contentType: "application/x-ndjson" }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Compose multiple sinks into one (e.g. durable SQLite + external forwarder).
 * Each sink is invoked independently; one failing never affects the others.
 */
export function teeSink(...sinks: TelemetrySink[]): TelemetrySink {
  return {
    append(row: TelemetryRow): void {
      for (const s of sinks) {
        try {
          void s.append(row)
        } catch {
          // A failing sink must not affect the others or the kernel.
        }
      }
    },
  }
}
