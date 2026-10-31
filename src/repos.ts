/**
 * fx's clones of the registered repositories, under ~/.fx/repos/<name>.
 *
 * Each clone is a mirror: a sync resets it to the remote, so it is never a
 * place to keep work. The user's own credentials (credential helper, ssh
 * agent) are what git uses, and git is never allowed to stop and ask.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { reposDir } from "./home";
import { runOk } from "./process";
import type { ObjectOf } from "./registry/kinds";

type Repository = ObjectOf<"Repository">;

/** A clone or fetch of a large repository is slow, but not this slow. */
const SYNC_TIMEOUT_MS = 10 * 60_000;

/**
 * Git is never allowed to stop and ask: a prompt in a background sync is a
 * hang, and a hang looks like a slow sync rather than a failed one. ssh in
 * batch mode fails on a key that wants a passphrase instead of waiting.
 */
export const GIT_ENV = {
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    SSH_ASKPASS: "",
    GIT_SSH_COMMAND: "ssh -oBatchMode=yes -oStrictHostKeyChecking=accept-new",
    GIT_PAGER: "cat",
    PAGER: "cat",
};

export function repoDir(name: string): string {
    return join(reposDir(), name);
}

export function isCloned(name: string): boolean {
    return existsSync(join(repoDir(name), ".git"));
}

type Git = (args: string[], cwd?: string) => Promise<string>;

/**
 * Only the registered branch — drover's clone. Without --single-branch, git
 * downloads every branch on the remote: 2,446 of them for opencode, 24,567
 * for cmux, all for a mirror fx only ever reads one branch of.
 */
function clone(git: Git, repo: Repository, dir: string): Promise<string> {
    const branch = repo.spec.branch ? ["--branch", repo.spec.branch] : [];
    return git(["clone", "--quiet", "--single-branch", ...branch, "--", repo.spec.url, dir]);
}

async function update(git: Git, repo: Repository, dir: string): Promise<void> {
    await git(["fetch", "--quiet", "origin", repo.spec.branch ?? "HEAD"], dir);
    await git(["reset", "--quiet", "--hard", "FETCH_HEAD"], dir);
}

/** Clone the repository, or bring an existing clone to the remote's tip. Returns the commit. */
export async function syncRepo(repo: Repository, signal?: AbortSignal): Promise<string> {
    const dir = repoDir(repo.metadata.name);
    const git: Git = (args, cwd) => runOk(["git", ...args], { cwd, env: GIT_ENV, timeoutMs: SYNC_TIMEOUT_MS, signal });
    if (isCloned(repo.metadata.name)) await update(git, repo, dir);
    else await clone(git, repo, dir);
    return (await git(["rev-parse", "--short", "HEAD"], dir)).trim();
}
