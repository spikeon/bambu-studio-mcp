import { describe, expect, it } from "vitest";
import {
  extractModelsFrom3mfToCliInput,
  pipelineOutputsSliceToCliInput,
  presetSliceToCliInput,
  quickSliceToCliInput,
} from "../../src/workflow-slice.js";

describe("workflow slice mappers", () => {
  it("quickSliceToCliInput omits STL/PNG fields", () => {
    const i = quickSliceToCliInput({
      plate_index: 0,
      input_files: ["a.3mf"],
      export_3mf: "out/sliced.3mf",
    });
    expect(i.export_stl).toBeUndefined();
    expect(i.export_3mf).toBe("out/sliced.3mf");
  });

  it("presetSliceToCliInput carries load-settings", () => {
    const i = presetSliceToCliInput({
      plate_index: 1,
      input_files: ["x.stl"],
      export_3mf: "o.3mf",
      load_settings_files: ["m.json", "p.json"],
    });
    expect(i.load_settings_files).toEqual(["m.json", "p.json"]);
  });

  it("extractModelsFrom3mfToCliInput sets export_stl or export_stls", () => {
    const merged = extractModelsFrom3mfToCliInput({
      mode: "merged_single_stl",
      three_mf_file: "in/project.3mf",
      plate_index: 0,
    });
    expect(merged.export_stl).toBe(true);
    expect(merged.input_files).toEqual(["in/project.3mf"]);

    const many = extractModelsFrom3mfToCliInput({
      mode: "per_object_stls",
      three_mf_file: "in/project.3mf",
      plate_index: 1,
      stls_directory: "out/meshes",
    });
    expect(many.export_stls).toBe("out/meshes");
    expect(many.export_stl).toBeUndefined();
  });

  it("pipelineOutputsSliceToCliInput allows export_3mf omitted", () => {
    const i = pipelineOutputsSliceToCliInput({
      plate_index: 0,
      input_files: ["a.3mf"],
      export_stls: "stls",
    });
    expect(i.export_3mf).toBeUndefined();
    expect(i.export_stls).toBe("stls");
  });
});
