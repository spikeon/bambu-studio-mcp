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

# Orient/arrange hit GLFW; without this it tries Wayland and fails under xvfb.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/bambu-xdg-runtime}"
mkdir -p "${XDG_RUNTIME_DIR}"
chmod 700 "${XDG_RUNTIME_DIR}" || true
export GDK_BACKEND="${GDK_BACKEND:-x11}"
export QT_QPA_PLATFORM="${QT_QPA_PLATFORM:-xcb}"
unset WAYLAND_DISPLAY 2>/dev/null || true

exec xvfb-run -a --server-args="-screen 0 1280x1024x24" ./AppRun "$@"
