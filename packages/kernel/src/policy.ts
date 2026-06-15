/**
 * Version-controlled gate policy. Kept deliberately small and dependency-free:
 * the policy is data (see `config/gate-policy.json`), loaded and validated by
 * hand so the kernel pulls no third-party schema library.
 */

export interface GatePolicy {
  /** Gate identifier, e.g. "GATE_3_REMEDIATION". */
  gate: string
  /** Tool schemas that are forbidden (the I_bad family). */
  blockedActions: string[]
  /** Tool schemas that satisfy the mandatory SOP (set sigma_sop = 1). */
  sopTools: string[]
  /** Tool schema that closes the gate (I_done). */
  completionTool: string
  /** Per-gate retry budget K_gate. */
  maxGateRetries: number
  /** Per-session retry budget K_global. */
  maxGlobalRetries: number
  /** Human-readable principle summaries surfaced via Crystalline recall. */
  principles?: string[]
  /**
   * Optional pessimistic-shield threshold. When > 0, an intent whose recall
   * confidence is below this value is treated as a hard violation (default-deny).
   * 0 (default) disables the pessimistic shield.
   */
  confidenceThreshold?: number
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string")
}

/** Validate an unknown value into a GatePolicy, throwing on malformed input. */
export function parsePolicy(raw: unknown): GatePolicy {
  if (typeof raw !== "object" || raw === null) throw new Error("gate policy must be an object")
  const get = (key: string): unknown => Reflect.get(raw, key)

  const gate = get("gate")
  const blockedActions = get("blockedActions")
  const sopTools = get("sopTools")
  const completionTool = get("completionTool")
  const maxGateRetries = get("maxGateRetries")
  const maxGlobalRetries = get("maxGlobalRetries")
  const principles = get("principles")
  const confidenceThreshold = get("confidenceThreshold")

  if (typeof gate !== "string" || gate.length === 0) throw new Error("gate policy: `gate` must be a non-empty string")
  if (!isStringArray(blockedActions)) throw new Error("gate policy: `blockedActions` must be a string[]")
  if (!isStringArray(sopTools)) throw new Error("gate policy: `sopTools` must be a string[]")
  if (typeof completionTool !== "string") throw new Error("gate policy: `completionTool` must be a string")
  if (typeof maxGateRetries !== "number" || maxGateRetries < 1)
    throw new Error("gate policy: `maxGateRetries` must be a number >= 1")
  if (typeof maxGlobalRetries !== "number" || maxGlobalRetries < 1)
    throw new Error("gate policy: `maxGlobalRetries` must be a number >= 1")
  if (principles !== undefined && !isStringArray(principles))
    throw new Error("gate policy: `principles` must be a string[] when present")
  if (
    confidenceThreshold !== undefined &&
    (typeof confidenceThreshold !== "number" || confidenceThreshold < 0 || confidenceThreshold > 1)
  )
    throw new Error("gate policy: `confidenceThreshold` must be a number in [0, 1] when present")

  return {
    gate,
    blockedActions,
    sopTools,
    completionTool,
    maxGateRetries,
    maxGlobalRetries,
    principles,
    confidenceThreshold,
  }
}

/** Load and validate a gate policy from a JSON file path (Bun runtime). */
export async function loadPolicy(path: string): Promise<GatePolicy> {
  const raw = await Bun.file(path).json()
  return parsePolicy(raw)
}
