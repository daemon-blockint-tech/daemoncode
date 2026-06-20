import { describe, test, expect } from "bun:test"
import { CircuitBreaker } from "./circuit-breaker"
import type { ToolExecutor, ExecutionResult } from "../executor"
import type { IntentProposal } from "../types"

function failingExecutor(failCount: number): ToolExecutor {
  let calls = 0
  return {
    async execute(): Promise<ExecutionResult> {
      calls++
      if (calls <= failCount) return { status: "FAILURE", summary: `fail #${calls}` }
      return { status: "SUCCESS" }
    },
  }
}

function alwaysFailExecutor(): ToolExecutor {
  return {
    async execute(): Promise<ExecutionResult> {
      return { status: "FAILURE", summary: "always fail" }
    },
  }
}

function throwExecutor(): ToolExecutor {
  return {
    async execute(): Promise<ExecutionResult> {
      throw new Error("backend crashed")
    },
  }
}

const intent: IntentProposal = {
  action_schema: "ares_scan_directory",
  target_subsystem: "TEST",
  typed_arguments: {},
}

describe("CircuitBreaker", () => {
  test("starts closed", () => {
    const cb = new CircuitBreaker({ executor: { async execute() { return { status: "SUCCESS" } } } })
    expect(cb.getState()).toBe("closed")
  })

  test("stays closed under success", async () => {
    const cb = new CircuitBreaker({
      executor: { async execute() { return { status: "SUCCESS" } } },
    })
    await cb.execute(intent)
    await cb.execute(intent)
    expect(cb.getState()).toBe("closed")
  })

  test("opens after failureThreshold consecutive failures", async () => {
    const cb = new CircuitBreaker({
      executor: alwaysFailExecutor(),
      failureThreshold: 3,
    })

    await cb.execute(intent) // fail 1
    expect(cb.getState()).toBe("closed")
    await cb.execute(intent) // fail 2
    expect(cb.getState()).toBe("closed")
    await cb.execute(intent) // fail 3 → open
    expect(cb.getState()).toBe("open")
  })

  test("rejects execution when open", async () => {
    const cb = new CircuitBreaker({
      executor: alwaysFailExecutor(),
      failureThreshold: 2,
    })

    await cb.execute(intent) // fail 1
    await cb.execute(intent) // fail 2 → open
    const result = await cb.execute(intent)
    expect(result.status).toBe("FAILURE")
    expect(result.summary).toContain("Circuit breaker OPEN")
  })

  test("resets on success", async () => {
    const cb = new CircuitBreaker({
      executor: failingExecutor(2),
      failureThreshold: 3,
    })

    await cb.execute(intent) // fail 1
    await cb.execute(intent) // fail 2
    await cb.execute(intent) // success → reset
    expect(cb.getState()).toBe("closed")
    expect(cb.execute(intent)).resolves.toMatchObject({ status: "SUCCESS" })
  })

  test("half-opens after cooldown", async () => {
    const cb = new CircuitBreaker({
      executor: alwaysFailExecutor(),
      failureThreshold: 1,
      cooldownMs: 50,
    })

    await cb.execute(intent) // fail → open
    expect(cb.getState()).toBe("open")

    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 60))

    expect(cb.getState()).toBe("half-open")
    // Try again → fails → opens again
    await cb.execute(intent)
    expect(cb.getState()).toBe("open")
  })

  test("closes on success from half-open", async () => {
    let calls = 0
    const cb = new CircuitBreaker({
      executor: {
        async execute() {
          calls++
          return calls <= 1 ? { status: "FAILURE" } : { status: "SUCCESS" }
        },
      },
      failureThreshold: 1,
      cooldownMs: 50,
    })

    await cb.execute(intent) // fail → open
    await new Promise((r) => setTimeout(r, 60))
    expect(cb.getState()).toBe("half-open")
    await cb.execute(intent) // success → closed
    expect(cb.getState()).toBe("closed")
  })

  test("handles executor throwing exceptions", async () => {
    const cb = new CircuitBreaker({
      executor: throwExecutor(),
      failureThreshold: 2,
    })

    const result = await cb.execute(intent)
    expect(result.status).toBe("FAILURE")
    expect(result.summary).toContain("threw")
    await cb.execute(intent)
    expect(cb.getState()).toBe("open")
  })

  test("passes intent through to underlying executor", async () => {
    let receivedIntent: IntentProposal | undefined
    const cb = new CircuitBreaker({
      executor: {
        async execute(i: IntentProposal) {
          receivedIntent = i
          return { status: "SUCCESS" }
        },
      },
    })

    await cb.execute(intent)
    expect(receivedIntent).toBe(intent)
  })
})
