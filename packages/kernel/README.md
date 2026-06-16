# @daemon-protocol/kernel

A deterministic **shielded kernel** for the GATE_3 smart-contract remediation
gate. It treats the LLM as an *untrusted tactical planner* and relocates safety
into a sterile, deterministic enforcer. Formalised in
[`whitepaper/daemon_gate3_safety_model.tex`](../../whitepaper/daemon_gate3_safety_model.tex).

> Scope: this package is the standalone, self-contained kernel for **one gate**.
> It is **not** wired into the live agent loop (`packages/opencode/src/session/tools.ts`)
> and makes **no** real network calls — the tool boundary is a mockable interface.
> Live-gate integration, real MCP executors, and other gates are roadmap.

## Three-tier defense

```
User Space   — LLM Tactical Planner (untrusted)   proposes Intent I_t
                       │  I_t
                       ▼
Kernel Space — runGateWithGuardedTools (σ, Δ)      decides BLOCKED/SUCCESS/PROCEED/ROLLBACK
                       │  only if E_t = 1
                       ▼
Physical     — ToolExecutor / MCP / gateway        g_exec → ARES / ouroboros / clusters
```

A network packet (`network_emitted = true`, the model's `E_t = 1`) is emitted
only for actions that pass the shield. Forbidden actions are reflected back as
cognitive interrupts (`E_t = 0`).

## Safety properties (proven & machine-checked for GATE_3)

- **No Unsafe Network Emission** — a forbidden intent never sets `network_emitted`.
- **Bounded Termination** — every episode reaches `PROCEED` or `ROLLBACK` within
  `maxGlobalRetries` turns for any planner; an all-violation path rolls back
  within `maxGateRetries + 1` turns. (Every turn consumes the global budget, so a
  planner cannot loop forever on SOP tools.)

Both properties are enforced two ways: the **Trinity Fixtures**
(`src/kernel.test.ts`) and a **bounded-exhaustive verifier** (`src/verification.ts`,
`verifyGate`) that drives the real kernel with an adversarial planner over every
action sequence and asserts P1/P2 on each path. A companion PRISM/PCTL model
lives in [`verification/`](./verification/) for independent model-checking.

## Model ↔ code mapping

| Formal symbol | Runtime |
| --- | --- |
| retry counter `r` | `KernelRegisters.r_gate` |
| SOP-cleared flag `σ_sop` | `KernelRegisters.sigma_sop` |
| emission flag `E_t ∈ {0,1}` | `TelemetryRow.network_emitted` |
| trace tuple `T_t` | `TelemetryRow` |
| transition table `Δ_δ` | `runGateWithGuardedTools` + `applyViolationPenalty` |
| shield `σ` / `f_enforce` | block / SOP / completion branches in the loop |

## Usage

```ts
import { runGateWithGuardedTools, createPolicyRecall, loadPolicy } from "@daemon-protocol/kernel"

const policy = await loadPolicy(new URL("./config/gate-policy.json", import.meta.url).pathname)
const result = await runGateWithGuardedTools({
  policy,
  recall: createPolicyRecall(policy),
  planner: myLLMPlanner, // (history) => Promise<IntentProposal>
  // executor defaults to a deterministic stub; supply a real MCP executor later
})
console.log(result.status, result.traces)
```

## Develop / test

```bash
cd packages/kernel
bun test        # Trinity Fixtures + exhaustive verification (12 tests)
bun run typecheck
```

See [`docs/trinity-fixtures.md`](./docs/trinity-fixtures.md) for the golden traces.

## Implemented beyond GATE_3

- **Real MCP executors** for ARES/ouroboros/Orion (`src/mcp/`) + a routing
  `createMcpExecutor` that degrades gracefully when a backend is absent.
- **GATE_0–GATE_4** policies and a multi-gate `runPipeline` (`src/gates/`).
- **Five-layer Crystalline memory + semiotic links** (`src/crystalline-memory.ts`)
  defeating synonym-attacks in the memory layer (σ/Δ unchanged).
- **SQLite SIEM sink + dashboard** (`src/siem.ts`, `src/dashboard.ts`) with a P1
  unsafe-emission alarm.
- **Explicit-state model checker** (`src/model-check.ts`) complementing the
  bounded-exhaustive verifier.

## Roadmap (still out of scope)

Forwarding the SIEM to an external system (Splunk/Elastic); running the PRISM
model in CI (the model is provided; the in-repo verifier + model checker already
enforce the properties); learned/embedding-based semiotic links.
