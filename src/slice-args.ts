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

/**
 * When --outputdir is set, pass only the path relative to that dir to the CLI
 * (avoids upstream doubling paths like /work/out//work/out/file).
 */
function cliPathUnderOutputDir(
  pathRel: string,
  outputDirRel: string | undefined,
  ws: string,
  mode: ExecMode
): string {
  assertRelativeWorkspacePath(pathRel);
  resolveHostPath(ws, pathRel);
  if (!outputDirRel) {
    return mapFileArgs(ws, [pathRel], mode)[0]!;
  }
  assertRelativeWorkspacePath(outputDirRel);
  resolveHostPath(ws, outputDirRel);
  const od = assertRelativeWorkspacePath(outputDirRel);
  const ex = assertRelativeWorkspacePath(pathRel);
  if (ex.startsWith(`${od}/`)) {
    return ex.slice(od.length + 1);
  }
  if (ex === od) {
    throw new Error("path must not be the same as output_dir");
  }
  const parts = ex.split("/");
  return parts[parts.length - 1] ?? ex;
}

function pushOpt(cli: string[], flag: string, v: string | number | undefined): void {
  if (v === undefined) {
    return;
  }
  cli.push(flag, String(v));
}

function pushBoolFlag(cli: string[], flag: string, v: boolean | undefined): void {
  if (v) {
    cli.push(flag);
  }
}

/** Every optional CLI flag we surface (see `bambu-studio --help`). */
export interface SliceCliInput {
  debug?: number;
  plate_index: number;
  input_files: string[];

  setting_overrides?: Record<string, string | number | boolean>;

  load_settings_files?: string[];
  load_filaments_semicolon?: string;

  output_dir?: string;

  /** Arrange / layout */
  arrange?: number;
  /** 0 off, 1 on, other int = auto (upstream `--orient`). */
  orient?: number;
  scale?: number;
  rotate?: number;
  rotate_x?: number;
  rotate_y?: number;
  repetitions?: number;
  assemble?: boolean;
  convert_unit?: boolean;
  /** Upstream takes an option value (often 0/1). */
  ensure_on_bed?: number;

  /** Multicolor / arrange behavior */
  allow_mix_temp?: number;
  allow_multicolor_oneplate?: boolean;
  allow_newer_file?: number;
  allow_rotations?: boolean;
  avoid_extrusion_cali_region?: boolean;

  camera_view?: number;

  clone_objects?: string;

  downward_check?: boolean;
  downward_settings_semicolon?: string;

  enable_timelapse?: boolean;

  load_assemble_list?: string;
  load_custom_gcodes?: string;
  load_filament_ids?: string;

  makerlab_name?: string;
  makerlab_version?: string;
  metadata_name?: string;
  metadata_value?: string;

  skip_modified_gcodes?: number;
  skip_objects?: string;
  skip_useless_pick?: number;

  uptodate_filaments_semicolon?: string;
  uptodate_settings_semicolon?: string;

  export_3mf?: string;
  export_settings?: string;
  export_slicedata?: string;
  export_png?: number;
  /** Bare flag: merge objects into one STL (see `--export-stl`). */
  export_stl?: boolean;
  /** Directory for per-object STLs (`--export-stls`). */
  export_stls?: string;

  /**
   * MCP-only: after a successful export, rename each **new** `.stl` (not present before the run)
   * to `prefix + originalStem + suffix + ".stl"`. The CLI does not support custom mesh filenames.
   */
  stl_export_filename_prefix?: string;
  /** MCP-only: see `stl_export_filename_prefix`. */
  stl_export_filename_suffix?: string;

  load_slicedata?: string;
  load_defaultfila?: number;

  min_save?: number;
  mstpp?: number;
  mtcpp?: number;
  no_check?: boolean;
  normative_check?: number;

  pipe?: string;

  uptodate?: boolean;
}

/** Build argv for `bambu-studio` (paths mapped for docker or native). */
export function buildSliceCliArgs(
  workspaceRoot: string,
  input: SliceCliInput,
  mode: ExecMode
): string[] {
  const ws = path.resolve(workspaceRoot);
  const cli: string[] = [];
  const od = input.output_dir;

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

  pushOpt(cli, "--allow-mix-temp", input.allow_mix_temp);
  pushBoolFlag(cli, "--allow-multicolor-oneplate", input.allow_multicolor_oneplate);
  pushOpt(cli, "--allow-newer-file", input.allow_newer_file);
  pushBoolFlag(cli, "--allow-rotations", input.allow_rotations);
  pushBoolFlag(cli, "--avoid-extrusion-cali-region", input.avoid_extrusion_cali_region);

  pushOpt(cli, "--camera-view", input.camera_view);

  if (input.clone_objects !== undefined) {
    cli.push("--clone-objects", input.clone_objects);
  }

  pushBoolFlag(cli, "--downward-check", input.downward_check);
  if (input.downward_settings_semicolon !== undefined) {
    cli.push(
      "--downward-settings",
      mapSemicolonPaths(ws, input.downward_settings_semicolon, mode)
    );
  }

  pushBoolFlag(cli, "--enable-timelapse", input.enable_timelapse);

  if (input.load_assemble_list) {
    assertRelativeWorkspacePath(input.load_assemble_list);
    resolveHostPath(ws, input.load_assemble_list);
    cli.push("--load-assemble-list", mapFileArgs(ws, [input.load_assemble_list], mode)[0]!);
  }
  if (input.load_custom_gcodes) {
    assertRelativeWorkspacePath(input.load_custom_gcodes);
    resolveHostPath(ws, input.load_custom_gcodes);
    cli.push("--load-custom-gcodes", mapFileArgs(ws, [input.load_custom_gcodes], mode)[0]!);
  }
  if (input.load_filament_ids !== undefined) {
    cli.push("--load-filament-ids", input.load_filament_ids);
  }

  if (input.makerlab_name !== undefined) {
    cli.push("--makerlab-name", input.makerlab_name);
  }
  if (input.makerlab_version !== undefined) {
    cli.push("--makerlab-version", input.makerlab_version);
  }
  if (input.metadata_name !== undefined) {
    cli.push("--metadata-name", input.metadata_name);
  }
  if (input.metadata_value !== undefined) {
    cli.push("--metadata-value", input.metadata_value);
  }

  if (od) {
    assertRelativeWorkspacePath(od);
    resolveHostPath(ws, od);
    cli.push("--outputdir", mapFileArgs(ws, [od], mode)[0]!);
  }

  pushOpt(cli, "--skip-modified-gcodes", input.skip_modified_gcodes);
  if (input.skip_objects !== undefined) {
    cli.push("--skip-objects", input.skip_objects);
  }
  pushOpt(cli, "--skip-useless-pick", input.skip_useless_pick);

  if (input.uptodate_filaments_semicolon !== undefined) {
    cli.push(
      "--uptodate-filaments",
      mapSemicolonPaths(ws, input.uptodate_filaments_semicolon, mode)
    );
  }
  if (input.uptodate_settings_semicolon !== undefined) {
    cli.push(
      "--uptodate-settings",
      mapSemicolonPaths(ws, input.uptodate_settings_semicolon, mode)
    );
  }

  if (input.arrange !== undefined) {
    cli.push("--arrange", String(input.arrange));
  }
  pushBoolFlag(cli, "--assemble", input.assemble);
  pushBoolFlag(cli, "--convert-unit", input.convert_unit);
  pushOpt(cli, "--ensure-on-bed", input.ensure_on_bed);
  if (input.orient !== undefined) {
    cli.push("--orient", String(input.orient));
  }
  pushOpt(cli, "--repetitions", input.repetitions);
  pushOpt(cli, "--rotate", input.rotate);
  pushOpt(cli, "--rotate-x", input.rotate_x);
  pushOpt(cli, "--rotate-y", input.rotate_y);
  if (input.scale !== undefined) {
    cli.push("--scale", String(input.scale));
  }

  if (input.export_3mf) {
    const exportArg = cliPathUnderOutputDir(input.export_3mf, od, ws, mode);
    cli.push("--export-3mf", exportArg);
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
  pushOpt(cli, "--export-png", input.export_png);
  if (input.export_stl) {
    cli.push("--export-stl");
  }
  if (input.export_stls) {
    cli.push("--export-stls", cliPathUnderOutputDir(input.export_stls, od, ws, mode));
  }

  if (input.load_slicedata) {
    assertRelativeWorkspacePath(input.load_slicedata);
    resolveHostPath(ws, input.load_slicedata);
    cli.push("--load-slicedata", mapFileArgs(ws, [input.load_slicedata], mode)[0]!);
  }
  pushOpt(cli, "--load-defaultfila", input.load_defaultfila);

  pushOpt(cli, "--min-save", input.min_save);
  pushOpt(cli, "--mstpp", input.mstpp);
  pushOpt(cli, "--mtcpp", input.mtcpp);
  pushBoolFlag(cli, "--no-check", input.no_check);
  pushOpt(cli, "--normative-check", input.normative_check);

  if (input.pipe !== undefined) {
    cli.push("--pipe", input.pipe);
  }

  if (input.uptodate) {
    cli.push("--uptodate");
  }

  cli.push("--slice", String(input.plate_index));
  cli.push(...mapFileArgs(ws, input.input_files, mode));

  return cli;
}
