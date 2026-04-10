import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const IMAGE = process.env.BAMBU_E2E_IMAGE ?? "bambu-studio-mcp:latest";
const REF = process.env.BAMBU_STUDIO_FIXTURE_REF ?? "v02.05.00.67";
const FIXTURE_PATH =
  process.env.BAMBU_E2E_FIXTURE_PATH ??
  "resources/calib/pressure_advance/auto_pa_line_single.3mf";
const TIMEOUT_MS = Number(process.env.BAMBU_E2E_DOCKER_TIMEOUT ?? "900") * 1000;

const dockerCliOk =
  spawnSync("docker", ["version"], { encoding: "utf-8" }).status === 0;

function runDocker(
  workDir: string,
  args: string[]
): { status: number | null; stdout: string; stderr: string; error?: Error } {
  const r = spawnSync(
    "docker",
    ["run", "--rm", "-v", `${workDir}:/work`, "-w", "/work", IMAGE, ...args],
    {
      encoding: "utf-8",
      timeout: TIMEOUT_MS,
      maxBuffer: 100 * 1024 * 1024,
      windowsHide: true,
    }
  );
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    error: r.error,
  };
}

function assertDockerOk(
  result: ReturnType<typeof runDocker>,
  label: string
): void {
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    // Vitest will show this with the assertion failure
    console.error(`\n[${label}] --- stdout ---\n`, result.stdout);
    console.error(`\n[${label}] --- stderr ---\n`, result.stderr);
  }
  expect(result.status, `${label}: expected exit 0, got ${result.status}`).toBe(0);
}

function expectMinBytes(file: string, min = 2000): void {
  const s = statSync(file);
  expect(s.size, `${file} should be at least ${min} bytes`).toBeGreaterThan(min);
}

describe.skipIf(!dockerCliOk)("Bambu Studio CLI (Docker image)", () => {
  let workspace: string;

  beforeAll(async () => {
    const inspect = spawnSync("docker", ["image", "inspect", IMAGE], {
      encoding: "utf-8",
    });
    expect(
      inspect.status,
      `Missing image ${IMAGE}. Run: docker build -t ${IMAGE} .`
    ).toBe(0);

    workspace = await mkdtemp(join(tmpdir(), "bambu-mcp-e2e-"));
    await mkdir(join(workspace, "out", "sub"), { recursive: true });
    await mkdir(join(workspace, "out", "slicedata"), { recursive: true });

    const url = `https://raw.githubusercontent.com/bambulab/BambuStudio/${REF}/${FIXTURE_PATH}`;
    const res = await fetch(url);
    expect(res.ok, `Fixture HTTP ${res.status}: ${url}`).toBe(true);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(join(workspace, "sample.3mf"), buf);
    expectMinBytes(join(workspace, "sample.3mf"), 500);
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  });

  describe("CLI basics", () => {
    it("shows --help", () => {
      const r = runDocker(workspace, ["--debug", "0", "--help"]);
      assertDockerOk(r, "--help");
      expect(r.stdout + r.stderr).toMatch(/Usage:\s*bambu-studio/i);
    });

    it("runs --info on sample.3mf", () => {
      const r = runDocker(workspace, ["--debug", "2", "--info", "/work/sample.3mf"]);
      assertDockerOk(r, "--info");
      expect(r.stdout + r.stderr).toMatch(/facet|plate|mesh|sample\.3mf/i);
    });
  });

  describe("Slice + export-3mf", () => {
    it("baseline slice produces baseline.3mf", () => {
      const r = runDocker(workspace, [
        "--debug",
        "2",
        "--slice",
        "0",
        "--export-3mf",
        "/work/out/baseline.3mf",
        "/work/sample.3mf",
      ]);
      assertDockerOk(r, "slice baseline");
      expectMinBytes(join(workspace, "out", "baseline.3mf"));
    });
  });

  describe("Layout flags", () => {
    it("slice with --orient 1", () => {
      const r = runDocker(workspace, [
        "--debug",
        "2",
        "--orient",
        "1",
        "--slice",
        "0",
        "--export-3mf",
        "/work/out/with_orient.3mf",
        "/work/sample.3mf",
      ]);
      assertDockerOk(r, "slice --orient 1");
      expectMinBytes(join(workspace, "out", "with_orient.3mf"));
    });

    it("slice with --arrange 1", () => {
      const r = runDocker(workspace, [
        "--debug",
        "2",
        "--arrange",
        "1",
        "--slice",
        "0",
        "--export-3mf",
        "/work/out/with_arrange.3mf",
        "/work/sample.3mf",
      ]);
      assertDockerOk(r, "slice --arrange 1");
      expectMinBytes(join(workspace, "out", "with_arrange.3mf"));
    });

    it("slice with --scale 0.92", () => {
      const r = runDocker(workspace, [
        "--debug",
        "2",
        "--scale",
        "0.92",
        "--slice",
        "0",
        "--export-3mf",
        "/work/out/with_scale.3mf",
        "/work/sample.3mf",
      ]);
      assertDockerOk(r, "slice --scale");
      expectMinBytes(join(workspace, "out", "with_scale.3mf"));
    });

    it("slice with --orient 1, --arrange 1, and --scale 0.95", () => {
      const r = runDocker(workspace, [
        "--debug",
        "2",
        "--orient",
        "1",
        "--arrange",
        "1",
        "--scale",
        "0.95",
        "--slice",
        "0",
        "--export-3mf",
        "/work/out/combined.3mf",
        "/work/sample.3mf",
      ]);
      assertDockerOk(r, "slice combined layout");
      expectMinBytes(join(workspace, "out", "combined.3mf"));
    });
  });

  describe("Export options", () => {
    it("writes --export-settings JSON and sliced 3mf", async () => {
      const r = runDocker(workspace, [
        "--debug",
        "2",
        "--slice",
        "0",
        "--export-settings",
        "/work/out/exported_settings.json",
        "--export-3mf",
        "/work/out/with_settings_export.3mf",
        "/work/sample.3mf",
      ]);
      assertDockerOk(r, "export-settings");
      expectMinBytes(join(workspace, "out", "with_settings_export.3mf"));
      expectMinBytes(join(workspace, "out", "exported_settings.json"), 20);
      const text = await readFile(join(workspace, "out", "exported_settings.json"), "utf8");
      expect(() => JSON.parse(text)).not.toThrow();
    });

    it("accepts --export-slicedata and still produces sliced 3mf", () => {
      const r = runDocker(workspace, [
        "--debug",
        "2",
        "--slice",
        "0",
        "--export-slicedata",
        "/work/out/slicedata",
        "--export-3mf",
        "/work/out/with_slicedata.3mf",
        "/work/sample.3mf",
      ]);
      assertDockerOk(r, "export-slicedata");
      expectMinBytes(join(workspace, "out", "with_slicedata.3mf"));
      // Upstream CLI does not always write loose files into this folder; the
      // important guarantee is a successful slice + 3mf output.
    });

    it("places export under --outputdir when requested", () => {
      // With --outputdir, pass a basename for --export-3mf; absolute paths are
      // joined incorrectly by upstream (duplicated directory).
      const r = runDocker(workspace, [
        "--debug",
        "2",
        "--slice",
        "0",
        "--outputdir",
        "/work/out/sub",
        "--export-3mf",
        "from_outputdir.3mf",
        "/work/sample.3mf",
      ]);
      assertDockerOk(r, "outputdir");
      expectMinBytes(join(workspace, "out", "sub", "from_outputdir.3mf"));
    });
  });
});
