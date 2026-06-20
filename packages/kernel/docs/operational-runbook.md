# Kernel Operational Runbook

## Monitoring P1 Violations

P1 = "forbidden action emitted a network packet." This should never happen.

### Detection
- **Dashboard**: `renderDashboard()` includes `SECURITY ALERT — P1 VIOLATION` when detected
- **SIEM query**: `sink.detectUnsafeEmissions(blockedActions)` returns violating rows
- **Metrics**: `kernel_verification_p1_violations > 0`

### Investigation
1. Query the SIEM for the violating trace: `sink.query({ emittedOnly: true })`
2. Check which action was emitted and which gate it belongs to
3. Verify the kernel's blockedActions list includes the action
4. Check if a semiotic alias bypassed the shield

## Investigating ROLLBACK Spots

### Common Causes
1. **Retry budget exhausted**: Planner kept proposing blocked/unknown actions
2. **SOP tool failure**: ARES/ouroboros returned FAILURE
3. **Illegal exit**: Planner tried `complete_gate_task` without clearing σ_sop
4. **Pessimistic shield**: Low-confidence SOP tool rejected

### Diagnosis
```typescript
const rows = sink.query({ gate: "GATE_3_REMEDIATION", enforcerStatus: "ROLLBACK" })
// Check the last few traces before ROLLBACK
```

## Adding New Blocked Actions

1. Add the action to the policy's `blockedActions` array
2. Add semiotic links for common aliases:
   ```typescript
   memory.addSemioticLink({ alias: "new_alias", canonical: "new_action", relation: "synonym" })
   ```
3. Run model-check to verify P1/P2 still hold
4. Update the PRISM model in `verification/`

## Adding New SOP Tools

1. Add the tool to the policy's `sopTools` array
2. Implement a `ToolExecutor` for the backend
3. Register it in `mcp/router.ts`
4. Run model-check to verify P1/P2 still hold

## Tuning Confidence Thresholds

The pessimistic shield (`confidenceThreshold`) rejects SOP tools below the threshold.

- `0` (default): Shield disabled — deterministic kernel only
- `0.5`: Moderate — reject very uncertain results
- `0.8`: Strict — reject anything below high confidence

Set via policy config:
```json
{ "confidenceThreshold": 0.8 }
```

## Emergency Procedures

### Disable a Gate
Remove it from the pipeline configuration. Downstream gates will not run.

### Override Policy
Deploy a JSON config file with relaxed constraints:
```json
{
  "GATE_3_REMEDIATION": {
    "maxGateRetries": 1,
    "blockedActions": ["deploy_to_prod"]
  }
}
```

### Emergency Stop
Set `maxGlobalRetries: 1` to force immediate ROLLBACK on any violation.
