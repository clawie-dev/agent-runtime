/**
 * Subprocess-level tests for the agent-runtime entrypoint.
 *
 * Uses Node's built-in `node --test` runner (no extra deps). Each case
 * spawns the entrypoint, pipes a stdin JSON spec, and asserts the stdout
 * envelope shape + exit code.
 *
 * Run: `node --experimental-strip-types --test tests/entrypoint.test.ts`
 */

import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ENTRY = join(__dirname, '..', 'src', 'entrypoint.ts')

interface RunResult {
  stdout: string
  stderr: string
  code: number | null
}

function runEntrypoint(stdin: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const proc = spawn(
      process.execPath,
      ['--experimental-strip-types', ENTRY],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (b) => (stdout += b.toString()))
    proc.stderr.on('data', (b) => (stderr += b.toString()))
    proc.on('close', (code) => resolve({ stdout, stderr, code }))
    proc.stdin.write(stdin)
    proc.stdin.end()
  })
}

function parseEnvelope(stdout: string): unknown {
  const last = stdout.trim().split('\n').pop() ?? ''
  return JSON.parse(last)
}

test('echo with string payload returns ok envelope, exit 0', async () => {
  const r = await runEntrypoint(
    JSON.stringify({ intent: 'echo', payload: 'world', task_id: 't1' })
  )
  assert.equal(r.code, 0)
  assert.deepEqual(parseEnvelope(r.stdout), {
    ok: true,
    output: { message: 'hello: world' },
  })
})

test('echo with object payload stringifies', async () => {
  const r = await runEntrypoint(
    JSON.stringify({ intent: 'echo', payload: { a: 1 }, task_id: 't2' })
  )
  assert.equal(r.code, 0)
  assert.deepEqual(parseEnvelope(r.stdout), {
    ok: true,
    output: { message: 'hello: {"a":1}' },
  })
})

test('echo with __fail payload returns failure envelope, exit 1', async () => {
  const r = await runEntrypoint(
    JSON.stringify({ intent: 'echo', payload: { __fail: true }, task_id: 't3' })
  )
  assert.equal(r.code, 1)
  const env = parseEnvelope(r.stdout) as { ok: boolean; cause: string }
  assert.equal(env.ok, false)
  assert.equal(env.cause, 'intentional_failure')
})

test('unknown intent fails with cause=unknown_intent', async () => {
  const r = await runEntrypoint(
    JSON.stringify({ intent: 'nope', payload: null, task_id: 't4' })
  )
  assert.equal(r.code, 1)
  const env = parseEnvelope(r.stdout) as { ok: boolean; cause: string }
  assert.equal(env.ok, false)
  assert.equal(env.cause, 'unknown_intent')
})

test('empty stdin fails with cause=empty_stdin', async () => {
  const r = await runEntrypoint('')
  assert.equal(r.code, 1)
  const env = parseEnvelope(r.stdout) as { ok: boolean; cause: string }
  assert.equal(env.ok, false)
  assert.equal(env.cause, 'empty_stdin')
})

test('invalid JSON fails with cause=invalid_json', async () => {
  const r = await runEntrypoint('this is not json')
  assert.equal(r.code, 1)
  const env = parseEnvelope(r.stdout) as { ok: boolean; cause: string }
  assert.equal(env.ok, false)
  assert.equal(env.cause, 'invalid_json')
})

test('missing intent fails with cause=missing_intent', async () => {
  const r = await runEntrypoint(JSON.stringify({ payload: 'x', task_id: 't5' }))
  assert.equal(r.code, 1)
  const env = parseEnvelope(r.stdout) as { ok: boolean; cause: string }
  assert.equal(env.ok, false)
  assert.equal(env.cause, 'missing_intent')
})
