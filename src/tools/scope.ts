/**
 * The file tools may only look inside fx's own directories: the registered
 * repositories' clones, the skills, and the scratchpad.
 *
 * Checked on the real path, after symlinks: a repository can carry a link to
 * /etc or ~/.ssh, and a check on the spelling alone would follow it out.
 */
import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

/** The real path of `path`, or of its nearest existing ancestor joined back on. */
function realPath(path: string): string {
    if (existsSync(path)) return realpathSync(path);
    const parent = dirname(path);
    if (parent === path) return path;
    return resolve(realPath(parent), relative(parent, path));
}

function isWithin(path: string, root: string): boolean {
    const rel = relative(root, path);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Throws unless `path` (relative to `cwd`) really lies under one of `roots`. */
export function assertInScope(path: string, cwd: string, roots: readonly string[]): void {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path.trim())) {
        throw new Error(`${path}: fx reads local files only — no URLs`);
    }
    const target = realPath(resolve(cwd, path.trim().replace(/^~(?=$|\/)/, process.env.HOME ?? "~")));
    if (roots.some((root) => isWithin(target, realPath(root)))) return;
    throw new Error(`${path} is outside what fx may read (the registered repositories, skills and scratchpad)`);
}
