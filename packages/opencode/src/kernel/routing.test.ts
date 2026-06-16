import { describe, test, expect } from "bun:test"
import { gateForTool, isWriteOperation, canonicalizeTool } from "./routing"
import { loadGate } from "../../../kernel/src/index"

describe("Semiotic alias resolution (routing)", () => {
  test("canonicalizes synonyms of forbidden actions", () => {
    expect(canonicalizeTool("ship_to_production")).toBe("deploy_to_prod")
    expect(canonicalizeTool("run_shell")).toBe("execute_bash")
    expect(canonicalizeTool("destroy_resource")).toBe("delete_resource")
  })

  test("case/separator-insensitive resolution", () => {
    expect(canonicalizeTool("Ship-To-Production")).toBe("deploy_to_prod")
  })

  test("unknown tools pass through unchanged", () => {
    expect(canonicalizeTool("read_file")).toBe("read_file")
  })

  test("a synonym of a write op is classified as a write op", () => {
    expect(isWriteOperation("ship_to_production")).toBe(true)
    expect(isWriteOperation("run_shell")).toBe(true)
  })

  test("a synonym routes to the canonical action's gate", () => {
    expect(gateForTool("ship_to_production")).toBe("GATE_4_VALIDATION")
    expect(gateForTool("run_shell")).toBe("GATE_0_INGESTION")
  })
})

describe("Tool → Gate Routing", () => {
  test("deployment tools route to GATE_4_VALIDATION", () => {
    expect(gateForTool("deploy_to_prod")).toBe("GATE_4_VALIDATION")
    expect(gateForTool("force_publish")).toBe("GATE_4_VALIDATION")
  })

  test("pipeline tools route to GATE_2_CICD", () => {
    expect(gateForTool("trigger_pipeline")).toBe("GATE_2_CICD")
    expect(gateForTool("push_code")).toBe("GATE_2_CICD")
  })

  test("execution tools route to GATE_0_INGESTION", () => {
    expect(gateForTool("execute_bash")).toBe("GATE_0_INGESTION")
    expect(gateForTool("execute_sql")).toBe("GATE_0_INGESTION")
  })

  test("config/data tools route to GATE_1_CONTEXT", () => {
    expect(gateForTool("modify_config")).toBe("GATE_1_CONTEXT")
    expect(gateForTool("delete_resource")).toBe("GATE_1_CONTEXT")
  })

  test("remediation tools route to GATE_3_REMEDIATION", () => {
    expect(gateForTool("remediate_vulnerability")).toBe("GATE_3_REMEDIATION")
    expect(gateForTool("apply_patch")).toBe("GATE_3_REMEDIATION")
  })

  test("unknown tools default-deny to GATE_3_REMEDIATION", () => {
    expect(gateForTool("some_unknown_tool")).toBe("GATE_3_REMEDIATION")
  })

  test("every write operation routes to a loadable gate", () => {
    for (const tool of ["deploy_to_prod", "execute_bash", "modify_config", "trigger_pipeline", "apply_patch"]) {
      const gateId = gateForTool(tool)
      const policy = loadGate(gateId)
      expect(policy.gate).toBe(gateId)
      // The routed gate must forbid the very action it governs (or a related one)
      expect(policy.blockedActions.length).toBeGreaterThan(0)
      expect(isWriteOperation(tool)).toBe(true)
    }
  })
})
