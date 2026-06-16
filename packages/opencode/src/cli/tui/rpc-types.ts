export type WorkerRpc = {
  fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }): Promise<{
    status: number
    headers: Record<string, string>
    body: string
  }>
  snapshot(): string
  server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }): Promise<{ url: string }>
  checkUpgrade(input: { directory: string }): Promise<void>
  reload(): Promise<void>
  shutdown(): Promise<void>
}
