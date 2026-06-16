/**
 * Tool → gate routing and write-operation classification.
 *
 * Kept separate from index.ts to avoid a circular import with gate.ts (which
 * needs the routing logic, while index.ts re-exports the gate).
 */

import { SEMIOTIC_LINKS } from "./semiotics"

/** Alias → canonical action index, normalized for case/separator variants. */
const ALIAS_INDEX = new Map<string, string>(
  SEMIOTIC_LINKS.map((l) => [l.alias.toLowerCase().replace(/[\s-]+/g, "_"), l.canonical]),
)

/**
 * Resolve a tool name through semiotic links to its canonical form. Ensures the
 * write-operation classifier and gate router see the canonical action, so a
 * synonym (e.g. "ship_to_production") cannot bypass the kernel gate entirely.
 */
export function canonicalizeTool(tool: string): string {
  return ALIAS_INDEX.get(tool.toLowerCase().replace(/[\s-]+/g, "_")) ?? tool
}

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
  // Resolve synonyms first so an alias of a write op cannot slip past the gate.
  return WRITE_OPERATIONS.has(canonicalizeTool(tool))
}

/**
 * Tool → gate routing. Each write operation is enforced by the gate whose
 * policy governs that class of action. Tools not listed fall back to GATE_3
 * (the strictest remediation gate) as a default-deny safety posture.
 */
const TOOL_GATE_MAP: Record<string, string> = {
  // Deployment / publish — validation gate (Orion policy)
  deploy_to_prod: "GATE_4_VALIDATION",
  deploy_to_staging: "GATE_4_VALIDATION",
  force_publish: "GATE_4_VALIDATION",

  // Pipeline / CI — CICD gate (tests + artifacts)
  trigger_pipeline: "GATE_2_CICD",
  push_code: "GATE_2_CICD",

  // Execution — ingestion gate (input validation + dependency scan)
  execute_bash: "GATE_0_INGESTION",
  execute_python: "GATE_0_INGESTION",
  execute_sql: "GATE_0_INGESTION",

  // Config / data modification — context gate
  modify_config: "GATE_1_CONTEXT",
  modify_database: "GATE_1_CONTEXT",
  delete_resource: "GATE_1_CONTEXT",

  // Remediation — remediation gate (ARES + ouroboros SOP)
  remediate_vulnerability: "GATE_3_REMEDIATION",
  apply_patch: "GATE_3_REMEDIATION",
}

/** Select the enforcing gate for a tool; defaults to GATE_3 (strictest). */
export function gateForTool(tool: string): string {
  return TOOL_GATE_MAP[canonicalizeTool(tool)] ?? "GATE_3_REMEDIATION"
}
