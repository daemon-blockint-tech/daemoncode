/**
 * Explicit-state model checker for the GATE_3 kernel.
 *
 * Exhaustively enumerates reachable states of the abstract MDP:
 * state = (r_gate, r_global, sigma_sop, status)
 *
 * Verifies:
 * - P1_SAFE: Pmax[F unsafe_emission] = 0 (no forbidden action emits)
 * - P2_TERM: minimum and maximum episode lengths are bounded by config
 *
 * This is an independent verification layer complementing the runtime verifier.
 */

import type { GatePolicy } from "./policy"

export interface ModelCheckResult {
  p1Holds: boolean
  p2Holds: boolean
  maxEpisodeLength: number
  minEpisodeLength: number
  statesVisited: number
  violations: string[]
}

interface State {
  r_gate: number
  r_global: number
  sigma_sop: number
  status: "INIT" | "BLOCKED" | "SUCCESS" | "PROCEED" | "ROLLBACK"
}

function stateKey(s: State): string {
  return `${s.r_gate},${s.r_global},${s.sigma_sop},${s.status}`
}

export function modelCheckGate(policy: GatePolicy): ModelCheckResult {
  const violations: string[] = []
  const stateSet = new Set<string>()
  const queue: Array<{ state: State; episodeLength: number; lastAction?: string; lastEmitted?: boolean }> = []

  let minEpisodeLength = Infinity
  let maxEpisodeLength = 0

  const initialState: State = {
    r_gate: 0,
    r_global: 0,
    sigma_sop: 0,
    status: "INIT",
  }

  queue.push({ state: initialState, episodeLength: 0 })

  while (queue.length > 0) {
    const { state, episodeLength, lastAction, lastEmitted } = queue.shift()!
    const key = stateKey(state)

    if (stateSet.has(key) && episodeLength > 0) {
      continue
    }
    stateSet.add(key)

    // Terminal states: record episode lengths
    if (state.status === "PROCEED" || state.status === "ROLLBACK") {
      minEpisodeLength = Math.min(minEpisodeLength, episodeLength)
      maxEpisodeLength = Math.max(maxEpisodeLength, episodeLength)

      // P1: forbidden actions never emit
      if (lastAction && policy.blockedActions.includes(lastAction) && lastEmitted) {
        violations.push(`P1 violation: forbidden action '${lastAction}' emitted at episode length ${episodeLength}`)
      }
      continue
    }

    // Non-terminal: generate successor states for each action class
    const actions = [...policy.blockedActions, ...policy.sopTools, policy.completionTool, "__unknown__"]

    for (const action of actions) {
      let nextState: State | null = null
      let emitted = false

      // Violation path: forbidden action
      if (policy.blockedActions.includes(action)) {
        nextState = {
          r_gate: state.r_gate + 1,
          r_global: state.r_global + 1,
          sigma_sop: state.sigma_sop,
          status:
            state.r_gate + 1 >= policy.maxGateRetries || state.r_global + 1 >= policy.maxGlobalRetries
              ? "ROLLBACK"
              : "BLOCKED",
        }
        emitted = false
      }

      // SOP tool: success path, refresh gate budget, charge global
      else if (policy.sopTools.includes(action)) {
        nextState = {
          r_gate: 0,
          r_global: state.r_global + 1,
          sigma_sop: 1,
          status: state.r_global + 1 >= policy.maxGlobalRetries ? "ROLLBACK" : "SUCCESS",
        }
        emitted = true
      }

      // Completion: legal only if SOP cleared
      else if (action === policy.completionTool) {
        if (state.sigma_sop === 1) {
          nextState = {
            ...state,
            status: "PROCEED",
          }
          emitted = true
        } else {
          nextState = {
            r_gate: state.r_gate + 1,
            r_global: state.r_global + 1,
            sigma_sop: state.sigma_sop,
            status:
              state.r_gate + 1 >= policy.maxGateRetries || state.r_global + 1 >= policy.maxGlobalRetries
                ? "ROLLBACK"
                : "BLOCKED",
          }
          emitted = false
        }
      }

      // Unknown tool: default-deny
      else {
        nextState = {
          r_gate: state.r_gate + 1,
          r_global: state.r_global + 1,
          sigma_sop: state.sigma_sop,
          status:
            state.r_gate + 1 >= policy.maxGateRetries || state.r_global + 1 >= policy.maxGlobalRetries
              ? "ROLLBACK"
              : "BLOCKED",
        }
        emitted = false
      }

      if (nextState) {
        queue.push({
          state: nextState,
          episodeLength: episodeLength + 1,
          lastAction: action,
          lastEmitted: emitted,
        })
      }
    }
  }

  const p1Holds = violations.length === 0
  const p2Holds = maxEpisodeLength <= policy.maxGlobalRetries && minEpisodeLength > 0

  return {
    p1Holds,
    p2Holds,
    maxEpisodeLength: maxEpisodeLength > 0 ? maxEpisodeLength : 1,
    minEpisodeLength: minEpisodeLength < Infinity ? minEpisodeLength : 1,
    statesVisited: stateSet.size,
    violations,
  }
}
