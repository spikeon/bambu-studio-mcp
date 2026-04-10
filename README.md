# bambu-studio-mcp

A [Model Context Protocol](https://modelcontextprotocol.io/) server that runs the [Bambu Studio](https://github.com/bambulab/BambuStudio) **command-line interface** so assistants can slice projects, inspect models, and read CLI help. The slicer runs in a **Docker** container by default (official Linux AppImage inside the image), so you do not need Bambu Studio installed on the host.

CLI reference: [Bambu Studio — Command Line Usage](https://github.com/bambulab/BambuStudio/wiki/Command-Line-Usage).

## Quick start

**Requirements:** [Docker](https://docs.docker.com/get-docker/) running (Docker Desktop is fine). That is the only setup.

Add the server to your MCP client. In **Cursor**, use **Settings → MCP → Add server** and paste JSON like this (no clone, no `npm install`, no manual image build):

```json
{
  "mcpServers": {
    "bambu-studio": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-v",
        "/var/run/docker.sock:/var/run/docker.sock",
        "ghcr.io/spikeon/bambu-studio-mcp:mcp"
      ]
    }
  }
}
```

- **`ghcr.io/spikeon/bambu-studio-mcp:mcp`** — MCP server (Node) plus a Docker client; it talks to your host Docker daemon through the socket and pulls/runs the slicer image when needed.
- The slicer image **`ghcr.io/spikeon/bambu-studio-mcp:latest`** is pulled automatically the first time you slice (can take a few minutes). If you use a fork that publishes its own GHCR images, replace `spikeon` with your GitHub username (lowercase) in both image names.

On **Windows**, if the socket mount fails from Cursor, use Docker Desktop with the WSL2 backend and run Cursor from [WSL](https://docs.docker.com/desktop/wsl/), or see Docker’s [Windows docs](https://docs.docker.com/desktop/settings/windows/). Alternatively use **native mode** (below) with Bambu Studio installed locally.

Model paths you pass into tools must be **relative to a workspace directory** you choose; that directory is bind-mounted to `/work` inside the slicer container.

Copy [`mcp-config.example.json`](mcp-config.example.json) as a starting point. For a **from-source** setup after `npm run build`, use `"command": "node"` and `"args": ["/absolute/path/to/.../dist/index.js"]` instead of `docker run`.

## Native mode (optional)

If Bambu Studio is installed on the machine that runs the MCP server, you can avoid Docker for slicing:

- Set `BAMBU_STUDIO_EXEC_MODE=native`.
- Set `BAMBU_STUDIO_BIN` to your `bambu-studio` / `bambu-studio.exe` if it is not in the default Windows install path.

You still need a way to run the MCP process itself (e.g. `node path/to/dist/index.js`).

## Environment variables

| Variable | Description |
|----------|-------------|
| `BAMBU_STUDIO_EXEC_MODE` | `docker` (default) or `native` |
| `BAMBU_STUDIO_IMAGE` | Slicer image (default `ghcr.io/spikeon/bambu-studio-mcp:latest`) |
| `BAMBU_STUDIO_BIN` | Path to `bambu-studio` / `bambu-studio.exe` when using `native` |
| `BAMBU_STUDIO_DOCKER_BIN` | `docker` or `podman` (default `docker`) |
| `BAMBU_STUDIO_DOCKER_RUN_ARGS` | Extra tokens passed to `docker run` (space-separated) |
| `BAMBU_STUDIO_TIMEOUT_MS` | Max time for one CLI invocation (default 1 hour) |

Native mode on Windows defaults to `C:\Program Files\Bambu Studio\bambu-studio.exe` if `BAMBU_STUDIO_BIN` is unset.

## MCP tools

| Tool | Purpose |
|------|---------|
| `bambu_studio_cli_reference` | Short summary; use `bambu_studio_help` for the exact flags from your build |
| `bambu_studio_help` | Runs `bambu-studio --help` in Docker or natively |
| `bambu_studio_model_info` | Runs `--info` on workspace-relative models |
| `bambu_studio_quick_slice` | Workflow: slice → one output **3MF** |
| `bambu_studio_slice_with_layout` | Workflow: orient / arrange / scale / rotate / … then slice → **3MF** |
| `bambu_studio_slice_with_presets` | Workflow: `--load-settings` / `--load-filaments` then slice → **3MF** |
| `bambu_studio_slice_write_outputs` | Workflow: slice plus **settings JSON**, **slicedata**, **STL(s)**, **PNG**, optional **3MF** |
| `bambu_studio_slice_all_cli_options` | Workflow: all other CLI flags (skips, makerlab, limits, …) in one call |
| `bambu_studio_health` | Reports exec mode and whether `--help` succeeds |

## Development (from source)

```bash
git clone https://github.com/spikeon/bambu-studio-mcp.git
cd bambu-studio-mcp
npm install
npm run build
docker build -t bambu-studio-mcp:latest .
docker build -f Dockerfile.mcp -t bambu-studio-mcp:mcp --build-arg SLICER_IMAGE=bambu-studio-mcp:latest .
```

```bash
npm run dev      # MCP server via tsx (stdio)
npm run test     # Vitest unit tests
npm run test:e2e # Docker E2E (needs Docker + image from BAMBU_E2E_IMAGE)
npm run ci       # build + unit + E2E
```

CI ([`.github/workflows/test.yml`](.github/workflows/test.yml)) builds the slicer image, runs unit + E2E tests, and **only if those pass** on a push to `main`, publishes **`ghcr.io/<owner>/bambu-studio-mcp:latest`** and **`:mcp`**. Pull requests run the same tests but do not push images.

E2E tests live in `test/e2e/*.e2e.test.ts` and download a small upstream 3MF (`BAMBU_STUDIO_FIXTURE_REF`, optional `BAMBU_E2E_FIXTURE_PATH`).

## Docker images

| Image | Role |
|-------|------|
| `ghcr.io/spikeon/bambu-studio-mcp:latest` | Fedora-based runtime + Bambu Studio AppImage (CLI / slicing). Built from [`Dockerfile`](Dockerfile). |
| `ghcr.io/spikeon/bambu-studio-mcp:mcp` | Node MCP server + Docker CLI; use with `-v /var/run/docker.sock:…`. Built from [`Dockerfile.mcp`](Dockerfile.mcp). |

[`docker/entrypoint.sh`](docker/entrypoint.sh) uses software OpenGL and X11-friendly env so headless `--orient` / `--arrange` work under `xvfb-run`.

## License

This MCP wrapper is **ISC** (see `package.json`). **Bambu Studio** itself is licensed under **AGPL-3.0**; using their binaries is subject to their terms.
