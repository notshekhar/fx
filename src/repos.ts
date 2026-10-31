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

export const GIT_ENV = { GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat", PAGER: "cat" };

export function repoDir(name: string): string {
    return join(reposDir(), name);
}

export function isCloned(name: string): boolean {
    return existsSync(join(repoDir(name), ".git"));
}

/** Clone the repository, or bring an existing clone to the remote's tip. Returns the commit. */
export async function syncRepo(repo: Repository, signal?: AbortSignal): Promise<string> {
    const dir = repoDir(repo.metadata.name);
    const git = (args: string[], cwd?: string) =>
        runOk(["git", ...args], { cwd, env: GIT_ENV, timeoutMs: SYNC_TIMEOUT_MS, signal });

    if (!isCloned(repo.metadata.name)) {
        const branch = repo.spec.branch ? ["--branch", repo.spec.branch] : [];
        await git(["clone", "--quiet", ...branch, repo.spec.url, dir]);
    } else {
        await git(["fetch", "--quiet", "origin", repo.spec.branch ?? "HEAD"], dir);
        await git(["reset", "--quiet", "--hard", "FETCH_HEAD"], dir);
    }
    return (await git(["rev-parse", "--short", "HEAD"], dir)).trim();
}
