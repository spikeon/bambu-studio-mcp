import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { SliceCliInput } from "./slice-args.js";
import { buildSliceCliArgs } from "./slice-args.js";
import { detectExecMode } from "./runner.js";
import { runBambuStudio } from "./runner.js";

/** Skip walking into these directory names (consumer monorepo conventions). */
export const DEFAULT_SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  ".3d-viewer",
  ".print-profiles",
  "print-profiles",
]);

/** Our temp export dirs under a part folder — never walk into these. */
export const BAMBU_STL_EXPORT_DIR_PREFIX = ".bambu-stl-export-";

export type CatalogFileResult = {
  three_mf_relative: string;
  ok: boolean;
  error?: string;
  renamed_three_mf_to?: string;
  stl_files_written?: string[];
  command_summary?: string;
};

export type CatalogStandardizeSummary = {
  ok: boolean;
  models_root: string;
  brand: string;
  files_total: number;
  files_ok: number;
  files_failed: number;
  /** Present when no `.3mf` files were discovered. */
  note?: string;
  results: CatalogFileResult[];
};

export type StandardizeCatalogOptions = {
  modelsRoot: string;
  brand: string;
  renameThreeMf: boolean;
  dedupeRealpath: boolean;
  skipDirNames: Set<string>;
  /** If set, write STLs under `path.join(partDir, stlOutputSubpath)` instead of partDir. */
  stlOutputSubpath?: string;
  debug?: number;
};

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/** Relative path from models root to file, forward slashes. */
export function relativeUnderModelsRoot(modelsRootAbs: string, fileAbs: string): string {
  const rel = path.relative(modelsRootAbs, fileAbs);
  return toPosix(rel);
}

/** Directory part of relative path: `a/b/c.3mf` → `a/b` */
export function dirRelativePath(relativeFilePath: string): string {
  const d = path.posix.dirname(relativeFilePath);
  return d === "." ? "" : d;
}

/** `Back/Generator` → `Back - Generator` */
export function pathToBrandSuffix(dirRel: string): string {
  if (!dirRel) {
    return "";
  }
  return dirRel.split("/").join(" - ");
}

/**
 * Single .3mf in folder: `{Brand} - {slot path with " - "}.3mf`
 * Multiple: `{Brand} - {slot path} - {originalStem}.3mf`
 */
export function computeStandardThreeMfName(
  brand: string,
  dirRel: string,
  originalStem: string,
  siblingThreeMfCount: number
): string {
  const slot = pathToBrandSuffix(dirRel);
  const base = slot ? `${brand} - ${slot}` : brand;
  if (siblingThreeMfCount <= 1) {
    return `${base}.3mf`;
  }
  return `${base} - ${originalStem}.3mf`;
}

/**
 * Parse Bambu `--export-stls` filenames like `obj_1_Part Studio 1 (38).step.stl`.
 * Returns obj index string and human label.
 */
export function parseBambuExportStlName(fileBase: string): { objIndex: string; label: string } | null {
  const m = /^obj_(\d+)_(.+)\.stl$/i.exec(fileBase);
  if (!m) {
    return null;
  }
  let rest = m[2]!;
  if (rest.toLowerCase().endsWith(".step")) {
    rest = rest.slice(0, -".step".length);
  }
  rest = rest.replace(/\s+\(\d+\)\s*$/, "").trim();
  return { objIndex: m[1]!, label: rest || `obj_${m[1]}` };
}

export function computeTargetStlName(
  brand: string,
  dirRel: string,
  sourceThreeMfStem: string,
  siblingThreeMfCount: number,
  objIndex: string,
  objectLabel: string
): string {
  const slot = pathToBrandSuffix(dirRel);
  const pathPart = slot ? `${brand} - ${slot}` : brand;
  const multiSource = siblingThreeMfCount > 1;
  const middle = multiSource
    ? `${pathPart} - ${sourceThreeMfStem} - ${objectLabel}`
    : `${pathPart} - ${objectLabel}`;
  return `${middle} - obj_${objIndex}.stl`;
}

async function safeRenameFile(src: string, dst: string): Promise<void> {
  const tmp = path.join(
    path.dirname(dst),
    `.tmp-${randomBytes(8).toString("hex")}-${path.basename(dst)}`
  );
  await fs.rename(src, tmp);
  try {
    await fs.rename(tmp, dst);
  } catch (e) {
    await fs.rename(tmp, src).catch(() => {});
    throw e;
  }
}

async function walkThreeMfFiles(
  dir: string,
  modelsRoot: string,
  skipNames: Set<string>,
  out: string[]
): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name as string);
    if (e.isDirectory()) {
      if (skipNames.has(e.name)) {
        continue;
      }
      if (e.name.startsWith(BAMBU_STL_EXPORT_DIR_PREFIX)) {
        continue;
      }
      await walkThreeMfFiles(full, modelsRoot, skipNames, out);
      continue;
    }
    if (e.isFile() && e.name.toLowerCase().endsWith(".3mf")) {
      out.push(full);
    }
  }
}

export async function standardizeCatalogMeshes(
  opts: StandardizeCatalogOptions
): Promise<CatalogStandardizeSummary> {
  const modelsRoot = path.resolve(opts.modelsRoot);
  const brand = opts.brand.trim();
  const results: CatalogFileResult[] = [];
  const seenReal = new Set<string>();

  const allFiles: string[] = [];
  await walkThreeMfFiles(modelsRoot, modelsRoot, opts.skipDirNames, allFiles);

  const threeMfCountByDir = new Map<string, number>();
  for (const f of allFiles) {
    const dir = path.dirname(f);
    threeMfCountByDir.set(dir, (threeMfCountByDir.get(dir) ?? 0) + 1);
  }

  for (const abs of allFiles) {
    if (opts.dedupeRealpath) {
      try {
        const rp = await fs.realpath(abs);
        if (seenReal.has(rp)) {
          continue;
        }
        seenReal.add(rp);
      } catch {
        /* use abs */
      }
    }

    const rel = relativeUnderModelsRoot(modelsRoot, abs);
    const dirAbs = path.dirname(abs);
    const siblingCount = threeMfCountByDir.get(dirAbs) ?? 1;
    const stem = path.basename(abs, path.extname(abs));

    const fileResult: CatalogFileResult = { three_mf_relative: rel, ok: false };

    try {
      let workingAbs = abs;
      let workingRel = rel;

      if (opts.renameThreeMf) {
        const dirRel = dirRelativePath(rel);
        const targetStem = computeStandardThreeMfName(brand, dirRel, stem, siblingCount);
        const targetAbs = path.join(dirAbs, targetStem);
        if (path.resolve(targetAbs) !== path.resolve(abs)) {
          if (
            await fs
              .stat(targetAbs)
              .then(() => true)
              .catch(() => false)
          ) {
            throw new Error(`Refusing to overwrite existing file: ${targetStem}`);
          }
          await safeRenameFile(abs, targetAbs);
          fileResult.renamed_three_mf_to = toPosix(path.relative(modelsRoot, targetAbs));
          workingAbs = targetAbs;
          workingRel = relativeUnderModelsRoot(modelsRoot, workingAbs);
        }
      }

      const parentPosix = path.posix.dirname(workingRel);
      const exportRelDir =
        parentPosix === "." || parentPosix === ""
          ? `${BAMBU_STL_EXPORT_DIR_PREFIX}${randomBytes(6).toString("hex")}`
          : `${parentPosix}/${BAMBU_STL_EXPORT_DIR_PREFIX}${randomBytes(6).toString("hex")}`;
      const exportAbsDir = path.join(modelsRoot, ...exportRelDir.split("/").filter((s) => s.length > 0));
      await fs.mkdir(exportAbsDir, { recursive: true });

      const sliceInput: SliceCliInput = {
        plate_index: 0,
        input_files: [workingRel],
        export_stls: exportRelDir,
        debug: opts.debug ?? 2,
      };

      const mode = detectExecMode();
      const cli = buildSliceCliArgs(modelsRoot, sliceInput, mode);
      const run = await runBambuStudio(modelsRoot, cli);
      fileResult.command_summary = run.commandSummary;

      if (run.code !== 0) {
        fileResult.error = `bambu-studio exit ${run.code}\n${run.stderr.slice(-4000)}`;
        results.push(fileResult);
        await fs.rm(exportAbsDir, { recursive: true, force: true }).catch(() => {});
        continue;
      }

      let stlNames: string[];
      try {
        stlNames = (await fs.readdir(exportAbsDir)).filter((n) => n.toLowerCase().endsWith(".stl"));
      } catch (e) {
        fileResult.error = `No STL listing: ${e instanceof Error ? e.message : String(e)}`;
        results.push(fileResult);
        await fs.rm(exportAbsDir, { recursive: true, force: true }).catch(() => {});
        continue;
      }

      const destBaseDir = opts.stlOutputSubpath
        ? path.join(dirAbs, opts.stlOutputSubpath)
        : dirAbs;
      await fs.mkdir(destBaseDir, { recursive: true });

      const written: string[] = [];
      const workStem = path.basename(workingAbs, ".3mf");

      for (const stlBase of stlNames) {
        const parsed = parseBambuExportStlName(stlBase);
        if (!parsed) {
          throw new Error(`Unrecognized STL export name: ${stlBase}`);
        }
        const targetName = computeTargetStlName(
          brand,
          dirRelativePath(workingRel),
          workStem,
          siblingCount,
          parsed.objIndex,
          parsed.label
        );
        const destAbs = path.join(destBaseDir, targetName);
        if (
          await fs
            .stat(destAbs)
            .then(() => true)
            .catch(() => false)
        ) {
          throw new Error(`STL target already exists: ${targetName}`);
        }
        await safeRenameFile(path.join(exportAbsDir, stlBase), destAbs);
        written.push(toPosix(path.relative(modelsRoot, destAbs)));
      }

      fileResult.ok = true;
      fileResult.stl_files_written = written;
      results.push(fileResult);

      await fs.rm(exportAbsDir, { recursive: true, force: true }).catch(() => {});
    } catch (e) {
      fileResult.error = e instanceof Error ? e.message : String(e);
      results.push(fileResult);
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const n = results.length;
  return {
    ok: n === 0 || okCount === n,
    models_root: toPosix(modelsRoot),
    brand,
    files_total: n,
    files_ok: okCount,
    files_failed: n - okCount,
    ...(n === 0 ? { note: "No .3mf files found under models_root (after skip rules)." as const } : {}),
    results,
  };
}

