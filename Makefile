# Clawie agent-runtime — local-only build + test
#
# Phase 2 keeps the image local. v0.5.x adds a publish target to GHCR.

IMAGE ?= clawie/agent-runtime
TAG   ?= dev

.PHONY: help build test clean smoke

help:
	@echo "Targets:"
	@echo "  make build       — build local image $(IMAGE):$(TAG)"
	@echo "  make test        — run entrypoint tests (no Docker)"
	@echo "  make smoke       — build then run a sample echo via the image"
	@echo "  make clean       — remove local image"

build:
	docker build -t $(IMAGE):$(TAG) .

test:
	node --experimental-strip-types --test tests/*.test.ts

smoke: build
	@echo '{"intent":"echo","payload":"smoke","task_id":"smoke-1"}' | \
	docker run --rm -i $(IMAGE):$(TAG)

clean:
	-docker image rm $(IMAGE):$(TAG)
