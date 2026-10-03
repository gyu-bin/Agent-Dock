import { randomUUID, createHash } from "node:crypto";
import { isCloudRuntime } from "../loadEnv.js";
import { usesCloudStore } from "../storage/dataFs.js";
import {
  WorkspaceError,
  type CloudWorkspaceProvider,
  type WorkspaceMetadata,
  type WorkspaceProject,
  type WorkspaceHandle,
  type WorkspaceVerification,
  type StepResult,
} from "./types.js";
import {
  PersistedWorkspaceRepository,
  type WorkspaceRepository,
  type WorkspaceLease,
} from "./repository.js";
import {
  EnvironmentGitHubCredentialProvider,
  redactWorkspaceText,
  normalizeGitHubRepository,
  type GitHubCredentialProvider,
} from "./github.js";
import {
  VercelSandboxWorkspaceProvider,
  verificationFile,
} from "./vercelProvider.js";
export class WorkspaceService {
  constructor(
    private readonly provider: CloudWorkspaceProvider = new VercelSandboxWorkspaceProvider(),
    private readonly repository: WorkspaceRepository = new PersistedWorkspaceRepository(),
    private readonly credentials: GitHubCredentialProvider = new EnvironmentGitHubCredentialProvider(),
  ) {}
  diagnostics() {
    return {
      provider: this.provider.id,
      configured: this.provider.configured(),
      persistence: usesCloudStore()
        ? "supabase"
        : isCloudRuntime()
          ? "unavailable"
          : "local",
      leaseConfigured: !isCloudRuntime() || usesCloudStore(),
    };
  }
  private checkOwner(
    ownerId: string,
    project?: WorkspaceProject,
    metadata?: WorkspaceMetadata | null,
  ): void {
    if (
      !ownerId ||
      (project?.ownerId && project.ownerId !== ownerId) ||
      (metadata && metadata.ownerId !== ownerId)
    )
      throw new WorkspaceError(
        "WORKSPACE_FORBIDDEN",
        "Workspace belongs to another account",
        403,
      );
  }
  private async locked<T>(
    id: string,
    fn: (lease: WorkspaceLease) => Promise<T>,
  ): Promise<T> {
    const lease = await this.repository.acquire(id);
    try {
      return await fn(lease);
    } finally {
      await this.repository.release(lease).catch(() => undefined);
    }
  }
  async get(
    projectId: string,
    ownerId: string,
  ): Promise<WorkspaceMetadata | null> {
    return this.locked(projectId, async (lease) => {
      const metadata = await this.repository.load(projectId);
      this.checkOwner(ownerId, undefined, metadata);
      if (!metadata) return null;
      if (metadata.deleting) return metadata;
      return this.refresh(metadata, lease);
    });
  }
  async provision(
    project: WorkspaceProject,
    ownerId: string,
  ): Promise<WorkspaceMetadata> {
    this.checkOwner(ownerId, project);
    if (!project.repository)
      throw new WorkspaceError(
        "GITHUB_SOURCE_REQUIRED",
        "A GitHub repository is required",
      );
    const normalized = normalizeGitHubRepository(
      project.repository.fullName,
      project.repository.defaultBranch,
    );
    return this.locked(project.id, async (lease) => {
      let metadata = await this.repository.load(project.id);
      this.checkOwner(ownerId, project, metadata);
      if (
        metadata &&
        (metadata.repository.fullName !== normalized.fullName ||
          metadata.branch !== normalized.defaultBranch)
      )
        throw new WorkspaceError(
          "WORKSPACE_SOURCE_CONFLICT",
          "Destroy the current workspace before changing its repository",
          409,
        );
      if (metadata?.deleting)
        throw new WorkspaceError(
          "WORKSPACE_BUSY",
          "Workspace cleanup is pending",
          409,
        );
      if (
        metadata &&
        metadata.status !== "expired" &&
        metadata.status !== "failed"
      )
        return this.refresh(metadata, lease);
      if (metadata?.sandboxId)
        await this.provider.destroyWorkspace(metadata.sandboxId);
      const generation = randomUUID();
      const now = new Date().toISOString();
      const identity = createHash("sha256")
        .update(`${ownerId}:${project.id}`)
        .digest("hex")
        .slice(0, 16);
      metadata = {
        projectId: project.id,
        ownerId,
        provider: this.provider.id,
        sandboxId: `agent-deck-${identity}-${generation.slice(0, 8)}`,
        repository: normalized,
        branch: normalized.defaultBranch,
        status: "provisioning",
        createdAt: now,
        lastUsedAt: now,
        generation,
      };
      await this.repository.save(metadata, lease);
      return this.refresh(metadata, lease);
    });
  }
  private async refresh(
    metadata: WorkspaceMetadata,
    lease: WorkspaceLease,
  ): Promise<WorkspaceMetadata> {
    try {
      let handle: WorkspaceHandle | null;
      if (metadata.status === "provisioning" || metadata.status === "cloning") {
        metadata.status = "cloning";
        await this.repository.save(metadata, lease);
        handle = await this.provider.ensureWorkspace(
          metadata.sandboxId,
          metadata.repository,
          await this.credentials.getToken(
            metadata.ownerId,
            metadata.repository,
          ),
        );
        await this.validateGit(metadata, handle, true);
        metadata.status = "ready";
        metadata.error = undefined;
      } else {
        handle = await this.provider.getWorkspace(
          metadata.sandboxId,
          metadata.repository,
        );
        if (!handle && metadata.status === "failed") return metadata;
        if (!handle) {
          metadata.status = "expired";
          metadata.error = {
            code: "CLOUD_WORKSPACE_EXPIRED",
            message: "Workspace expired; provision a new workspace",
          };
          if (metadata.verification?.status === "running")
            metadata.verification.status = "failed";
          await this.repository.save(metadata, lease);
          return metadata;
        }
      }
      metadata.expiresAt = handle.expiresAt;
      metadata.lastUsedAt = new Date().toISOString();
      if (metadata.verification?.status === "running") {
        const file = await this.provider.readFile(
          handle,
          verificationFile(metadata.verification.id),
        );
        if (!file && !metadata.commandId) {
          metadata.commandId = await this.provider.startVerification(
            handle,
            metadata.verification,
          );
        }
        if (file) {
          const raw = JSON.parse(file) as WorkspaceVerification;
          metadata.verification = this.sanitizeVerification(
            raw,
            metadata.verification,
          );
          if (raw.status === "passed" || raw.status === "failed")
            metadata.status = raw.status === "passed" ? "ready" : "failed";
        }
        if (
          Date.now() - Date.parse(metadata.verification.startedAt) >
            20 * 60000 &&
          metadata.verification.status === "running"
        ) {
          metadata.verification.status = "failed";
          metadata.status = "failed";
          metadata.error = {
            code: "CLOUD_WORKSPACE_VERIFY_TIMEOUT",
            message: "Workspace verification exceeded its smoke deadline",
          };
        }
      }
      await this.repository.save(metadata, lease);
      return metadata;
    } catch (error) {
      if (
        error instanceof WorkspaceError &&
        error.code === "CLOUD_WORKSPACE_PROVISION_PENDING"
      ) {
        metadata.status = "provisioning";
        await this.repository.save(metadata, lease);
        return metadata;
      }
      if (
        error instanceof WorkspaceError &&
        (error.code === "WORKSPACE_LEASE_LOST" ||
          error.code === "WORKSPACE_STORAGE_UNAVAILABLE")
      )
        throw error;
      metadata.status = "failed";
      metadata.error = {
        code:
          error instanceof WorkspaceError
            ? error.code
            : "WORKSPACE_OPERATION_FAILED",
        message:
          error instanceof WorkspaceError
            ? error.message
            : "Workspace operation failed",
      };
      await this.repository.save(metadata, lease);
      return metadata;
    }
  }
  private async validateGit(
    metadata: WorkspaceMetadata,
    handle: WorkspaceHandle,
    initializeBranch = false,
  ): Promise<void> {
    const script = `const cp=require('node:child_process');const git=(args)=>cp.execFileSync('git',args,{encoding:'utf8',timeout:4000}).trim();const status=git(['status','--porcelain']);const revision=git(['rev-parse','HEAD']);let branch=git(['branch','--show-current']);if(!branch&&process.argv[3]==='initialize'){git(['checkout','-B',process.argv[2],'HEAD']);branch=git(['branch','--show-current']);}git(['remote','set-url','origin',process.argv[1]]);for(const scope of ['--local','--global']){let keys=[];try{keys=git(['config',scope,'--name-only','--list']).split('\\n')}catch{}for(const key of keys)if(/^credential[.]|^http[.].*extraheader$/i.test(key)){try{git(['config',scope,'--unset-all',key])}catch{}}}require('node:fs').rmSync(require('node:path').join(require('node:os').homedir(),'.git-credentials'),{force:true});console.log(JSON.stringify({revision,branch,valid:typeof status==='string'}));`;
    const result = await this.provider.exec(handle, {
      command: "node",
      args: [
        "-e",
        script,
        metadata.repository.cloneUrl,
        metadata.branch,
        initializeBranch ? "initialize" : "validate",
      ],
      timeoutMs: 12000,
    });
    let info: { revision?: string; branch?: string; valid?: boolean };
    try {
      info = JSON.parse(result.stdout);
    } catch {
      throw new WorkspaceError(
        "CLOUD_WORKSPACE_CLONE_FAILED",
        "Repository validation failed",
        502,
      );
    }
    if (
      result.exitCode !== 0 ||
      !info.valid ||
      !/^[a-f0-9]{40,64}$/.test(info.revision ?? "") ||
      info.branch !== metadata.branch
    )
      throw new WorkspaceError(
        "CLOUD_WORKSPACE_CLONE_FAILED",
        "Repository HEAD or branch validation failed",
        502,
      );
    metadata.revision = info.revision;
  }

  private sanitizeVerification(
    raw: WorkspaceVerification,
    original: WorkspaceVerification,
  ): WorkspaceVerification {
    if (
      raw.id !== original.id ||
      !["running", "passed", "failed"].includes(raw.status)
    )
      throw new WorkspaceError(
        "INVALID_VERIFY_RESULT",
        "Workspace returned an invalid verification result",
        502,
      );
    const result: WorkspaceVerification = {
      ...original,
      status: raw.status,
      ...(typeof raw.completedAt === "string"
        ? { completedAt: raw.completedAt }
        : {}),
    };
    for (const key of ["install", "typecheck", "build", "test"] as const) {
      const step = raw[key];
      if (
        !step ||
        !["pending", "running", "passed", "failed", "skipped"].includes(
          step.status,
        )
      )
        throw new WorkspaceError(
          "INVALID_VERIFY_RESULT",
          "Workspace returned invalid verification steps",
          502,
        );
      const safe: StepResult = { status: step.status };
      if (Number.isFinite(step.durationMs)) safe.durationMs = step.durationMs;
      if (Number.isInteger(step.exitCode)) safe.exitCode = step.exitCode;
      if (typeof step.logTail === "string")
        safe.logTail = redactWorkspaceText(step.logTail);
      if (typeof step.reason === "string")
        safe.reason = redactWorkspaceText(step.reason).slice(0, 200);
      result[key] = safe;
    }
    return result;
  }
  async verify(
    project: WorkspaceProject,
    ownerId: string,
  ): Promise<WorkspaceMetadata> {
    this.checkOwner(ownerId, project);
    return this.locked(project.id, async (lease) => {
      let metadata = await this.repository.load(project.id);
      this.checkOwner(ownerId, project, metadata);
      if (!metadata)
        throw new WorkspaceError(
          "WORKSPACE_NOT_READY",
          "Provision the workspace first",
          409,
        );
      metadata = await this.refresh(metadata, lease);
      if (metadata.verification?.status === "running") return metadata;
      if (metadata.status !== "ready")
        throw new WorkspaceError(
          "WORKSPACE_NOT_READY",
          "Workspace is not ready for verification",
          409,
        );
      const handle = await this.provider.getWorkspace(
        metadata.sandboxId,
        metadata.repository,
      );
      if (!handle)
        throw new WorkspaceError(
          "WORKSPACE_NOT_READY",
          "Workspace expired",
          409,
        );
      try {
        await this.validateGit(metadata, handle);
      } catch (error) {
        metadata.status = "failed";
        metadata.error = {
          code: "CLOUD_WORKSPACE_CLONE_FAILED",
          message: "Repository HEAD or branch validation failed",
        };
        await this.repository.save(metadata, lease);
        throw error;
      }
      const verification: WorkspaceVerification = {
        id: randomUUID(),
        status: "running",
        repository: metadata.repository.fullName,
        revision: metadata.revision!,
        startedAt: new Date().toISOString(),
        install: { status: "pending" },
        typecheck: { status: "pending" },
        build: { status: "pending" },
        test: { status: "pending" },
      };
      metadata.verification = verification;
      metadata.status = "busy";
      await this.repository.save(metadata, lease);
      try {
        metadata.commandId = await this.provider.startVerification(
          handle,
          verification,
        );
        await this.repository.save(metadata, lease);
      } catch (error) {
        metadata.status = "failed";
        metadata.verification.status = "failed";
        metadata.error = {
          code: "CLOUD_WORKSPACE_VERIFY_START_FAILED",
          message: "Verification could not be started",
        };
        await this.repository.save(metadata, lease);
      }
      return metadata;
    });
  }
  async destroy(projectId: string, ownerId: string): Promise<void> {
    await this.locked(projectId, async (lease) => {
      const metadata = await this.repository.load(projectId);
      this.checkOwner(ownerId, undefined, metadata);
      if (!metadata) return;
      metadata.deleting = true;
      await this.repository.save(metadata, lease);
      await this.provider.destroyWorkspace(metadata.sandboxId);
      await this.repository.remove(projectId, lease);
    });
  }
}
