import fs from "node:fs/promises";
import path from "node:path";
import { resolveHostPath } from "./paths.js";
import type { SliceCliInput } from "./slice-args.js";

export interface StlRenameResult {
  renames: { relativeFrom: string; relativeTo: string }[];
}

function wantsStlRename(input: SliceCliInput): boolean {
  const p = input.stl_export_filename_prefix?.trim() ?? "";
  const s = input.stl_export_filename_suffix?.trim() ?? "";
  return p !== "" || s !== "";
}

async function listStlBasenames(dirAbs: string): Promise<Set<string>> {
  let names: string[];
  try {
    names = await fs.readdir(dirAbs);
  } catch {
    return new Set();
  }
  return new Set(names.filter((n) => n.toLowerCase().endsWith(".stl")));
}

function buildNewBasename(
  oldBasename: string,
  prefix: string,
  suffix: string
): string {
  const stem = path.basename(oldBasename, path.extname(oldBasename));
  return `${prefix}${stem}${suffix}.stl`;
}

/**
 * After a successful `bambu-studio` run, rename newly created STL files (not present
 * before the invocation) using optional prefix/suffix on the basename (MCP-only; the
 * CLI does not support custom mesh filenames).
 */
export async function applyStlFilenameFormat(
  workspaceRoot: string,
  input: SliceCliInput,
  baselineByDir: Map<string, Set<string>>
): Promise<StlRenameResult> {
  if (!wantsStlRename(input)) {
    return { renames: [] };
  }
  const prefix = input.stl_export_filename_prefix?.trim() ?? "";
  const suffix = input.stl_export_filename_suffix?.trim() ?? "";

  const renames: { relativeFrom: string; relativeTo: string }[] = [];
  const ws = path.resolve(workspaceRoot);

  for (const [dirAbs, baseline] of baselineByDir) {
    const current = await listStlBasenames(dirAbs);
    const added = [...current].filter((b) => !baseline.has(b));
    if (added.length === 0) {
      continue;
    }

    const planned = added.map((oldBase) => {
      const newBase = buildNewBasename(oldBase, prefix, suffix);
      return { oldBase, newBase };
    });

    const newNames = new Set(planned.map((p) => p.newBase));
    if (newNames.size !== planned.length) {
      throw new Error(
        `stl_export filename format would collide: duplicate target names under ${dirAbs}`
      );
    }

    for (const { oldBase, newBase } of planned) {
      if (oldBase === newBase) {
        continue;
      }
      const toAbs = path.join(dirAbs, newBase);
      try {
        await fs.access(toAbs);
        throw new Error(
          `Cannot rename STL to ${newBase}: file already exists at ${toAbs}`
        );
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("Cannot rename")) {
          throw e;
        }
        const err = e as NodeJS.ErrnoException;
        if (err?.code !== "ENOENT") {
          throw e;
        }
      }
    }

    for (const { oldBase, newBase } of planned) {
      if (oldBase === newBase) {
        continue;
      }
      const fromAbs = path.join(dirAbs, oldBase);
      const toAbs = path.join(dirAbs, newBase);
      await fs.rename(fromAbs, toAbs);
      const relDir = path.relative(ws, dirAbs);
      const relFrom = path.join(relDir, oldBase).replace(/\\/g, "/");
      const relTo = path.join(relDir, newBase).replace(/\\/g, "/");
      renames.push({ relativeFrom: relFrom, relativeTo: relTo });
    }
  }

  return { renames };
}

/** Directories to snapshot for STL baseline (before running the slicer). */
export async function collectStlBaselineDirs(
  workspaceRoot: string,
  input: SliceCliInput
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  if (!wantsStlRename(input)) {
    return map;
  }
  const ws = path.resolve(workspaceRoot);

  const addDir = async (relOrAbs: string | undefined, isRel: boolean) => {
    if (!relOrAbs) {
      return;
    }
    const abs = isRel ? resolveHostPath(ws, relOrAbs) : relOrAbs;
    const key = path.resolve(abs);
    if (!map.has(key)) {
      map.set(key, await listStlBasenames(key));
    }
  };

  if (input.export_stls) {
    await addDir(input.export_stls, true);
  }
  if (input.export_stl) {
    const first = input.input_files[0];
    if (first) {
      const mergedDir = input.output_dir
        ? resolveHostPath(ws, input.output_dir)
        : resolveHostPath(ws, path.dirname(first));
      await addDir(mergedDir, false);
    }
  }

  return map;
}
