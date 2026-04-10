import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { SliceCliInput } from "./slice-args.js";
import { runSliceFromInput } from "./slice-runner.js";
import {
  detectExecMode,
  formatToolOutput,
  mapFileArgs,
  runBambuStudio,
} from "./runner.js";

const WIKI_CLI_URL =
  "https://github.com/bambulab/BambuStudio/wiki/Command-Line-Usage";

const CLI_REFERENCE = `Bambu Studio command-line usage (summary). Full manual: ${WIKI_CLI_URL}

Usage: bambu-studio [ OPTIONS ] [ file.3mf/file.stl ... ]

Common OPTIONS:
- --debug level — 0:fatal, 1:error, 2:warning, 3:info, 4:debug, 5:trace
- --load-filaments "a.json;;c.json" — semicolon list; empty slots keep 3MF filament
- --load-settings "machine.json;process.json" — up to one machine + one process JSON
- --outputdir dir — export directory
- --arrange option — 0 disable, 1 enable, other values: auto
- --orient option — 0 disable, 1 enable, other values: auto
- --scale factor — float scale
- --export-3mf file.3mf — write sliced project 3MF
- --export-settings settings.json — dump settings
- --export-slicedata dir — export slicing cache
- --info — print model info
- --load-slicedata dir — load slicing cache
- --pipe pipename — progress pipe
- --slice plate_index — 0 = all plates, i = plate i
- --uptodate — refresh 3MF config presets to latest

Settings priority (high to low): CLI --key=value, --load-settings/--load-filaments, values inside 3MF.

This MCP maps workspace-relative paths to /work/... inside Docker (default), or uses them as-is on the host in native mode.

Slice workflows are split across several tools (basic slice, layout, presets, outputs, full). Use bambu_studio_slice_full when you need options from more than one category in a single run.`;

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

const sliceBaseSchema = {
  workspace_path: workspaceField,
  input_files: inputFilesField,
  plate_index: plateIndexField,
  export_3mf: z
    .string()
    .min(1)
    .optional()
    .describe("Relative path for --export-3mf output"),
  debug: z.number().int().min(0).max(5).optional(),
  setting_overrides: settingOverridesField,
  uptodate: z.boolean().optional().describe("Refresh 3MF preset values to latest (--uptodate)"),
};

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

function sliceInputBase(args: {
  workspace_path: string;
  input_files: string[];
  plate_index: number;
  export_3mf?: string;
  debug?: number;
  setting_overrides?: Record<string, string | number | boolean>;
  uptodate?: boolean;
}): SliceCliInput {
  return {
    plate_index: args.plate_index,
    input_files: args.input_files,
    export_3mf: args.export_3mf,
    debug: args.debug,
    setting_overrides: args.setting_overrides,
    uptodate: args.uptodate,
  };
}

const server = new McpServer(
  {
    name: "bambu-studio-mcp",
    version: "1.0.0",
  },
  {
    instructions: `Wraps Bambu Studio CLI for slicing and model inspection. Default Docker slicer image: ghcr.io/spikeon/bambu-studio-mcp:latest (override with BAMBU_STUDIO_IMAGE). Reference: ${WIKI_CLI_URL}

Slice tools: bambu_studio_slice (minimal), bambu_studio_slice_layout (orient/arrange/scale), bambu_studio_slice_load_presets (machine/process/filament JSON), bambu_studio_slice_outputs (export paths and cache dirs), bambu_studio_slice_full (all options in one call).

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
      "Static summary of Bambu Studio CLI flags and behavior (from the official wiki). Use before planning slice commands.",
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
  "bambu_studio_slice",
  {
    description:
      "Minimal slice: --slice only (plus optional --export-3mf, --debug, --uptodate, and CLI setting overrides). Use other bambu_studio_slice_* tools for layout, presets, or extra exports.",
    inputSchema: sliceBaseSchema,
  },
  async (args) =>
    runSliceFromInput(args.workspace_path, sliceInputBase(args))
);

server.registerTool(
  "bambu_studio_slice_layout",
  {
    description:
      "Slice with model layout options: --orient, --arrange, and/or --scale before slicing (typical for raw STL workflows).",
    inputSchema: { ...sliceBaseSchema, ...layoutSchemaFields },
  },
  async (args) =>
    runSliceFromInput(
      args.workspace_path,
      {
        ...sliceInputBase(args),
        orient: args.orient,
        arrange: args.arrange,
        scale: args.scale,
      }
    )
);

server.registerTool(
  "bambu_studio_slice_load_presets",
  {
    description:
      "Slice while loading full machine/process JSON and optional --load-filaments preset list (semicolon pattern). Common for STL or overriding 3MF printer/print/filament settings.",
    inputSchema: { ...sliceBaseSchema, ...presetSchemaFields },
  },
  async (args) =>
    runSliceFromInput(
      args.workspace_path,
      {
        ...sliceInputBase(args),
        load_settings_files: args.load_settings_files,
        load_filaments_semicolon: args.load_filaments_semicolon,
      }
    )
);

server.registerTool(
  "bambu_studio_slice_outputs",
  {
    description:
      "Slice with output paths: --outputdir, --export-settings, --export-slicedata, and/or --load-slicedata. If you set output_dir and export_3mf, use a path for export_3mf under that directory (the server passes a relative name to the CLI so Bambu Studio does not double the folder).",
    inputSchema: { ...sliceBaseSchema, ...outputSchemaFields },
  },
  async (args) =>
    runSliceFromInput(
      args.workspace_path,
      {
        ...sliceInputBase(args),
        output_dir: args.output_dir,
        export_settings: args.export_settings,
        export_slicedata: args.export_slicedata,
        load_slicedata: args.load_slicedata,
      }
    )
);

server.registerTool(
  "bambu_studio_slice_full",
  {
    description:
      "Single slice invocation with every supported option (layout, presets, outputs, overrides). Prefer the narrower slice tools when possible.",
    inputSchema: { ...sliceBaseSchema, ...layoutSchemaFields, ...presetSchemaFields, ...outputSchemaFields },
  },
  async (args) =>
    runSliceFromInput(args.workspace_path, {
      ...sliceInputBase(args),
      orient: args.orient,
      arrange: args.arrange,
      scale: args.scale,
      load_settings_files: args.load_settings_files,
      load_filaments_semicolon: args.load_filaments_semicolon,
      output_dir: args.output_dir,
      export_settings: args.export_settings,
      export_slicedata: args.export_slicedata,
      load_slicedata: args.load_slicedata,
    })
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
