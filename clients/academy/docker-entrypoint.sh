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
  # Build-time rewrites append /api to the placeholder (next.config strips a
  # trailing /api that the placeholder doesn't have), so "placeholder/api/..."
  # must collapse into $API when $API itself already ends in /api — otherwise
  # every proxied route becomes /api/api/... and the backend 404s them.
  if [ "${API%/api}" != "$API" ]; then
    SED_EXPR="s|https://runtime-api-url-placeholder/api|$API|g; s|https://runtime-api-url-placeholder|$API|g"
  else
    SED_EXPR="s|https://runtime-api-url-placeholder|$API|g"
  fi
  grep -rl 'https://runtime-api-url-placeholder' .next server.js 2>/dev/null | while IFS= read -r f; do
    sed -i "$SED_EXPR" "$f"
  done
fi
exec "$@"
