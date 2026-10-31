/**
 * git against a real "remote": a local bare repository with a pull request
 * ref, the way GitHub serves refs/pull/<n>/head.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureHome, reposDir } from "../src/home";
import type { ObjectOf } from "../src/registry/kinds";
import { repoDir, syncRepo } from "../src/repos";
import { createGitTools, forbiddenGitOption } from "../src/tools/git";
import { call, useFxHome } from "./helpers";

const fxHome = useFxHome();
let repo: ObjectOf<"Repository">;
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

function commit(file: string, text: string, message: string): void {
    writeFileSync(join(work, file), text);
    git(work, "add", file);
    git(work, "commit", "-qm", message);
}

beforeAll(() => {
    ensureHome();
    const origin = join(fxHome(), "..", "origin.git");
    work = join(fxHome(), "..", "work");
    git(fxHome(), "init", "-q", "--bare", "-b", "main", origin);
    mkdirSync(work);
    git(work, "init", "-q", "-b", "main");
    commit("handler.go", "func handle() { return 200 }\n", "Add the handler");
    git(work, "remote", "add", "origin", origin);
    git(work, "push", "-q", "origin", "main");
    git(work, "switch", "-qc", "fix");
    commit("handler.go", "func handle() { return 204 }\n", "Return 204 on empty bodies");
    git(work, "push", "-q", "origin", "fix:refs/pull/7/head");
    repo = {
        apiVersion: "fx/v1",
        kind: "Repository",
        metadata: { name: "svc" },
        spec: { url: origin, refreshInterval: "15m" },
    };
});

describe("git tools", () => {
    test("sync_repo clones, then follows the remote", async () => {
        const tools = createGitTools([repo]);
        expect(await call(tools.sync_repo, { repo: "svc" })).toMatch(/^svc is at [0-9a-f]{7}/);
        git(work, "switch", "-q", "main");
        commit("README.md", "svc\n", "Document the service");
        git(work, "push", "-q", "origin", "main");
        await call(tools.sync_repo, { repo: "svc" });
        expect(git(repoDir("svc"), "log", "-1", "--format=%s")).toBe("Document the service");
    });

    test("git runs read-only commands in the clone", async () => {
        const out = await call(createGitTools([repo]).git, { repo: "svc", command: "log", args: ["--format=%s"] });
        expect(out).toContain("Add the handler");
    });

    test("options that write files or run programs are refused before git runs", async () => {
        const target = join(reposDir(), "leak.patch");
        await expect(
            call(createGitTools([repo]).git, { repo: "svc", command: "diff", args: [`--output=${target}`, "HEAD~1"] }),
        ).rejects.toThrow("is not allowed");
        expect(existsSync(target)).toBe(false);
        expect(forbiddenGitOption(["--ext-diff"])).toBe("--ext-diff");
        expect(forbiddenGitOption(["-Ovim", "x"])).toBe("-Ovim");
        expect(forbiddenGitOption(["--stat", "-S", "handle"])).toBeUndefined();
    });

    test("an unregistered repository is named, not guessed", async () => {
        await expect(call(createGitTools([repo]).git, { repo: "nope", command: "log", args: [] })).rejects.toThrow(
            "no repository named nope — registered: svc",
        );
    });

    test("pull_request fetches into fx's own ref and summarises the change", async () => {
        const out = await call(createGitTools([repo]).pull_request, { repo: "svc", number: 7 });
        expect(out).toContain("ref: refs/fx/pr/7");
        expect(out).toContain("Return 204 on empty bodies");
        expect(out).toContain("handler.go");
        // No branch moved: the clone's HEAD is still the synced main.
        expect(git(repoDir("svc"), "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    });

    test("syncRepo reports the commit it landed on", async () => {
        expect(await syncRepo(repo)).toBe(git(repoDir("svc"), "rev-parse", "--short", "HEAD"));
    });
});
