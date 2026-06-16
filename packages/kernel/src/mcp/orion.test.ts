import { describe, test, expect } from "bun:test"
import { createOrionExecutor, DeployDecision, type OrionHubClient } from "./orion"

describe("OrionExecutor", () => {
  test("returns SUCCESS when all decisions are PROCEED or NO_UPDATE", async () => {
    const mockClient: OrionHubClient = {
      evaluatePolicy: async () => ({
        app_responses: [
          { product_id: "app1", decision: DeployDecision.PROCEED },
          { product_id: "app2", decision: DeployDecision.NO_UPDATE },
        ],
      }),
    }

    const executor = createOrionExecutor({ client: mockClient })
    const result = await executor()

    expect(result.status).toBe("SUCCESS")
    expect(result.summary).toContain("approved")
  })

  test("returns FAILURE when decision is HOLD", async () => {
    const mockClient: OrionHubClient = {
      evaluatePolicy: async () => ({
        app_responses: [{ product_id: "app1", decision: DeployDecision.HOLD }],
      }),
    }

    const executor = createOrionExecutor({ client: mockClient })
    const result = await executor()

    expect(result.status).toBe("FAILURE")
    expect(result.summary).toContain("blocked")
  })

  test("returns FAILURE when decision is ROLLBACK", async () => {
    const mockClient: OrionHubClient = {
      evaluatePolicy: async () => ({
        app_responses: [{ product_id: "app1", decision: DeployDecision.ROLLBACK }],
      }),
    }

    const executor = createOrionExecutor({ client: mockClient })
    const result = await executor()

    expect(result.status).toBe("FAILURE")
    expect(result.summary).toContain("blocked")
  })

  test("evaluates custom apps list", async () => {
    let capturedReq: any
    const mockClient: OrionHubClient = {
      evaluatePolicy: async (req) => {
        capturedReq = req
        return { app_responses: [] }
      },
    }

    const executor = createOrionExecutor({
      client: mockClient,
      agentId: "test-agent",
      clusterName: "test-cluster",
    })

    await executor([
      { product_id: "foo", current_version: "1.0.0" },
      { product_id: "bar", current_version: "2.0.0" },
    ])

    expect(capturedReq.agent_id).toBe("test-agent")
    expect(capturedReq.cluster_name).toBe("test-cluster")
    expect(capturedReq.apps).toHaveLength(2)
    expect(capturedReq.apps[0].product_id).toBe("foo")
  })

  test("handles client error gracefully", async () => {
    const mockClient: OrionHubClient = {
      evaluatePolicy: async () => {
        throw new Error("Connection refused")
      },
    }

    const executor = createOrionExecutor({ client: mockClient })
    const result = await executor()

    expect(result.status).toBe("FAILURE")
    expect(result.summary).toContain("Connection refused")
  })
})
