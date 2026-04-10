import { describe, expect, it } from "vitest";
import {
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
