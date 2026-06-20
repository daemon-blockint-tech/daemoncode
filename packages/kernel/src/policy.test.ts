import { describe, test, expect, mock } from "bun:test"
import { parsePolicy, loadPolicy } from "./policy"
import type { GatePolicy } from "./policy"

const validPolicy = {
  gate: "GATE_3_REMEDIATION",
  blockedActions: ["deploy_to_prod", "force_publish"],
  sopTools: ["ares_scan_directory"],
  completionTool: "complete_gate_task",
  maxGateRetries: 3,
  maxGlobalRetries: 10,
}

describe("parsePolicy", () => {
  test("round-trips a valid policy", () => {
    const result = parsePolicy(validPolicy)
    expect(result.gate).toBe("GATE_3_REMEDIATION")
    expect(result.blockedActions).toEqual(["deploy_to_prod", "force_publish"])
    expect(result.sopTools).toEqual(["ares_scan_directory"])
    expect(result.completionTool).toBe("complete_gate_task")
    expect(result.maxGateRetries).toBe(3)
    expect(result.maxGlobalRetries).toBe(10)
  })

  test("accepts optional confidenceThreshold in [0,1]", () => {
    const p0 = parsePolicy({ ...validPolicy, confidenceThreshold: 0 })
    expect(p0.confidenceThreshold).toBe(0)
    const p1 = parsePolicy({ ...validPolicy, confidenceThreshold: 1 })
    expect(p1.confidenceThreshold).toBe(1)
    const p5 = parsePolicy({ ...validPolicy, confidenceThreshold: 0.5 })
    expect(p5.confidenceThreshold).toBe(0.5)
  })

  test("rejects confidenceThreshold outside [0,1]", () => {
    expect(() => parsePolicy({ ...validPolicy, confidenceThreshold: -0.1 })).toThrow("confidenceThreshold")
    expect(() => parsePolicy({ ...validPolicy, confidenceThreshold: 1.1 })).toThrow("confidenceThreshold")
  })

  test("accepts optional principles as string[]", () => {
    const result = parsePolicy({ ...validPolicy, principles: ["principle a", "principle b"] })
    expect(result.principles).toEqual(["principle a", "principle b"])
  })

  test("rejects non-object input", () => {
    expect(() => parsePolicy(null)).toThrow("must be an object")
    expect(() => parsePolicy("string")).toThrow("must be an object")
    expect(() => parsePolicy(42)).toThrow("must be an object")
    expect(() => parsePolicy(undefined)).toThrow("must be an object")
  })

  test("rejects missing required fields", () => {
    expect(() => parsePolicy({})).toThrow("`gate`")
    expect(() => parsePolicy({ gate: "X" })).toThrow("`blockedActions`")
    expect(() => parsePolicy({ gate: "X", blockedActions: [] })).toThrow("`sopTools`")
    expect(() =>
      parsePolicy({ gate: "X", blockedActions: [], sopTools: [] }),
    ).toThrow("`completionTool`")
    expect(() =>
      parsePolicy({ gate: "X", blockedActions: [], sopTools: [], completionTool: "c" }),
    ).toThrow("`maxGateRetries`")
    expect(() =>
      parsePolicy({
        gate: "X",
        blockedActions: [],
        sopTools: [],
        completionTool: "c",
        maxGateRetries: 1,
      }),
    ).toThrow("`maxGlobalRetries`")
  })

  test("rejects non-string gate", () => {
    expect(() => parsePolicy({ ...validPolicy, gate: 123 })).toThrow("`gate` must be a non-empty string")
    expect(() => parsePolicy({ ...validPolicy, gate: "" })).toThrow("`gate` must be a non-empty string")
  })

  test("rejects non-array blockedActions", () => {
    expect(() => parsePolicy({ ...validPolicy, blockedActions: "not-array" })).toThrow("`blockedActions` must be a string[]")
    expect(() => parsePolicy({ ...validPolicy, blockedActions: [1, 2] })).toThrow("`blockedActions` must be a string[]")
  })

  test("rejects non-array sopTools", () => {
    expect(() => parsePolicy({ ...validPolicy, sopTools: 42 })).toThrow("`sopTools` must be a string[]")
  })

  test("rejects maxGateRetries < 1", () => {
    expect(() => parsePolicy({ ...validPolicy, maxGateRetries: 0 })).toThrow("maxGateRetries")
    expect(() => parsePolicy({ ...validPolicy, maxGateRetries: -1 })).toThrow("maxGateRetries")
  })

  test("rejects maxGlobalRetries < 1", () => {
    expect(() => parsePolicy({ ...validPolicy, maxGlobalRetries: 0 })).toThrow("maxGlobalRetries")
    expect(() => parsePolicy({ ...validPolicy, maxGlobalRetries: -5 })).toThrow("maxGlobalRetries")
  })

  test("rejects non-string completionTool", () => {
    expect(() => parsePolicy({ ...validPolicy, completionTool: 123 })).toThrow("`completionTool` must be a string")
  })

  test("rejects non-string principles", () => {
    expect(() => parsePolicy({ ...validPolicy, principles: "not-array" })).toThrow("`principles` must be a string[]")
    expect(() => parsePolicy({ ...validPolicy, principles: [1] })).toThrow("`principles` must be a string[]")
  })
})

describe("loadPolicy", () => {
  test("loads from JSON file via Bun.file", async () => {
    const tmpPath = `/tmp/test-policy-${Date.now()}.json`
    await Bun.write(tmpPath, JSON.stringify(validPolicy))
    const result = await loadPolicy(tmpPath)
    expect(result.gate).toBe("GATE_3_REMEDIATION")
    expect(result.blockedActions).toHaveLength(2)
  })

  test("throws on malformed JSON file", async () => {
    const tmpPath = `/tmp/test-bad-policy-${Date.now()}.json`
    await Bun.write(tmpPath, "{ not valid json {{{")
    await expect(loadPolicy(tmpPath)).rejects.toThrow()
  })

  test("throws on valid JSON but invalid policy", async () => {
    const tmpPath = `/tmp/test-invalid-policy-${Date.now()}.json`
    await Bun.write(tmpPath, JSON.stringify({ gate: "", blockedActions: "nope" }))
    await expect(loadPolicy(tmpPath)).rejects.toThrow("gate")
  })
})
