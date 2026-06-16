/**
 * MCP executor router: routes SOP tool calls to the appropriate real backend
 * executor (ARES, ouroboros, Orion), conforming to the ToolExecutor interface
 * the kernel expects.
 *
 * Graceful degradation: if a backend is not configured, the corresponding tool
 * returns FAILURE (never crashes, never silently succeeds). This preserves the
 * kernel's safety properties — an unconfigured scanner cannot satisfy the SOP.
 */

import type { ToolExecutor, ExecutionResult } from "../executor"
import type { IntentProposal } from "../types"
import { createAresExecutor, type AresExecutorOpts } from "./ares"
import { createOuroborosExecutor, type OuroborosExecutorOpts } from "./ouroboros"
import { createOrionExecutor, type OrionExecutorOpts } from "./orion"

export interface McpExecutorConfig {
  /** Maps SOP tool name → ARES options (e.g. "ares_scan_directory"). */
  ares?: { tool: string; opts: AresExecutorOpts }
  /** Maps SOP tool name → ouroboros options (e.g. "ouroboros_scan"). */
  ouroboros?: { tool: string; opts: OuroborosExecutorOpts }
  /** Maps SOP tool name → Orion options (e.g. "check_orion_policy"). */
  orion?: { tool: string; opts: OrionExecutorOpts }
}

/**
 * Build a ToolExecutor that dispatches SOP tool calls to real backends.
 * Tools not mapped to any backend degrade to FAILURE.
 */
export function createMcpExecutor(config: McpExecutorConfig): ToolExecutor {
  const routes = new Map<string, (intent: IntentProposal) => Promise<ExecutionResult>>()

  if (config.ares) {
    const aresExec = createAresExecutor(config.ares.opts)
    routes.set(config.ares.tool, async (intent) => {
      const target = (intent.typed_arguments?.path as string) ?? "."
      return aresExec(target)
    })
  }

  if (config.ouroboros) {
    const ouroborosExec = createOuroborosExecutor(config.ouroboros.opts)
    routes.set(config.ouroboros.tool, async () => ouroborosExec())
  }

  if (config.orion) {
    const orionExec = createOrionExecutor(config.orion.opts)
    routes.set(config.orion.tool, async (intent) => {
      const apps = (intent.typed_arguments?.apps as Array<{ product_id: string; current_version: string }>) ?? []
      return orionExec(apps)
    })
  }

  return {
    async execute(intent: IntentProposal): Promise<ExecutionResult> {
      const route = routes.get(intent.action_schema)
      if (!route) {
        // Graceful degradation: unconfigured backend cannot satisfy SOP.
        return {
          status: "FAILURE",
          summary: `No MCP backend configured for tool '${intent.action_schema}'`,
          networkEmitted: false,
        }
      }
      const result = await route(intent)
      // Real backends emit a network packet only on a successful, completed scan.
      return { ...result, networkEmitted: result.status === "SUCCESS" }
    },
  }
}
