import path from "node:path";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { readFile, writeJsonAtomic } from "../storage/dataFs.js";
import { isCloudRuntime } from "../loadEnv.js";
import { WorkspaceError, type WorkspaceMetadata } from "./types.js";
export interface WorkspaceLease {
  projectId: string;
  token: string;
}
export interface WorkspaceRepository {
  load(projectId: string): Promise<WorkspaceMetadata | null>;
  acquire(projectId: string): Promise<WorkspaceLease>;
  save(metadata: WorkspaceMetadata, lease: WorkspaceLease): Promise<void>;
  remove(projectId: string, lease: WorkspaceLease): Promise<void>;
  release(lease: WorkspaceLease): Promise<void>;
}
export class PersistedWorkspaceRepository implements WorkspaceRepository {
  constructor(
    private readonly root = process.env.AGENT_DECK_WORKSPACES_DIR ??
      (isCloudRuntime()
        ? `${process.env.AGENT_DECK_CLOUD_ROOT ?? "/tmp/agent-deck"}/workspaces`
        : path.resolve("data/workspaces")),
  ) {}
  private file(id: string): string {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id))
      throw new WorkspaceError("INVALID_PROJECT_ID", "Invalid project ID");
    return path.join(this.root, `${id}.json`);
  }
  private cloudKey(id: string): string {
    const relative = path.relative(
      path.resolve(process.env.AGENT_DECK_CLOUD_ROOT ?? "/tmp/agent-deck"),
      this.file(id),
    );
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new WorkspaceError(
        "WORKSPACE_STORAGE_NOT_CONFIGURED",
        "Workspace storage must use cloud data root",
        503,
      );
    return relative.split(path.sep).join("/");
  }
  private async rpc(name: string, input: unknown): Promise<unknown> {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key)
      throw new WorkspaceError(
        "WORKSPACE_STORAGE_NOT_CONFIGURED",
        "Supabase workspace storage is required",
        503,
      );
    const headers: Record<string, string> = {
      apikey: key,
      "Content-Type": "application/json",
    };
    if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;
    const response = await fetch(
      `${url.replace(/\/$/, "")}/rest/v1/rpc/${name}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok)
      throw new WorkspaceError(
        "WORKSPACE_STORAGE_UNAVAILABLE",
        "Workspace storage or lease migration is unavailable",
        503,
      );
    return response.json();
  }
  async load(projectId: string): Promise<WorkspaceMetadata | null> {
    try {
      return JSON.parse(
        await readFile(this.file(projectId), "utf8"),
      ) as WorkspaceMetadata;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  async acquire(projectId: string): Promise<WorkspaceLease> {
    const token = randomUUID();
    const lease = { projectId, token };
    if (isCloudRuntime()) {
      const ok = await this.rpc("workspace_acquire_lease", {
        p_project_id: projectId,
        p_token: token,
        p_ttl_seconds: 120,
      });
      if (!ok)
        throw new WorkspaceError(
          "WORKSPACE_BUSY",
          "Workspace operation is already in progress",
          409,
        );
    } else {
      await fs.mkdir(this.root, { recursive: true });
      const file = `${this.file(projectId)}.lease`;
      try {
        await fs.writeFile(
          file,
          JSON.stringify({ token, expiresAt: Date.now() + 120000 }),
          { flag: "wx" },
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = JSON.parse(await fs.readFile(file, "utf8")) as {
          expiresAt: number;
        };
        if (existing.expiresAt > Date.now())
          throw new WorkspaceError(
            "WORKSPACE_BUSY",
            "Workspace operation is already in progress",
            409,
          );
        // Local mode only. Cloud uses an atomic database compare-and-set.
        await fs.unlink(file);
        await fs.writeFile(
          file,
          JSON.stringify({ token, expiresAt: Date.now() + 120000 }),
          { flag: "wx" },
        );
      }
    }
    return lease;
  }
  private async localFence(lease: WorkspaceLease): Promise<void> {
    const record = JSON.parse(
      await fs.readFile(`${this.file(lease.projectId)}.lease`, "utf8"),
    ) as { token: string; expiresAt: number };
    if (record.token !== lease.token || record.expiresAt <= Date.now())
      throw new WorkspaceError(
        "WORKSPACE_LEASE_LOST",
        "Workspace lease expired",
        409,
      );
  }
  async save(
    metadata: WorkspaceMetadata,
    lease: WorkspaceLease,
  ): Promise<void> {
    if (isCloudRuntime()) {
      const ok = await this.rpc("workspace_save_fenced", {
        p_project_id: lease.projectId,
        p_token: lease.token,
        p_path: this.cloudKey(lease.projectId),
        p_content: JSON.stringify(metadata),
      });
      if (!ok)
        throw new WorkspaceError(
          "WORKSPACE_LEASE_LOST",
          "Workspace lease expired",
          409,
        );
    } else {
      await this.localFence(lease);
      await writeJsonAtomic(this.file(lease.projectId), metadata);
    }
  }
  async remove(id: string, lease: WorkspaceLease): Promise<void> {
    if (isCloudRuntime()) {
      const ok = await this.rpc("workspace_save_fenced", {
        p_project_id: id,
        p_token: lease.token,
        p_path: this.cloudKey(id),
        p_content: null,
      });
      if (!ok)
        throw new WorkspaceError(
          "WORKSPACE_LEASE_LOST",
          "Workspace lease expired",
          409,
        );
    } else {
      await this.localFence(lease);
      await fs.rm(this.file(id), { force: true });
    }
  }
  async release(lease: WorkspaceLease): Promise<void> {
    if (isCloudRuntime()) {
      await this.rpc("workspace_release_lease", {
        p_project_id: lease.projectId,
        p_token: lease.token,
      });
    } else {
      try {
        await this.localFence(lease);
        await fs.unlink(`${this.file(lease.projectId)}.lease`);
      } catch {
        /* A newer lease must never be removed. */
      }
    }
  }
}
