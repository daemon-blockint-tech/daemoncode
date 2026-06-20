# Kernel API Reference

## Core Kernel

### `runGateWithGuardedTools(options: RunGateOptions): Promise<GateResult>`
Run one GATE episode. Returns `{ status: "PROCEED" | "ROLLBACK", traces: TelemetryRow[] }`.

### `applyViolationPenalty(ctx, registers, config, recorder, history): LoopControl`
Atomic helper for hard violations. Mutates registers, logs telemetry, decides loop control.

## Policy

### `parsePolicy(raw: unknown): GatePolicy`
Validate an unknown value into a GatePolicy. Throws on malformed input.

### `loadPolicy(path: string): Promise<GatePolicy>`
Load and validate a gate policy from a JSON file.

### `GatePolicy` interface
```typescript
{
  gate: string
  blockedActions: string[]
  sopTools: string[]
  completionTool: string
  maxGateRetries: number
  maxGlobalRetries: number
  principles?: string[]
  confidenceThreshold?: number
}
```

## Crystalline Memory

### `CrystallineMemory` class
Five-layer cognitive memory implementing `CrystallineRecall`.

- `recall(action: string): Promise<RichRecallResult>` — resolve action through semiotic links
- `addSemioticLink(link: SemioticLink): void` — register new alias at runtime

### `createCrystallineMemory(config: CrystallineMemoryConfig): CrystallineMemory`
Convenience factory.

## Gates

### `GATE_POLICIES: Record<string, GatePolicy>`
Hardcoded policies for GATE_0 through GATE_4.

### `loadGate(id: string): GatePolicy`
Lookup gate by ID; throws on unknown.

### `loadGatePolicies(configPath?: string): Promise<Record<string, GatePolicy>>`
Load from JSON file, merging with defaults.

### `runPipeline(opts: PipelineOpts): Promise<PipelineResult>`
Multi-gate orchestrator. Aborts on first ROLLBACK.

## Verification

### `modelCheckGate(policy: GatePolicy): ModelCheckResult`
Explicit-state MDP enumeration. Returns `{ p1Holds, p2Holds, statesVisited, ... }`.

### `verifyGate(policy: GatePolicy): Promise<VerificationResult>`
Bounded-exhaustive drive of the real kernel.

## MCP

### `createMcpExecutor(backends): McpExecutor`
Route SOP tools to configured backends (ARES/ouroboros/Orion).

### `CircuitBreaker` class
Wraps a `ToolExecutor`; opens after N failures, half-opens after cooldown.

## SIEM

### `SqliteSiemSink` class
Append-only SQLite telemetry store.
- `append(row)` — persist a decision
- `query(filter)` — query stored traces
- `stats()` — aggregate dashboard statistics
- `detectUnsafeEmissions(blockedActions)` — P1 violation detection

### `SiemForwarder` class
Batched HTTP forwarding to external SIEM.
- `append(row)` — buffer a row (fire-and-forget)
- `flush()` — send buffered rows
- `close()` — flush + stop timer

### `teeSink(...sinks): TelemetrySink`
Compose multiple sinks (each independent).

## Telemetry

### `BlackBoxRecorder` class
In-memory trace accumulator with optional `TelemetrySink`.

### `NdjsonFileSink` class
Append-only NDJSON file writer (O(1) per row).

## Metrics

### `renderMetrics(stats, verification): string`
Prometheus text-format metrics.

## Health

### `checkKernelHealth(opts): Promise<KernelHealth>`
Runtime health status combining model-check, SIEM, and MCP reachability.

## Dashboard

### `renderStats(stats): string`
ASCII stats block.

### `renderRecent(rows): string`
Tabular recent decisions.

### `renderDashboard(sink, blockedActions?, recentLimit?): string`
Full dashboard with P1 security alerts.
