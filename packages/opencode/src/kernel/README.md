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

## Real MCP Backends (Phase 5)

The kernel gate runs SOP tools (`ares_scan_directory`, `ouroboros_scan`,
`check_orion_policy`) against real backends when configured. Wiring lives in
`backends.ts` and is driven by environment variables:

| Env var | Effect |
| --- | --- |
| `DAEMON_ARES_BIN` | Path to `ares` binary; enables `ares_scan_directory` |
| `DAEMON_OUROBOROS_BIN` | Path to `ouroboros` binary; enables `ouroboros_scan` |
| `DAEMON_SCAN_ROOT` | Allowlisted scan root (default: cwd) |
| `DAEMON_ORION_ADDR` | Orion hub address; the gRPC client is caller-supplied |

`buildLiveExecutor()` returns a `ToolExecutor` only when at least one backend is
configured; otherwise it returns `undefined` and the kernel falls back to its
deterministic stub, so dev sessions work without scanners installed.

**Graceful degradation:** an SOP tool with no configured backend returns
`FAILURE` (never silently succeeds). Because the kernel treats an unsatisfied SOP
as unable to clear the gate, a missing scanner can never be used to reach
`PROCEED`. This preserves P1/P2 regardless of which backends are present.

The Orion executor is **evaluation-only**: `HOLD`/`ROLLBACK` decisions map to
`FAILURE`; it never deploys.

## Multi-Gate Routing (Phase 6)

Each write operation is enforced by the gate that governs its action class
(`routing.ts`, `gateForTool`):

| Tool class | Gate |
| --- | --- |
| `deploy_to_prod`, `deploy_to_staging`, `force_publish` | GATE_4_VALIDATION |
| `trigger_pipeline`, `push_code` | GATE_2_CICD |
| `execute_bash`, `execute_python`, `execute_sql` | GATE_0_INGESTION |
| `modify_config`, `modify_database`, `delete_resource` | GATE_1_CONTEXT |
| `remediate_vulnerability`, `apply_patch` | GATE_3_REMEDIATION |
| (anything else) | GATE_3_REMEDIATION (default-deny) |

The gate loads the matching policy from the kernel's gate registry, so each
class has its own blocked actions, SOP tools, and retry budgets.

## SIEM Telemetry (Phase 6)

Kernel decisions persist to a durable, queryable SQLite store
(`SqliteSiemSink` in `@daemon-protocol/kernel`) when `DAEMON_SIEM_DB` is set:

| Env var | Effect |
| --- | --- |
| `DAEMON_SIEM_DB` | SQLite path for the audit store (`:memory:` for ephemeral) |

The store is append-only (non-repudiation), indexed by gate/status/timestamp,
and supports:
- `query(filter)` — filter by gate, status, emitted-only, since-timestamp
- `stats()` — aggregate counts for dashboards
- `detectUnsafeEmissions(blockedActions)` — **P1 alarm**: any forbidden action
  that emitted a packet (should always be empty for a correct kernel)

A text dashboard (`renderDashboard`, `renderStats`, `renderRecent`) renders the
store for CLI/CI inspection, including a SECURITY ALERT banner on any P1
violation. SIEM persistence is fire-and-forget and never blocks or affects
enforcement — a sink failure cannot change a gate decision.

## Known Limitations

- gRPC transport for Orion is supplied by the caller (no bundled grpc dependency)
- HITL escalation requires human in the loop (cannot auto-override)
- When no backend is configured, the deterministic stub is used (dev fallback)
- SIEM store is local SQLite; forwarding to an external SIEM is a future step
