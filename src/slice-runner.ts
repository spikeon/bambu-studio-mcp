import path from "node:path";
import { buildSliceCliArgs, type SliceCliInput } from "./slice-args.js";
import { detectExecMode, formatToolOutput, runBambuStudio } from "./runner.js";
import {
  applyStlFilenameFormat,
  collectStlBaselineDirs,
} from "./stl-rename.js";

export async function runSliceFromInput(
  workspacePath: string,
  input: SliceCliInput
): Promise<{ content: { type: "text"; text: string }[]; isError: boolean }> {
  const ws = path.resolve(workspacePath);
  const baselineByDir = await collectStlBaselineDirs(ws, input);
  const cli = buildSliceCliArgs(ws, input, detectExecMode());
  const result = await runBambuStudio(ws, cli);
  let text = formatToolOutput(result);
  let isError = result.code !== 0;

  if (!isError && baselineByDir.size > 0) {
    try {
      const r = await applyStlFilenameFormat(ws, input, baselineByDir);
      if (r.renames.length > 0) {
        text += "\n--- stl filename format (MCP) ---\n";
        for (const x of r.renames) {
          text += `${x.relativeFrom} -> ${x.relativeTo}\n`;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      text += `\n--- stl filename format failed (MCP) ---\n${msg}\n`;
      isError = true;
    }
  }

  return {
    content: [{ type: "text", text }],
    isError,
  };
}
