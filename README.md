# bambu-studio-mcp

A [Model Context Protocol](https://modelcontextprotocol.io/) server that runs the [Bambu Studio](https://github.com/bambulab/BambuStudio) **command-line interface** so assistants can slice projects, inspect models, and read CLI help. By default the slicer runs inside a **Docker** image that bundles the official Linux AppImage, so you do not need Bambu Studio installed on the host.

CLI reference: [Bambu Studio — Command Line Usage](https://github.com/bambulab/BambuStudio/wiki/Command-Line-Usage).

## Prerequisites

- **Node.js** 18+ (for the MCP server)
- **Docker** (default mode), or a local **Bambu Studio** install if you use native mode

## Quick start

```bash
git clone https://github.com/spikeon/bambu-studio-mcp.git
cd bambu-studio-mcp
npm install
npm run build
docker build -t bambu-studio-mcp:latest .
```

Point your MCP client at `dist/index.js` (see below). All model and settings paths you pass through tools must be **relative to a single workspace directory** you choose; that directory is bind-mounted to `/work` in the container.

## Cursor / MCP configuration

Use absolute paths on your machine. Example shape (see also [`mcp-config.example.json`](mcp-config.example.json)):

```json
{
  "mcpServers": {
    "bambu-studio": {
      "command": "node",
      "args": ["/absolute/path/to/bambu-studio-mcp/dist/index.js"],
      "env": {
        "BAMBU_STUDIO_EXEC_MODE": "docker",
        "BAMBU_STUDIO_IMAGE": "bambu-studio-mcp:latest"
      }
    }
  }
}
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `BAMBU_STUDIO_EXEC_MODE` | `docker` (default) or `native` |
| `BAMBU_STUDIO_IMAGE` | Docker image tag (default `bambu-studio-mcp:latest`) |
| `BAMBU_STUDIO_BIN` | Path to `bambu-studio` / `bambu-studio.exe` when using `native` |
| `BAMBU_STUDIO_DOCKER_BIN` | `docker` or `podman` (default `docker`) |
| `BAMBU_STUDIO_DOCKER_RUN_ARGS` | Extra tokens passed to `docker run` (space-separated) |
| `BAMBU_STUDIO_TIMEOUT_MS` | Max time for one CLI invocation (default 1 hour) |

Native mode on Windows defaults to `C:\Program Files\Bambu Studio\bambu-studio.exe` if `BAMBU_STUDIO_BIN` is unset.

## MCP tools

| Tool | Purpose |
|------|---------|
| `bambu_studio_cli_reference` | Short summary of common CLI flags (from the wiki) |
| `bambu_studio_help` | Runs `bambu-studio --help` in Docker or natively |
| `bambu_studio_model_info` | Runs `--info` on workspace-relative models |
| `bambu_studio_slice` | Minimal slice: `--slice`, optional `--export-3mf`, `--debug`, `--uptodate`, `setting_overrides` |
| `bambu_studio_slice_layout` | Slice with `--orient` / `--arrange` (0/1/auto) and `--scale` |
| `bambu_studio_slice_load_presets` | Slice with `--load-settings` and optional `--load-filaments` |
| `bambu_studio_slice_outputs` | Slice with `--outputdir`, `--export-settings`, `--export-slicedata`, `--load-slicedata` |
| `bambu_studio_slice_full` | One call with every slice-related option (use when combining categories) |
| `bambu_studio_health` | Reports exec mode and whether `--help` succeeds |

## Development

```bash
npm run dev      # run server via tsx (stdio MCP)
npm run build    # compile to dist/
npm run test     # Vitest unit tests
npm run test:e2e # Docker E2E (requires bash + Docker; use Git Bash/WSL on Windows)
npm run ci       # build + unit tests + E2E
```

CI (GitHub Actions) builds the image and runs the same E2E script as `test:e2e`.

E2E downloads a small upstream 3MF (default: `auto_pa_line_single.3mf` at `BAMBU_STUDIO_FIXTURE_REF`). Override with `BAMBU_E2E_FIXTURE_PATH` (repo-relative path under `BambuStudio`, e.g. `resources/calib/...`) if needed.

## Docker image notes

The [`Dockerfile`](Dockerfile) uses **Fedora** as the runtime base so shared libraries match the **Fedora** AppImage from upstream releases. The image downloads a pinned AppImage at build time (`BAMBU_APPIMAGE_URL` build-arg); override it if you need another version.

The [`docker/entrypoint.sh`](docker/entrypoint.sh) defaults to **software OpenGL** (`LIBGL_ALWAYS_SOFTWARE`, `llvmpipe`) so headless slicing is stable in CI; unset or override those variables if you run the image with a real GPU.

## License

This MCP wrapper is **ISC** (see `package.json`). **Bambu Studio** itself is licensed under **AGPL-3.0**; using the Docker image or their binaries is subject to their terms.
