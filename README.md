# clawie/agent-runtime

Docker base image that every Clawie agent container runs on top of.

Per [spec 002](https://github.com/clawie-dev/specs/tree/main/speckit/002-container-runtime-outcall), every agent task spawns an ephemeral container from this image plus optional per-agent overlay. Designed to be minimal, reproducible, signed, and pinned.

## Goals

- **Small** — < 500 MB compressed (NFR-002).
- **Non-root by default** — UID > 1000.
- **No Docker socket access.** No host network. Default-deny capabilities.
- **Liveness-ping built in** — emits heartbeats to the control plane per spec 020.
- **Lazy skill loader** — `/skills` mount populated on demand.
- **Model router client** — talks to the credential broker, never to providers directly.
- **Reproducible** — pinned base image, locked deps, signed releases.

## Layout (planned)

```
agent-runtime/
├── Dockerfile               # base image
├── overlays/               # per-language overlay variants (node, python, php, etc.)
├── src/
│   ├── loop/               # agent loop driver
│   ├── liveness/           # heartbeat + checkpoint emitter
│   ├── router/             # model router client
│   ├── policy/             # local policy enforcement stub
│   └── skills/             # lazy loader
├── scripts/                # build, sign, publish
└── tests/
```

## Release versions

Images published as:

```
clawie/agent-runtime:v0.1.0
clawie/agent-runtime:v0.1.0-node22
clawie/agent-runtime:v0.1.0-python3.12
clawie/agent-runtime:v0.1.0-php8.3
```

## Status

Bootstrap pending. Tracked in [`clawie-dev/specs/speckit/002-container-runtime-outcall`](https://github.com/clawie-dev/specs/tree/main/speckit/002-container-runtime-outcall).

## License

MIT — see [LICENSE](LICENSE).
