import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertRelativeWorkspacePath,
  resolveHostPath,
  toContainerPath,
} from "../../src/paths.js";

describe("assertRelativeWorkspacePath", () => {
  it("accepts simple relative paths", () => {
    expect(assertRelativeWorkspacePath("models/a.3mf")).toBe("models/a.3mf");
    expect(assertRelativeWorkspacePath("out\\x.stl")).toBe("out/x.stl");
  });

  it("rejects traversal", () => {
    expect(() => assertRelativeWorkspacePath("../etc/passwd")).toThrow("..");
  });

  it("rejects absolute paths", () => {
    expect(() => assertRelativeWorkspacePath("/tmp/x")).toThrow("relative");
  });
});

describe("resolveHostPath", () => {
  it("resolves under workspace", () => {
    const ws = path.join(os.tmpdir(), "bambu-mcp-path-test");
    expect(resolveHostPath(ws, "a/b.3mf")).toBe(path.resolve(ws, "a", "b.3mf"));
  });

  it("rejects escape", () => {
    const ws = path.join(os.tmpdir(), "bambu-mcp-path-test2");
    expect(() => resolveHostPath(ws, "a/../../outside")).toThrow();
  });
});

describe("toContainerPath", () => {
  it("maps to /work prefix", () => {
    expect(toContainerPath("models/x.3mf")).toBe("/work/models/x.3mf");
  });
});
