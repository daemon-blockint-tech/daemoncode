/**
 * Performance benchmark for kernel execution.
 *
 * Run via: bun src/benchmark.ts
 * Tracks per-invocation latency for critical kernel paths.
 */

import { runGateWithGuardedTools } from "./kernel"
import { CrystallineMemory } from "./crystalline-memory"
import { modelCheckGate } from "./model-check"
import { loadGate } from "./gates/registry"
import { SqliteSiemSink } from "./siem"
import type { IntentProposal } from "./types"

const WARMUP = 10
const ITERATIONS = 100

function formatMs(ns: number): string {
  return `${(ns / 1_000_000).toFixed(2)}ms`
}

async function benchRunGate(): Promise<number> {
  const policy = loadGate("GATE_3_REMEDIATION")
  const memory = new CrystallineMemory({ policy })

  // Warmup
  for (let i = 0; i < WARMUP; i++) {
    await runGateWithGuardedTools({
      policy,
      recall: memory,
      planner: async () => ({
        action_schema: "deploy_to_prod",
        target_subsystem: "BENCH",
        typed_arguments: {},
      }),
    })
  }

  const start = performance.now()
  for (let i = 0; i < ITERATIONS; i++) {
    await runGateWithGuardedTools({
      policy,
      recall: memory,
      planner: async () => ({
        action_schema: "deploy_to_prod",
        target_subsystem: "BENCH",
        typed_arguments: {},
      }),
    })
  }
  return (performance.now() - start) / ITERATIONS
}

function benchModelCheck(): number {
  const policy = loadGate("GATE_3_REMEDIATION")

  // Warmup
  for (let i = 0; i < WARMUP; i++) {
    modelCheckGate(policy)
  }

  const start = performance.now()
  for (let i = 0; i < ITERATIONS; i++) {
    modelCheckGate(policy)
  }
  return (performance.now() - start) / ITERATIONS
}

function benchSiemAppend(): number {
  const sink = new SqliteSiemSink()

  const row = {
    gate: "GATE_BENCH",
    turn: 1,
    action_schema: "bench_tool",
    enforcer_status: "SUCCESS" as const,
    network_emitted: true,
    timestamp: new Date().toISOString(),
  }

  // Warmup
  for (let i = 0; i < WARMUP; i++) {
    sink.append(row)
  }

  const start = performance.now()
  for (let i = 0; i < ITERATIONS; i++) {
    sink.append(row)
  }
  const elapsed = (performance.now() - start) / ITERATIONS
  sink.close()
  return elapsed
}

async function main() {
  console.log("Daemon Kernel — Performance Benchmark")
  console.log("=".repeat(50))
  console.log(`Warmup: ${WARMUP} iterations, Measured: ${ITERATIONS} iterations\n`)

  const gateMs = await benchRunGate()
  console.log(`runGateWithGuardedTools (ROLLBACK):  ${formatMs(gateMs * 1_000_000)}`)

  const mcMs = benchModelCheck()
  console.log(`modelCheckGate (explicit-state):     ${formatMs(mcMs * 1_000_000)}`)

  const siemMs = benchSiemAppend()
  console.log(`SqliteSiemSink.append:               ${formatMs(siemMs * 1_000_000)}`)

  console.log("=".repeat(50))
  console.log("Baseline complete. Store for regression comparison.")
}

main().catch(console.error)
