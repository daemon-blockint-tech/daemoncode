/**
 * ARES executor: spawns `ares scan <path> -o <out>` and parses JSON findings.
 *
 * Returns SUCCESS when scan completes with no blocking-severity findings,
 * FAILURE if unresolved HIGH/CRITICAL exist or scan fails.
 */

import type { ProcessRunner } from "./process"
import type { ExecutionResult } from "../executor"

interface Finding {
  severity: "Critical" | "High" | "Medium" | "Low" | "Informational"
  category: string
  location: {
    file: string
    line_start: number
  }
}

interface AuditReport {
  summary: {
    critical_count: number
    high_count: number
    medium_count: number
    low_count: number
    informational_count: number
  }
  findings: Finding[]
}

export interface AresExecutorOpts {
  runner: ProcessRunner
  aresBin: string
  allowedRoot: string
  blockingSeverities?: Set<string>
}

export function createAresExecutor(opts: AresExecutorOpts) {
  const {
    runner,
    aresBin,
    allowedRoot,
    blockingSeverities = new Set(["Critical", "High"]),
  } = opts

  return async (target: string): Promise<ExecutionResult> => {
    // Normalize target path to prevent traversal
    if (target.includes("..") || target.startsWith("/")) {
      return { status: "FAILURE", summary: "Invalid target path" }
    }

    const outputFile = `ares-report-${Date.now()}.json`
    const result = await runner.run({
      bin: aresBin,
      args: ["scan", target, "-o", outputFile, "--fuzz", "false", "--poc", "false"],
      cwd: allowedRoot,
      timeout: 60000,
    })

    if (result.killed) {
      return { status: "FAILURE", summary: "ARES scan timeout" }
    }

    if (result.exitCode !== 0) {
      return {
        status: "FAILURE",
        summary: `ARES scan failed: ${result.stderr.slice(0, 200)}`,
      }
    }

    try {
      const reportText = await Bun.file(`${allowedRoot}/${outputFile}`).text()
      const report: AuditReport = JSON.parse(reportText)

      // Check for blocking findings
      let blockingCount = 0
      for (const finding of report.findings) {
        if (blockingSeverities.has(finding.severity)) {
          blockingCount++
        }
      }

      if (blockingCount > 0) {
        return {
          status: "FAILURE",
          summary: `Found ${blockingCount} blocking findings (${report.summary.critical_count} Critical, ${report.summary.high_count} High)`,
        }
      }

      return {
        status: "SUCCESS",
        summary: "ARES scan clean",
      }
    } catch (e) {
      return {
        status: "FAILURE",
        summary: `Failed to parse ARES report: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  }
}
