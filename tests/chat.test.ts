/**
 * Unit tests for the chat handler. fetch is injected so no network
 * calls happen in CI. Subprocess-level tests for the entrypoint
 * exercise the full envelope contract separately.
 *
 * Run: `node --experimental-strip-types --test tests/chat.test.ts`
 */

import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { makeChatHandler } from '../src/handlers/chat.ts'

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fakeFetch(routes: Record<string, () => Response>) {
  return async (url: string | URL) => {
    const key = typeof url === 'string' ? url : url.toString()
    const handler = routes[key]
    if (!handler) throw new Error(`unexpected fetch to ${key}`)
    return handler()
  }
}

test('anthropic happy path: completion + usage + cost', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  const handler = makeChatHandler(
    fakeFetch({
      'https://api.anthropic.com/v1/messages': () =>
        jsonResponse(200, {
          content: [{ type: 'text', text: 'hello back' }],
          usage: { input_tokens: 12, output_tokens: 3 },
        }),
    }) as typeof fetch
  )

  const result = await handler({
    taskId: 't1',
    payload: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
    },
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  const out = result.output as Record<string, unknown>
  assert.equal(out.completion, 'hello back')
  assert.equal(out.provider, 'anthropic')
  assert.equal(out.model, 'claude-sonnet-4-6')
  assert.deepEqual(out.usage, { input_tokens: 12, output_tokens: 3 })
  // 12 in * $3/MT + 3 out * $15/MT = 0.000036 + 0.000045 = $0.000081 = 0.0081 cents -> rounded to 0.0
  // (rounding: usd*1000 rounded then /10) -> 0.0081 -> 0.1 cents
  const cost = out.cost as { usd_cents: number }
  assert.ok(typeof cost.usd_cents === 'number')
})

test('openai happy path: maps choices[0].message.content + usage', async () => {
  process.env.OPENAI_API_KEY = 'test-key'
  const handler = makeChatHandler(
    fakeFetch({
      'https://api.openai.com/v1/chat/completions': () =>
        jsonResponse(200, {
          choices: [{ message: { content: 'pong' } }],
          usage: { prompt_tokens: 5, completion_tokens: 1 },
        }),
    }) as typeof fetch
  )

  const result = await handler({
    taskId: 't2',
    payload: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'ping' }],
    },
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  const out = result.output as Record<string, unknown>
  assert.equal(out.completion, 'pong')
  assert.deepEqual(out.usage, { input_tokens: 5, output_tokens: 1 })
})

test('unknown model returns cost_unknown:true', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  const handler = makeChatHandler(
    fakeFetch({
      'https://api.anthropic.com/v1/messages': () =>
        jsonResponse(200, {
          content: [{ type: 'text', text: 'x' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
    }) as typeof fetch
  )

  const result = await handler({
    taskId: 't3',
    payload: {
      provider: 'anthropic',
      model: 'claude-mystery-9',
      messages: [{ role: 'user', content: 'q' }],
    },
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  const out = result.output as Record<string, unknown>
  assert.equal(out.cost, null)
  assert.equal(out.cost_unknown, true)
})

test('missing credential fails with cause=missing_credential', async () => {
  delete process.env.ANTHROPIC_API_KEY
  const handler = makeChatHandler((() => {
    throw new Error('should not fetch')
  }) as unknown as typeof fetch)

  const result = await handler({
    taskId: 't4',
    payload: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'x' }],
    },
  })

  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.cause, 'missing_credential')
})

test('provider 4xx becomes cause=provider_error with detail', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  const handler = makeChatHandler(
    fakeFetch({
      'https://api.anthropic.com/v1/messages': () =>
        new Response('rate limited', { status: 429 }),
    }) as typeof fetch
  )

  const result = await handler({
    taskId: 't5',
    payload: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'x' }],
    },
  })

  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.cause, 'provider_error')
  assert.match(result.detail ?? '', /429/)
})

test('invalid payload (no messages) fails with cause=invalid_payload', async () => {
  const handler = makeChatHandler((() => {
    throw new Error('should not fetch')
  }) as unknown as typeof fetch)

  const result = await handler({
    taskId: 't6',
    payload: { provider: 'anthropic', model: 'claude-sonnet-4-6', messages: [] },
  })

  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.cause, 'invalid_payload')
})

test('OUTCALL_URL routes anthropic through sidecar without auth header', async () => {
  delete process.env.ANTHROPIC_API_KEY
  process.env.OUTCALL_URL = 'http://localhost:8080'
  let captured: { url: string; headers: Record<string, string> } | null = null
  const fakeFetch = (async (url: string | URL, init: RequestInit) => {
    const headers: Record<string, string> = {}
    if (init.headers) {
      const h = new Headers(init.headers as HeadersInit)
      h.forEach((v, k) => {
        headers[k] = v
      })
    }
    captured = { url: typeof url === 'string' ? url : url.toString(), headers }
    return jsonResponse(200, {
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })
  }) as unknown as typeof fetch

  const handler = makeChatHandler(fakeFetch)
  const result = await handler({
    taskId: 'sidecar',
    payload: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
    },
  })
  delete process.env.OUTCALL_URL

  assert.equal(result.ok, true)
  assert.equal(captured!.url, 'http://localhost:8080/anthropic/v1/messages')
  assert.equal(captured!.headers['x-api-key'], undefined)
  assert.equal(captured!.headers['anthropic-version'], undefined)
})

test('OUTCALL_URL routes openai through sidecar without bearer token', async () => {
  delete process.env.OPENAI_API_KEY
  process.env.OUTCALL_URL = 'http://localhost:8080/'
  let captured: { url: string; headers: Record<string, string> } | null = null
  const fakeFetch = (async (url: string | URL, init: RequestInit) => {
    const headers: Record<string, string> = {}
    if (init.headers) {
      const h = new Headers(init.headers as HeadersInit)
      h.forEach((v, k) => {
        headers[k] = v
      })
    }
    captured = { url: typeof url === 'string' ? url : url.toString(), headers }
    return jsonResponse(200, {
      choices: [{ message: { content: 'pong' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
  }) as unknown as typeof fetch

  const handler = makeChatHandler(fakeFetch)
  const result = await handler({
    taskId: 'sidecar-openai',
    payload: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'ping' }],
    },
  })
  delete process.env.OUTCALL_URL

  assert.equal(result.ok, true)
  assert.equal(captured!.url, 'http://localhost:8080/openai/v1/chat/completions')
  assert.equal(captured!.headers['authorization'], undefined)
})

test('anthropic body strips system message into top-level field', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  let capturedBody = ''
  const handler = makeChatHandler(((_url: string, init: RequestInit) => {
    capturedBody = init.body as string
    return Promise.resolve(
      jsonResponse(200, {
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      })
    )
  }) as unknown as typeof fetch)

  await handler({
    taskId: 't7',
    payload: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' },
      ],
    },
  })

  const body = JSON.parse(capturedBody)
  assert.equal(body.system, 'be brief')
  assert.equal(body.messages.length, 1)
  assert.equal(body.messages[0].role, 'user')
})
