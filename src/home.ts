/**
 * ~/.fx — everything fx owns. Providers, logins and models are loop's and
 * stay in ~/.loop; nothing else fx writes ever leaves this directory.
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** FX_HOME moves the whole tree, which is how tests get a home of their own. */
export function fxHome(): string {
    return process.env.FX_HOME || join(homedir(), ".fx");
}

/** fx's own clones of the registered repositories. */
export function reposDir(): string {
    return join(fxHome(), "repos");
}

/** The one place bash may write. */
export function scratchpadDir(): string {
    return join(fxHome(), "scratchpad");
}

/** The user's skills. */
export function skillsDir(): string {
    return join(fxHome(), "skills");
}

/** The skills fx ships, rewritten on every start so an upgrade replaces them. */
export function builtinSkillsDir(): string {
    return join(fxHome(), "builtin-skills");
}

/** The user's system prompt; the built-in one applies while it is absent. */
export function promptFile(): string {
    return join(fxHome(), "prompt.md");
}

export function ensureHome(): void {
    for (const dir of [fxHome(), reposDir(), scratchpadDir(), skillsDir(), builtinSkillsDir()]) {
        mkdirSync(dir, { recursive: true });
    }
}
