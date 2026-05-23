# agent-runtime — Phase 2 design (placeholder)

Phase 2 of Clawie (target v0.2.0) replaces the in-process intent executor
with a Docker container per task. This repo will then ship the base image.

## Planned layout

```
agent-runtime/
├── Dockerfile               # base image
├── overlays/                # per-language variants (node, python, php)
├── src/
│   ├── loop/                # agent loop driver
│   ├── liveness/            # heartbeat + checkpoint emitter
│   ├── router/              # model router client (Phase 3)
│   ├── policy/              # local policy enforcement stub (Phase 4)
│   └── skills/              # lazy loader (Phase 7)
├── scripts/                 # build, sign, publish
└── tests/
```

## Goals

- < 500 MB compressed image
- non-root by default (UID > 1000)
- no Docker socket access
- default-deny capabilities
- liveness ping built in (per spec 020)
- reproducible: pinned base, locked deps, signed releases

See [spec 002](https://github.com/clawie-dev/specs/tree/main/speckit/002-container-runtime-outcall)
for the full contract.

Phase 2 work begins after v0.1.x stabilizes.
