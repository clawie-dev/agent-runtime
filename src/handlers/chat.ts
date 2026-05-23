import type { Handler, HandlerResult } from './index.ts'
import { priceFor, costUsdCents } from '../pricing.ts'

/**
 * Phase 3 `chat` handler. Calls the provider API directly from inside
 * the container; the clawie spawner is responsible for granting network
 * access and injecting credentials via env. Phase 5 (Outcall) will
 * replace the direct egress with a sidecar.
 *
 * Payload shape:
 *   { provider: "anthropic" | "openai", model: string,
 *     messages: [{role, content}], max_tokens?: number }
 *
 * Output shape:
 *   { completion: string, provider, model,
 *     usage: { input_tokens, output_tokens },
 *     cost: { usd_cents } | null,
 *     cost_unknown?: true }
 */

type Role = 'system' | 'user' | 'assistant'

interface Message {
  role: Role
  content: string
}

interface ChatPayload {
  provider: 'anthropic' | 'openai'
  model: string
  messages: Message[]
  max_tokens?: number
}

interface NormalizedResponse {
  completion: string
  inputTokens: number
  outputTokens: number
}

type FetchFn = typeof fetch

const DEFAULT_MAX_TOKENS = 1024

export function makeChatHandler(fetchImpl: FetchFn = globalThis.fetch): Handler {
  return async ({ payload }): Promise<HandlerResult> => {
    const parsed = parsePayload(payload)
    if (!parsed.ok) return parsed.failure

    // Phase 5: when OUTCALL_URL is set, route through the sidecar.
    // The sidecar injects credentials; we send no auth header at all
    // and use mount paths instead of provider hostnames.
    //
    // When OUTCALL_URL is unset (Phase 3 legacy path), we read API
    // keys from env and call providers directly. This branch will be
    // removed once Outcall is required everywhere.
    const outcallUrl = readOutcallUrl()
    const credential = outcallUrl ? null : readCredential(parsed.value.provider)
    if (!outcallUrl && !credential) {
      return {
        ok: false,
        cause: 'missing_credential',
        detail: `no API key in env for provider "${parsed.value.provider}" (and OUTCALL_URL unset)`,
      }
    }

    let response: NormalizedResponse
    try {
      response =
        parsed.value.provider === 'anthropic'
          ? await callAnthropic(fetchImpl, credential, parsed.value, outcallUrl)
          : await callOpenAI(fetchImpl, credential, parsed.value, outcallUrl)
    } catch (err) {
      return {
        ok: false,
        cause: 'provider_error',
        detail: err instanceof Error ? err.message : String(err),
      }
    }

    const pricing = priceFor(parsed.value.model)
    const cost = pricing
      ? { usd_cents: costUsdCents(pricing, response.inputTokens, response.outputTokens) }
      : null

    return {
      ok: true,
      output: {
        completion: response.completion,
        provider: parsed.value.provider,
        model: parsed.value.model,
        usage: {
          input_tokens: response.inputTokens,
          output_tokens: response.outputTokens,
        },
        cost,
        ...(pricing ? {} : { cost_unknown: true as const }),
      },
    }
  }
}

export const chatHandler: Handler = (ctx) => makeChatHandler()(ctx)

function parsePayload(
  raw: unknown
):
  | { ok: true; value: ChatPayload }
  | { ok: false; failure: { ok: false; cause: string; detail: string } } {
  if (typeof raw !== 'object' || raw === null) {
    return fail('invalid_payload', 'payload must be an object')
  }
  const p = raw as Record<string, unknown>
  if (p.provider !== 'anthropic' && p.provider !== 'openai') {
    return fail('invalid_payload', `provider must be "anthropic" or "openai"`)
  }
  if (typeof p.model !== 'string' || p.model.length === 0) {
    return fail('invalid_payload', 'model must be a non-empty string')
  }
  if (!Array.isArray(p.messages) || p.messages.length === 0) {
    return fail('invalid_payload', 'messages must be a non-empty array')
  }
  for (const m of p.messages) {
    if (
      typeof m !== 'object' ||
      m === null ||
      typeof (m as Message).content !== 'string' ||
      !['system', 'user', 'assistant'].includes((m as Message).role)
    ) {
      return fail('invalid_payload', 'each message needs {role, content:string}')
    }
  }
  const maxTokens = p.max_tokens
  if (
    maxTokens !== undefined &&
    (typeof maxTokens !== 'number' || maxTokens <= 0 || !Number.isInteger(maxTokens))
  ) {
    return fail('invalid_payload', 'max_tokens must be a positive integer')
  }
  return {
    ok: true,
    value: {
      provider: p.provider,
      model: p.model,
      messages: p.messages as Message[],
      max_tokens: maxTokens as number | undefined,
    },
  }
}

function fail(cause: string, detail: string) {
  return { ok: false as const, failure: { ok: false as const, cause, detail } }
}

function readCredential(provider: 'anthropic' | 'openai'): string | null {
  const key = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'
  const value = process.env[key]
  return value && value.length > 0 ? value : null
}

function readOutcallUrl(): string | null {
  const v = process.env.OUTCALL_URL
  return v && v.length > 0 ? v.replace(/\/$/, '') : null
}

async function callAnthropic(
  fetchImpl: FetchFn,
  apiKey: string | null,
  payload: ChatPayload,
  outcallUrl: string | null
): Promise<NormalizedResponse> {
  const system = payload.messages.find((m) => m.role === 'system')?.content
  const conversation = payload.messages.filter((m) => m.role !== 'system')
  const body: Record<string, unknown> = {
    model: payload.model,
    messages: conversation,
    max_tokens: payload.max_tokens ?? DEFAULT_MAX_TOKENS,
  }
  if (system) body.system = system

  const url = outcallUrl
    ? `${outcallUrl}/anthropic/v1/messages`
    : 'https://api.anthropic.com/v1/messages'
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (!outcallUrl) {
    // Direct mode (Phase 3 legacy). Sidecar mode lets Outcall inject these.
    headers['x-api-key'] = apiKey ?? ''
    headers['anthropic-version'] = '2023-06-01'
  }

  const res = await fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`anthropic ${res.status}: ${text.slice(0, 400)}`)
  }
  const data = JSON.parse(text) as {
    content: Array<{ type: string; text: string }>
    usage: { input_tokens: number; output_tokens: number }
  }
  const completion = data.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('')
  return {
    completion,
    inputTokens: data.usage.input_tokens,
    outputTokens: data.usage.output_tokens,
  }
}

async function callOpenAI(
  fetchImpl: FetchFn,
  apiKey: string | null,
  payload: ChatPayload,
  outcallUrl: string | null
): Promise<NormalizedResponse> {
  const body: Record<string, unknown> = {
    model: payload.model,
    messages: payload.messages,
  }
  if (payload.max_tokens !== undefined) body.max_tokens = payload.max_tokens

  const url = outcallUrl
    ? `${outcallUrl}/openai/v1/chat/completions`
    : 'https://api.openai.com/v1/chat/completions'
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (!outcallUrl) {
    headers['authorization'] = `Bearer ${apiKey ?? ''}`
  }

  const res = await fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`openai ${res.status}: ${text.slice(0, 400)}`)
  }
  const data = JSON.parse(text) as {
    choices: Array<{ message: { content: string } }>
    usage: { prompt_tokens: number; completion_tokens: number }
  }
  return {
    completion: data.choices[0]?.message?.content ?? '',
    inputTokens: data.usage.prompt_tokens,
    outputTokens: data.usage.completion_tokens,
  }
}
