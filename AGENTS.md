# Agent notes — bambu-studio-mcp

Internal context for assistants working in this repository. User-facing documentation lives in `README.md` (including **MCP-only behavior** vs upstream Bambu Studio CLI).

## What this project is

- A **Node.js** [Model Context Protocol](https://modelcontextprotocol.io/) server that invokes the **Bambu Studio** command-line binary (`bambu-studio`).
- **Default execution:** `docker run` with the workspace bind-mounted as `/work`, using image `ghcr.io/spikeon/bambu-studio-mcp:latest` (Fedora + Bambu AppImage). Alternative: **`native`** mode runs a host-installed `bambu-studio` / `bambu-studio.exe`.
- The MCP does **not** reimplement slicing; it builds argv, maps paths, spawns Docker or the native binary, and returns stdout/stderr/exit code.

## Stack and layout

| Area | Details |
|------|---------|
| Runtime | Node **ES modules** (`"type": "module"`), TypeScript compiled to `dist/`. |
| Entry | `src/index.ts` — registers MCP tools, Zod schemas, stdio transport. |
| CLI invocation | `src/runner.ts` — `runBambuStudio`, `detectExecMode`, `mapFileArgs`, `mapSemicolonPaths`, `formatToolOutput`. |
| Path safety | `src/paths.ts` — workspace-relative paths, `resolveHostPath`, `toContainerPath` (`/work/...`). |
| Slice argv | `src/slice-args.ts` — `SliceCliInput`, `sliceCliInputToArgs` (large surface matching `--help`). |
| Workflows | `src/workflow-slice.ts` — maps high-level tools (`quick_slice`, layout, presets, extract, full) to `SliceCliInput`. |
| Actual slice run | `src/slice-runner.ts` — `runSliceFromInput` ties args + runner. |

## Environment variables (quick reference)

- `BAMBU_STUDIO_EXEC_MODE` — `docker` (default) or `native`.
- `BAMBU_STUDIO_IMAGE` — slicer Docker image (default `ghcr.io/spikeon/bambu-studio-mcp:latest`).
- `BAMBU_STUDIO_BIN` — native binary path (Windows default `C:\Program Files\Bambu Studio\bambu-studio.exe` if unset).
- `BAMBU_STUDIO_DOCKER_BIN`, `BAMBU_STUDIO_DOCKER_RUN_ARGS`, `BAMBU_STUDIO_TIMEOUT_MS` (default 1h).

## Paths (critical for correct tools)

- **`workspace_path`** must be an absolute path to a directory on the host; all model/output paths are **relative** to it.
- For **Docker on Windows**, MCP callers should use **Linux-style** paths (e.g. `/d/project/...` for `D:\project\...`). Backslash Windows paths are error-prone because the server-side resolution assumes consistent POSIX-style workspace roots in container scenarios (see Zod `describe` on `workspace_path` in `index.ts`).
- Inside the container, inputs are passed as **`/work/<relative>`**; `mapFileArgs` performs that mapping.

## MCP-only vs Bambu CLI

- Anything that is **only** in this repo (Docker wiring, `--outputdir`/`--export-3mf` path normalization in `slice-args.ts`, health tool, static CLI reference markdown, Zod unions for extract tool, workflow tool **names**) is documented under **README → MCP-only behavior**. Do not attribute those to Bambu Lab’s wiki.
- **`cliPathUnderOutputDir`** in `slice-args.ts` exists to avoid upstream path doubling when both `--outputdir` and export paths are set; treat changes there carefully.

## Tests

- **Unit:** `npm run test` — Vitest, `test/unit/*.test.ts` (paths, slice args, workflows).
- **E2E:** `npm run test:e2e` — Docker-based tests in `test/e2e/`; needs Docker and `BAMBU_E2E_IMAGE` / fixture env as in README.
- **CI:** `npm run ci` — build + unit + E2E; workflow in `.github/workflows/test.yml` builds slicer image and publishes GHCR on `main` when tests pass.

## Docker images (maintainer)

- **`Dockerfile`** — slicer runtime (AppImage, headless-friendly entrypoint).
- **`Dockerfile.mcp`** — MCP server image that includes Docker CLI for socket-based sibling container runs (`:mcp` tag).

## License

- This wrapper: **ISC** (`package.json`).
- **Bambu Studio** upstream: **AGPL-3.0**; binary use is subject to their terms.
