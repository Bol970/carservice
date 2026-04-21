#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)

if [ -z "${D1_DATABASE_ID:-}" ]; then
  if [ -f "$ROOT_DIR/.env.docker" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$ROOT_DIR/.env.docker"
    set +a
  elif [ -f "$ROOT_DIR/.dev.vars" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$ROOT_DIR/.dev.vars"
    set +a
  fi
fi

if [ -z "${D1_DATABASE_ID:-}" ]; then
  echo "D1_DATABASE_ID is not set. Add it to .env.docker or export it before running this script." >&2
  exit 1
fi

sed "s/__D1_DATABASE_ID__/${D1_DATABASE_ID}/g" \
  "$ROOT_DIR/wrangler.toml.template" > "$ROOT_DIR/wrangler.toml"

sed "s/__D1_DATABASE_ID__/${D1_DATABASE_ID}/g" \
  "$ROOT_DIR/cloudflare-upload-metadata.template.json" > "$ROOT_DIR/cloudflare-upload-metadata.json"

echo "Generated wrangler.toml and cloudflare-upload-metadata.json from templates."
