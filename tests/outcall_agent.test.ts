import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OutcallAgent } from '../src/outcall_agent.ts'

async function startShim(reply: { status: number; body: unknown }): Promise<{
  socketPath: string
  close: () => Promise<void>
  calls: string[]
}> {
  const dir = mkdtempSync(join(tmpdir(), 'shim-'))
  const socketPath = join(dir, 'agent.sock')
  const calls: string[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c: Buffer) => (body += c.toString()))
    req.on('end', () => {
      calls.push(body)
      res.writeHead(reply.status, { 'content-type': 'application/json' })
      res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body))
    })
  })
  await new Promise<void>((resolve) => server.listen(socketPath, resolve))
  return {
    socketPath,
    calls,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

test('available() is false when the socket file does not exist', () => {
  const agent = new OutcallAgent('/tmp/clawie-agent-test-nope.sock')
  assert.equal(agent.available(), false)
})

test('permissionsCheck returns allowed=true when shim is not mounted', async () => {
  const agent = new OutcallAgent('/tmp/clawie-agent-test-nope.sock')
  const verdict = await agent.permissionsCheck({
    action_type: 'file_access',
    target: '/workspace/x.ts',
  })
  assert.equal(verdict.allowed, true)
  assert.match(verdict.reason ?? '', /not mounted/)
})

test('permissionsCheck POSTs to /v1/permissions/check and unwraps the envelope', async () => {
  const shim = await startShim({
    status: 200,
    body: { success: true, data: { allowed: true, matched_rule: 'allow-fs', reason: null } },
  })
  const agent = new OutcallAgent(shim.socketPath)
  const verdict = await agent.permissionsCheck({
    action_type: 'file_access',
    target: '/workspace/SOUL.md',
    metadata: { kind: 'self_mod' },
  })
  await shim.close()
  assert.equal(verdict.allowed, true)
  assert.equal(verdict.matched_rule, 'allow-fs')
  assert.equal(shim.calls.length, 1)
  const parsed = JSON.parse(shim.calls[0])
  assert.equal(parsed.action_type, 'file_access')
  assert.equal(parsed.target, '/workspace/SOUL.md')
  assert.equal(parsed.metadata.kind, 'self_mod')
})

test('shim returns 403 -> throws with status code', async () => {
  const shim = await startShim({ status: 403, body: { success: false, error: 'blocked' } })
  const agent = new OutcallAgent(shim.socketPath)
  await assert.rejects(
    () => agent.permissionsCheck({ action_type: 'shell_exec', target: 'rm -rf /' }),
    /HTTP 403/
  )
  await shim.close()
})

test('shim envelope success=false -> throws with error string', async () => {
  const shim = await startShim({
    status: 200,
    body: { success: false, error: 'rule engine timed out' },
  })
  const agent = new OutcallAgent(shim.socketPath)
  await assert.rejects(
    () => agent.permissionsCheck({ action_type: 'tool_exec', target: 'fetch' }),
    /rule engine timed out/
  )
  await shim.close()
})

test('verdict allowed=false flows through cleanly', async () => {
  const shim = await startShim({
    status: 200,
    body: {
      success: true,
      data: { allowed: false, matched_rule: 'deny-fs-write', reason: 'no write access' },
    },
  })
  const agent = new OutcallAgent(shim.socketPath)
  const verdict = await agent.permissionsCheck({
    action_type: 'file_access',
    target: '/etc/passwd',
  })
  await shim.close()
  assert.equal(verdict.allowed, false)
  assert.equal(verdict.matched_rule, 'deny-fs-write')
  assert.equal(verdict.reason, 'no write access')
})
