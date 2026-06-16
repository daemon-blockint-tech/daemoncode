/**
 * Orion executor: gRPC client for policy evaluation via HubService.EvaluatePolicy.
 *
 * Maps deployment decisions:
 * - PROCEED | NO_UPDATE → SUCCESS (evaluation approved)
 * - HOLD | ROLLBACK → FAILURE (evaluation recommends caution/rollback)
 *
 * This executor is EVALUATION-ONLY and never auto-deploys. It uses the exact
 * proto message field names from orion.proto.
 */

import type { ExecutionResult } from "../executor"

export enum DeployDecision {
  UNSPECIFIED = 0,
  PROCEED = 1,
  HOLD = 2,
  ROLLBACK = 3,
  NO_UPDATE = 4,
}

export interface AppResponse {
  product_id: string
  decision: DeployDecision
  target_version?: string
}

export interface PolicyBatchResponse {
  app_responses: AppResponse[]
}

export interface EvaluationBatchRequest {
  agent_id: string
  cluster_name: string
  health: number
  apps: Array<{ product_id: string; current_version: string }>
  timestamp_utc: string
}

export interface OrionHubClient {
  evaluatePolicy(req: EvaluationBatchRequest): Promise<PolicyBatchResponse>
}

export interface OrionExecutorOpts {
  client: OrionHubClient
  agentId?: string
  clusterName?: string
}

export function createOrionExecutor(opts: OrionExecutorOpts) {
  const { client, agentId = "daemon-kernel", clusterName = "default" } = opts

  return async (apps?: Array<{ product_id: string; current_version: string }>): Promise<ExecutionResult> => {
    try {
      const response = await client.evaluatePolicy({
        agent_id: agentId,
        cluster_name: clusterName,
        health: 100,
        apps: apps ?? [],
        timestamp_utc: new Date().toISOString(),
      })

      // Check decisions: PROCEED or NO_UPDATE = success; HOLD or ROLLBACK = failure
      let hasBlockingDecision = false

      for (const appResp of response.app_responses) {
        if (appResp.decision === DeployDecision.HOLD || appResp.decision === DeployDecision.ROLLBACK) {
          hasBlockingDecision = true
          break
        }
      }

      if (hasBlockingDecision) {
        return {
          status: "FAILURE",
          summary: "Orion policy evaluation: one or more apps blocked",
        }
      }

      return {
        status: "SUCCESS",
        summary: "Orion policy evaluation approved",
      }
    } catch (e) {
      return {
        status: "FAILURE",
        summary: `Orion evaluation failed: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  }
}
