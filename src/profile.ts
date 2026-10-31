/**
 * fx as loop sees it: loop's engine and screen, with fx's tools, prompt,
 * skills and home. Logins, providers and models stay loop's, in ~/.loop.
 */
import type { AppProfile, McpServerConfig } from "@notshekhar/loop-core";
import { FX_COMMANDS } from "./commands";
import { builtinSkillsDir, fxHome, skillsDir } from "./home";
import { systemPrompt } from "./prompt";
import type { ObjectOf } from "./registry/kinds";
import { loadRegistry, objectsOf, type Registry } from "./registry/store";
import { createFxTools } from "./tools";

/** loop features fx does not offer: writing, delegating, background work, loop's own plumbing. */
const HIDDEN_COMMANDS = [
    "plan",
    "goal",
    "background",
    "bg",
    "daemon",
    "team",
    "lead",
    "hosts",
    "rc",
    "timer",
    "reminder",
    "reminders",
    "shells",
    "cd",
    "cwd",
    "update",
    "changelog",
    "release-notes",
    "memory",
    "init",
    "agents",
    "hooks",
    "extensions",
    "install",
    "datasource",
    "gateways",
    "artifacts",
    "recipe",
    "handoff",
];

function mcpServers(servers: readonly ObjectOf<"McpServer">[]): Record<string, McpServerConfig> {
    return Object.fromEntries(
        servers.map(({ metadata, spec }) => [
            metadata.name,
            {
                type: spec.transport,
                url: spec.url,
                ...(spec.headers && { headers: spec.headers }),
                ...(spec.auth && { auth: spec.auth }),
                ...(spec.allowedTools && { allowedTools: spec.allowedTools }),
                ...(spec.deniedTools && { deniedTools: spec.deniedTools }),
            },
        ]),
    );
}

/**
 * MCP servers are read when the profile is built, because loop connects them
 * once at startup — a new McpServer object applies on the next start.
 */
export function createFxProfile(registry: Registry): AppProfile {
    return {
        name: "fx",
        dataDir: fxHome(),
        createTools: createFxTools,
        basePrompt: () => systemPrompt(loadRegistry()),
        fixedSettings: {
            mcpServers: mcpServers(objectsOf(registry, "McpServer")),
            agent: "default",
            subagents: false,
            threadTeams: false,
            backgroundShells: false,
            artifacts: false,
            webSearch: false,
            reminders: false,
            // fx is not in a project: no AGENTS.md, no project memory, and
            // none of loop's hooks, which were written for coding sessions.
            workspaceContext: false,
            memory: false,
            hooks: {},
            importClaudeHooks: false,
        },
        // Rows for loop features fx leaves out that are not pinned above.
        hiddenSettings: ["subagentModel", "subagentMaxParallel", "recap", "serve", "serveTerminal", "gateways"],
        skillDirs: [skillsDir(), builtinSkillsDir()],
        skillCommandPrefix: "",
        hiddenCommands: HIDDEN_COMMANDS,
        commands: FX_COMMANDS,
        agents: false,
        extensions: false,
    };
}
