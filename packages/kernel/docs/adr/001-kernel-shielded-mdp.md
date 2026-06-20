# ADR-001: Shielded MDP Kernel

## Status
Accepted

## Context
LLM planners are untrusted tactical agents. Prompt engineering alone cannot guarantee safety properties — an adversarial or confused planner will eventually propose a forbidden action. We need a deterministic enforcer that sits between the planner and tool execution.

## Decision
Use a shielded Markov Decision Process (MDP) as the kernel architecture. The kernel implements a deterministic transition function Δ_δ that:
1. Inspects every intent proposal from the planner
2. Enforces blocked actions (I_bad set) — never emits network packets for forbidden tools
3. Requires SOP clearance (σ_sop) before allowing gate completion
4. Guarantees bounded termination via retry budgets (K_gate, K_global)

The kernel is sterile: it contains no LLM calls, no network I/O, and no state beyond its registers.

## Consequences
- Safety is a property of the kernel, not of the model's disposition
- P1 (No Unsafe Network Emission) and P2 (Bounded Termination) are formally verifiable
- The kernel can be model-checked via explicit-state MDP enumeration
- Adding new safety rules requires only policy changes, not kernel changes
