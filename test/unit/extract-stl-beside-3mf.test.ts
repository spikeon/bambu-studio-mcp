import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { moveStlsFromTempBesideThreeMf } from "../../src/extract-stl-beside-3mf.js";

describe("extract-stl-beside-3mf", () => {
  let ws = "";

  afterEach(async () => {
    if (ws) {
      await import("node:fs/promises").then((fs) =>
        fs.rm(ws, { recursive: true, force: true })
      );
    }
  });

  it("moveStlsFromTempBesideThreeMf moves stls next to the .3mf", async () => {
    ws = await mkdtemp(join(tmpdir(), "bambu-beside-"));
    await mkdir(join(ws, "parts"), { recursive: true });
    await writeFile(join(ws, "parts", "widget.3mf"), "3mf");

    const tempRel = "parts/.bambu-mcp-prefixed-stl-test";
    await mkdir(join(ws, tempRel), { recursive: true });
    await writeFile(join(ws, tempRel, "widget - a.stl"), "solid");

    const moved = await moveStlsFromTempBesideThreeMf(ws, "parts/widget.3mf", tempRel);
    expect(moved.sort()).toEqual(["parts/widget - a.stl"].sort());

    const stl = await readFile(join(ws, "parts", "widget - a.stl"), "utf8");
    expect(stl).toBe("solid");
  });

  it("moveStlsFromTempBesideThreeMf refuses to clobber an existing file", async () => {
    ws = await mkdtemp(join(tmpdir(), "bambu-beside-"));
    await mkdir(join(ws, "parts"), { recursive: true });
    await writeFile(join(ws, "parts", "widget.3mf"), "3mf");
    await writeFile(join(ws, "parts", "widget - a.stl"), "old");

    const tempRel = "parts/.bambu-mcp-prefixed-stl-test";
    await mkdir(join(ws, tempRel), { recursive: true });
    await writeFile(join(ws, tempRel, "widget - a.stl"), "new");

    await expect(
      moveStlsFromTempBesideThreeMf(ws, "parts/widget.3mf", tempRel)
    ).rejects.toThrow(/Refusing to overwrite/);
  });
});
