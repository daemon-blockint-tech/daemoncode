import { describe, test, expect } from "bun:test"
import { createCrystallineMemory } from "./crystalline-memory"
import { runGateWithGuardedTools } from "./kernel"
import type { GatePolicy } from "./policy"
import type { IntentProposal } from "./types"

const policy: GatePolicy = {
  gate: "GATE_3_REMEDIATION",
  blockedActions: ["deploy_to_prod", "force_publish"],
  sopTools: ["ares_scan_directory", "ouroboros_scan"],
  completionTool: "complete_gate_task",
  maxGateRetries: 3,
  maxGlobalRetries: 10,
}

describe("Crystalline Memory", () => {
  test("recall returns base principle blocked actions", async () => {
    const mem = createCrystallineMemory({ policy })
    const r = await mem.recall("some_tool")
    expect(r.blockedActions).toContain("deploy_to_prod")
    expect(r.memories.some((m) => m.layer === "principle")).toBe(true)
  })

  test("semiotic link resolves a synonym of a forbidden action to blocked", async () => {
    const mem = createCrystallineMemory({
      policy,
      semioticLinks: [{ alias: "ship_to_production", canonical: "deploy_to_prod", relation: "synonym" }],
    })

    const r = await mem.recall("ship_to_production")
    expect(r.blockedActions).toContain("ship_to_production")
    expect(r.resolvedCanonical).toBe("deploy_to_prod")
  })

  test("normalization catches case/separator variants", async () => {
    const mem = createCrystallineMemory({
      policy,
      semioticLinks: [{ alias: "Ship To Production", canonical: "deploy_to_prod", relation: "paraphrase" }],
    })

    const r = await mem.recall("ship-to-production")
    expect(r.blockedActions).toContain("ship-to-production")
  })

  test("non-forbidden aliases are not blocked", async () => {
    const mem = createCrystallineMemory({
      policy,
      semioticLinks: [{ alias: "scan_repo", canonical: "ares_scan_directory", relation: "synonym" }],
    })

    const r = await mem.recall("scan_repo")
    expect(r.blockedActions).not.toContain("scan_repo")
    expect(r.resolvedCanonical).toBeUndefined()
  })

  test("weak semiotic links lower recall confidence", async () => {
    const mem = createCrystallineMemory({
      policy,
      semioticLinks: [{ alias: "go_live", canonical: "deploy_to_prod", relation: "paraphrase", weight: 0.6 }],
    })

    const r = await mem.recall("go_live")
    expect(r.confidence).toBe(0.6)
  })

  test("episodic precedents attach to recall", async () => {
    const mem = createCrystallineMemory({
      policy,
      episodes: [
        { id: "e1", layer: "episodic", summary: "prior block", action: "deploy_to_prod", outcome: "BLOCKED" },
      ],
    })

    const r = await mem.recall("deploy_to_prod")
    expect(r.memories.some((m) => m.layer === "episodic")).toBe(true)
    expect(r.principles.some((p) => p.includes("Precedent"))).toBe(true)
  })
})

describe("Crystalline Memory + Kernel (synonym-attack regression)", () => {
  test("kernel blocks a synonym of a forbidden action via semiotic recall", async () => {
    const mem = createCrystallineMemory({
      policy,
      semioticLinks: [{ alias: "ship_to_production", canonical: "deploy_to_prod", relation: "synonym" }],
    })

    // Planner repeatedly proposes the synonym; kernel must never PROCEED.
    const planner = async (): Promise<IntentProposal> => ({
      action_schema: "ship_to_production",
      target_subsystem: "ADVERSARIAL",
      typed_arguments: {},
    })

    const result = await runGateWithGuardedTools({ policy, recall: mem, planner })

    expect(result.status).toBe("ROLLBACK")
    // No trace for the synonym ever emitted a packet (P1 under aliasing).
    for (const row of result.traces) {
      if (row.action_schema === "ship_to_production") {
        expect(row.network_emitted).toBe(false)
      }
    }
  })

  test("legitimate SOP synonym still clears the gate", async () => {
    const mem = createCrystallineMemory({
      policy,
      semioticLinks: [{ alias: "scan_repo", canonical: "ares_scan_directory", relation: "synonym" }],
    })

    // The synonym is NOT forbidden, so it flows as a normal (unmodelled) tool —
    // the kernel default-denies unknown tools, so use the real SOP then complete.
    let step = 0
    const planner = async (): Promise<IntentProposal> => {
      step++
      return step === 1
        ? { action_schema: "ares_scan_directory", target_subsystem: "SOP", typed_arguments: {} }
        : { action_schema: "complete_gate_task", target_subsystem: "DONE", typed_arguments: {} }
    }

    const result = await runGateWithGuardedTools({ policy, recall: mem, planner })
    expect(result.status).toBe("PROCEED")
  })
})
