import type { Handler } from './index.ts'

/**
 * Echo: same semantics as the Phase 1 in-process intent (intentionally —
 * Phase 2 proves the *path* through a container, not new functionality).
 *
 * Returns `{message: "hello: <payload-as-string>"}`.
 * Fails deterministically when payload is `{__fail: true}` (test fixture).
 */
export const echoHandler: Handler = async ({ payload }) => {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as Record<string, unknown>).__fail === true
  ) {
    return {
      ok: false,
      cause: 'intentional_failure',
      detail: 'payload requested failure',
    }
  }

  let asString: string
  if (payload === null || payload === undefined) {
    asString = ''
  } else if (typeof payload === 'string') {
    asString = payload
  } else {
    asString = JSON.stringify(payload)
  }

  return { ok: true, output: { message: `hello: ${asString}` } }
}
