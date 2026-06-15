import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./shodan.txt"
import {
  ShodanClient,
  ShodanExploitsClient,
  auditLog,
  buildAuditEntry,
} from "@opencode/shodan"

const operations = [
  "host_info",
  "host_search",
  "host_count",
  "dns_resolve",
  "dns_reverse",
  "honeypot_score",
  "exploits_search",
  "api_info",
  "ports",
] as const

export const Parameters = Schema.Struct({
  operation: Schema.Literals(operations).annotate({ description: "The Shodan operation to perform" }),
  ip: Schema.optional(Schema.String).annotate({ description: "IPv4 address for host_info or honeypot_score" }),
  query: Schema.optional(Schema.String).annotate({ description: "Search query for host_search or exploits_search" }),
  page: Schema.optional(Schema.Number).annotate({ description: "Page number for paginated results" }),
  facets: Schema.optional(Schema.String).annotate({ description: "Comma-separated facets for host_search" }),
  hostnames: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Hostnames for dns_resolve",
  }),
  ips: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "IP addresses for dns_reverse" }),
  port: Schema.optional(Schema.Number).annotate({ description: "Port filter for exploits_search" }),
  type: Schema.optional(
    Schema.Literals(["dos", "local", "papers", "remote", "shellcode", "webapps"]),
  ).annotate({ description: "Exploit type filter for exploits_search" }),
  osvdb: Schema.optional(Schema.String).annotate({ description: "OSVDB id filter for exploits_search" }),
  cve: Schema.optional(Schema.String).annotate({ description: "CVE id filter for exploits_search" }),
})

type ShodanArgs = Schema.Schema.Type<typeof Parameters>

function permissionPatterns(params: ShodanArgs): string[] {
  if (params.operation === "host_info" || params.operation === "honeypot_score") {
    if (params.ip) return [params.ip]
  }
  if (params.query) return [params.query]
  return ["*"]
}

function permissionMetadata(params: ShodanArgs): Record<string, unknown> {
  return {
    operation: params.operation,
    ip: params.ip,
    query: params.query,
  }
}

function requireString(value: string | undefined, label: string): Effect.Effect<string> {
  if (!value) return Effect.die(new Error(`${label} is required for this operation`))
  return Effect.succeed(value)
}

function exploitsFilter(params: ShodanArgs): Effect.Effect<void> {
  if (params.query || params.port !== undefined || params.type || params.osvdb || params.cve) {
    return Effect.void
  }
  return Effect.die(
    new Error("exploits_search requires at least one of: query, port, type, osvdb, or cve"),
  )
}

export const ShodanTool = Tool.define(
  "shodan",
  Effect.gen(function* () {
    const apiKey = process.env.SHODAN_API_KEY
    const client = apiKey ? new ShodanClient({ apiKey }) : undefined
    const exploitsClient = apiKey ? new ShodanExploitsClient({ apiKey }) : undefined

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: ShodanArgs, ctx: Tool.Context): Effect.Effect<Tool.ExecuteResult> =>
        Effect.gen(function* () {
          if (!client || !exploitsClient) {
            return yield* Effect.die(new Error("SHODAN_API_KEY environment variable is not set"))
          }

          yield* ctx.ask({
            permission: "shodan",
            patterns: permissionPatterns(params),
            always: ["*"],
            metadata: permissionMetadata(params),
          })

          const approved = true

          if (params.operation === "host_info") {
            const ip = yield* requireString(params.ip, "ip")
            const result = yield* Effect.tryPromise(() => client.host(ip))
            yield* auditLog(
              buildAuditEntry({ operation: "host_info", ip, approved, result_count: 1 }),
            ).pipe(Effect.catch(() => Effect.void))
            return {
              title: `shodan host_info ${ip}`,
              metadata: { operation: "host_info", ip },
              output: JSON.stringify(result, null, 2),
            }
          }

          if (params.operation === "host_search") {
            const query = yield* requireString(params.query, "query")
            const result = yield* Effect.tryPromise(() =>
              client.hostSearch(query, { page: params.page, facets: params.facets }),
            )
            yield* auditLog(
              buildAuditEntry({
                operation: "host_search",
                query,
                approved,
                result_count: result.total,
              }),
            ).pipe(Effect.catch(() => Effect.void))
            return {
              title: `shodan host_search`,
              metadata: { operation: "host_search", query },
              output: JSON.stringify(result, null, 2),
            }
          }

          if (params.operation === "host_count") {
            const query = yield* requireString(params.query, "query")
            const result = yield* Effect.tryPromise(() => client.hostCount(query))
            yield* auditLog(
              buildAuditEntry({ operation: "host_count", query, approved, result_count: result.total }),
            ).pipe(Effect.catch(() => Effect.void))
            return {
              title: `shodan host_count`,
              metadata: { operation: "host_count", query },
              output: JSON.stringify(result, null, 2),
            }
          }

          if (params.operation === "dns_resolve") {
            const hostnames = params.hostnames
            if (!hostnames?.length) return yield* Effect.die(new Error("hostnames is required for dns_resolve"))
            const result = yield* Effect.tryPromise(() => client.resolve(...hostnames))
            yield* auditLog(
              buildAuditEntry({
                operation: "dns_resolve",
                query: hostnames.join(","),
                approved,
                result_count: Object.keys(result).length,
              }),
            ).pipe(Effect.catch(() => Effect.void))
            return {
              title: `shodan dns_resolve`,
              metadata: { operation: "dns_resolve" },
              output: JSON.stringify(result, null, 2),
            }
          }

          if (params.operation === "dns_reverse") {
            const ips = params.ips
            if (!ips?.length) return yield* Effect.die(new Error("ips is required for dns_reverse"))
            const result = yield* Effect.tryPromise(() => client.reverseLookup(...ips))
            yield* auditLog(
              buildAuditEntry({
                operation: "dns_reverse",
                query: ips.join(","),
                approved,
                result_count: Object.keys(result).length,
              }),
            ).pipe(Effect.catch(() => Effect.void))
            return {
              title: `shodan dns_reverse`,
              metadata: { operation: "dns_reverse" },
              output: JSON.stringify(result, null, 2),
            }
          }

          if (params.operation === "honeypot_score") {
            const ip = yield* requireString(params.ip, "ip")
            const result = yield* Effect.tryPromise(() => client.honeypotScore(ip))
            yield* auditLog(
              buildAuditEntry({ operation: "honeypot_score", ip, approved, result_count: 1 }),
            ).pipe(Effect.catch(() => Effect.void))
            return {
              title: `shodan honeypot_score ${ip}`,
              metadata: { operation: "honeypot_score", ip },
              output: JSON.stringify({ score: result }, null, 2),
            }
          }

          if (params.operation === "exploits_search") {
            yield* exploitsFilter(params)
            const searchArg = params.query
              ? params.query
              : {
                  port: params.port,
                  type: params.type,
                  osvdb: params.osvdb,
                  cve: params.cve,
                }
            const result = yield* Effect.tryPromise(() =>
              exploitsClient.search(searchArg, { page: params.page }),
            )
            yield* auditLog(
              buildAuditEntry({
                operation: "exploits_search",
                query: params.query,
                approved,
                result_count: result.total,
              }),
            ).pipe(Effect.catch(() => Effect.void))
            return {
              title: `shodan exploits_search`,
              metadata: { operation: "exploits_search", query: params.query },
              output: JSON.stringify(result, null, 2),
            }
          }

          if (params.operation === "api_info") {
            const result = yield* Effect.tryPromise(() => client.info())
            yield* auditLog(
              buildAuditEntry({ operation: "api_info", approved, result_count: 1 }),
            ).pipe(Effect.catch(() => Effect.void))
            return {
              title: `shodan api_info`,
              metadata: { operation: "api_info" },
              output: JSON.stringify(result, null, 2),
            }
          }

          if (params.operation === "ports") {
            const result = yield* Effect.tryPromise(() => client.ports())
            yield* auditLog(
              buildAuditEntry({ operation: "ports", approved, result_count: result.length }),
            ).pipe(Effect.catch(() => Effect.void))
            return {
              title: `shodan ports`,
              metadata: { operation: "ports" },
              output: JSON.stringify(result, null, 2),
            }
          }

          return yield* Effect.die(new Error(`Unknown operation: ${params.operation}`))
        }).pipe(Effect.orDie),
    }
  }),
)
