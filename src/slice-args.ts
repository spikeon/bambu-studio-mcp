import path from "node:path";
import { assertRelativeWorkspacePath, resolveHostPath } from "./paths.js";
import type { ExecMode } from "./runner.js";
import { mapFileArgs, mapSemicolonPaths } from "./runner.js";

export function appendSettingOverrides(
  args: string[],
  o?: Record<string, string | number | boolean>
): void {
  if (!o) {
    return;
  }
  for (const [rawKey, v] of Object.entries(o)) {
    if (v === false || v === undefined || v === null) {
      continue;
    }
    let key = String(rawKey).trim();
    if (key.startsWith("--")) {
      key = key.slice(2);
    }
    if (v === true) {
      args.push(`--${key}`);
    } else {
      args.push(`--${key}=${String(v)}`);
    }
  }
}

export interface SliceCliInput {
  debug?: number;
  arrange?: number;
  orient?: boolean;
  scale?: number;
  output_dir?: string;
  load_settings_files?: string[];
  load_filaments_semicolon?: string;
  export_3mf?: string;
  export_settings?: string;
  export_slicedata?: string;
  load_slicedata?: string;
  uptodate?: boolean;
  setting_overrides?: Record<string, string | number | boolean>;
  plate_index: number;
  input_files: string[];
}

/** Build argv for `bambu-studio` (paths mapped for docker or native). */
export function buildSliceCliArgs(
  workspaceRoot: string,
  input: SliceCliInput,
  mode: ExecMode
): string[] {
  const ws = path.resolve(workspaceRoot);
  const cli: string[] = [];

  appendSettingOverrides(cli, input.setting_overrides);
  cli.push("--debug", String(input.debug ?? 2));

  if (input.load_settings_files?.length) {
    for (const f of input.load_settings_files) {
      assertRelativeWorkspacePath(f);
      resolveHostPath(ws, f);
    }
    const joined = mapSemicolonPaths(ws, input.load_settings_files.join(";"), mode);
    cli.push("--load-settings", joined);
  }

  if (input.load_filaments_semicolon !== undefined) {
    cli.push("--load-filaments", mapSemicolonPaths(ws, input.load_filaments_semicolon, mode));
  }

  if (input.output_dir) {
    assertRelativeWorkspacePath(input.output_dir);
    resolveHostPath(ws, input.output_dir);
    cli.push("--outputdir", mapFileArgs(ws, [input.output_dir], mode)[0]!);
  }

  if (input.arrange !== undefined) {
    cli.push("--arrange", String(input.arrange));
  }
  if (input.orient) {
    cli.push("--orient");
  }
  if (input.scale !== undefined) {
    cli.push("--scale", String(input.scale));
  }
  if (input.export_3mf) {
    assertRelativeWorkspacePath(input.export_3mf);
    resolveHostPath(ws, input.export_3mf);
    cli.push("--export-3mf", mapFileArgs(ws, [input.export_3mf], mode)[0]!);
  }
  if (input.export_settings) {
    assertRelativeWorkspacePath(input.export_settings);
    resolveHostPath(ws, input.export_settings);
    cli.push("--export-settings", mapFileArgs(ws, [input.export_settings], mode)[0]!);
  }
  if (input.export_slicedata) {
    assertRelativeWorkspacePath(input.export_slicedata);
    resolveHostPath(ws, input.export_slicedata);
    cli.push("--export-slicedata", mapFileArgs(ws, [input.export_slicedata], mode)[0]!);
  }
  if (input.load_slicedata) {
    assertRelativeWorkspacePath(input.load_slicedata);
    resolveHostPath(ws, input.load_slicedata);
    cli.push("--load-slicedata", mapFileArgs(ws, [input.load_slicedata], mode)[0]!);
  }
  if (input.uptodate) {
    cli.push("--uptodate");
  }

  cli.push("--slice", String(input.plate_index));
  cli.push(...mapFileArgs(ws, input.input_files, mode));

  return cli;
}
