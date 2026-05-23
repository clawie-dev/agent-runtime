/**
 * Clawie agent-runtime entrypoint (Phase 2).
 *
 * Reads one JSON object from stdin (terminated by EOF), runs the declared
 * intent, writes one JSON envelope to stdout.
 *
 *   stdin  : {"intent": "<name>", "payload": <any>, "task_id": "<uuid>"}
 *   stdout : {"ok": true, "output": <any>}
 *          | {"ok": false, "cause": "<code>", "detail": "<text>"}
 *
 * Exit code 0 ↔ ok=true. Non-zero ↔ ok=false (or unhandled crash).
 *
 * Phase 2 ships only the `echo` handler. Later phases extend the handler
 * registry via skills (spec 010).
 */

import { handlers, type Handler } from './handlers/index.ts'

interface TaskSpec {
  intent: string
  payload: unknown
  task_id: string
}

interface IntentResult {
  ok: true
  output: unknown
}

interface IntentFailure {
  ok: false
  cause: string
  detail?: string
}

type Envelope = IntentResult | IntentFailure

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8').trim()
}

function emit(env: Envelope): never {
  process.stdout.write(JSON.stringify(env) + '\n')
  process.exit(env.ok ? 0 : 1)
}

async function main(): Promise<void> {
  let raw: string
  try {
    raw = await readStdin()
  } catch (err) {
    emit({ ok: false, cause: 'stdin_read_failed', detail: (err as Error).message })
  }

  if (!raw) {
    emit({ ok: false, cause: 'empty_stdin', detail: 'no task spec received' })
  }

  let spec: TaskSpec
  try {
    spec = JSON.parse(raw) as TaskSpec
  } catch (err) {
    emit({ ok: false, cause: 'invalid_json', detail: (err as Error).message })
  }

  if (!spec.intent || typeof spec.intent !== 'string') {
    emit({ ok: false, cause: 'missing_intent', detail: 'spec.intent is required' })
  }

  const handler: Handler | undefined = handlers[spec.intent]
  if (!handler) {
    const registered = Object.keys(handlers).sort().join(', ') || '(none)'
    emit({
      ok: false,
      cause: 'unknown_intent',
      detail: `intent "${spec.intent}" not registered. Available: ${registered}`,
    })
  }

  try {
    const result = await handler({ payload: spec.payload, taskId: spec.task_id })
    emit(result)
  } catch (err) {
    emit({
      ok: false,
      cause: 'handler_threw',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
}

main().catch((err) => {
  // Last-resort guard. Should never reach here because main() catches.
  emit({
    ok: false,
    cause: 'unhandled',
    detail: err instanceof Error ? err.message : String(err),
  })
})
