/**
 * Things both the CLI and the slash commands do with the registry: list it
 * and sync its repositories.
 */
import { KINDS, type FxObject, type Kind } from "./registry/kinds";
import { loadRegistry, objectsOf, type Registry } from "./registry/store";
import { isCloned } from "./repos";
import { readSyncStatus, syncTracked, type SyncStatus } from "./sync";

/** `fx get repositories`, `fx delete database orders`: kinds by their spelled-out name, either number. */
const KIND_WORDS: Record<string, Kind> = {
    repository: "Repository",
    repositories: "Repository",
    database: "Database",
    databases: "Database",
    kubernetes: "Kubernetes",
    environment: "Environment",
    environments: "Environment",
    httprequest: "HTTPRequest",
    httprequests: "HTTPRequest",
    telemetry: "Telemetry",
    mcpserver: "McpServer",
    mcpservers: "McpServer",
};

export function parseKind(word: string): Kind {
    const kind = KIND_WORDS[word.toLowerCase()];
    if (!kind) throw new Error(`unknown kind ${word} — one of ${KINDS.join(", ")}`);
    return kind;
}

export function formatRegistry(registry: Registry, only?: Kind): string {
    const lines: string[] = [];
    for (const kind of only ? [only] : KINDS) {
        const objects = registry.objects.filter((o) => o.kind === kind);
        if (objects.length === 0) continue;
        lines.push(`${kind}:`);
        for (const object of objects) lines.push(`  ${object.metadata.name.padEnd(20)} ${detail(object)}`);
    }
    if (lines.length === 0) lines.push("nothing registered — add sources with `fx apply -f <file>.yaml`");
    for (const problem of registry.problems) lines.push(`! ${problem}`);
    return lines.join("\n");
}

function detail(object: FxObject): string {
    switch (object.kind) {
        case "Repository":
            return `${object.spec.url}  ${repositoryState(object.metadata.name, readSyncStatus()[object.metadata.name])}  every ${object.spec.refreshInterval}`;
        case "Database":
            return `${object.spec.type}  ${object.spec.host}:${object.spec.port}/${object.spec.database}`;
        case "Kubernetes":
            return `context ${object.spec.context}${object.spec.namespaces ? `  namespaces ${object.spec.namespaces.join(",")}` : ""}`;
        case "Telemetry":
        case "McpServer":
            return `${object.kind === "Telemetry" ? object.spec.type : object.spec.transport}  ${object.spec.url}`;
        case "Environment":
            return `variables ${Object.keys(object.spec.variables).join(",") || "-"}  secrets ${Object.keys(object.spec.secrets).join(",") || "-"}`;
        case "HTTPRequest":
            return `${object.spec.method} ${object.spec.url}${object.spec.method === "GET" ? "" : "  (not offered: only GET is)"}`;
    }
}

function repositoryState(name: string, status: SyncStatus | undefined): string {
    if (status?.error) return `sync failed ${ago(status.at)}: ${status.error.split("\n")[0]}`;
    if (!isCloned(name)) return "not cloned";
    return status?.commit ? `${status.commit}, synced ${ago(status.at)}` : "cloned";
}

function ago(iso: string): string {
    const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    return minutes < 48 * 60 ? `${Math.round(minutes / 60)}h ago` : `${Math.round(minutes / 1440)}d ago`;
}

/** Sync the named repository, or all of them; each result is reported as it lands. */
export async function syncRepositories(name: string | undefined, report: (line: string) => void): Promise<void> {
    const repos = objectsOf(loadRegistry(), "Repository").filter((r) => !name || r.metadata.name === name);
    if (name && repos.length === 0) throw new Error(`no repository named ${name}`);
    for (const repo of repos) {
        try {
            report(`${repo.metadata.name}: ${await syncTracked(repo)}`);
        } catch (err) {
            report(`${repo.metadata.name}: failed — ${(err as Error).message}`);
        }
    }
}
