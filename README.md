# clawie/agent-runtime

Docker base image that every Clawie agent container runs on top of. Phase 2 (v0.2.0) ships the minimum: a Node 24 alpine image whose entrypoint reads one JSON task spec from stdin, dispatches to a built-in handler, and writes a structured result envelope to stdout.

Per [spec 002](https://github.com/clawie-dev/specs/tree/main/speckit/002-container-runtime-outcall), every agent task spawns an ephemeral container from this image plus optional per-agent overlay. Designed to be minimal, reproducible, signed, and pinned.

## v0.2.0 surface

| What | How |
|---|---|
| Image (local-only for now) | `make build` → `clawie/agent-runtime:dev` |
| Built-in handlers | `echo` (returns `{message: "hello: <payload>"}`) |
| Tests | `make test` — Node's built-in `node --test`, no deps |
| Smoke | `make smoke` — builds + runs an echo through the image |

## Stdio contract

The container reads **one JSON object from stdin** (terminated by EOF) and writes **one JSON envelope to stdout**.

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

### Failure causes (Phase 2)

| Cause | When |
|---|---|
| `empty_stdin` | No input received |
| `invalid_json` | Stdin is not valid JSON |
| `missing_intent` | Spec is JSON but `.intent` is missing or non-string |
| `unknown_intent` | Intent name not in the built-in handler registry |
| `intentional_failure` | The `echo` test fixture (`{__fail: true}`) |
| `handler_threw` | A handler threw an unhandled error |
| `unhandled` | Last-resort guard (should never fire) |

## Try it locally

```bash
make build
echo '{"intent":"echo","payload":"world","task_id":"t1"}' | \
  docker run --rm -i clawie/agent-runtime:dev
# → {"ok":true,"output":{"message":"hello: world"}}
```

## Roadmap

| Phase | Adds |
|---|---|
| v0.2.0 (now) | base image + `echo` handler |
| v0.3.0 | `chat` handler with model router client (no creds — broker is Phase 5) |
| v0.5.0 | publish to GHCR; integrate with Outcall sidecar |
| v0.7.0 | skill-loaded handlers via `/skills` mount |
| later | per-language overlays (Python, PHP, Ruby) |

## Goals + constraints

- **<100 MB compressed** — node:24-alpine ≈ 50 MB; entrypoint adds <1 MB.
- **Non-root** — UID 1000 (`agent` user).
- **No Docker socket access** — never granted by the spawner.
- **No network by default** — Clawie's spawner configures network; image makes no calls on its own.
- **Reproducible** — pinned base, no transitive deps in Phase 2.

## License

MIT — see [LICENSE](LICENSE).
