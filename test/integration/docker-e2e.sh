#!/usr/bin/env bash
# End-to-end checks against the real Bambu Studio CLI inside the Docker image.
# Requires: docker, bash, curl, coreutils. Intended for Linux CI (GitHub Actions).

set -euo pipefail

IMAGE="${BAMBU_E2E_IMAGE:-bambu-studio-mcp:latest}"
REF="${BAMBU_STUDIO_FIXTURE_REF:-v02.05.00.67}"
BASE="https://raw.githubusercontent.com/bambulab/BambuStudio/${REF}"
RUN_TIMEOUT="${BAMBU_E2E_DOCKER_TIMEOUT:-900}"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "${WORKDIR}"' EXIT
mkdir -p "${WORKDIR}/out/sub" "${WORKDIR}/out/slicedata"

echo "Using image: ${IMAGE}"
echo "Fixtures from BambuStudio ref: ${REF}"
echo "Workdir: ${WORKDIR}"

curl -fsSL -o "${WORKDIR}/flow.3mf" \
  "${BASE}/resources/calib/filament_flow/flowrate-test-pass1.3mf"

require_min_bytes() {
  local f="$1"
  local min="${2:-2000}"
  [[ -f "${f}" ]] || {
    echo "missing file: ${f}"
    exit 1
  }
  local sz
  sz="$(wc -c < "${f}" | tr -d ' ')"
  if (( sz < min )); then
    echo "file too small (${sz} < ${min}): ${f}"
    exit 1
  fi
}

require_non_empty_dir() {
  local d="$1"
  [[ -d "${d}" ]] || {
    echo "missing dir: ${d}"
    exit 1
  }
  local n
  n="$(find "${d}" -type f 2>/dev/null | wc -l | tr -d ' ')"
  if (( n < 1 )); then
    echo "expected files under ${d}, found ${n}"
    exit 1
  fi
}

run_bs() {
  local title="$1"
  shift
  echo ""
  echo "=== ${title} ==="
  if ! timeout "${RUN_TIMEOUT}" docker run --rm -v "${WORKDIR}:/work" -w /work "${IMAGE}" "$@"; then
    echo "FAILED: ${title} (exit or timeout after ${RUN_TIMEOUT}s)"
    exit 1
  fi
}

run_bs "cli --help" --debug 0 --help >/dev/null

run_bs "model --info" --debug 2 --info /work/flow.3mf | tee "${WORKDIR}/out/info.log"
if ! grep -qiE 'plate|facet|vertex|triangle|mesh|model' "${WORKDIR}/out/info.log"; then
  echo "info output did not look like model metadata"
  exit 1
fi

run_bs "slice + export-3mf (baseline)" \
  --debug 2 --slice 0 --export-3mf /work/out/baseline.3mf /work/flow.3mf
require_min_bytes "${WORKDIR}/out/baseline.3mf"

run_bs "slice + --orient" \
  --debug 2 --orient --slice 0 --export-3mf /work/out/with_orient.3mf /work/flow.3mf
require_min_bytes "${WORKDIR}/out/with_orient.3mf"

run_bs "slice + --arrange 1" \
  --debug 2 --arrange 1 --slice 0 --export-3mf /work/out/with_arrange.3mf /work/flow.3mf
require_min_bytes "${WORKDIR}/out/with_arrange.3mf"

run_bs "slice + --scale 0.92" \
  --debug 2 --scale 0.92 --slice 0 --export-3mf /work/out/with_scale.3mf /work/flow.3mf
require_min_bytes "${WORKDIR}/out/with_scale.3mf"

run_bs "slice + orient + arrange + scale" \
  --debug 2 --orient --arrange 1 --scale 0.95 --slice 0 --export-3mf /work/out/combined.3mf /work/flow.3mf
require_min_bytes "${WORKDIR}/out/combined.3mf"

run_bs "slice + --export-settings" \
  --debug 2 --slice 0 \
  --export-settings /work/out/exported_settings.json \
  --export-3mf /work/out/with_settings_export.3mf \
  /work/flow.3mf
require_min_bytes "${WORKDIR}/out/with_settings_export.3mf"
require_min_bytes "${WORKDIR}/out/exported_settings.json" 20
node -e "JSON.parse(require('fs').readFileSync('${WORKDIR}/out/exported_settings.json','utf8'))"

run_bs "slice + --export-slicedata" \
  --debug 2 --slice 0 \
  --export-slicedata /work/out/slicedata \
  --export-3mf /work/out/with_slicedata.3mf \
  /work/flow.3mf
require_min_bytes "${WORKDIR}/out/with_slicedata.3mf"
require_non_empty_dir "${WORKDIR}/out/slicedata"

run_bs "slice + --outputdir" \
  --debug 2 --slice 0 \
  --outputdir /work/out/sub \
  --export-3mf /work/out/sub/from_outputdir.3mf \
  /work/flow.3mf
require_min_bytes "${WORKDIR}/out/sub/from_outputdir.3mf"

echo ""
echo "All docker E2E checks passed."
