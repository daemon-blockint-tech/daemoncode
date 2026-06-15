import { Effect } from "effect"
import { appendFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"

const LOG_PATH = process.env.SHODAN_AUDIT_LOG ?? "/tmp/shodan-audit.jsonl"

export function buildAuditEntry(entry: {
  operation: string
  query?: string
  ip?: string
  approved: boolean
  result_count?: number
  error?: string
}) {
  return {
    operation: entry.operation,
    query: entry.query,
    ip: entry.ip,
    approved: entry.approved,
    result_count: entry.result_count,
    error: entry.error,
  }
}

export function auditLog(entry: {
  operation: string
  query?: string
  ip?: string
  approved: boolean
  result_count?: number
  error?: string
}) {
  return Effect.gen(function* () {
    const record = {
      ts: new Date().toISOString(),
      ...buildAuditEntry(entry),
    }
    yield* Effect.tryPromise({
      try: async () => {
        await mkdir(dirname(LOG_PATH), { recursive: true })
        await appendFile(LOG_PATH, JSON.stringify(record) + "\n")
      },
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          process.stderr.write(`[shodan:audit] ${String(error)}\n`)
        }),
      ),
    )
  })
}
