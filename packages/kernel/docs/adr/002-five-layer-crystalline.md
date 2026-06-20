# ADR-002: Five-Layer Crystalline Memory

## Status
Accepted

## Context
The kernel needs to resolve synonyms, paraphrases, and aliases of forbidden actions back to their canonical form. A naive approach (regex matching) is brittle and cannot handle semantic similarity.

## Decision
Use a five-layer Crystalline cognitive memory:
1. **Episodic**: Past precedents (action → outcome) for analogical recall
2. **Semantic**: Semiotic links mapping aliases to canonical actions
3. **Procedural**: Required SOP tool sequences
4. **Analogical**: Cross-domain pattern matching
5. **Principle**: Active constraints (blockedActions, requiredSOP)

Semiotic links are the core defense against synonym attacks. A link maps an alias (e.g. "ship_to_production") to its canonical form (e.g. "deploy_to_prod") with a relation type and confidence weight.

## Consequences
- Synonym attacks are defeated at the memory layer, not by expanding blockedActions
- The kernel's transition function (σ/Δ) is unchanged — defense is orthogonal
- New aliases can be added at runtime via `addSemioticLink()`
- Weak links lower recall confidence, enabling the pessimistic shield
