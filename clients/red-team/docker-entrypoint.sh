#!/bin/sh
set -e
# Replace the build-time API-URL sentinel with the real per-environment URL
# (supplied at runtime via NEXT_PUBLIC_API_URL) across the compiled bundle:
# browser chunks under .next/static and standalone server chunks under .next +
# server.js. Server-side code reads the runtime env directly, so this only needs
# to fix the frozen browser bundle.
API="${NEXT_PUBLIC_API_URL:-}"
if [ -z "$API" ] || [ "$API" = "https://runtime-api-url-placeholder" ]; then
  echo "WARNING: NEXT_PUBLIC_API_URL not provided at runtime; the browser bundle will keep the placeholder and the app cannot reach the API." >&2
else
  grep -rl 'https://runtime-api-url-placeholder' .next server.js 2>/dev/null | while IFS= read -r f; do
    sed -i "s|https://runtime-api-url-placeholder|$API|g" "$f"
  done
fi
exec "$@"
