import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { assertRelativeWorkspacePath, resolveHostPath } from "./paths.js";
import { runSliceFromInput } from "./slice-runner.js";
import { extractModelsFrom3mfToCliInput } from "./workflow-slice.js";

function posixStemFrom3mfBasename(fileBase: string): string {
  const lower = fileBase.toLowerCase();
  if (lower.endsWith(".3mf") && fileBase.length > 4) {
    return fileBase.slice(0, -4);
  }
  return path.basename(fileBase, path.extname(fileBase));
}

/**
 * Move every `.stl` from `tempRel` into the parent folder of `threeMfFileRel` (same directory as the .3mf).
 * Fails if a target filename already exists in the destination.
 */
export async function moveStlsFromTempBesideThreeMf(
  workspaceRoot: string,
  threeMfFileRel: string,
  tempRel: string
): Promise<string[]> {
  const ws = path.resolve(workspaceRoot);
  const posixThree = assertRelativeWorkspacePath(threeMfFileRel);
  const dirRel = path.posix.dirname(posixThree);
  const parentAbs =
    dirRel === "." ? resolveHostPath(ws, ".") : resolveHostPath(ws, dirRel);
  const tempAbs = resolveHostPath(ws, tempRel);

  const names = await fs.readdir(tempAbs);
  const stlNames = names.filter((n) => n.toLowerCase().endsWith(".stl"));
  const movedRel: string[] = [];

  for (const name of stlNames) {
    const fromAbs = path.join(tempAbs, name);
    const toAbs = path.join(parentAbs, name);
    try {
      await fs.access(toAbs);
      throw new Error(
        `Refusing to overwrite existing STL beside the .3mf: ${name}`
      );
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Refusing")) {
        throw e;
      }
      const err = e as NodeJS.ErrnoException;
      if (err?.code !== "ENOENT") {
        throw e;
      }
    }
    await fs.rename(fromAbs, toAbs);
    const relOut =
      dirRel === "." ? name.replace(/\\/g, "/") : `${dirRel}/${name}`.replace(/\\/g, "/");
    movedRel.push(relOut);
  }

  return movedRel;
}

export async function extractPrefixedStlsBesideThreeMf(
  workspaceRoot: string,
  threeMfFileRel: string,
  plateIndex: number,
  debug?: number
): Promise<{ content: { type: "text"; text: string }[]; isError: boolean }> {
  const ws = path.resolve(workspaceRoot);
  const posixThree = assertRelativeWorkspacePath(threeMfFileRel.replace(/\\/g, "/"));
  const base = path.posix.basename(posixThree);
  if (!base.toLowerCase().endsWith(".3mf")) {
    throw new Error("three_mf_file must be a .3mf path");
  }

  const dirRel = path.posix.dirname(posixThree);
  const stem = posixStemFrom3mfBasename(base);
  const rnd = randomBytes(8).toString("hex");
  const tempRel =
    dirRel === "."
      ? `.bambu-mcp-prefixed-stl-${rnd}`
      : `${dirRel}/.bambu-mcp-prefixed-stl-${rnd}`;

  await fs.mkdir(resolveHostPath(ws, tempRel), { recursive: true });

  const input = extractModelsFrom3mfToCliInput({
    mode: "per_object_stls",
    three_mf_file: posixThree,
    plate_index: plateIndex,
    stls_directory: tempRel,
    stl_export_filename_prefix: `${stem} - `,
    debug,
  });

  const sliceResult = await runSliceFromInput(ws, input);
  const baseText = sliceResult.content[0]?.text ?? "";

  if (sliceResult.isError) {
    await fs.rm(resolveHostPath(ws, tempRel), { recursive: true, force: true }).catch(
      () => {}
    );
    return sliceResult;
  }

  try {
    const moved = await moveStlsFromTempBesideThreeMf(ws, posixThree, tempRel);
    let text = baseText;
    if (moved.length > 0) {
      text += "\n--- moved beside .3mf (MCP) ---\n";
      for (const r of moved) {
        text += `${r}\n`;
      }
    } else {
      text +=
        "\n--- note (MCP) ---\nNo .stl files were found in the temp export folder; temp dir removed.\n";
    }
    await fs.rm(resolveHostPath(ws, tempRel), { recursive: true, force: true });
    return {
      content: [{ type: "text", text }],
      isError: false,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const tempNote = `Temporary export folder was left in place: ${tempRel}`;
    return {
      content: [
        {
          type: "text",
          text:
            baseText +
            `\n--- move beside .3mf failed (MCP) ---\n${msg}\n${tempNote}\n`,
        },
      ],
      isError: true,
    };
  }
}
