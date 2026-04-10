import { describe, expect, it } from "vitest";
import { appendSettingOverrides, buildSliceCliArgs } from "../../src/slice-args.js";

describe("appendSettingOverrides", () => {
  it("emits boolean flags and key=value pairs", () => {
    const args: string[] = [];
    appendSettingOverrides(args, { "curr-bed-type": "Cool Plate", uptodate: true, skip: false });
    expect(args).toContain("--curr-bed-type=Cool Plate");
    expect(args).toContain("--uptodate");
    expect(args.some((a) => a.includes("skip"))).toBe(false);
  });

  it("strips leading -- from keys", () => {
    const args: string[] = [];
    appendSettingOverrides(args, { "--layer-height": 0.2 });
    expect(args).toContain("--layer-height=0.2");
  });
});

describe("buildSliceCliArgs", () => {
  const ws = "/tmp/bambu-ws";

  it("maps paths for docker", () => {
    const argv = buildSliceCliArgs(
      ws,
      {
        plate_index: 0,
        input_files: ["in/model.3mf"],
        export_3mf: "out/sliced.3mf",
        orient: 1,
        arrange: 1,
        scale: 0.5,
        debug: 2,
      },
      "docker"
    );
    const oi = argv.indexOf("--orient");
    expect(oi).toBeGreaterThanOrEqual(0);
    expect(argv[oi + 1]).toBe("1");
    const ar = argv.indexOf("--arrange");
    expect(ar).toBeGreaterThanOrEqual(0);
    expect(argv[ar + 1]).toBe("1");
    expect(argv).toContain("--scale");
    expect(argv).toContain("0.5");
    expect(argv).toContain("--export-3mf");
    expect(argv).toContain("/work/out/sliced.3mf");
    expect(argv).toContain("/work/in/model.3mf");
    expect(argv.indexOf("--slice")).toBeLessThan(argv.indexOf("/work/in/model.3mf"));
  });

  it("maps paths for native (relative)", () => {
    const argv = buildSliceCliArgs(
      ws,
      {
        plate_index: 2,
        input_files: ["moon.3mf"],
        export_3mf: "out.3mf",
      },
      "native"
    );
    expect(argv).toContain("moon.3mf");
    expect(argv).toContain("out.3mf");
    expect(argv).not.toContain("/work/");
  });

  it("includes load-settings and load-filaments patterns for docker", () => {
    const argv = buildSliceCliArgs(
      ws,
      {
        plate_index: 0,
        input_files: ["x.stl"],
        load_settings_files: ["machine.json", "process.json"],
        load_filaments_semicolon: "a.json;;c.json",
      },
      "docker"
    );
    const ls = argv[argv.indexOf("--load-settings") + 1];
    expect(ls).toBe("/work/machine.json;/work/process.json");
    const lf = argv[argv.indexOf("--load-filaments") + 1];
    expect(lf).toBe("/work/a.json;;/work/c.json");
  });

  it("includes outputdir, export-settings, export-slicedata, load-slicedata, uptodate", () => {
    const argv = buildSliceCliArgs(
      ws,
      {
        plate_index: 0,
        input_files: ["p.3mf"],
        output_dir: "exports",
        export_settings: "settings.json",
        export_slicedata: "sdata",
        load_slicedata: "cached",
        uptodate: true,
      },
      "docker"
    );
    expect(argv).toContain("--outputdir");
    expect(argv).toContain("/work/exports");
    expect(argv).toContain("--export-settings");
    expect(argv).toContain("/work/settings.json");
    expect(argv).toContain("--export-slicedata");
    expect(argv).toContain("/work/sdata");
    expect(argv).toContain("--load-slicedata");
    expect(argv).toContain("/work/cached");
    expect(argv).toContain("--uptodate");
  });

  it("uses path under output_dir as relative --export-3mf (avoids upstream path doubling)", () => {
    const argv = buildSliceCliArgs(
      ws,
      {
        plate_index: 0,
        input_files: ["p.3mf"],
        output_dir: "out/sub",
        export_3mf: "out/sub/from_outputdir.3mf",
      },
      "docker"
    );
    const i = argv.indexOf("--export-3mf");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(argv[i + 1]).toBe("from_outputdir.3mf");
    expect(argv[argv.indexOf("--outputdir") + 1]).toBe("/work/out/sub");
  });

  it("places setting_overrides before --debug", () => {
    const argv = buildSliceCliArgs(
      ws,
      {
        plate_index: 0,
        input_files: ["m.3mf"],
        setting_overrides: { "nozzle-diameter": 0.4 },
      },
      "native"
    );
    const dIdx = argv.indexOf("--debug");
    const nIdx = argv.indexOf("--nozzle-diameter=0.4");
    expect(nIdx).toBeGreaterThanOrEqual(0);
    expect(nIdx).toBeLessThan(dIdx);
  });
});
