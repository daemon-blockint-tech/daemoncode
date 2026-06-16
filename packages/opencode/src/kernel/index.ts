export { gateToolWithKernel, type KernelGateInput, type KernelGateResult } from "./gate"

/**
 * Write operation classification: tools that require kernel enforcement.
 * These are high-risk operations that mutate external state.
 */
export const WRITE_OPERATIONS = new Set([
  // Deployment
  "deploy_to_prod",
  "deploy_to_staging",
  "force_publish",
  "trigger_pipeline",

  // Execution
  "execute_bash",
  "execute_python",
  "execute_sql",

  // Modification
  "modify_config",
  "modify_database",
  "push_code",
  "delete_resource",

  // Remediation (SOP-required)
  "remediate_vulnerability",
  "apply_patch",
])

export function isWriteOperation(tool: string): boolean {
  return WRITE_OPERATIONS.has(tool)
}
