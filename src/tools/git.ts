/**
 * git, read-only, over fx's clones — plus the two writes fx makes to its own
 * clones: bringing one up to date, and fetching a pull request into a ref of
 * its own for review. Both stay inside ~/.fx/repos.
 */
import { tool, type Tool } from "ai";
import { z } from "zod";
import { GIT_ENV, isCloned, repoDir } from "../repos";
import { syncTracked } from "../sync";
import { runOk } from "../process";
import type { ObjectOf } from "../registry/kinds";
import { capped } from "./output";

type Repository = ObjectOf<"Repository">;

const READ_ONLY_COMMANDS = [
    "log",
    "show",
    "diff",
    "blame",
    "status",
    "branch",
    "tag",
    "ls-files",
    "ls-tree",
    "rev-parse",
    "rev-list",
    "describe",
    "shortlog",
    "grep",
    "cat-file",
    "merge-base",
    "name-rev",
] as const;

/**
 * Options that make an otherwise read-only command write a file or start a
 * program: diff/log write with --output, an external diff or text converter
 * runs a configured command, and grep's -O opens results in a pager.
 */
const FORBIDDEN_OPTIONS = [/^--output(=|$)/, /^--ext-diff$/, /^--textconv$/, /^-O/, /^--open-files-in-pager/];

const GIT_TIMEOUT_MS = 60_000;

export function forbiddenGitOption(args: readonly string[]): string | undefined {
    return args.find((arg) => FORBIDDEN_OPTIONS.some((re) => re.test(arg)));
}

/** Refs fx owns, so fetching a pull request can never move a branch. */
const PR_REF_PREFIX = "refs/fx/pr/";

function pullRequestRef(number: number): string {
    return `${PR_REF_PREFIX}${number}`;
}

function requireRepo(repos: readonly Repository[], name: string): Repository {
    const repo = repos.find((r) => r.metadata.name === name);
    if (!repo)
        throw new Error(
            `no repository named ${name} — registered: ${repos.map((r) => r.metadata.name).join(", ") || "none"}`,
        );
    return repo;
}

const repoName = z.string().describe("Registered repository name");

export function createGitTools(repos: readonly Repository[], fallbackSignal?: AbortSignal): Record<string, Tool> {
    const git = (name: string, args: string[], signal: AbortSignal | undefined) => {
        if (!isCloned(name)) throw new Error(`${name} is not cloned yet — call sync_repo first`);
        return runOk(["git", "--no-pager", ...args], {
            cwd: repoDir(name),
            env: GIT_ENV,
            timeoutMs: GIT_TIMEOUT_MS,
            signal: signal ?? fallbackSignal,
        });
    };

    return {
        git: tool({
            description: `Run a read-only git command in a registered repository's clone: ${READ_ONLY_COMMANDS.join(", ")}. Use it to trace history — who changed a line and why (blame → show), what changed between two refs (diff a..b), when a symbol appeared (log -S).`,
            inputSchema: z.object({
                repo: repoName,
                command: z.enum(READ_ONLY_COMMANDS),
                args: z.array(z.string()).default([]).describe("Arguments after the command, one per element"),
            }),
            execute: async ({ repo, command, args }, options) => {
                requireRepo(repos, repo);
                const bad = forbiddenGitOption(args);
                if (bad) throw new Error(`${bad} is not allowed: it can write files or run programs`);
                return capped(await git(repo, [command, ...args], options?.abortSignal));
            },
        }),
        sync_repo: tool({
            description:
                "Clone a registered repository, or reset fx's clone of it to the remote's latest commit. Do this before investigating when the answer depends on current code.",
            inputSchema: z.object({ repo: repoName }),
            execute: async ({ repo }, options) =>
                `${repo} is at ${await syncTracked(requireRepo(repos, repo), options?.abortSignal ?? fallbackSignal)}`,
        }),
        pull_request: tool({
            description: `Fetch a GitHub pull request into fx's clone as ${PR_REF_PREFIX}<number> and summarise it: base, commits and changed files. Then read the change with git diff <base>...${PR_REF_PREFIX}<number>.`,
            inputSchema: z.object({ repo: repoName, number: z.number().int().positive() }),
            execute: async ({ repo, number }, options) => {
                requireRepo(repos, repo);
                const run = (args: string[]) => git(repo, args, options?.abortSignal);
                const ref = pullRequestRef(number);
                await run(["fetch", "--quiet", "--force", "origin", `pull/${number}/head:${ref}`]);
                const base = (await run(["merge-base", "HEAD", ref])).trim();
                const commits = await run(["log", "--oneline", `${base}..${ref}`]);
                const files = await run(["diff", "--stat", `${base}...${ref}`]);
                return capped(`ref: ${ref}\nbase: ${base}\n\ncommits:\n${commits}\nfiles:\n${files}`);
            },
        }),
    };
}
