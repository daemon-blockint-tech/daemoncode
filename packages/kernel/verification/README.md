# PRISM Models for Daemon Protocol Kernel

This directory contains PRISM Markov Decision Process (MDP) models that formalize the safety properties of the shielded kernel gates.

## Files

### `gate3.prism` and `gate3.props`

Formal model of **GATE_3_REMEDIATION** as an 8-state MDP:
- States: `(r ∈ [0..K_gate], σ ∈ {0,1})` tracking gate-retry counter and SOP-cleared flag
- Actions: three transition classes (violation, SOP, completion) corresponding to the kernel enforcer's decision points
- Initial state: `r=0, σ=0` (no retries, SOP not cleared)

Properties verified (in `gate3.props`):
- **P1_NO_UNSAFE**: `Pmax[F unsafe_emission] = 0` — forbidden actions never emit a network packet
- **P2_TERM_MIN**: Minimum episode length (at least 1 turn to reach terminal state)
- **P2_TERM_MAX**: Maximum episode length bounded by `K_global` (guaranteed termination)

### `pipeline.prism`

Sequential composition of GATE_0..GATE_4 with shared global budget:
- 5 gates, each with local state `(r_gate, σ_sop)` and shared state `r_global`
- Advancement: PROCEED at one gate → initialize next gate's state
- Abort: ROLLBACK at any gate → pipeline halts (no downstream gates execute)
- Safety: global budget `K_global = 60` bounds all combined gate executions

Properties:
- `p1_safe`: No forbidden action ever sets `unsafe_emitted=true`
- `pipeline_proceed`: All gates completed without safety violation

## Running PRISM

The PRISM binary is not bundled in this repository. To verify models:

1. **Install PRISM** (http://www.prismmodelchecker.org/)
2. **Run model-checking**:
   ```bash
   prism gate3.prism gate3.props
   prism pipeline.prism pipeline.props  # (not yet created; pipeline.prism is template)
   ```

## Complementary Verification

The TypeScript files in `src/` provide two independent verification layers:

1. **Bounded-Exhaustive Verifier** (`src/verification.ts`, `verifyGate`):
   - Drives the real kernel with adversarial planners over all action sequences
   - Machine-checks P1 and P2 on every path
   - Runs in CI as regression insurance

2. **Explicit-State Model Checker** (`src/model-check.ts`, `modelCheckGate`):
   - Abstract MDP state enumeration
   - Independent of the runtime implementation
   - Verifies formal properties over the state space

Both are runnable without external tools and make the proof machine-checkable in CI.
