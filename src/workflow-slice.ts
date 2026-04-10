import type { SliceCliInput } from "./slice-args.js";

/** “Kitchen sink” tool: every optional CLI field this server exposes (validated by Zod in index). */
export function fullSliceToolToCliInput(
  args: Record<string, unknown> & { workspace_path: string }
): SliceCliInput {
  const { workspace_path: _w, ...rest } = args;
  return rest as unknown as SliceCliInput;
}

/** Map MCP “quick slice” tool args → CLI input (slice project → one 3MF). */
export function quickSliceToCliInput(args: {
  plate_index: number;
  input_files: string[];
  export_3mf: string;
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

/** Orient / arrange / scale / rotate, then slice → 3MF. */
export function layoutSliceToCliInput(
  args: Parameters<typeof quickSliceToCliInput>[0] & {
    arrange?: number;
    orient?: number;
    scale?: number;
    rotate?: number;
    rotate_x?: number;
    rotate_y?: number;
    repetitions?: number;
    assemble?: boolean;
    convert_unit?: boolean;
    ensure_on_bed?: number;
  }
): SliceCliInput {
  return {
    ...quickSliceToCliInput(args),
    arrange: args.arrange,
    orient: args.orient,
    scale: args.scale,
    rotate: args.rotate,
    rotate_x: args.rotate_x,
    rotate_y: args.rotate_y,
    repetitions: args.repetitions,
    assemble: args.assemble,
    convert_unit: args.convert_unit,
    ensure_on_bed: args.ensure_on_bed,
  };
}

/** Load machine/process/filament JSON, then slice → 3MF. */
export function presetSliceToCliInput(
  args: Parameters<typeof quickSliceToCliInput>[0] & {
    load_settings_files?: string[];
    load_filaments_semicolon?: string;
  }
): SliceCliInput {
  return {
    ...quickSliceToCliInput(args),
    load_settings_files: args.load_settings_files,
    load_filaments_semicolon: args.load_filaments_semicolon,
  };
}

/** Export mesh geometry from a 3MF using `--export-stl` (one merged mesh) or `--export-stls` (one file per object). */
export function extractModelsFrom3mfToCliInput(
  args:
    | {
        mode: "merged_single_stl";
        three_mf_file: string;
        plate_index: number;
        output_dir?: string;
        debug?: number;
        stl_export_filename_prefix?: string;
        stl_export_filename_suffix?: string;
      }
    | {
        mode: "per_object_stls";
        three_mf_file: string;
        stls_directory: string;
        plate_index: number;
        output_dir?: string;
        debug?: number;
        stl_export_filename_prefix?: string;
        stl_export_filename_suffix?: string;
      }
): SliceCliInput {
  const input_files = [args.three_mf_file];
  const fmt = {
    stl_export_filename_prefix: args.stl_export_filename_prefix,
    stl_export_filename_suffix: args.stl_export_filename_suffix,
  };
  const base: SliceCliInput = {
    plate_index: args.plate_index,
    input_files,
    output_dir: args.output_dir,
    debug: args.debug,
    ...fmt,
  };
  if (args.mode === "merged_single_stl") {
    return { ...base, export_stl: true };
  }
  return { ...base, export_stls: args.stls_directory };
}

/** Slice and write auxiliary artifacts (output dir, settings JSON, slicedata, STLs, PNG, etc.). */
export function pipelineOutputsSliceToCliInput(args: {
  plate_index: number;
  input_files: string[];
  export_3mf?: string;
  output_dir?: string;
  export_settings?: string;
  export_slicedata?: string;
  load_slicedata?: string;
  export_png?: number;
  export_stl?: boolean;
  export_stls?: string;
  camera_view?: number;
  debug?: number;
  setting_overrides?: Record<string, string | number | boolean>;
  uptodate?: boolean;
  stl_export_filename_prefix?: string;
  stl_export_filename_suffix?: string;
}): SliceCliInput {
  return {
    plate_index: args.plate_index,
    input_files: args.input_files,
    export_3mf: args.export_3mf,
    output_dir: args.output_dir,
    export_settings: args.export_settings,
    export_slicedata: args.export_slicedata,
    load_slicedata: args.load_slicedata,
    export_png: args.export_png,
    export_stl: args.export_stl,
    export_stls: args.export_stls,
    camera_view: args.camera_view,
    debug: args.debug,
    setting_overrides: args.setting_overrides,
    uptodate: args.uptodate,
    stl_export_filename_prefix: args.stl_export_filename_prefix,
    stl_export_filename_suffix: args.stl_export_filename_suffix,
  };
}
