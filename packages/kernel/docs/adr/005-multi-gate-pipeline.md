# ADR-005: Multi-Gate Pipeline

## Status
Accepted

## Context
A single gate enforces safety for one stage. A full deployment pipeline requires multiple stages (ingestion, context, CI/CD, remediation, validation), each with different blocked actions and SOP requirements.

## Decision
Gates are composed sequentially via `runPipeline()`. Each gate runs independently with its own policy, planner, and retry budgets. The pipeline:
1. Runs gates in order (GATE_0 → GATE_4)
2. Aborts on the first ROLLBACK (downstream gates not run)
3. Aggregates traces from all gates
4. Returns per-gate status and overall status

## Consequences
- Each gate can be independently model-checked for P1/P2
- Pipeline-level safety is guaranteed by the sequential abort semantics
- A ROLLBACK in any gate prevents all downstream execution
- The global retry budget is per-gate (not shared across gates)
