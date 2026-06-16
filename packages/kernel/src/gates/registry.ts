/**
 * Gate policies registry for GATE_0 through GATE_4.
 *
 * Each gate enforces a distinct set of blocked actions and mandatory SOP tools,
 * representing a stage in the Daemon Protocol pipeline.
 */

import type { GatePolicy } from "../policy"

const GATE_0_INGESTION: GatePolicy = {
  gate: "GATE_0_INGESTION",
  blockedActions: ["deploy_to_prod", "trigger_pipeline", "execute_bash", "modify_config"],
  sopTools: ["validate_input", "scan_dependencies"],
  completionTool: "complete_gate_task",
  maxGateRetries: 3,
  maxGlobalRetries: 12,
}

const GATE_1_CONTEXT: GatePolicy = {
  gate: "GATE_1_CONTEXT",
  blockedActions: ["deploy_to_prod", "trigger_pipeline", "execute_bash", "push_code"],
  sopTools: ["gather_context", "analyze_dependencies"],
  completionTool: "complete_gate_task",
  maxGateRetries: 3,
  maxGlobalRetries: 12,
}

const GATE_2_CICD: GatePolicy = {
  gate: "GATE_2_CICD",
  blockedActions: ["deploy_to_prod", "force_publish", "skip_tests"],
  sopTools: ["run_tests", "build_artifacts"],
  completionTool: "complete_gate_task",
  maxGateRetries: 3,
  maxGlobalRetries: 12,
}

const GATE_3_REMEDIATION: GatePolicy = {
  gate: "GATE_3_REMEDIATION",
  blockedActions: ["deploy_to_prod", "force_publish", "trigger_pipeline", "execute_bash"],
  sopTools: ["ares_scan_directory", "ouroboros_scan"],
  completionTool: "complete_gate_task",
  maxGateRetries: 3,
  maxGlobalRetries: 10,
}

const GATE_4_VALIDATION: GatePolicy = {
  gate: "GATE_4_VALIDATION",
  blockedActions: ["deploy_to_prod", "skip_validation", "ignore_warnings"],
  sopTools: ["validate_deployment", "check_orion_policy"],
  completionTool: "complete_gate_task",
  maxGateRetries: 3,
  maxGlobalRetries: 12,
}

export const GATE_POLICIES: Record<string, GatePolicy> = {
  GATE_0_INGESTION,
  GATE_1_CONTEXT,
  GATE_2_CICD,
  GATE_3_REMEDIATION,
  GATE_4_VALIDATION,
}

export function loadGate(id: string): GatePolicy {
  const policy = GATE_POLICIES[id]
  if (!policy) {
    throw new Error(`Unknown gate: ${id}`)
  }
  return policy
}
