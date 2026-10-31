/**
 * read / ls / grep / find — loop's own tools, started in ~/.fx/repos and
 * fenced to fx's directories. Plain ripgrep and plain files: no index.
 */
import type { Tool } from "ai";
import { createFindTool, createGrepTool, createLsTool, createReadTool } from "@notshekhar/loop-core";
import { builtinSkillsDir, reposDir, scratchpadDir, skillsDir } from "../home";
import { assertInScope } from "./scope";

/**
 * Loop's read also fetches URLs and reads loop's docs, and tells the model to
 * edit loop's config — none of which applies here.
 */
const READ_DESCRIPTION = `Read a file. Paths are relative to the repositories directory, so \`api/src/main.go\` is \`src/main.go\` in the repository named api. Skill files and the scratchpad can be read too. Text is cut at 2000 lines or 50KB; continue with offset/limit.`;

export interface FileToolContext {
    sessionId?: string;
    abortSignal?: AbortSignal;
}

export function createFileTools(ctx: FileToolContext): Record<string, Tool> {
    const cwd = reposDir();
    const roots = [reposDir(), skillsDir(), builtinSkillsDir(), scratchpadDir()];
    const base = { cwd, sessionId: ctx.sessionId, abortSignal: ctx.abortSignal };
    const fence = <T extends Tool>(tool: T, description?: string) => confined(tool, cwd, roots, description);
    return {
        read: fence(createReadTool(base), READ_DESCRIPTION),
        ls: fence(createLsTool(base)),
        grep: fence(createGrepTool(base)),
        find: fence(createFindTool(base)),
    };
}

/** The same tool, refusing any `path` outside `roots` before it runs. */
function confined<T extends Tool>(tool: T, cwd: string, roots: readonly string[], description?: string): T {
    const execute = tool.execute as (input: { path?: string }, options: unknown) => unknown;
    return {
        ...tool,
        ...(description ? { description } : {}),
        execute: async (input: { path?: string }, options: unknown) => {
            assertInScope(input.path ?? ".", cwd, roots);
            return execute(input, options);
        },
    } as T;
}
