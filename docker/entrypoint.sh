#!/bin/bash
set -euo pipefail
ROOT="/opt/bambu/squashfs-root"
cd "$ROOT"
if [[ ! -x ./AppRun ]]; then
  echo "bambu-studio-mcp: AppRun missing under ${ROOT}" >&2
  exit 127
fi

# Headless CI: avoid GPU drivers that can crash the slicer (segfault in GLX/EGL paths).
export LIBGL_ALWAYS_SOFTWARE="${LIBGL_ALWAYS_SOFTWARE:-1}"
export GALLIUM_DRIVER="${GALLIUM_DRIVER:-llvmpipe}"
export MESA_LOADER_DRIVER_OVERRIDE="${MESA_LOADER_DRIVER_OVERRIDE:-llvmpipe}"

exec xvfb-run -a --server-args="-screen 0 1280x1024x24" ./AppRun "$@"
