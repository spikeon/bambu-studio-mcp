import path from "node:path";
import { buildSliceCliArgs, type SliceCliInput } from "./slice-args.js";
import { detectExecMode, formatToolOutput, runBambuStudio } from "./runner.js";

export async function runSliceFromInput(
  workspacePath: string,
  input: SliceCliInput
): Promise<{ content: { type: "text"; text: string }[]; isError: boolean }> {
  const ws = path.resolve(workspacePath);
  const cli = buildSliceCliArgs(ws, input, detectExecMode());
  const result = await runBambuStudio(ws, cli);
  return {
    content: [{ type: "text", text: formatToolOutput(result) }],
    isError: result.code !== 0,
  };
}
