import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  WorkspaceService,
  PersistedWorkspaceRepository,
  normalizeGitHubRepository,
  resolveGitHubRepository,
  redactWorkspaceText,
  WorkspaceError,
  type CloudWorkspaceProvider,
  type WorkspaceHandle,
  type WorkspaceVerification,
} from "./index.js";
import { verificationRunner } from "./verificationRunner.js";
const secret = "github_pat_fixture_verysecret_0123456789";
const previous = process.env.GITHUB_TOKEN;
process.env.GITHUB_TOKEN = secret;
const dir = await mkdtemp(path.join(os.tmpdir(), "agent-deck-workspace-"));
const handles = new Map<string, WorkspaceHandle>();
const results = new Map<string, string>();
let creates = 0;
let launches = 0;
let branchInitializations = 0;
const branches = new Map<string, string>();
const provider: CloudWorkspaceProvider = {
  id: "vercel-sandbox",
  configured: () => true,
  async createWorkspace(name, repo, credential) {
    return this.ensureWorkspace(name, repo, credential);
  },
  async ensureWorkspace(name, repo, credential) {
    assert.equal(credential, secret);
    assert(!repo.cloneUrl.includes(secret));
    if (repo.name === "missing")
      throw new WorkspaceError(
        "CLOUD_WORKSPACE_CLONE_FAILED",
        "Repository inaccessible",
        502,
      );
    if (!handles.has(name)) {
      creates++;
      branches.set(name, "");
      handles.set(name, {
        sandboxId: name,
        root: "/vercel/sandbox/" + repo.name,
      });
    }
    return handles.get(name)!;
  },
  async getWorkspace(name) {
    return handles.get(name) ?? null;
  },
  async exec(handle, command) {
    if (
      !branches.get(handle.sandboxId) &&
      command.args.at(-1) === "initialize"
    ) {
      branches.set(handle.sandboxId, "main");
      branchInitializations++;
    }
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        revision: "a".repeat(40),
        branch: branches.get(handle.sandboxId),
        valid: true,
      }),
      stderr: "",
    };
  },
  async readFile(_h, file) {
    return results.get(file) ?? null;
  },
  async writeFile() {},
  async listFiles() {
    return ["package.json", "package-lock.json"];
  },
  async startVerification(_h, v) {
    launches++;
    results.set(
      "/tmp/agent-deck-" + v.id + ".json",
      JSON.stringify({
        ...v,
        status: "passed",
        completedAt: new Date().toISOString(),
        install: { status: "passed", durationMs: 20 },
        typecheck: { status: "passed" },
        build: { status: "passed", logTail: "authorization: Bearer " + secret },
        test: { status: "skipped", reason: "No test script" },
      }),
    );
    return "cmd_" + launches;
  },
  async destroyWorkspace(name) {
    handles.delete(name);
  },
};
const repo = new PersistedWorkspaceRepository(dir);
const service = new WorkspaceService(provider, repo);
const project = {
  id: "proj_fixture",
  ownerId: "owner_1",
  repository: normalizeGitHubRepository(
    "https://github.com/example/node-fixture.git",
  ),
};
try {
  assert.equal(
    normalizeGitHubRepository("gyu-bin/Agent-Dock").fullName,
    "gyu-bin/Agent-Dock",
  );
  for (const url of [
    "https://evil.test/a/b",
    "https://token@github.com/a/b",
    "a/b/c",
    "https://github.com/a/b?token=hello",
  ])
    assert.throws(() => normalizeGitHubRepository(url));
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        "Bearer " + secret,
      );
      return new Response(
        JSON.stringify({
          full_name: "example/node-fixture",
          default_branch: "master",
        }),
        { status: 200 },
      );
    };
    assert.equal(
      (await resolveGitHubRepository("example/node-fixture")).defaultBranch,
      "master",
    );
    assert.equal(
      (await resolveGitHubRepository("example/node-fixture", "release/next"))
        .defaultBranch,
      "release/next",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log(
    "PASS GitHub default branch resolution and explicit branch preservation",
  );
  let metadata = await service.provision(project, "owner_1");
  assert.equal(metadata.status, "ready");
  assert.equal(metadata.revision, "a".repeat(40));
  assert.equal(creates, 1);
  assert.equal(branchInitializations, 1);
  console.log(
    "PASS native clone detached HEAD initializes requested branch once",
  );
  console.log("PASS C public repository provision/HEAD/ready");
  assert(!JSON.stringify(metadata).includes(secret));
  assert(!JSON.stringify(metadata).includes("password"));
  console.log(
    "PASS D credential boundary (mock), native private clone needs live credential test",
  );
  const missing = await service.provision(
    {
      ...project,
      id: "proj_missing",
      repository: normalizeGitHubRepository("example/missing"),
    },
    "owner_1",
  );
  assert.equal(missing.status, "failed");
  assert.equal(missing.error?.code, "CLOUD_WORKSPACE_CLONE_FAILED");
  console.log("PASS E typed invalid repository");
  const branchCount = branchInitializations;
  metadata = await service.verify(project, "owner_1");
  assert.equal(branchInitializations, branchCount);
  assert.equal(metadata.status, "busy");
  assert.equal(metadata.verification?.status, "running");
  metadata = (await service.get(project.id, "owner_1"))!;
  assert.equal(metadata.status, "ready");
  assert.equal(metadata.verification?.build.status, "passed");
  assert.equal(metadata.verification?.test.status, "skipped");
  assert(!JSON.stringify(metadata).includes(secret));
  console.log("PASS F structured asynchronous verify");
  const recovered = new WorkspaceService(
    provider,
    new PersistedWorkspaceRepository(dir),
  );
  assert.equal(
    (await recovered.get(project.id, "owner_1"))?.sandboxId,
    metadata.sandboxId,
  );
  assert.equal(creates, 1);
  console.log("PASS G new service instance reconnect from persisted metadata");
  handles.delete(metadata.sandboxId);
  assert.equal((await recovered.get(project.id, "owner_1"))?.status, "expired");
  metadata = await recovered.provision(project, "owner_1");
  assert.equal(metadata.status, "ready");
  assert.equal(creates, 2);
  console.log("PASS H expired workspace reprovision");
  const concurrent = { ...project, id: "proj_concurrent" };
  const count = creates;
  const pair = await Promise.allSettled([
    service.provision(concurrent, "owner_1"),
    recovered.provision(concurrent, "owner_1"),
  ]);
  assert.equal(pair.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(creates, count + 1);
  assert.equal(
    (pair.find((r) => r.status === "rejected") as PromiseRejectedResult).reason
      .code,
    "WORKSPACE_BUSY",
  );
  console.log("PASS I concurrent provision protected by persisted lease");
  await assert.rejects(
    () => recovered.get(project.id, "other_owner"),
    (e) => e instanceof WorkspaceError && e.code === "WORKSPACE_FORBIDDEN",
  );
  assert(
    !redactWorkspaceText(secret + " authorization: Bearer " + secret).includes(
      secret,
    ),
  );
  branches.set(metadata.sandboxId, "wrong-branch");
  const initializationsBeforeDrift = branchInitializations;
  await assert.rejects(
    () => service.verify(project, "owner_1"),
    (e) =>
      e instanceof WorkspaceError && e.code === "CLOUD_WORKSPACE_CLONE_FAILED",
  );
  assert.equal(branchInitializations, initializationsBeforeDrift);
  assert.equal(branches.get(metadata.sandboxId), "wrong-branch");
  console.log(
    "PASS verification rejects branch drift without checking out another branch",
  );
  await service.destroy(project.id, "owner_1");
  assert.equal(await recovered.get(project.id, "owner_1"), null);
  console.log("PASS J redacted persisted/API result, ownership, cleanup");
  const runnerDir = path.join(dir, "runner");
  await import("node:fs/promises").then((f) => f.mkdir(runnerDir));
  const pkg = {
    name: "workspace-smoke-fixture",
    version: "1.0.0",
    scripts: {
      typecheck: 'node -e "if(process.env.GITHUB_TOKEN)process.exit(5)"',
      build: "node -e \"console.log('built')\"",
      test: "node -e \"console.log('tested')\"",
    },
  };
  await writeFile(path.join(runnerDir, "package.json"), JSON.stringify(pkg));
  await writeFile(
    path.join(runnerDir, "package-lock.json"),
    JSON.stringify({
      name: pkg.name,
      version: "1.0.0",
      lockfileVersion: 3,
      packages: { "": { name: pkg.name, version: "1.0.0" } },
    }),
  );
  const verify: WorkspaceVerification = {
    id: "a".repeat(36),
    status: "running",
    repository: "example/fixture",
    revision: "a".repeat(40),
    startedAt: new Date().toISOString(),
    install: { status: "pending" },
    typecheck: { status: "pending" },
    build: { status: "pending" },
    test: { status: "pending" },
  };
  const script = path.join(dir, "runner.cjs");
  const file = path.join(dir, "result.json");
  const input = path.join(dir, "input.json");
  await writeFile(script, verificationRunner);
  await writeFile(input, JSON.stringify(verify));
  await promisify(execFile)(
    process.execPath,
    [script, runnerDir, file, input],
    { timeout: 20000 },
  );
  const run = JSON.parse(await readFile(file, "utf8"));
  assert.equal(run.status, "passed");
  for (const key of ["install", "typecheck", "build", "test"])
    assert.equal(run[key].status, "passed");
  console.log(
    "PASS actual bounded Node runner npm ci/typecheck/build/test, clean child environment",
  );
  pkg.scripts.build = 'node -e "process.exit(3)"';
  await writeFile(path.join(runnerDir, "package.json"), JSON.stringify(pkg));
  const failedFile = path.join(dir, "failed.json");
  await promisify(execFile)(
    process.execPath,
    [script, runnerDir, failedFile, input],
    { timeout: 20000 },
  );
  const failed = JSON.parse(await readFile(failedFile, "utf8"));
  assert.equal(failed.status, "failed");
  assert.equal(failed.build.status, "failed");
  assert.equal(failed.test.status, "skipped");
  console.log("PASS runner preserves failed build and skips later test");
  await writeFile(path.join(runnerDir, "package.json"), "{broken");
  const malformedFile = path.join(dir, "malformed.json");
  await promisify(execFile)(
    process.execPath,
    [script, runnerDir, malformedFile, input],
    { timeout: 20000 },
  );
  const malformed = JSON.parse(await readFile(malformedFile, "utf8"));
  assert.equal(malformed.status, "failed");
  assert.equal(malformed.install.status, "failed");
  console.log("PASS malformed package.json is not reported successful");
} finally {
  if (previous === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = previous;
  await rm(dir, { recursive: true, force: true });
}
