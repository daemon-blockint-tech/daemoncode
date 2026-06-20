/**
 * Gate policies registry for GATE_0 through GATE_4.
 *
 * Each gate enforces a distinct set of blocked actions and mandatory SOP tools,
 * representing a stage in the Daemon Protocol pipeline.
 *
 * Supports runtime configuration via loadGatePolicies() — loads overrides from
 * a JSON file or uses hardcoded defaults. Per-environment tuning without code
 * changes.
 */

import type { GatePolicy } from "../policy"
import { parsePolicy } from "../policy"

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

/**
 * Load gate policies from a JSON config file, merging with hardcoded defaults.
 * If configPath is omitted, returns the hardcoded defaults.
 * Config file format: Record<string, GatePolicy> (keys must match gate names).
 * Unknown keys are ignored; valid keys override the corresponding default.
 */
export async function loadGatePolicies(configPath?: string): Promise<Record<string, GatePolicy>> {
  if (!configPath) return { ...GATE_POLICIES }

  const file = Bun.file(configPath)
  if (!(await file.exists())) return { ...GATE_POLICIES }

  const overrides = (await file.json()) as Record<string, unknown>
  const merged: Record<string, GatePolicy> = { ...GATE_POLICIES }

  for (const [key, value] of Object.entries(overrides)) {
    if (key in GATE_POLICIES) {
      merged[key] = parsePolicy(value)
    }
  }

  return merged
}
