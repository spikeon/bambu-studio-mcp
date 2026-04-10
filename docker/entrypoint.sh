#!/bin/bash
set -euo pipefail
ROOT="/opt/bambu/squashfs-root"
cd "$ROOT"
if [[ ! -x ./AppRun ]]; then
  echo "bambu-studio-mcp: AppRun missing under ${ROOT}" >&2
  exit 127
fi
exec xvfb-run -a --server-args="-screen 0 1280x1024x24" ./AppRun "$@"
