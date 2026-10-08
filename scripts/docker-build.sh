#!/usr/bin/env bash
# Build server + webapp inside ephemeral containers (no host Go/Node required).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

GO_IMAGE="${GO_IMAGE:-golang:1.23-bookworm}"
NODE_IMAGE="${NODE_IMAGE:-node:20-bookworm}"
GOOS="${GOOS:-linux}"
GOARCH="${GOARCH:-amd64}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found. Install Docker or set PATH." >&2
  exit 1
fi

PLUGIN_VERSION="$(grep -E '"version"' plugin.json | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')"
echo "Building read-receipt ${PLUGIN_VERSION} (GOOS=${GOOS} GOARCH=${GOARCH})..."

echo "==> webapp"
docker run --rm \
  -v "${ROOT}:/src:rw" \
  -w /src/webapp \
  "${NODE_IMAGE}" \
  bash -c 'if [ -f package-lock.json ]; then npm ci; else npm install; fi && npm run build'

echo "==> server"
docker run --rm \
  -v "${ROOT}:/src:rw" \
  -w /src \
  -e GOOS="${GOOS}" \
  -e GOARCH="${GOARCH}" \
  "${GO_IMAGE}" \
  bash -c 'go mod tidy && go test ./server && make dist'

echo "Artifact: ${ROOT}/dist/com.mst.read-receipt.tar.gz"
