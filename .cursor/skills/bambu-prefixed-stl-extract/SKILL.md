---
name: bambu-prefixed-stl-extract
description: >-
  Export per-object STLs from a .3mf beside the project file with "{3mfStem} - " naming,
  using the bambu-studio MCP tool bambu_studio_extract_stls_beside_3mf. Use when the user
  wants STLs colocated with the 3MF with consistent prefixed names.
---

# Prefixed STLs beside `.3mf` (bambu-studio MCP)

## When to use

- The user asks to pull mesh STLs out of a Bambu `.3mf` and place them **in the same folder** as that file.
- They want filenames like **`{name of .3mf} - {object}.stl`** (e.g. `test - obj_1_….stl` for `test.3mf`). The exact middle part comes from **Bambu Studio’s export names** (often `obj_N_…`), not single-letter placeholders.

## Tool to call

Use MCP tool **`bambu_studio_extract_stls_beside_3mf`** with:

| Argument | Notes |
|----------|--------|
| `workspace_path` | Absolute directory containing the project; **Linux-style** path if the MCP runs in Docker (e.g. `/d/...` on Windows). |
| `three_mf_file` | Path to the `.3mf` **relative to** `workspace_path`. |
| `plate_index` | Optional; default `0` (all plates). |
| `debug` | Optional Bambu `--debug` level. |

Do **not** hand-roll `bambu_studio_extract_models_from_3mf` + manual temp dirs unless the user needs a custom export directory or merged single STL.

## Behavior (for explanations)

1. Creates a **hidden temp folder** next to the `.3mf` (name like `.bambu-mcp-prefixed-stl-<hex>`).
2. Runs `--export-stls` there, applies MCP rename **`{3mfStem} - `** + original STL stem.
3. **Moves** each resulting `.stl` into the **parent folder of the `.3mf`** (same folder as the project).
4. **Deletes** the temp folder on success.
5. On move failure, leaves the temp folder and reports its relative path for recovery.

## Limitations

- Names are **`{3mfStem} - {bambuExportStem}.stl`**, not guaranteed short `a` / `b` / `c` unless Bambu exports that way.
- Refuses to overwrite an STL that already exists beside the `.3mf`.
