/**
 * Core types for the GATE_3 shielded kernel.
 *
 * These instantiate the symbols of the formal model in
 * `daemoncode/whitepaper/daemon_gate3_safety_model.tex`:
 *   - `TelemetryRow`        <-> trace tuple T_t = [gate, t, a, status, E_t]
 *   - `network_emitted`     <-> the physical emission flag E_t in {0, 1}
 *   - `KernelRegisters.r_*` <-> the retry counter r
 *   - `sigma_sop`           <-> the SOP-cleared flag sigma_sop
 */

export type EnforcerStatus = "BLOCKED" | "SUCCESS" | "FAILURE" | "ROLLBACK" | "PROCEED"

/** One row of the black-box trace; the empirical instantiation of T_t. */
export interface TelemetryRow {
  gate: string
  turn: number
  action_schema: string
  enforcer_status: EnforcerStatus
  network_emitted: boolean
  timestamp: string
}

/** Deterministic kernel state ("CPU registers"). */
export interface KernelRegisters {
  r_gate: number
  r_global: number
  turn: number
  /** 0 = mandatory SOP not yet cleared, 1 = SOP cleared. */
  sigma_sop: number
}

export interface LoopConfig {
  maxGateRetries: number
  maxGlobalRetries: number
}

/** A proposal emitted by the (untrusted) LLM planner. */
export interface IntentProposal {
  action_schema: string
  target_subsystem: string
  typed_arguments: Record<string, unknown>
  /**
   * Optional scanner/recall confidence in [0, 1]. Used only by the optional
   * pessimistic shield; when absent the deterministic shield is used.
   */
  confidence?: number
}

export interface GateResult {
  status: "PROCEED" | "ROLLBACK"
  traces: TelemetryRow[]
}

export interface LoopControl {
  shouldBreak: boolean
  finalStatus: "ROLLBACK" | "PENDING"
}
