import path from "node:path";
import { Sandbox, Snapshot } from "@vercel/sandbox";
import { getVercelOidcTokenSync } from "@vercel/oidc";
import {
  WorkspaceError,
  type CloudWorkspaceProvider,
  type GitHubRepository,
  type WorkspaceHandle,
  type WorkspaceCommand,
  type WorkspaceVerification,
} from "./types.js";
import { verificationRunner } from "./verificationRunner.js";
import { redactWorkspaceText } from "./github.js";
const SDK_TIMEOUT = 30000;
export function verificationFile(id: string): string {
  if (!/^[a-f0-9-]{36}$/.test(id))
    throw new WorkspaceError("INVALID_VERIFY_ID", "Invalid verification ID");
  return `/tmp/agent-deck-${id}.json`;
}
export class VercelSandboxWorkspaceProvider implements CloudWorkspaceProvider {
  readonly id = "vercel-sandbox" as const;
  configured(): boolean {
    if (
      process.env.VERCEL_TOKEN &&
      process.env.VERCEL_TEAM_ID &&
      process.env.VERCEL_PROJECT_ID
    )
      return true;
    try {
      return Boolean(getVercelOidcTokenSync());
    } catch {
      return false;
    }
  }
  private credentials() {
    const {
      VERCEL_TOKEN: token,
      VERCEL_TEAM_ID: teamId,
      VERCEL_PROJECT_ID: projectId,
    } = process.env;
    return token && teamId && projectId ? { token, teamId, projectId } : {};
  }
  private async sandbox(name: string): Promise<Sandbox> {
    return Sandbox.get({
      name,
      resume: true,
      ...this.credentials(),
      signal: AbortSignal.timeout(SDK_TIMEOUT),
    });
  }
  private handle(
    sandbox: Sandbox,
    repository: GitHubRepository,
  ): WorkspaceHandle {
    return {
      sandboxId: sandbox.name,
      root: "/vercel/sandbox",
      expiresAt: sandbox.expiresAt?.toISOString(),
    };
  }
  async createWorkspace(
    name: string,
    repository: GitHubRepository,
    credential?: string,
  ): Promise<WorkspaceHandle> {
    return this.ensureWorkspace(name, repository, credential);
  }
  async ensureWorkspace(
    name: string,
    repository: GitHubRepository,
    credential?: string,
  ): Promise<WorkspaceHandle> {
    if (!this.configured())
      throw new WorkspaceError(
        "WORKSPACE_PROVIDER_NOT_CONFIGURED",
        "Vercel Sandbox authentication is not configured",
        503,
      );
    try {
      const sandbox = await Sandbox.getOrCreate({
        name,
        resume: true,
        ...this.credentials(),
        runtime: "node24",
        timeout: 20 * 60000,
        snapshotExpiration: 86400000,
        keepLastSnapshots: { count: 1, deleteEvicted: true },
        source: {
          type: "git",
          url: repository.cloneUrl,
          revision: repository.defaultBranch,
          depth: 1,
          ...(credential
            ? { username: "x-access-token", password: credential }
            : {}),
        },
        signal: AbortSignal.timeout(SDK_TIMEOUT),
      });
      return this.handle(sandbox, repository);
    } catch (error) {
      if (
        (error as Error).name === "TimeoutError" ||
        (error as Error).name === "AbortError"
      )
        throw new WorkspaceError(
          "CLOUD_WORKSPACE_PROVISION_PENDING",
          "Workspace creation is still pending; refresh status to reconnect",
          202,
        );
      throw new WorkspaceError(
        "CLOUD_WORKSPACE_CLONE_FAILED",
        "GitHub repository could not be cloned. Check repository, branch and GitHub access.",
        502,
      );
    }
  }
  async getWorkspace(
    name: string,
    repository: GitHubRepository,
  ): Promise<WorkspaceHandle | null> {
    try {
      return this.handle(await this.sandbox(name), repository);
    } catch (error) {
      const status =
        (error as { status?: number; statusCode?: number }).status ??
        (error as { statusCode?: number }).statusCode;
      if (
        status === 404 ||
        /not found|does not exist|expired/i.test((error as Error).message)
      )
        return null;
      throw new WorkspaceError(
        "WORKSPACE_PROVIDER_UNAVAILABLE",
        "Vercel Sandbox could not be reached",
        503,
      );
    }
  }
  private safePath(handle: WorkspaceHandle, file: string): string {
    const target = path.posix.resolve(handle.root, file);
    if (
      target !== handle.root &&
      !target.startsWith(`${handle.root}/`) &&
      !/^\/tmp\/agent-deck-[a-f0-9-]{36}\.(?:json|cjs|input\.json)$/.test(
        target,
      )
    )
      throw new WorkspaceError(
        "INVALID_WORKSPACE_PATH",
        "Path is outside the workspace",
      );
    return target;
  }
  async exec(handle: WorkspaceHandle, command: WorkspaceCommand) {
    const cwd = this.safePath(handle, command.cwd ?? handle.root);
    try {
      const sandbox = await this.sandbox(handle.sandboxId);
      const result = await sandbox.runCommand({
        cmd: command.command,
        args: command.args,
        cwd,
        signal: AbortSignal.timeout(
          Math.min(command.timeoutMs ?? 10000, 15000),
        ),
      });
      return {
        exitCode: result.exitCode,
        stdout: redactWorkspaceText(await result.stdout()),
        stderr: redactWorkspaceText(await result.stderr()),
      };
    } catch {
      throw new WorkspaceError(
        "WORKSPACE_COMMAND_FAILED",
        "Sandbox command could not complete",
        502,
      );
    }
  }

  async readFile(
    handle: WorkspaceHandle,
    file: string,
  ): Promise<string | null> {
    const sandbox = await this.sandbox(handle.sandboxId);
    const content = await sandbox.readFileToBuffer(
      { path: this.safePath(handle, file) },
      { signal: AbortSignal.timeout(10000) },
    );
    return content?.toString("utf8") ?? null;
  }
  async writeFile(
    handle: WorkspaceHandle,
    file: string,
    content: string,
  ): Promise<void> {
    const sandbox = await this.sandbox(handle.sandboxId);
    await sandbox.writeFiles(
      [{ path: this.safePath(handle, file), content: Buffer.from(content) }],
      { signal: AbortSignal.timeout(10000) },
    );
  }
  async listFiles(
    handle: WorkspaceHandle,
    dir = handle.root,
  ): Promise<string[]> {
    const sandbox = await this.sandbox(handle.sandboxId);
    return sandbox.fs.readdir(this.safePath(handle, dir));
  }
  async startVerification(
    handle: WorkspaceHandle,
    verification: WorkspaceVerification,
  ): Promise<string> {
    const sandbox = await this.sandbox(handle.sandboxId);
    const file = verificationFile(verification.id);
    const script = file.replace(/\.json$/, ".cjs");
    const input = file.replace(/\.json$/, ".input.json");
    await sandbox.writeFiles(
      [
        { path: script, content: Buffer.from(verificationRunner) },
        { path: input, content: Buffer.from(JSON.stringify(verification)) },
      ],
      { signal: AbortSignal.timeout(10000) },
    );
    const command = await sandbox.runCommand({
      cmd: "node",
      args: [script, handle.root, file, input],
      cwd: handle.root,
      detached: true,
      env: { CI: "true" },
      signal: AbortSignal.timeout(10000),
    });
    return command.cmdId;
  }
  async destroyWorkspace(name: string): Promise<void> {
    let sandbox: Sandbox;
    try {
      sandbox = await this.sandbox(name);
    } catch (error) {
      if (/not found|does not exist/i.test((error as Error).message)) return;
      throw new WorkspaceError(
        "WORKSPACE_CLEANUP_FAILED",
        "Workspace cleanup could not reconnect",
        503,
      );
    }
    const snapshots = await sandbox.listSnapshots({
      signal: AbortSignal.timeout(10000),
    });
    const ids: string[] = [];
    for await (const snapshot of snapshots) ids.push(snapshot.id);
    await sandbox.delete({ signal: AbortSignal.timeout(10000) });
    for (const snapshotId of ids) {
      const snapshot = await Snapshot.get({
        snapshotId,
        ...this.credentials(),
      });
      await snapshot.delete({ signal: AbortSignal.timeout(10000) });
    }
  }
}
