import { describe, expect, it } from "vitest";
import {
  computeStandardThreeMfName,
  computeTargetStlName,
  dirRelativePath,
  parseBambuExportStlName,
  pathToBrandSuffix,
} from "../../src/catalog-standardize.js";

describe("catalog standardize naming", () => {
  it("pathToBrandSuffix joins segments", () => {
    expect(pathToBrandSuffix("Back/Generator")).toBe("Back - Generator");
    expect(pathToBrandSuffix("")).toBe("");
  });

  it("computeStandardThreeMfName single vs multi", () => {
    expect(computeStandardThreeMfName("ExoGuitar", "Back/Generator", "Configurable Back Plate", 1)).toBe(
      "ExoGuitar - Back - Generator.3mf"
    );
    expect(computeStandardThreeMfName("ExoGuitar", "Back/Generator", "a", 2)).toBe(
      "ExoGuitar - Back - Generator - a.3mf"
    );
  });

  it("parseBambuExportStlName strips step and (digits)", () => {
    const p = parseBambuExportStlName("obj_1_Part Studio 1 (38).step.stl");
    expect(p).toEqual({ objIndex: "1", label: "Part Studio 1" });
    expect(parseBambuExportStlName("obj_2_foo.stl")).toEqual({ objIndex: "2", label: "foo" });
  });

  it("computeTargetStlName matches documented shape", () => {
    const name = computeTargetStlName(
      "ExoGuitar",
      "Back/Generator",
      "project",
      1,
      "1",
      "Part Studio 1"
    );
    expect(name).toBe("ExoGuitar - Back - Generator - Part Studio 1 - obj_1.stl");
    const multi = computeTargetStlName("ExoGuitar", "Back/Generator", "project", 2, "1", "Part Studio 1");
    expect(multi).toBe("ExoGuitar - Back - Generator - project - Part Studio 1 - obj_1.stl");
  });

  it("dirRelativePath", () => {
    expect(dirRelativePath("Back/Generator/x.3mf")).toBe("Back/Generator");
  });
});
