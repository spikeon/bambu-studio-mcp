import { spawn } from "node:child_process";
import path from "node:path";
import { assertRelativeWorkspacePath, resolveHostPath, toContainerPath } from "./paths.js";

export type ExecMode = "docker" | "native";

function getTimeoutMs(): number {
  const raw = process.env.BAMBU_STUDIO_TIMEOUT_MS;
  if (!raw) {
    return 3_600_000;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 3_600_000;
}

function getDockerBin(): string {
  return process.env.BAMBU_STUDIO_DOCKER_BIN?.trim() || "docker";
}

function getDockerImage(): string {
  return process.env.BAMBU_STUDIO_IMAGE?.trim() || "bambu-studio-mcp:latest";
}

function getNativeBin(): string {
  const b = process.env.BAMBU_STUDIO_BIN?.trim();
  if (b) {
    return b;
  }
  if (process.platform === "win32") {
    return "C:\\Program Files\\Bambu Studio\\bambu-studio.exe";
  }
  return "bambu-studio";
}

function parseExtraDockerArgs(): string[] {
  const s = process.env.BAMBU_STUDIO_DOCKER_RUN_ARGS?.trim();
  if (!s) {
    return [];
  }
  // Minimal split: space-separated tokens; users can repeat flag pairs.
  return s.split(/\s+/).filter(Boolean);
}

export function detectExecMode(): ExecMode {
  const m = process.env.BAMBU_STUDIO_EXEC_MODE?.trim().toLowerCase();
  if (m === "native" || m === "docker") {
    return m;
  }
  return "docker";
}

function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string }
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const timeoutMs = getTimeoutMs();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString("utf8");
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error(`Timed out after ${timeoutMs}ms (set BAMBU_STUDIO_TIMEOUT_MS to adjust)`)
      );
    }, timeoutMs);
    child.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

export async function runBambuStudio(
  workspaceRoot: string,
  cliArgs: string[]
): Promise<{ code: number | null; stdout: string; stderr: string; commandSummary: string }> {
  const mode = detectExecMode();
  const resolvedRoot = path.resolve(workspaceRoot);

  if (mode === "native") {
    const bin = getNativeBin();
    const summary = `${bin} ${cliArgs.map((a) => JSON.stringify(a)).join(" ")}`;
    const result = await runProcess(bin, cliArgs, { cwd: resolvedRoot });
    return { ...result, commandSummary: summary };
  }

  const docker = getDockerBin();
  const image = getDockerImage();
  const mount = `${resolvedRoot}:/work`;
  const dockerArgs = [
    "run",
    "--rm",
    "-v",
    mount,
    "-w",
    "/work",
    ...parseExtraDockerArgs(),
    image,
    ...cliArgs,
  ];
  const summary = `${docker} ${dockerArgs.map((a) => JSON.stringify(a)).join(" ")}`;
  const result = await runProcess(docker, dockerArgs, {});
  return { ...result, commandSummary: summary };
}

/** Map each relative file argument to host or /work/... */
export function mapFileArgs(
  workspaceRoot: string,
  relativePaths: string[],
  mode: ExecMode = detectExecMode()
): string[] {
  return relativePaths.map((rel) => {
    resolveHostPath(workspaceRoot, rel);
    return mode === "docker" ? toContainerPath(rel) : rel;
  });
}

/** Semicolon pattern for --load-filaments (empty slots stay empty). */
export function mapSemicolonPaths(
  workspaceRoot: string,
  pattern: string,
  mode: ExecMode = detectExecMode()
): string {
  return pattern.split(";").map((segment) => {
    const t = segment.trim();
    if (t === "") {
      return "";
    }
    assertRelativeWorkspacePath(t);
    resolveHostPath(workspaceRoot, t);
    return mode === "docker" ? toContainerPath(t) : t;
  }).join(";");
}

export function formatToolOutput(result: {
  code: number | null;
  stdout: string;
  stderr: string;
  commandSummary: string;
}): string {
  const parts = [
    `exit_code: ${result.code ?? "null"}`,
    `command: ${result.commandSummary}`,
    "--- stdout ---",
    result.stdout.trimEnd(),
    "--- stderr ---",
    result.stderr.trimEnd(),
  ];
  return parts.join("\n");
}
