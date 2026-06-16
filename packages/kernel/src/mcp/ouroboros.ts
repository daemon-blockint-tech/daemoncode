/**
 * Ouroboros executor: spawns `ouroboros scan --profile project --output stdout`
 * and parses NDJSON records.
 *
 * Enforces the promotion rule: only trusts findings once a scan_summary record
 * with status="complete" arrives.
 *
 * Returns SUCCESS when scan completes cleanly with no high/critical exposures,
 * FAILURE if incomplete, high/critical found, or scan errors.
 */

import type { ProcessRunner } from "./process"
import type { ExecutionResult } from "../executor"

interface Finding {
  record_type: "finding"
  severity: string
  catalog_id: string
}

interface ScanSummary {
  record_type: "scan_summary"
  status: string
}

type NdjsonRecord = Finding | ScanSummary | Record<string, unknown>

export interface OuroborosExecutorOpts {
  runner: ProcessRunner
  ouroborosBin: string
  allowedRoot: string
  blockingSeverities?: Set<string>
}

export function createOuroborosExecutor(opts: OuroborosExecutorOpts) {
  const {
    runner,
    ouroborosBin,
    allowedRoot,
    blockingSeverities = new Set(["Critical", "High"]),
  } = opts

  return async (): Promise<ExecutionResult> => {
    const result = await runner.run({
      bin: ouroborosBin,
      args: ["scan", "--profile", "project", "--output", "stdout"],
      cwd: allowedRoot,
      timeout: 120000,
    })

    if (result.killed) {
      return { status: "FAILURE", summary: "Ouroboros scan timeout" }
    }

    if (result.exitCode !== 0) {
      return {
        status: "FAILURE",
        summary: `Ouroboros scan failed: ${result.stderr.slice(0, 200)}`,
      }
    }

    try {
      const lines = result.stdout.trim().split("\n").filter((l) => l.length > 0)
      let scanComplete = false
      let blockingCount = 0

      for (const line of lines) {
        const record: NdjsonRecord = JSON.parse(line)

        // Check for scan completion
        if (record.record_type === "scan_summary") {
          const summary = record as ScanSummary
          if (summary.status === "complete") {
            scanComplete = true
          }
        }

        // Only count findings if scan has completed (promotion rule)
        if (scanComplete && record.record_type === "finding") {
          const finding = record as Finding
          if (blockingSeverities.has(finding.severity)) {
            blockingCount++
          }
        }
      }

      if (!scanComplete) {
        return {
          status: "FAILURE",
          summary: "Scan did not complete (missing scan_summary with status=complete)",
        }
      }

      if (blockingCount > 0) {
        return {
          status: "FAILURE",
          summary: `Found ${blockingCount} blocking exposures`,
        }
      }

      return {
        status: "SUCCESS",
        summary: "Ouroboros scan clean",
      }
    } catch (e) {
      return {
        status: "FAILURE",
        summary: `Failed to parse ouroboros output: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  }
}
