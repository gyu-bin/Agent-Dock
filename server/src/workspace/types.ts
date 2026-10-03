export type WorkspaceStatus =
  | "provisioning"
  | "cloning"
  | "ready"
  | "busy"
  | "failed"
  | "expired";
export interface GitHubRepository {
  owner: string;
  name: string;
  fullName: string;
  cloneUrl: string;
  defaultBranch: string;
}
export interface WorkspaceProject {
  id: string;
  ownerId?: string;
  repository?: GitHubRepository;
}
export type VerifyStep = "install" | "typecheck" | "build" | "test";
export interface StepResult {
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  durationMs?: number;
  exitCode?: number;
  logTail?: string;
  reason?: string;
}
export interface WorkspaceVerification {
  id: string;
  status: "running" | "passed" | "failed";
  repository: string;
  revision: string;
  startedAt: string;
  completedAt?: string;
  install: StepResult;
  typecheck: StepResult;
  build: StepResult;
  test: StepResult;
}
export interface WorkspaceMetadata {
  projectId: string;
  ownerId: string;
  provider: "vercel-sandbox";
  sandboxId: string;
  repository: GitHubRepository;
  branch: string;
  status: WorkspaceStatus;
  createdAt: string;
  lastUsedAt: string;
  revision?: string;
  expiresAt?: string;
  generation: string;
  error?: { code: string; message: string };
  verification?: WorkspaceVerification;
  commandId?: string;
  deleting?: boolean;
}
export interface WorkspaceHandle {
  sandboxId: string;
  root: string;
  expiresAt?: string;
}
export interface WorkspaceCommand {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
}
export interface CloudWorkspaceProvider {
  readonly id: "vercel-sandbox";
  configured(): boolean;
  createWorkspace(
    name: string,
    repository: GitHubRepository,
    credential?: string,
  ): Promise<WorkspaceHandle>;
  getWorkspace(
    name: string,
    repository: GitHubRepository,
  ): Promise<WorkspaceHandle | null>;
  ensureWorkspace(
    name: string,
    repository: GitHubRepository,
    credential?: string,
  ): Promise<WorkspaceHandle>;
  exec(
    handle: WorkspaceHandle,
    command: WorkspaceCommand,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  readFile(handle: WorkspaceHandle, file: string): Promise<string | null>;
  writeFile(
    handle: WorkspaceHandle,
    file: string,
    content: string,
  ): Promise<void>;
  listFiles(handle: WorkspaceHandle, dir?: string): Promise<string[]>;
  startVerification(
    handle: WorkspaceHandle,
    verification: WorkspaceVerification,
  ): Promise<string>;
  destroyWorkspace(name: string): Promise<void>;
}
export class WorkspaceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}
