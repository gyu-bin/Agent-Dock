import { WorkspaceError, type GitHubRepository } from "./types.js";
export function normalizeGitHubRepository(
  input: string,
  branch = "main",
): GitHubRepository {
  const value = input.trim();
  let full = value;
  if (/^https?:/i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new WorkspaceError(
        "INVALID_GITHUB_REPOSITORY",
        "GitHub repository URL is invalid",
      );
    }
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new WorkspaceError(
        "INVALID_GITHUB_REPOSITORY",
        "Use an HTTPS github.com repository URL without credentials",
      );
    full = url.pathname.replace(/^\//, "").replace(/\/$/, "");
  }
  full = full.replace(/\.git$/, "");
  const parts = full.split("/");
  const owner = parts[0] ?? "";
  const name = parts[1] ?? "";
  if (
    parts.length !== 2 ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner) ||
    !/^[A-Za-z0-9_.-]{1,100}$/.test(name) ||
    name === "." ||
    name === ".."
  )
    throw new WorkspaceError(
      "INVALID_GITHUB_REPOSITORY",
      "Use owner/repository or its GitHub URL",
    );
  if (
    !branch ||
    branch.length > 200 ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) ||
    branch.includes("..") ||
    branch.includes("//") ||
    branch.endsWith("/") ||
    branch
      .split("/")
      .some(
        (part) =>
          part.startsWith(".") || part.endsWith(".") || part.endsWith(".lock"),
      )
  )
    throw new WorkspaceError(
      "INVALID_GITHUB_BRANCH",
      "GitHub branch is invalid",
    );
  return {
    owner,
    name,
    fullName: `${owner}/${name}`,
    cloneUrl: `https://github.com/${owner}/${name}.git`,
    defaultBranch: branch,
  };
}
export interface GitHubCredentialProvider {
  getToken(
    ownerId: string,
    repository: GitHubRepository,
  ): Promise<string | undefined>;
}
export class EnvironmentGitHubCredentialProvider
  implements GitHubCredentialProvider
{
  async getToken(): Promise<string | undefined> {
    return process.env.GITHUB_TOKEN?.trim() || undefined;
  }
}
export function redactWorkspaceText(value: string): string {
  let text = value;
  for (const [key, secret] of Object.entries(process.env))
    if (
      secret &&
      secret.length >= 8 &&
      /(TOKEN|SECRET|PASSWORD|API_KEY|ANON_KEY|PUBLISHABLE_KEY)/i.test(key)
    )
      text = text.split(secret).join("[REDACTED]");
  return text
    .replace(
      /(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g,
      "[REDACTED]",
    )
    .replace(
      /(authorization\s*[:=]\s*(?:bearer|basic)\s+)[^\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(/(https:\/\/)[^/\s@]+@/gi, "$1[REDACTED]@")
    .slice(-3000);
}

/** Resolve the real default branch through GitHub; authentication stays server-only. */
export async function resolveGitHubRepository(
  input: string,
  branch?: string,
  ownerId = "local",
  credentials: GitHubCredentialProvider = new EnvironmentGitHubCredentialProvider(),
): Promise<GitHubRepository> {
  const normalized = normalizeGitHubRepository(input, branch?.trim() || "main");
  const token = await credentials.getToken(ownerId, normalized);
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Agent-Deck-Cloud-Workspace",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(normalized.owner)}/${encodeURIComponent(normalized.name)}`,
      { headers, signal: AbortSignal.timeout(10000), redirect: "error" },
    );
  } catch {
    throw new WorkspaceError(
      "GITHUB_REPOSITORY_UNAVAILABLE",
      "GitHub repository metadata could not be reached",
      503,
    );
  }
  if (response.status === 404)
    throw new WorkspaceError(
      "GITHUB_REPOSITORY_NOT_FOUND",
      "GitHub repository was not found or is not accessible",
      400,
    );
  if (response.status === 401)
    throw new WorkspaceError(
      "GITHUB_CREDENTIAL_INVALID",
      "GitHub credential is invalid",
      503,
    );
  if (!response.ok)
    throw new WorkspaceError(
      "GITHUB_REPOSITORY_UNAVAILABLE",
      "GitHub repository metadata is currently unavailable",
      503,
    );
  const metadata = (await response.json().catch(() => null)) as {
    full_name?: string;
    default_branch?: string;
  } | null;
  if (
    typeof metadata?.full_name !== "string" ||
    typeof metadata.default_branch !== "string"
  )
    throw new WorkspaceError(
      "GITHUB_REPOSITORY_UNAVAILABLE",
      "GitHub returned invalid repository metadata",
      503,
    );
  return normalizeGitHubRepository(
    metadata.full_name,
    branch?.trim() || metadata.default_branch,
  );
}
