import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { buildSliceCliArgs } from "./slice-args.js";
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
- --orient — auto-orient models
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

This MCP maps workspace-relative paths to /work/... inside Docker (default), or uses them as-is on the host in native mode.`;

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
    "Absolute path to a directory on the host. All model/settings paths must be relative to this directory. It is bind-mounted to /work in Docker."
  );

const inputFilesField = z
  .array(z.string().min(1))
  .min(1)
  .describe("Project/model files relative to workspace (.3mf, .stl, etc.)");

const settingOverridesField = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .optional()
  .describe('CLI overrides as --key=value (e.g. { "curr-bed-type": "Cool Plate" })');

const server = new McpServer(
  {
    name: "bambu-studio-mcp",
    version: "1.0.0",
  },
  {
    instructions: `Wraps Bambu Studio CLI for slicing and model inspection. Default execution uses Docker image bambu-studio-mcp:latest (build from this repo). Reference: ${WIKI_CLI_URL}`,
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
      "Slice a 3MF or STL project using Bambu Studio CLI (--slice, --export-3mf, optional settings/filament JSON). Paths are relative to workspace_path.",
    inputSchema: {
      workspace_path: workspaceField,
      input_files: inputFilesField,
      plate_index: z
        .number()
        .int()
        .min(0)
        .describe("0 = all plates; i = plate index i (see upstream CLI docs)"),
      export_3mf: z
        .string()
        .min(1)
        .optional()
        .describe("Relative path for --export-3mf output"),
      debug: z.number().int().min(0).max(5).optional(),
      arrange: z
        .union([z.literal(0), z.literal(1), z.number().int()])
        .optional()
        .describe("0 off, 1 on, any other int = auto (upstream behavior)"),
      orient: z.boolean().optional(),
      scale: z.number().optional(),
      output_dir: z.string().min(1).optional().describe("Relative directory for --outputdir"),
      load_settings_files: z
        .array(z.string().min(1))
        .max(2)
        .optional()
        .describe("0–2 relative paths: machine.json [; process.json]"),
      load_filaments_semicolon: z
        .string()
        .optional()
        .describe('Raw --load-filaments string with workspace-relative paths, e.g. "f1.json;;f3.json"'),
      export_settings: z.string().min(1).optional(),
      export_slicedata: z.string().min(1).optional(),
      load_slicedata: z.string().min(1).optional(),
      uptodate: z.boolean().optional(),
      setting_overrides: settingOverridesField,
    },
  },
  async (args) => {
    const ws = path.resolve(args.workspace_path);
    const cli = buildSliceCliArgs(
      ws,
      {
        debug: args.debug,
        arrange: args.arrange,
        orient: args.orient,
        scale: args.scale,
        output_dir: args.output_dir,
        load_settings_files: args.load_settings_files,
        load_filaments_semicolon: args.load_filaments_semicolon,
        export_3mf: args.export_3mf,
        export_settings: args.export_settings,
        export_slicedata: args.export_slicedata,
        load_slicedata: args.load_slicedata,
        uptodate: args.uptodate,
        setting_overrides: args.setting_overrides,
        plate_index: args.plate_index,
        input_files: args.input_files,
      },
      detectExecMode()
    );

    const result = await runBambuStudio(ws, cli);
    return {
      content: [{ type: "text", text: formatToolOutput(result) }],
      isError: result.code !== 0,
    };
  }
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
      lines.push(`image: ${process.env.BAMBU_STUDIO_IMAGE?.trim() || "bambu-studio-mcp:latest"}`);
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
