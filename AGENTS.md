# AGENTS.md

## Cursor Cloud specific instructions

### Overview
This is an MCP (Model Context Protocol) server wrapping the Bambu Studio 3D-printing slicer CLI. The server communicates via stdio (JSON-RPC) and by default runs the slicer inside a Docker container.

### Key commands
Standard commands are documented in `README.md` under "Development (from source)". Quick reference:
- `npm run dev` — run MCP server via tsx (stdio transport)
- `npm run build` — compile TypeScript to `dist/`
- `npm run test` — unit tests (Vitest, no Docker needed)
- `npm run test:e2e` — E2E tests (requires Docker + slicer image)
- `npm run ci` — build + unit + E2E in sequence

### Docker requirements
- Docker must be running for E2E tests and for the MCP server's default exec mode.
- The slicer image must be built locally before running E2E tests: `docker build -t bambu-studio-mcp:latest .`
- E2E tests use the `BAMBU_E2E_IMAGE` env var (defaults to `bambu-studio-mcp:latest`).
- The slicer image is ~1.6 GB (Fedora + Bambu Studio AppImage) and takes several minutes to build.

### Cloud VM Docker setup
Running Docker inside the Cloud Agent VM requires nested-container workarounds:
1. Docker must use `fuse-overlayfs` storage driver (`/etc/docker/daemon.json`).
2. `iptables-legacy` must be selected via `update-alternatives`.
3. Start the daemon with `sudo dockerd &` and wait a few seconds before use.
4. Socket permissions: `sudo chmod 666 /var/run/docker.sock` or add user to `docker` group.

### MCP server testing
The server uses stdio transport — no HTTP port. To test interactively, pipe JSON-RPC messages:
```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"bambu_studio_health","arguments":{}}}\n' | npx tsx src/index.ts
```

### No lint configuration
This project has no ESLint or Prettier configuration. TypeScript compiler strict mode (`tsc`) is the primary code-quality check via `npm run build`.
