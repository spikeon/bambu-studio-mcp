# bambu-studio-mcp

A [Model Context Protocol](https://modelcontextprotocol.io/) server that runs the [Bambu Studio](https://github.com/bambulab/BambuStudio) **command-line interface** so assistants can slice projects, inspect models, and read CLI help. The slicer runs in a **Docker** container by default (official Linux AppImage inside the image), so you do not need Bambu Studio installed on the host.

**Scope:** Anything the upstream `bambu-studio` binary can do is still *that* program’s behavior. Features listed under [MCP-only behavior](#mcp-only-behavior-not-bambu-studio-cli) are implemented in **this Node server** (file renames, tree walks, Docker wiring, etc.) and are **not** part of Bambu Studio itself.

CLI reference: [Bambu Studio — Command Line Usage](https://github.com/bambulab/BambuStudio/wiki/Command-Line-Usage).

### Tools vs skills vs Cursor plugins

| Layer | What it is |
|-------|------------|
| **MCP tool** | A callable entry point implemented in **this server** (e.g. `bambu_studio_extract_stls_beside_3mf`). It runs Docker/native `bambu-studio` and MCP-side file logic. |
| **Agent skill** | A `SKILL.md` file that teaches assistants *when* and *how* to use tools. It does not execute slicing by itself. |
| **Cursor plugin** | The supported **distribution** format for skills (and optional MCP wiring): a directory with `.cursor-plugin/plugin.json`, plus `skills/`, and optionally `mcp.json`. See [Cursor Plugins](https://cursor.com/docs/plugins.md). |

The “prefixed STLs beside `.3mf`” workflow is distributed as a **plugin** at [`plugins/bambu-prefixed-stl-extract/`](plugins/bambu-prefixed-stl-extract/README.md) (skill + default `mcp.json`). Install it from a clone via `~/.cursor/plugins/local/` or publish the repo to the Cursor Marketplace / a team marketplace.

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
| `bambu_studio_extract_models_from_3mf` | Workflow: **3MF → STL** (one merged mesh or one STL per object in a folder); schema uses a **union** so MCP clients see full `mode`-specific fields |
| `bambu_studio_extract_stls_beside_3mf` | Workflow: per-object STLs **next to the .3mf** with `{3mfStem} - {exportStem}.stl`; uses a temp folder then moves + deletes it |
| `bambu_studio_quick_slice` | Workflow: slice → one output **3MF** |
| `bambu_studio_slice_with_layout` | Workflow: orient / arrange / scale / rotate / … then slice → **3MF** |
| `bambu_studio_slice_with_presets` | Workflow: `--load-settings` / `--load-filaments` then slice → **3MF** |
| `bambu_studio_slice_write_outputs` | Workflow: slice plus **settings JSON**, **slicedata**, **STL(s)**, **PNG**, optional **3MF** |
| `bambu_studio_slice_all_cli_options` | Workflow: all other CLI flags (skips, makerlab, limits, …) in one call |
| `bambu_studio_health` | Reports exec mode and whether `--help` succeeds |

Anything that is **not** a capability of the `bambu-studio` executable itself is documented in the next section—not in Bambu Lab’s wiki.

## MCP-only behavior (not Bambu Studio CLI)

The upstream [`bambu-studio`](https://github.com/bambulab/BambuStudio) binary exposes flags such as `--slice`, `--export-stls`, `--info`, `--orient`, etc. **Everything in this section is extra behavior from the MCP server** (this repository): Node.js logic, Docker orchestration, or documentation helpers—not features you get by running Bambu Studio alone.

**In this category:**

- **Workspace / Docker path mapping** — Resolving a host workspace and bind-mounting it as `/work`, and the documented Linux-style absolute paths for MCP-on-Docker. Not a Bambu Studio feature.
- **`--outputdir` + `--export-3mf` path handling** — The server adjusts relative paths so the CLI does not double folder segments in some combinations. Logic lives in this repo’s argument builder, not upstream.
- **Workflow-oriented tool split** — Grouping CLI flags into `quick_slice`, `slice_with_layout`, `slice_write_outputs`, etc. is for MCP ergonomics; they still invoke the same CLI capabilities.
- **`bambu_studio_cli_reference`** — Static markdown summary, not the binary.
- **`bambu_studio_health`** — Checks how this MCP is configured (Docker vs native, image, `--help` exit code).
- **MCP input schemas** — Zod/JSON Schema for tools (including union shapes so clients list all fields for `bambu_studio_extract_models_from_3mf`).
- **`stl_export_filename_prefix` / `stl_export_filename_suffix`** — After `--export-stl` / `--export-stls`, rename each **new** `.stl` (not present before the run) to `prefix + originalStem + suffix + .stl`. The Bambu binary does not choose custom names; this is post-processing in the MCP.
- **`bambu_studio_extract_stls_beside_3mf`** — Exports to a dot-prefixed temp directory under the `.3mf`’s folder, applies the `{3mfStem} - ` prefix via the same rename logic, **moves** STLs beside the `.3mf`, then **removes** the temp directory (or leaves it if moving fails).

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
