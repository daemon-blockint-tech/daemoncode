/**
 * Process execution interface and default Bun implementation.
 *
 * Provides a mockable abstraction for spawning external processes with:
 * - allowlisted binary validation
 * - path normalization (reject `..` and out-of-root)
 * - timeout enforcement with automatic kill
 * - captured stdout/stderr with size cap
 */

export interface ProcessResult {
  exitCode: number
  stdout: string
  stderr: string
  killed: boolean
}

export interface ProcessRunner {
  run(args: {
    bin: string
    args: string[]
    cwd?: string
    timeout?: number
    maxOutputSize?: number
  }): Promise<ProcessResult>
}

/**
 * Default Bun-based process runner with safety guards:
 * - Only allowed binaries in allowedBinaries set
 * - Paths normalized; rejects `..` and out-of-root paths
 * - Kill after timeout
 * - Cap stdout/stderr to maxOutputSize (default 10MB)
 */
export function createBunProcessRunner(opts: {
  allowedBinaries: Set<string>
  allowedRoot?: string
}): ProcessRunner {
  const { allowedBinaries, allowedRoot = process.cwd() } = opts

  function normalizePath(p: string): string {
    // Prevent directory traversal
    if (p.includes("..") || p.startsWith("/")) {
      throw new Error(`Path traversal detected: ${p}`)
    }
    return p
  }

  return {
    async run({ bin, args, cwd = ".", timeout = 30000, maxOutputSize = 10 * 1024 * 1024 }) {
      // Validate binary
      if (!allowedBinaries.has(bin)) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `Binary not allowed: ${bin}`,
          killed: false,
        }
      }

      // Normalize working directory
      try {
        normalizePath(cwd)
      } catch (e) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `${e instanceof Error ? e.message : String(e)}`,
          killed: false,
        }
      }

      try {
        const proc = Bun.spawn([bin, ...args], {
          cwd,
          stdout: "pipe",
          stderr: "pipe",
        })

        let killed = false
        const timeoutId = setTimeout(() => {
          killed = true
          proc.kill()
        }, timeout)

        const exitCode = await proc.exited
        const stdout = (await proc.stdout.text()).slice(0, maxOutputSize)
        const stderr = (await proc.stderr.text()).slice(0, maxOutputSize)

        clearTimeout(timeoutId)

        return { exitCode, stdout, stderr, killed }
      } catch (e) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `Failed to spawn ${bin}: ${e instanceof Error ? e.message : String(e)}`,
          killed: false,
        }
      }
    },
  }
}
