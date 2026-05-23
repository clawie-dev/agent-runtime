# Clawie agent-runtime — Phase 2 base image
#
# Minimal Node 24 runtime. The entrypoint reads a task spec from stdin (one
# JSON object terminated by EOF) and writes a result envelope to stdout
# (one JSON object). No LLM client. No Outcall. No network access by default
# at the Docker level — Clawie's spawner is responsible for network config.
#
# Image size goal: < 100 MB compressed.

FROM node:24-alpine AS base

# Non-root user (spec 002-FR Security constraint 1)
RUN addgroup -g 1000 agent && adduser -D -u 1000 -G agent agent

WORKDIR /agent

# Production deps only — entrypoint runs on Node's built-in TS strip support,
# so we keep the package surface tiny. No dependencies in Phase 2.
COPY package.json ./
COPY src ./src

USER agent

# Phase 2 contract:
#   stdin  : one JSON object {intent, payload, task_id}
#   stdout : one JSON object {ok: bool, output?: any, cause?: str, detail?: str}
#   exit 0 : ok=true
#   exit 1 : ok=false (or unhandled error)
#
# Wall-clock timeout is enforced by the spawner via `docker run --stop-timeout`.
ENTRYPOINT ["node", "--experimental-strip-types", "src/entrypoint.ts"]
