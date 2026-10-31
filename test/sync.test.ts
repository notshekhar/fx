/** The auto-sync schedule, against a real local remote. */
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureHome } from "../src/home";
import type { ObjectOf } from "../src/registry/kinds";
import { isCloned, repoDir } from "../src/repos";
import { isDue, readSyncStatus, syncDueRepositories, syncTracked } from "../src/sync";
import { useFxHome, yamlDoc } from "./helpers";

const fxHome = useFxHome();
let origin: string;
let work: string;

function git(cwd: string, ...args: string[]): string {
    const result = Bun.spawnSync(["git", ...args], {
        cwd,
        env: {
            ...process.env,
            GIT_AUTHOR_NAME: "t",
            GIT_AUTHOR_EMAIL: "t@t",
            GIT_COMMITTER_NAME: "t",
            GIT_COMMITTER_EMAIL: "t@t",
        },
    });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
}

function pushCommit(message: string): void {
    writeFileSync(join(work, "f.txt"), message);
    git(work, "add", "f.txt");
    git(work, "commit", "-qm", message);
    git(work, "push", "-q", "origin", "main");
}

const repo = (name: string, refreshInterval = "15m"): ObjectOf<"Repository"> => ({
    apiVersion: "fx/v1",
    kind: "Repository",
    metadata: { name },
    spec: { url: origin, refreshInterval },
});

beforeAll(() => {
    ensureHome();
    origin = join(fxHome(), "..", "origin.git");
    work = join(fxHome(), "..", "work");
    git(fxHome(), "init", "-q", "--bare", "-b", "main", origin);
    mkdirSync(work);
    git(work, "init", "-q", "-b", "main");
    git(work, "remote", "add", "origin", origin);
    pushCommit("first");
});

describe("auto sync", () => {
    test("a missing clone is always due; a fresh one is not until its interval passes", () => {
        const now = Date.parse("2026-10-31T12:00:00Z");
        expect(isDue(repo("never-cloned"), undefined, now)).toBe(true);
        mkdirSync(join(repoDir("present"), ".git"), { recursive: true });
        const at = { at: "2026-10-31T11:50:00Z", commit: "abc" };
        expect(isDue(repo("present", "15m"), at, now)).toBe(false);
        expect(isDue(repo("present", "5m"), at, now)).toBe(true);
        expect(isDue(repo("present", "never"), at, now)).toBe(false);
    });

    test("one pass clones what is registered, then follows the remote when due", async () => {
        writeFileSync(
            join(fxHome(), "repos.yaml"),
            yamlDoc("Repository", "api", `url: ${origin}\nrefreshInterval: 1m`),
        );
        await syncDueRepositories();
        expect(isCloned("api")).toBe(true);
        const first = readSyncStatus().api!;
        expect(first.commit).toBe(git(repoDir("api"), "rev-parse", "--short", "HEAD"));

        pushCommit("second");
        await syncDueRepositories(Date.parse(first.at) + 30_000);
        expect(git(repoDir("api"), "log", "-1", "--format=%s")).toBe("first");
        await syncDueRepositories(Date.parse(first.at) + 61_000);
        expect(git(repoDir("api"), "log", "-1", "--format=%s")).toBe("second");
    });

    test("a failure is recorded, not thrown, and the next pass retries", async () => {
        writeFileSync(join(fxHome(), "broken.yaml"), yamlDoc("Repository", "gone", "url: /nonexistent/repo.git"));
        await syncDueRepositories();
        expect(readSyncStatus().gone?.error).toBeTruthy();
    });

    test("two syncs of one repository share one run", async () => {
        const [a, b] = [syncTracked(repo("api")), syncTracked(repo("api"))];
        expect(a).toBe(b);
        await a;
    });
});
