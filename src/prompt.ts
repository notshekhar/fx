/**
 * fx's system prompt: the user's ~/.fx/prompt.md when there is one, fx's own
 * otherwise — followed, either way, by what is registered right now, so the
 * model never has to guess which repositories or databases exist.
 */
import { existsSync, readFileSync } from "node:fs";
import { promptFile, reposDir, scratchpadDir } from "./home";
import type { Registry } from "./registry/store";
import { isCloned } from "./repos";

export const DEFAULT_PROMPT = `You are fx, a debugging and investigation assistant. You find out how systems behave and why they fail by reading their code, history, data, cluster state and telemetry. You never change any of them.

How you work:
- Start from evidence. Read the code that runs, the commit that changed it, the rows in the database, the pod's events and logs, the trace — then reason. Never present a guess as a finding.
- Name your sources: file and line, commit, query, pod, trace id. Someone should be able to check every claim you make.
- Say what you could not see. If a repository is not cloned, a cluster refuses, or a query returns nothing, report that instead of filling the gap.
- Keep queries bounded: add LIMIT to SQL, --tail to logs, a narrow time window to telemetry.
- Use the scratchpad for anything that needs a script: write it there with bash, run it there. It is the only place you can write.
- Lead with the answer. Keep it short, then the evidence.`;

function loadPrompt(): string {
    const file = promptFile();
    if (!existsSync(file)) return DEFAULT_PROMPT;
    return readFileSync(file, "utf8").trim() || DEFAULT_PROMPT;
}

function describeSources(registry: Registry): string {
    const lines = [
        `Repositories live in ${reposDir()} (one directory each, named as below).`,
        `bash starts in the scratchpad, ${scratchpadDir()} — write scripts there, by relative path. It has no network and cannot read the rest of the home directory.`,
        "",
        "Registered sources:",
    ];
    if (registry.objects.length === 0)
        lines.push("  (none — the user registers sources with `fx apply -f <file>.yaml`)");
    for (const object of registry.objects)
        lines.push(`  - ${object.kind} ${object.metadata.name}: ${summarise(object)}`);
    return lines.join("\n");
}

function summarise(object: Registry["objects"][number]): string {
    switch (object.kind) {
        case "Repository":
            return `${object.spec.url}${isCloned(object.metadata.name) ? "" : " (not cloned yet — it is being cloned; sync_repo to wait for it)"}`;
        case "Database":
            return `${object.spec.type} ${object.spec.database} (sql tool)`;
        case "Kubernetes":
            return `context ${object.spec.context}${object.spec.namespaces ? `, namespaces ${object.spec.namespaces.join(", ")}` : ""}`;
        case "Telemetry":
            return `${object.spec.type} (telemetry tool)`;
        case "McpServer":
            return `MCP server ${object.spec.url}`;
        case "Environment":
            return `environment for http requests`;
        case "HTTPRequest":
            return object.spec.method === "GET"
                ? `${object.spec.description ?? object.spec.url} (http_request tool)`
                : `${object.spec.method}, not callable: fx only makes GET requests`;
    }
}

export function systemPrompt(registry: Registry): string {
    return `${loadPrompt()}\n\n${describeSources(registry)}`;
}
