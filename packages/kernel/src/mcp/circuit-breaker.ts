/**
 * Circuit breaker for MCP tool executors.
 *
 * Prevents cascade failures when backends (ARES, ouroboros, Orion) are down.
 * Opens after N consecutive failures; half-opens after a cooldown; closes on
 * the first success. The kernel's deterministic safety is preserved: even if
 * the circuit breaker rejects execution, the kernel's default-deny shield
 * already blocked forbidden actions. The circuit breaker only affects the
 * SOP-tool execution path (sigma_sop).
 */

import type { ToolExecutor, ExecutionResult } from "./executor"

export type CircuitState = "closed" | "open" | "half-open"

export interface CircuitBreakerOptions {
  /** Underlying executor to wrap. */
  executor: ToolExecutor
  /** Number of consecutive failures before opening. Default: 3. */
  failureThreshold?: number
  /** Cooldown in ms before half-open. Default: 30000. */
  cooldownMs?: number
}

export class CircuitBreaker implements ToolExecutor {
  private state: CircuitState = "closed"
  private failures = 0
  private lastFailure = 0
  private readonly executor: ToolExecutor
  private readonly failureThreshold: number
  private readonly cooldownMs: number

  constructor(options: CircuitBreakerOptions) {
    this.executor = options.executor
    this.failureThreshold = options.failureThreshold ?? 3
    this.cooldownMs = options.cooldownMs ?? 30_000
  }

  getState(): CircuitState {
    if (this.state === "open") {
      if (Date.now() - this.lastFailure >= this.cooldownMs) {
        this.state = "half-open"
      }
    }
    return this.state
  }

  async execute(intent: Parameters<ToolExecutor["execute"]>[0]): Promise<ExecutionResult> {
    const current = this.getState()

    if (current === "open") {
      return {
        status: "FAILURE",
        summary: `Circuit breaker OPEN: backend unavailable (failures=${this.failures})`,
      }
    }

    try {
      const result = await this.executor.execute(intent)

      if (result.status === "SUCCESS") {
        this.failures = 0
        this.state = "closed"
      } else {
        this.recordFailure()
      }

      return result
    } catch (e) {
      this.recordFailure()
      return {
        status: "FAILURE",
        summary: `Circuit breaker: execution threw: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  }

  private recordFailure(): void {
    this.failures++
    this.lastFailure = Date.now()
    if (this.failures >= this.failureThreshold) {
      this.state = "open"
    }
  }
}
