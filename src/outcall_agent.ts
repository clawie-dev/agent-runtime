/**
 * Outcall agent-shim client (Phase 7a).
 *
 * Inside an agent container running under Outcall, `/run/outcall/agent.sock`
 * is mounted by Clawie's `OutcallEgressProvider` (when `mountAgentSocket` is
 * set). Tool handlers that want to honor host policy on filesystem writes,
 * shell execs, or arbitrary tool invocations call `permissionsCheck()` here
 * before performing the action. The shim returns `allowed: true|false` plus
 * an optional matched-rule id and reason.
 *
 * Identity is kernel-derived (the daemon reads `SO_PEERCRED` on the unix
 * socket) — the agent cannot impersonate another agent. The shim runs *as
 * part of* the agent container in spirit, but the daemon enforcing decisions
 * lives on the host.
 *
 * When the socket isn't mounted (CLAWIE_EGRESS=null) the check transparently
 * resolves to `{allowed: true}` so handlers can call it unconditionally.
 *
 * Spec mirror: `Outcall-dev/outcall/application/outcall-api/src/lib.rs`
 * (PermissionRequest, Verdict, ActionType).
 */

import http from 'node:http'
import { existsSync } from 'node:fs'

export type ActionType = 'tool_exec' | 'network_call' | 'file_access' | 'shell_exec'

export interface PermissionRequest {
  action_type: ActionType
  target: string
  metadata?: Record<string, string>
}

export interface Verdict {
  allowed: boolean
  matched_rule?: string | null
  reason?: string | null
}

interface ApiEnvelope<T> {
  success: boolean
  data?: T
  error?: string
}

const DEFAULT_SOCKET = '/run/outcall/agent.sock'
const DEFAULT_TIMEOUT_MS = 3_000

type FetchFn = (
  socketPath: string,
  path: string,
  init: { method: 'POST'; body: string; timeoutMs: number }
) => Promise<{ status: number; body: string }>

const defaultUnixFetch: FetchFn = (socketPath, path, init) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        path,
        method: init.method,
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(init.body)),
        },
        timeout: init.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        )
        res.on('error', reject)
      }
    )
    req.on('timeout', () => {
      req.destroy(new Error(`unix-socket request to ${socketPath}${path} timed out after ${init.timeoutMs}ms`))
    })
    req.on('error', reject)
    req.write(init.body)
    req.end()
  })

export class OutcallAgent {
  private readonly socketPath: string
  private readonly fetchImpl: FetchFn

  constructor(socketPath: string = DEFAULT_SOCKET, fetchImpl: FetchFn = defaultUnixFetch) {
    this.socketPath = socketPath
    this.fetchImpl = fetchImpl
  }

  /**
   * `available()` is `true` when the socket exists on disk (i.e. the
   * container was launched with `--volume /run/outcall/agent.sock:...`).
   * Handlers can early-out when false to keep their fallback path
   * unchanged from a non-Outcall deployment.
   */
  available(): boolean {
    return existsSync(this.socketPath)
  }

  async permissionsCheck(req: PermissionRequest): Promise<Verdict> {
    if (!this.available()) {
      // No shim mounted = no Outcall in the picture. Default-allow.
      // The host-level Outcall daemon, when present, makes the real
      // decisions; absent that, we don't second-guess the deployment.
      return { allowed: true, reason: 'shim socket not mounted' }
    }

    const res = await this.fetchImpl(this.socketPath, '/v1/permissions/check', {
      method: 'POST',
      body: JSON.stringify(req),
      timeoutMs: DEFAULT_TIMEOUT_MS,
    })

    if (res.status !== 200) {
      throw new Error(
        `outcall-agent /v1/permissions/check HTTP ${res.status}: ${res.body.slice(0, 200)}`
      )
    }
    const env = JSON.parse(res.body) as ApiEnvelope<Verdict>
    if (!env.success || !env.data) {
      throw new Error(`outcall-agent envelope.success=false: ${env.error ?? 'no detail'}`)
    }
    return env.data
  }
}
