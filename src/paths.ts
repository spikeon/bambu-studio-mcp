import path from "node:path";

/** Reject .., absolute segments, and NUL; return POSIX-style path under workspace (for Docker bind mount). */
export function assertRelativeWorkspacePath(rel: string): string {
  if (rel.includes("\0")) {
    throw new Error("Paths must not contain NUL");
  }
  const normalized = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/");
  if (segments.some((s) => s === "..")) {
    throw new Error(`Path must not contain '..': ${rel}`);
  }
  if (path.isAbsolute(rel)) {
    throw new Error(`Path must be relative to workspace: ${rel}`);
  }
  return normalized;
}

export function resolveHostPath(workspaceRoot: string, rel: string): string {
  const posixRel = assertRelativeWorkspacePath(rel);
  const abs = path.resolve(workspaceRoot, ...posixRel.split("/"));
  const root = path.resolve(workspaceRoot);
  const absLow = abs.toLowerCase();
  const rootLow = root.toLowerCase();
  if (absLow !== rootLow && !absLow.startsWith(`${rootLow}${path.sep}`)) {
    throw new Error(`Resolved path escapes workspace: ${rel}`);
  }
  return abs;
}

export function toContainerPath(rel: string): string {
  const posixRel = assertRelativeWorkspacePath(rel);
  return `/work/${posixRel}`;
}
