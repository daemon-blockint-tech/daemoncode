# ADR-007: SIEM Architecture

## Status
Accepted

## Context
Kernel decisions must be persisted for audit, forensics, and security monitoring. The SIEM layer must not affect kernel performance or safety.

## Decision
Two-tier SIEM architecture:
1. **SqliteSiemSink**: Append-only SQLite store (WAL mode) for durable, queryable telemetry. Supports `query()`, `stats()`, and `detectUnsafeEmissions()` for dashboard and alerting.
2. **SiemForwarder**: Batched HTTP forwarding to external SIEM (Splunk HEC / Elasticsearch bulk). Fire-and-forget with retry and backoff. Never blocks the kernel.

Both compose via `teeSink()` — each sink is independent; a failing sink does not affect the others or the kernel.

## Consequences
- Kernel decisions are non-repudiable (append-only, no UPDATE/DELETE)
- External SIEM forwarding is resilient (batching, retry, backoff)
- The kernel never awaits SIEM writes (fire-and-forget)
- Dashboard rendering is decoupled from SIEM persistence
