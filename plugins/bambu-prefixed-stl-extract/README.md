# Plugin: bambu-prefixed-stl-extract

Cursor **plugin** that distributes the **Agent Skill** for “prefixed STLs beside `.3mf`” and wires the **bambu-studio MCP** server so the underlying **tool** (`bambu_studio_extract_stls_beside_3mf`) is available.

## What you get

| Piece | What it is |
|-------|------------|
| **Skill** | `skills/bambu-prefixed-stl-extract/SKILL.md` — when and how the agent should call the MCP tool. |
| **MCP** | `mcp.json` — default Docker-based `ghcr.io/spikeon/bambu-studio-mcp:mcp` server (same pattern as the main repo’s `mcp-config.example.json`). |

The **tool** itself is implemented in the **bambu-studio-mcp** server image / this repository’s `src/` — not in this folder. This plugin is the **distribution bundle** Cursor loads as a plugin (skills + MCP config).

## Install locally (test)

Per [Cursor Plugins docs](https://cursor.com/docs/plugins.md):

1. Copy or symlink this directory to `~/.cursor/plugins/local/bambu-prefixed-stl-extract` (plugin root must contain `.cursor-plugin/plugin.json`).
2. Reload Cursor.

## Publish

Submit the hosting Git repository at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish). Team plans can instead add the repo as a **team marketplace** import.

## Forks

Replace `spikeon` in `mcp.json` with your GHCR namespace if you publish your own images.
