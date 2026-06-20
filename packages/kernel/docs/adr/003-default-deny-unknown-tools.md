# ADR-003: Default-Deny for Unknown Tools

## Status
Accepted

## Context
An LLM planner may propose tools not listed in the policy's blockedActions or sopTools. Allowing unknown tools creates an unmodelled transition in the MDP, which could violate safety properties.

## Decision
Unknown tools are treated as violations (default-deny). The kernel applies the same penalty as a blocked action: increment retry counters, log a BLOCKED telemetry row, and inject a steering decree into the conversation history.

## Consequences
- Every tool transition is either explicitly allowed (SOP tool, completion tool) or denied
- The MDP state space is finite and fully enumerable
- Adding a new tool requires adding it to the policy (blockedActions or sopTools)
- The model checker can verify P1/P2 over the complete action space
