# Kernel Deployment Runbook

## Prerequisites
- Bun >= 1.2
- SQLite (bun:sqlite — built-in)
- ARES binary (optional, for GATE_3 SOP scanning)
- ouroboros binary (optional, for GATE_3 SOP scanning)

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DAEMON_SIEM_DB` | No | `:memory:` | Path to durable SQLite SIEM store |
| `DAEMON_SIEM_FORWARD_URL` | No | — | External SIEM endpoint (Splunk HEC / Elasticsearch) |
| `DAEMON_SIEM_FORWARD_FORMAT` | No | `splunk-hec` | Wire format: `splunk-hec` or `elastic-bulk` |
| `DAEMON_SIEM_FORWARD_TOKEN` | No | — | Auth token for external SIEM |
| `DAEMON_SIEM_FORWARD_INDEX` | No | `daemon-kernel` | Elasticsearch index name |
| `DAEMON_ARES_BIN` | No | — | Path to ARES scanner binary |
| `DAEMON_OUROBOROS_BIN` | No | — | Path to ouroboros scanner binary |

## Gate Policy Configuration

Policies can be overridden per-environment via a JSON config file:
```bash
bun run model-check  # uses hardcoded defaults
# Or with overrides:
# loadGatePolicies("/etc/daemon/gate-overrides.json")
```

Config format: `Record<string, GatePolicy>` — keys must match gate names (e.g. `GATE_3_REMEDIATION`).

## Health Check

```typescript
import { checkKernelHealth } from "@daemon-protocol/kernel/health"

const health = await checkKernelHealth({ siem, mcpBackends: ["ares", "ouroboros"] })
// health.status: "healthy" | "degraded" | "unhealthy"
```

## Metrics Export

```typescript
import { renderMetrics } from "@daemon-protocol/kernel/metrics"

const metrics = renderMetrics(sink.stats(), { gatesChecked: 5, p1Violations: 0, p2Violations: 0 })
// Expose as /metrics endpoint for Prometheus scraping
```

## Alerting Rules

### P1 Violation (Critical)
```
kernel_verification_p1_violations > 0
```
Action: Immediate investigation. A forbidden action emitted a network packet.

### ROLLBACK Spike
```
rate(kernel_decisions_total{status="ROLLBACK"}[5m]) > 0.5
```
Action: Check planner behavior, verify SOP tool availability.

### Circuit Breaker Open
Monitor `CircuitBreaker.getState()` — alerts when state is `"open"`.
Action: Check MCP backend health (ARES/ouroboros/Orion).

## Rollback Procedures

1. **Disable a gate**: Remove it from the pipeline configuration
2. **Override policy**: Deploy a JSON config file with relaxed constraints
3. **Emergency stop**: Set `maxGlobalRetries: 1` to force immediate ROLLBACK on any violation
