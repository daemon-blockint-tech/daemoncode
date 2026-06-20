# ADR-006: In-Repo Verifier Replaces PRISM in CI

## Status
Accepted

## Context
PRISM binaries are not available in CI environments. The formal PCTL models in `verification/` are the human-readable specification, but they cannot be executed directly in GitHub Actions.

## Decision
Two in-repo verification layers run in CI:
1. **Explicit-state model checker** (`model-check.ts`): Enumerates all reachable MDP states and verifies P1 (no unsafe emission) and P2 (bounded termination)
2. **Bounded-exhaustive verifier** (`verification.ts`): Drives the real kernel with an adversarial planner across all reachable paths

Both run via `bun run model-check` and exit non-zero on any violation.

## Consequences
- CI catches any kernel change that breaks P1/P2
- The PRISM models remain as the authoritative specification
- The in-repo verifier is faster than PRISM (no binary install, no model compilation)
- Both layers are independent — a bug in one does not affect the other
