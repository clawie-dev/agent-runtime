# clawie/agent-runtime

Docker base image that every Clawie agent container runs on top of. A Node 24
Alpine image whose entrypoint reads one JSON task spec from stdin, dispatches
to a built-in handler, and writes a structured result envelope to stdout.

Per [spec 002](https://github.com/clawie-dev/specs/tree/main/speckit/002-container-runtime-outcall),
every agent task spawns an ephemeral container from this image plus optional
per-agent overlay. Designed to be minimal, reproducible, signed, and pinned.

**Current tag:** `v0.5.0` — base image + `echo` + `chat` (Anthropic / OpenAI),
direct egress with credentials injected by env. (The earlier sidecar fork from
v0.5.0 was walked back in v0.5.1; egress isolation now lives in the Clawie
control-plane via the `EgressProvider` interface.)

## Surface

| What | How |
|---|---|
| Image (local-only) | `make build` → `clawie/agent-runtime:dev` |
| Built-in handlers | `echo`, `chat` |
| Tests | `make test` — Node's built-in `node --test`, no deps |
| Smoke | `make smoke` — builds + runs an echo through the image |

## Stdio contract

The container reads **one JSON object from stdin** (terminated by EOF) and
writes **one JSON envelope to stdout**.

Stdin spec:

```json
{ "intent": "echo", "payload": "world", "task_id": "<uuid>" }
```

Stdout envelope:

```json
{ "ok": true,  "output": <any> }
{ "ok": false, "cause": "<code>", "detail": "<text>" }
```

Exit code mirrors `ok`: `0` for success, non-zero for failure.

### Failure causes

| Cause | When |
|---|---|
| `empty_stdin` | No input received |
| `invalid_json` | Stdin is not valid JSON |
| `missing_intent` | Spec is JSON but `.intent` is missing or non-string |
| `unknown_intent` | Intent name not in the built-in handler registry |
| `intentional_failure` | The `echo` test fixture (`{__fail: true}`) |
| `handler_threw` | A handler threw an unhandled error |
| `unhandled` | Last-resort guard (should never fire) |

## Handlers

### `echo`

```bash
make build
echo '{"intent":"echo","payload":"world","task_id":"t1"}' | \
  docker run --rm -i clawie/agent-runtime:dev
# → {"ok":true,"output":{"message":"hello: world"}}
```

### `chat`

Calls Anthropic or OpenAI directly. The Clawie spawner injects credentials
via env (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) and grants network egress;
the container itself makes no calls on its own.

Payload:

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "messages": [{"role": "user", "content": "hi"}],
  "max_tokens": 1024
}
```

Output:

```json
{
  "completion": "...",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "usage": { "input_tokens": 12, "output_tokens": 48 },
  "cost": { "usd_cents": 0.18 }
}
```

`cost: null` with `cost_unknown: true` when pricing isn't available for a model.

## Goals + constraints

- **<100 MB compressed** — `node:24-alpine` ≈ 50 MB; entrypoint adds <1 MB.
- **Non-root** — UID 1000 (`agent` user).
- **No Docker socket access** — never granted by the spawner.
- **No network by default** — Clawie's spawner configures network per-intent;
  the image itself makes no calls.
- **Reproducible** — pinned base, no transitive deps in the image core
  (handlers may pull provider SDKs at build time).

## Tagged versions

| Tag | Adds |
|---|---|
| v0.2.1 | base image + `echo` handler |
| v0.3.0 | `chat` handler (Anthropic + OpenAI), pricing + cost tracking |
| v0.4.1 | refinements + pin updates |
| v0.5.0 | current published tag; image stays local-only pending GHCR publish |

## License

MIT — see [LICENSE](LICENSE).
