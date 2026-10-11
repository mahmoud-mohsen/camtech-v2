#!/bin/sh
# Runs at container start (the nginx image executes /docker-entrypoint.d/*.sh before nginx).
# Writes env-config.js from the container's environment so one image can be deployed anywhere:
# the app reads window.__CAMTECH_ENV__ first and falls back to its build-time VITE_* value.
set -eu

out=/usr/share/nginx/html/env-config.js

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

{
  printf 'window.__CAMTECH_ENV__ = {'
  sep=''
  for name in VITE_API_BASE_URL VITE_SDK_URL; do
    eval "val=\${$name-}"
    [ -n "$val" ] || continue
    printf '%s"%s": "%s"' "$sep" "$name" "$(json_escape "$val")"
    sep=', '
  done
  printf '};\n'
} > "$out"

echo "env-config.sh: wrote $out"
