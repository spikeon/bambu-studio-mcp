import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { extractPrefixedStlsBesideThreeMf } from "./extract-stl-beside-3mf.js";
import { runSliceFromInput } from "./slice-runner.js";
import {
  extractModelsFrom3mfToCliInput,
  fullSliceToolToCliInput,
  layoutSliceToCliInput,
  pipelineOutputsSliceToCliInput,
  presetSliceToCliInput,
  quickSliceToCliInput,
} from "./workflow-slice.js";
import {
  detectExecMode,
  formatToolOutput,
  mapFileArgs,
  runBambuStudio,
} from "./runner.js";

const WIKI_CLI_URL =
  "https://github.com/bambulab/BambuStudio/wiki/Command-Line-Usage";

const CLI_REFERENCE = `Bambu Studio command-line usage (summary). Full manual: ${WIKI_CLI_URL}

Run bambu_studio_help for the exact flag list from your installed build.

Usage: bambu-studio [ OPTIONS ] [ file.3mf/file.stl ... ]

Representative OPTIONS (see --help for the complete set):
- --debug, --load-settings, --load-filaments, --outputdir
- --arrange, --orient, --scale, --rotate, --rotate-x, --rotate-y, --repetitions
- --assemble, --convert-unit, --ensure-on-bed
- --export-3mf, --export-settings, --export-slicedata, --export-png, --export-stl, --export-stls
- --load-slicedata, --info, --pipe, --slice, --uptodate
- Plus multicolor, skip, makerlab, metadata, downward-check, timelapse, limits (--mstpp, --mtcpp), etc.

Settings priority (high to low): CLI --key=value, --load-settings/--load-filaments, values inside 3MF.

This MCP maps workspace-relative paths to /work/... inside Docker (default), or uses them as-is on the host in native mode.

Slice workflows: bambu_studio_extract_models_from_3mf; bambu_studio_extract_stls_beside_3mf (per-object STLs beside the .3mf, {name} - prefix); bambu_studio_quick_slice; bambu_studio_slice_with_layout; bambu_studio_slice_with_presets; bambu_studio_slice_write_outputs; bambu_studio_slice_all_cli_options.`;

async function withTempWorkspace<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bambu-mcp-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const workspaceField = z
  .string()
  .min(1)
  .describe(
    "Absolute path to a directory that holds your model/settings files. All input_files and output paths are relative to this directory. " +
    "PATH FORMAT: use a Linux-style absolute path regardless of your OS. " +
    "On Windows with Docker Desktop supply the drive as the first path segment: e.g. /d/Users/me/prints for D:\\Users\\me\\prints. " +
    "Do NOT use Windows backslash paths (D:\\...) — the MCP server runs on Linux inside Docker and path.resolve() will mangle them. " +
    "The directory is bind-mounted to /work inside the slicer container."
  );

const inputFilesField = z
  .array(z.string().min(1))
  .min(1)
  .describe("Project/model files relative to workspace (.3mf, .stl, etc.)");

const plateIndexField = z
  .number()
  .int()
  .min(0)
  .describe("0 = all plates; i = plate index i (see upstream CLI docs)");

const settingOverridesField = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .optional()
  .describe('CLI overrides as --key=value (e.g. { "curr-bed-type": "Cool Plate" })');

/** STL/PNG exports and camera (see --export-stl, --export-stls, --export-png, --camera-view). */
const exportMediaSchemaFields = {
  export_png: z
    .number()
    .int()
    .optional()
    .describe("Plate index for --export-png (0 = all plates; i = plate i)"),
  export_stl: z.boolean().optional().describe("Set true for --export-stl (single merged STL)"),
  export_stls: z
    .string()
    .min(1)
    .optional()
    .describe("Relative directory for --export-stls (one STL per object); create the dir if needed"),
  stl_export_filename_prefix: z
    .string()
    .optional()
    .describe(
      "MCP-only: after export, rename each new STL to prefix + originalStem + suffix + .stl (requires export_stl and/or export_stls; Bambu CLI does not set mesh basenames)."
    ),
  stl_export_filename_suffix: z
    .string()
    .optional()
    .describe("MCP-only: suffix before .stl; see stl_export_filename_prefix."),
  camera_view: z
    .number()
    .int()
    .optional()
    .describe("Camera angle for PNG export: 0–3, 10–12 (see --camera-view in --help)"),
};

/** Workflow: slice → one 3MF (no STL/PNG here; use slice_write_outputs). */
const quickSliceSchema = {
  workspace_path: workspaceField,
  input_files: inputFilesField,
  plate_index: plateIndexField,
  export_3mf: z
    .string()
    .min(1)
    .describe("Where to write the sliced 3MF (relative to workspace)"),
  debug: z.number().int().min(0).max(5).optional(),
  setting_overrides: settingOverridesField,
  uptodate: z.boolean().optional().describe("Refresh 3MF preset values to latest (--uptodate)"),
};

const threeMfFileField = z
  .string()
  .min(1)
  .describe("Path to the .3mf project file relative to workspace");

/** Export meshes from a 3MF to STL via --export-stl or --export-stls (runs slice for the chosen plate). Use `z.union` so JSON Schema lists each branch (fixes empty props in some MCP clients). */
const extractModelsFrom3mfSchema = z.union([
  z.object({
    workspace_path: workspaceField,
    mode: z.literal("merged_single_stl"),
    three_mf_file: threeMfFileField,
    plate_index: plateIndexField,
    output_dir: z
      .string()
      .min(1)
      .optional()
      .describe("Optional --outputdir; merged STL is written under this folder when set"),
    debug: z.number().int().min(0).max(5).optional(),
    stl_export_filename_prefix: exportMediaSchemaFields.stl_export_filename_prefix,
    stl_export_filename_suffix: exportMediaSchemaFields.stl_export_filename_suffix,
  }),
  z.object({
    workspace_path: workspaceField,
    mode: z.literal("per_object_stls"),
    three_mf_file: threeMfFileField,
    plate_index: plateIndexField,
    stls_directory: z
      .string()
      .min(1)
      .describe("Relative directory for --export-stls (one STL per object); create it if missing"),
    output_dir: z
      .string()
      .min(1)
      .optional()
      .describe("Optional --outputdir; if set, stls_directory is usually under this folder"),
    debug: z.number().int().min(0).max(5).optional(),
    stl_export_filename_prefix: exportMediaSchemaFields.stl_export_filename_prefix,
    stl_export_filename_suffix: exportMediaSchemaFields.stl_export_filename_suffix,
  }),
]);

const layoutSchemaFields = {
  arrange: z
    .union([z.literal(0), z.literal(1), z.number().int()])
    .optional()
    .describe("0 off, 1 on, any other int = auto (upstream behavior)"),
  orient: z
    .union([z.literal(0), z.literal(1), z.number().int()])
    .optional()
    .describe("0 off, 1 on, any other int = auto (upstream --orient)"),
  scale: z.number().optional().describe("Uniform scale factor before slicing"),
  rotate: z.number().optional().describe("--rotate (degrees around Z)"),
  rotate_x: z.number().optional().describe("--rotate-x"),
  rotate_y: z.number().optional().describe("--rotate-y"),
  repetitions: z.number().int().min(0).optional().describe("--repetitions"),
  assemble: z.boolean().optional().describe("--assemble (merge loaded models for one operation)"),
  convert_unit: z.boolean().optional().describe("--convert-unit"),
  ensure_on_bed: z.number().int().optional().describe("--ensure-on-bed (option value, often 0/1)"),
};

/** Remaining CLI flags from bambu-studio --help (multicolor, skips, makerlab, limits, etc.). */
const advancedSliceSchemaFields = {
  allow_mix_temp: z.number().optional().describe("--allow-mix-temp"),
  allow_multicolor_oneplate: z.boolean().optional().describe("--allow-multicolor-oneplate"),
  allow_newer_file: z.number().optional().describe("--allow-newer-file"),
  allow_rotations: z.boolean().optional().describe("--allow-rotations (during arrange)"),
  avoid_extrusion_cali_region: z.boolean().optional().describe("--avoid-extrusion-cali-region"),
  downward_check: z.boolean().optional().describe("--downward-check"),
  downward_settings_semicolon: z
    .string()
    .optional()
    .describe("--downward-settings (semicolon-separated JSON paths)"),
  enable_timelapse: z.boolean().optional().describe("--enable-timelapse"),
  load_assemble_list: z.string().min(1).optional().describe("--load-assemble-list"),
  load_custom_gcodes: z.string().min(1).optional().describe("--load-custom-gcodes"),
  load_filament_ids: z.string().optional().describe('--load-filament-ids e.g. "1,2,3,1"'),
  clone_objects: z.string().optional().describe('--clone-objects e.g. "1,3,1,10"'),
  makerlab_name: z.string().optional().describe("--makerlab-name"),
  makerlab_version: z.string().optional().describe("--makerlab-version"),
  metadata_name: z.string().optional().describe('--metadata-name (semicolon-separated)'),
  metadata_value: z.string().optional().describe("--metadata-value"),
  skip_modified_gcodes: z.number().optional().describe("--skip-modified-gcodes"),
  skip_objects: z.string().optional().describe('--skip-objects e.g. "3,5,10,77"'),
  skip_useless_pick: z.number().optional().describe("--skip-useless-pick"),
  uptodate_filaments_semicolon: z
    .string()
    .optional()
    .describe("--uptodate-filaments (semicolon paths, used with --uptodate)"),
  uptodate_settings_semicolon: z
    .string()
    .optional()
    .describe("--uptodate-settings (semicolon paths, used with --uptodate)"),
  load_defaultfila: z.number().optional().describe("--load-defaultfila"),
  min_save: z.number().optional().describe("--min-save"),
  mstpp: z.number().optional().describe("--mstpp (max slice time per plate, seconds)"),
  mtcpp: z.number().optional().describe("--mtcpp (max triangle count per plate)"),
  no_check: z.boolean().optional().describe("--no-check"),
  normative_check: z.number().optional().describe("--normative-check"),
  pipe: z.string().min(1).optional().describe("--pipe progress pipe name"),
};

const presetSchemaFields = {
  load_settings_files: z
    .array(z.string().min(1))
    .max(2)
    .optional()
    .describe("0–2 relative paths: machine.json [; process.json] for --load-settings"),
  load_filaments_semicolon: z
    .string()
    .optional()
    .describe('Raw --load-filaments string with workspace-relative paths, e.g. "f1.json;;f3.json"'),
};

const outputSchemaFields = {
  output_dir: z.string().min(1).optional().describe("Relative directory for --outputdir"),
  export_settings: z
    .string()
    .min(1)
    .optional()
    .describe("Relative path for --export-settings JSON"),
  export_slicedata: z
    .string()
    .min(1)
    .optional()
    .describe("Relative directory for --export-slicedata. The directory must already exist; Bambu Studio creates numbered subdirs inside it but cannot create the top-level dir on Windows-mounted volumes."),
  load_slicedata: z
    .string()
    .min(1)
    .optional()
    .describe("Relative directory for --load-slicedata"),
};

const layoutWorkflowSchema = { ...quickSliceSchema, ...layoutSchemaFields };

const presetWorkflowSchema = { ...quickSliceSchema, ...presetSchemaFields };

const pipelineWorkflowSchema = {
  workspace_path: workspaceField,
  input_files: inputFilesField,
  plate_index: plateIndexField,
  export_3mf: z
    .string()
    .min(1)
    .optional()
    .describe("Optional sliced 3MF output (relative to workspace)"),
  debug: z.number().int().min(0).max(5).optional(),
  setting_overrides: settingOverridesField,
  uptodate: z.boolean().optional(),
  ...outputSchemaFields,
  ...exportMediaSchemaFields,
};

const allCliOptionsWorkflowSchema = {
  workspace_path: workspaceField,
  input_files: inputFilesField,
  plate_index: plateIndexField,
  export_3mf: z
    .string()
    .min(1)
    .optional()
    .describe("Output 3MF path when needed"),
  debug: z.number().int().min(0).max(5).optional(),
  setting_overrides: settingOverridesField,
  uptodate: z.boolean().optional(),
  ...layoutSchemaFields,
  ...presetSchemaFields,
  ...outputSchemaFields,
  ...exportMediaSchemaFields,
  ...advancedSliceSchemaFields,
};

const server = new McpServer(
  {
    name: "bambu-studio-mcp",
    version: "1.0.0",
  },
  {
    instructions: `Wraps Bambu Studio CLI for slicing and model inspection. Default Docker slicer image: ghcr.io/spikeon/bambu-studio-mcp:latest (override with BAMBU_STUDIO_IMAGE). Reference: ${WIKI_CLI_URL}

Workflows: bambu_studio_extract_models_from_3mf (single 3MF → STL) · bambu_studio_extract_stls_beside_3mf (per-object STLs next to the .3mf with {3mfStem} - prefix) · bambu_studio_quick_slice (→ 3MF) · layout / presets / write_outputs / all_cli_options. For upstream flags, call bambu_studio_help. Use Linux-style absolute paths for workspace_path (see below).

IMPORTANT — workspace_path format:
This MCP server process runs on Linux (inside a Docker container). Always supply workspace_path as a Linux-style absolute path:
  • Windows (Docker Desktop): use /d/Users/me/prints for D:\\Users\\me\\prints
  • Linux/macOS: use the path as-is, e.g. /home/me/prints
Never use Windows backslash paths — path.resolve() on Linux will mangle them.

IMPORTANT — export_slicedata:
The directory passed to export_slicedata must already exist on disk before the slice runs. Bambu Studio creates a numbered subdirectory (e.g. slicedata/1/) inside it but cannot create the top-level directory itself when the workspace is a Windows-mounted Docker volume.`,
  }
);

server.registerTool(
  "bambu_studio_cli_reference",
  {
    description:
      "Short summary of Bambu Studio CLI; for the authoritative flag list from your slicer build, call bambu_studio_help.",
  },
  async () => ({
    content: [{ type: "text", text: CLI_REFERENCE }],
  })
);

server.registerTool(
  "bambu_studio_help",
  {
    description:
      "Runs `bambu-studio --help` via Docker or native binary so you see the exact flags for the installed version.",
  },
  async () => {
    const result = await withTempWorkspace((ws) => runBambuStudio(ws, ["--help"]));
    return {
      content: [{ type: "text", text: formatToolOutput(result) }],
      isError: result.code !== 0,
    };
  }
);

server.registerTool(
  "bambu_studio_model_info",
  {
    description: "Runs `bambu-studio --info` on the given model files (prints mesh/project information).",
    inputSchema: {
      workspace_path: workspaceField,
      input_files: inputFilesField,
      debug: z.number().int().min(0).max(5).optional().describe("Log level (default 2)"),
    },
  },
  async (args) => {
    const ws = path.resolve(args.workspace_path);
    const mapped = mapFileArgs(ws, args.input_files);
    const cli: string[] = [];
    cli.push("--debug", String(args.debug ?? 2));
    cli.push("--info", ...mapped);
    const result = await runBambuStudio(ws, cli);
    return {
      content: [{ type: "text", text: formatToolOutput(result) }],
      isError: result.code !== 0,
    };
  }
);

server.registerTool(
  "bambu_studio_extract_models_from_3mf",
  {
    description:
      "Workflow: pull mesh geometry out of a .3mf and write STL—either one merged file (--export-stl) or one STL per object in a folder (--export-stls). Optional stl_export_filename_prefix/suffix renames each new STL after export (MCP-only). Uses the same plate index as slicing (0 = all plates). Prefer this over generic slice tools when you only need STLs.",
    inputSchema: extractModelsFrom3mfSchema,
  },
  async (args) => {
    const { workspace_path, ...rest } = args;
    return runSliceFromInput(workspace_path, extractModelsFrom3mfToCliInput(rest));
  }
);

const extractStlsBesideThreeMfSchema = z.object({
  workspace_path: workspaceField,
  three_mf_file: threeMfFileField,
  plate_index: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Plate index for --slice (default 0 = all plates)"),
  debug: z.number().int().min(0).max(5).optional(),
});

server.registerTool(
  "bambu_studio_extract_stls_beside_3mf",
  {
    description:
      "MCP workflow: export one STL per mesh object from a .3mf using --export-stls into a dot-prefixed temp folder, rename each to `{3mfBasenameWithoutExt} - {originalStlStem}.stl`, move them into the same folder as the .3mf, then delete the temp folder. If moving fails, the temp folder is left in place for recovery. Object labels come from Bambu export names (often obj_N_…), not arbitrary letters a/b/c.",
    inputSchema: extractStlsBesideThreeMfSchema,
  },
  async (args) => {
    return extractPrefixedStlsBesideThreeMf(
      args.workspace_path,
      args.three_mf_file,
      args.plate_index ?? 0,
      args.debug
    );
  }
);

server.registerTool(
  "bambu_studio_quick_slice",
  {
    description:
      "Workflow: slice the project and write one output 3MF. For STL/PNG/settings exports use bambu_studio_slice_write_outputs; for orient/arrange use bambu_studio_slice_with_layout.",
    inputSchema: quickSliceSchema,
  },
  async (args) => {
    const { workspace_path, ...rest } = args;
    return runSliceFromInput(workspace_path, quickSliceToCliInput(rest));
  }
);

server.registerTool(
  "bambu_studio_slice_with_layout",
  {
    description:
      "Workflow: place parts on the bed (orient, arrange, scale, rotate, …) then slice to a 3MF. Same output contract as quick_slice.",
    inputSchema: layoutWorkflowSchema,
  },
  async (args) => {
    const { workspace_path, ...rest } = args;
    return runSliceFromInput(workspace_path, layoutSliceToCliInput(rest));
  }
);

server.registerTool(
  "bambu_studio_slice_with_presets",
  {
    description:
      "Workflow: load machine/process/filament JSON presets, then slice to a 3MF. Use when the project needs external profile files.",
    inputSchema: presetWorkflowSchema,
  },
  async (args) => {
    const { workspace_path, ...rest } = args;
    return runSliceFromInput(workspace_path, presetSliceToCliInput(rest));
  }
);

server.registerTool(
  "bambu_studio_slice_write_outputs",
  {
    description:
      "Workflow: slice and write auxiliary files—output directory, exported settings JSON, slicedata cache, load cached slicedata, merged STL, per-object STLs, plate PNG, camera view. Optional sliced 3MF. Optional stl_export_filename_prefix/suffix renames new STL basenames after export (MCP-only). If you set output_dir, keep export_3mf/export_stls paths under it so paths do not double.",
    inputSchema: pipelineWorkflowSchema,
  },
  async (args) => {
    const { workspace_path, ...rest } = args;
    return runSliceFromInput(workspace_path, pipelineOutputsSliceToCliInput(rest));
  }
);

server.registerTool(
  "bambu_studio_slice_all_cli_options",
  {
    description:
      "Workflow: one call with every optional CLI flag this server supports (clone objects, makerlab, skips, limits, …). Prefer the narrower workflow tools when possible.",
    inputSchema: allCliOptionsWorkflowSchema,
  },
  async (args) => runSliceFromInput(args.workspace_path, fullSliceToolToCliInput(args))
);

server.registerTool(
  "bambu_studio_health",
  {
    description:
      "Checks configuration: exec mode (docker/native), and whether Docker or the native binary responds to --help.",
  },
  async () => {
    const mode = detectExecMode();
    const lines = [`exec_mode: ${mode}`, `platform: ${process.platform}`];
    if (mode === "docker") {
      lines.push(`docker_bin: ${process.env.BAMBU_STUDIO_DOCKER_BIN?.trim() || "docker"}`);
      lines.push(
        `image: ${process.env.BAMBU_STUDIO_IMAGE?.trim() || "ghcr.io/spikeon/bambu-studio-mcp:latest"}`
      );
    } else {
      lines.push(
        `native_bin: ${process.env.BAMBU_STUDIO_BIN?.trim() || "(default path for OS)"}`
      );
    }
    const help = await withTempWorkspace((ws) => runBambuStudio(ws, ["--help"]));
    lines.push(`--help exit_code: ${help.code}`);
    if (help.code !== 0) {
      lines.push(formatToolOutput(help));
    }
    return {
      content: [{ type: "text", text: lines.join("\n") }],
      isError: help.code !== 0,
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
