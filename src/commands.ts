/** Slash commands fx adds to loop's: /sources, /sync and /prompt. */
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import type { SlashCommand } from "@notshekhar/loop-core";
import { promptFile } from "./home";
import { DEFAULT_PROMPT } from "./prompt";
import { loadRegistry } from "./registry/store";
import { formatRegistry, syncRepositories } from "./sources";

/** Write the built-in prompt out, so there is something to edit. */
export function ensurePromptFile(): string {
    const file = promptFile();
    if (!existsSync(file)) writeFileSync(file, `${DEFAULT_PROMPT}\n`);
    return file;
}

export const FX_COMMANDS: readonly SlashCommand[] = [
    {
        name: "sources",
        description: "List what fx can see: repositories, databases, clusters, telemetry, MCP servers",
        handler: (ctx) => ctx.emit("help", formatRegistry(loadRegistry())),
    },
    {
        name: "sync",
        description: "Clone or update the registered repositories: /sync [name]",
        handler: async (ctx, args) => {
            try {
                await syncRepositories(args || undefined, (line) => ctx.emit("help", line));
            } catch (err) {
                ctx.emit("error", (err as Error).message);
            }
        },
    },
    {
        name: "prompt",
        description: "Edit fx's system prompt (~/.fx/prompt.md); /prompt reset goes back to the built-in one",
        handler: (ctx, args) => {
            if (args === "reset") {
                if (existsSync(promptFile())) unlinkSync(promptFile());
                ctx.emit("help", "system prompt reset to fx's built-in one");
                return;
            }
            ctx.emit("help", `edit ${ensurePromptFile()} — it applies from your next message`);
        },
    },
];
