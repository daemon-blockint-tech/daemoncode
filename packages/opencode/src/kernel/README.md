# Kernel Gate: Shielded Enforcement in Live Agent Loop

## Overview

The kernel gate (`gateToolWithKernel`) enforces the Daemon Protocol's safety properties (P1: No Unsafe Network Emission, P2: Bounded Termination) directly in the live agent loop, before tools execute.

## Architecture

```
Tool Proposal (LLM) → Kernel Gate (GATE_3) → ACE Gate → Permission Ask → Tool Execute
                      ↓ (if write operation)
                      Deterministic Enforcer (σ, Δ)
                      - Block forbidden actions
                      - Require SOP tools before remediation
                      - Emit audit telemetry
```

## Write Operations

The following operations require kernel enforcement (GATE_3_REMEDIATION):

- **Deployment**: `deploy_to_prod`, `deploy_to_staging`, `force_publish`, `trigger_pipeline`
- **Execution**: `execute_bash`, `execute_python`, `execute_sql`
- **Modification**: `modify_config`, `modify_database`, `push_code`, `delete_resource`
- **Remediation**: `remediate_vulnerability`, `apply_patch`

Read-only operations (list, read, describe, scan) bypass the kernel gate and go directly to ACE gate.

## Safety Properties

### P1: No Unsafe Network Emission
Forbidden actions (deploy, execute_bash, modify_config) are rejected before they can execute. The kernel's deterministic transition function ensures no network packet is emitted for a forbidden intent.

### P2: Bounded Termination
Every agent episode terminates within `maxGlobalRetries` turns (default 10 for GATE_3). The kernel's global retry budget (`r_global`) ticks on every turn, even successful SOP tool execution, providing a hard wall against unbounded loops.

## Integration Points

1. **Session Tools** (`packages/opencode/src/session/tools.ts`)
   - Write operations flow through `gateToolWithKernel` before ACE gate
   - Kernel telemetry emitted via `plugin.trigger("kernel.gate.evaluated", ...)`
   - Blocked actions return to agent with "[KERNEL BLOCKED]" message

2. **Telemetry** (`TelemetryRow` in kernel decision)
   - `enforcer_status`: BLOCKED | SUCCESS | PROCEED | ROLLBACK
   - `network_emitted`: false for blocked, true for allowed
   - Emitted to session audit log via `EventV2Bridge`

3. **Escalation**
   - Kernel blocks → asks for HITL approval
   - User can approve (override block) or deny (remain blocked)
   - Approval logged as exception in audit trail

## Configuration

GATE_3 policy (in `@daemon-protocol/kernel`):
- `blockedActions`: deploy_to_prod, force_publish, trigger_pipeline, execute_bash
- `sopTools`: ares_scan_directory, ouroboros_scan
- `completionTool`: complete_gate_task
- `maxGateRetries`: 3 (per-gate retry budget)
- `maxGlobalRetries`: 10 (hard termination wall)

## Testing

### Local Testing
```bash
cd packages/opencode
bun test src/kernel/gate.test.ts
```

### Integration Testing
1. Propose a write operation (deploy_to_prod)
2. Verify kernel gate blocks it (status: BLOCKED)
3. Verify telemetry emitted to session audit log
4. Test SOP sequence: ares_scan_directory → complete_gate_task → PROCEED

## Safety Guarantees

- Kernel decisions are **deterministic** (no randomness, no external state leakage)
- Kernel enforces **default-deny** for unknown tools
- Kernel requires **mandatory SOP** (ares_scan or ouroboros_scan) before remediation completion
- Kernel **always terminates** within global budget (no infinite loops for any planner)
- Kernel **emits telemetry** for every turn (audit trail non-repudiation)

## Known Limitations

- Executors use deterministic stub (returns SUCCESS for all allowed actions)
- Real ARES/ouroboros/Orion backends integrated separately (Phase 5)
- No real network calls in kernel context; tool boundary is mockable
- HITL escalation requires human in the loop (cannot auto-override)
