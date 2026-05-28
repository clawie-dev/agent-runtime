# Clawie agent-runtime — Phase 2 base image
#
# Minimal Node 24 runtime. The entrypoint reads a task spec from stdin (one
# JSON object terminated by EOF) and writes a result envelope to stdout
# (one JSON object). The chat handler calls Anthropic/OpenAI via native
# fetch — no SDK dependencies. No Outcall. No network access by default at
# the Docker level — Clawie's spawner is responsible for network config.
#
# Image size goal: < 100 MB compressed.

FROM node:24-alpine AS base

# Non-root user (spec 002-FR Security constraint 1).
# The node:24-alpine base ships a non-root `node` user at UID/GID 1000, so
# we reuse it instead of creating a duplicate `agent` user. The clawie
# spawner pins `--user 1000:1000` against this UID.

WORKDIR /agent

# Production deps only — entrypoint runs on Node's built-in TS strip support,
# so we keep the package surface tiny. No dependencies in Phase 2.
COPY package.json ./
COPY src ./src

USER node

# Phase 2 contract:
#   stdin  : one JSON object {intent, payload, task_id}
#   stdout : one JSON object {ok: bool, output?: any, cause?: str, detail?: str}
#   exit 0 : ok=true
#   exit 1 : ok=false (or unhandled error)
#
# Wall-clock timeout is enforced by the Clawie spawner, which SIGKILLs the
# spawned `docker run` process once the per-task timeout elapses.
ENTRYPOINT ["node", "--experimental-strip-types", "src/entrypoint.ts"]
