# ADR-004: Pessimistic Shielding

## Status
Accepted

## Context
SOP tools (ARES, ouroboros, Orion) may return low-confidence results. A planner could exploit a "pass" from a low-confidence scanner to complete the gate without genuine safety clearance.

## Decision
When `confidenceThreshold > 0`, any intent whose recall confidence falls below the threshold is treated as a hard violation (default-deny). The confidence is sourced from the weakest semiotic link traversed during recall, or from the intent's explicit confidence field.

## Consequences
- The pessimistic shield removes the trusted-oracle assumption on scanners
- A policy with `confidenceThreshold: 0` (default) disables the shield
- The shield composes with the deterministic kernel — it is an additional filter, not a replacement
- Low-confidence SOP tools trigger the same violation penalty as blocked actions
