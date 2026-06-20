import { describe, test, expect } from "bun:test"
import { loadGatePolicies } from "./registry"

describe("loadGatePolicies", () => {
  test("returns all hardcoded defaults when no config path", async () => {
    const policies = await loadGatePolicies()
    expect(Object.keys(policies)).toHaveLength(5)
    expect(policies).toHaveProperty("GATE_0_INGESTION")
    expect(policies).toHaveProperty("GATE_3_REMEDIATION")
  })

  test("merges overrides from config file", async () => {
    const tmpPath = `/tmp/test-gate-config-${Date.now()}.json`
    const override = {
      GATE_3_REMEDIATION: {
        gate: "GATE_3_REMEDIATION",
        blockedActions: ["deploy_to_prod", "force_publish", "trigger_pipeline", "execute_bash", "nuclear_option"],
        sopTools: ["ares_scan_directory", "ouroboros_scan"],
        completionTool: "complete_gate_task",
        maxGateRetries: 5,
        maxGlobalRetries: 15,
      },
    }
    await Bun.write(tmpPath, JSON.stringify(override))

    const policies = await loadGatePolicies(tmpPath)
    expect(policies.GATE_3_REMEDIATION.blockedActions).toContain("nuclear_option")
    expect(policies.GATE_3_REMEDIATION.maxGateRetries).toBe(5)
    // Other gates unchanged
    expect(policies.GATE_0_INGESTION.maxGateRetries).toBe(3)
  })

  test("ignores unknown gate keys in config", async () => {
    const tmpPath = `/tmp/test-gate-config-${Date.now()}.json`
    await Bun.write(tmpPath, JSON.stringify({ GATE_99_FUTURE: { gate: "nope" } }))

    const policies = await loadGatePolicies(tmpPath)
    expect(Object.keys(policies)).toHaveLength(5)
    expect(policies).not.toHaveProperty("GATE_99_FUTURE")
  })
})
