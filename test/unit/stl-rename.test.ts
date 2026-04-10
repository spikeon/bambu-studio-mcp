import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SliceCliInput } from "../../src/slice-args.js";
import {
  applyStlFilenameFormat,
  collectStlBaselineDirs,
} from "../../src/stl-rename.js";

describe("stl-rename", () => {
  let ws = "";

  afterEach(async () => {
    if (ws) {
      await import("node:fs/promises").then((fs) =>
        fs.rm(ws, { recursive: true, force: true })
      );
    }
  });

  it("collectStlBaselineDirs skips when no prefix/suffix", async () => {
    ws = await mkdtemp(join(tmpdir(), "bambu-stl-"));
    const input: SliceCliInput = {
      plate_index: 0,
      input_files: ["m.3mf"],
      export_stls: "out",
    };
    const m = await collectStlBaselineDirs(ws, input);
    expect(m.size).toBe(0);
  });

  it("renames only new STLs in export_stls directory", async () => {
    ws = await mkdtemp(join(tmpdir(), "bambu-stl-"));
    const outRel = "meshes";
    await mkdir(join(ws, outRel), { recursive: true });
    await writeFile(join(ws, outRel, "old.stl"), "x");

    const input: SliceCliInput = {
      plate_index: 0,
      input_files: ["p.3mf"],
      export_stls: outRel,
      stl_export_filename_prefix: "pre-",
      stl_export_filename_suffix: "-suf",
    };
    const baseline = await collectStlBaselineDirs(ws, input);
    expect(baseline.get(join(ws, outRel))?.has("old.stl")).toBe(true);

    await writeFile(join(ws, outRel, "newfile.stl"), "mesh");

    const r = await applyStlFilenameFormat(ws, input, baseline);
    expect(r.renames).toEqual([
      {
        relativeFrom: "meshes/newfile.stl",
        relativeTo: "meshes/pre-newfile-suf.stl",
      },
    ]);
    const { access, readdir } = await import("node:fs/promises");
    await expect(access(join(ws, outRel, "pre-newfile-suf.stl"))).resolves.toBeUndefined();
    const names = await readdir(join(ws, outRel));
    expect(names.sort()).toEqual(["old.stl", "pre-newfile-suf.stl"].sort());
  });

  it("throws when target basename already exists", async () => {
    ws = await mkdtemp(join(tmpdir(), "bambu-stl-"));
    const outRel = "meshes";
    await mkdir(join(ws, outRel), { recursive: true });
    await writeFile(join(ws, outRel, "pre-x-suf.stl"), "existing");

    const input: SliceCliInput = {
      plate_index: 0,
      input_files: ["p.3mf"],
      export_stls: outRel,
      stl_export_filename_prefix: "pre-",
      stl_export_filename_suffix: "-suf",
    };
    const baseline = await collectStlBaselineDirs(ws, input);
    await writeFile(join(ws, outRel, "x.stl"), "new");

    await expect(applyStlFilenameFormat(ws, input, baseline)).rejects.toThrow(/already exists/);
  });

});
