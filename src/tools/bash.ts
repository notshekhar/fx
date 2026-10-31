/**
 * loop's bash, in a sandbox that holds or refuses to run: it writes only to
 * the scratchpad, has no network, and reads nothing in the user's home
 * directory except ~/.fx and the program directories on their PATH.
 *
 * No network, because data comes in through fx's tools — a script that could
 * reach the network could reach a cluster's API too. No home, because that is
 * where keys, tokens and other people's repositories live.
 */
import { homedir } from "node:os";
import { delimiter, isAbsolute, relative } from "node:path";
import type { Tool } from "ai";
import { createBashTool, type ToolContext } from "@notshekhar/loop-core";
import { fxHome, scratchpadDir } from "../home";

/** PATH entries under home (~/.bun/bin, ~/.local/bin, …), so installed programs still run. */
function programDirsUnderHome(home: string): string[] {
    return (process.env.PATH ?? "")
        .split(delimiter)
        .filter((dir) => dir && isAbsolute(dir) && !relative(home, dir).startsWith(".."));
}

export function createScratchpadBash(ctx: ToolContext): Tool {
    const home = homedir();
    return createBashTool({
        cwd: scratchpadDir(),
        sessionId: ctx.sessionId,
        abortSignal: ctx.abortSignal,
        confineToCwd: {
            network: "deny",
            denyRead: [home],
            allowRead: [fxHome(), ...programDirsUnderHome(home)],
        },
    });
}
