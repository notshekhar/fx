/**
 * `fx status` and /status: whether each registered thing works right now.
 * Repositories report their last sync; databases, clusters, telemetry and MCP
 * servers are asked live, all at once, each within CHECK_TIMEOUT_MS so one
 * dead host cannot hold up the rest; environments and requests are resolved
 * without sending anything.
 */
import { resolveSecrets, testConnection } from "@notshekhar/loop-core";
import { chooseEnvironment, missingSecrets, resolveOrigin, type Environment } from "./http/request";
import { runOk } from "./process";
import type { FxObject, Kind, ObjectOf } from "./registry/kinds";
import { objectsOf, type Registry } from "./registry/store";
import { describeSync } from "./sync";
import { probeTelemetry } from "./telemetry/probe";
import { kubectlFor } from "./tools/kubernetes";

/** `off`: registered but deliberately unused, such as a request fx will not send. */
export type HealthState = "ok" | "failing" | "off";

export interface Health {
    kind: Kind;
    name: string;
    state: HealthState;
    detail: string;
    /** How long a live check took; absent for the ones answered locally. */
    ms?: number;
}

interface Verdict {
    state: HealthState;
    detail: string;
}

/** Long enough for a slow VPN, short enough that /status feels like a glance. */
export const CHECK_TIMEOUT_MS = 5_000;

const LIVE_KINDS: ReadonlySet<Kind> = new Set(["Database", "Kubernetes", "Telemetry", "McpServer"]);

const ok = (detail: string): Verdict => ({ state: "ok", detail });

export function checkAll(registry: Registry, only?: Kind): Promise<Health[]> {
    const environments = objectsOf(registry, "Environment");
    const objects = registry.objects.filter((o) => !only || o.kind === only);
    return Promise.all(objects.map((object) => checkOne(object, environments)));
}

async function checkOne(object: FxObject, environments: readonly Environment[]): Promise<Health> {
    const started = performance.now();
    const signal = AbortSignal.timeout(CHECK_TIMEOUT_MS);
    let verdict: Verdict;
    try {
        verdict = await withDeadline(check(object, environments, signal), signal);
    } catch (err) {
        const detail = signal.aborted ? `no answer in ${CHECK_TIMEOUT_MS / 1000}s` : (err as Error).message;
        verdict = { state: "failing", detail: detail.trim().split("\n")[0]! };
    }
    const ms = LIVE_KINDS.has(object.kind) ? Math.round(performance.now() - started) : undefined;
    return { kind: object.kind, name: object.metadata.name, ...verdict, ...(ms !== undefined && { ms }) };
}

/** Some checks (loop's database test) do not take a signal; this stops waiting for them all the same. */
function withDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    const deadline = new Promise<never>((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
    );
    return Promise.race([work, deadline]);
}

function check(object: FxObject, environments: readonly Environment[], signal: AbortSignal): Promise<Verdict> {
    switch (object.kind) {
        case "Repository":
            return Promise.resolve(checkRepository(object));
        case "Database":
            return checkDatabase(object);
        case "Kubernetes":
            return checkCluster(object, signal);
        case "Telemetry":
            return probeTelemetry(object, signal).then(() => ok("answering"));
        case "McpServer":
            return checkMcpServer(object, signal);
        case "Environment":
            return Promise.resolve(checkEnvironment(object));
        case "HTTPRequest":
            return Promise.resolve(checkRequest(object, environments));
    }
}

function checkRepository(repo: ObjectOf<"Repository">): Verdict {
    const { ok: synced, detail } = describeSync(repo.metadata.name);
    return { state: synced ? "ok" : "failing", detail };
}

async function checkDatabase(db: ObjectOf<"Database">): Promise<Verdict> {
    const result = await testConnection(db.spec);
    if (!result.ok) throw new Error(result.error ?? "could not connect");
    return ok(`connected to ${db.spec.host}:${db.spec.port}/${db.spec.database}`);
}

async function checkCluster(cluster: ObjectOf<"Kubernetes">, signal: AbortSignal): Promise<Verdict> {
    const argv = [...kubectlFor(cluster), "version", "-o", "json", `--request-timeout=${CHECK_TIMEOUT_MS / 1000}s`];
    const out = await runOk(argv, { timeoutMs: CHECK_TIMEOUT_MS, signal });
    const server = (JSON.parse(out) as { serverVersion?: { gitVersion?: string } }).serverVersion?.gitVersion;
    if (!server) throw new Error(`context ${cluster.spec.context} did not report a server version`);
    return ok(`server ${server}`);
}

/**
 * Reachability only: the chat does the real MCP handshake (and any OAuth
 * sign-in) when it connects, so a refusal is only fx's fault when fx was
 * given credentials of its own.
 */
async function checkMcpServer(server: ObjectOf<"McpServer">, signal: AbortSignal): Promise<Verdict> {
    const headers = Object.fromEntries(
        Object.entries(server.spec.headers ?? {}).map(([name, value]) => [name, resolveSecrets(value)]),
    );
    const response = await fetch(server.spec.url, { method: "HEAD", headers, signal });
    if (response.status === 401 || response.status === 403) {
        if (server.spec.auth === "oauth") return ok("reachable; signs in with OAuth when the chat connects");
        throw new Error(`HTTP ${response.status}: the server refused fx's credentials`);
    }
    if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
    return ok("reachable");
}

function checkEnvironment(environment: Environment): Verdict {
    const missing = missingSecrets(environment);
    if (missing.length) return { state: "failing", detail: `not set: ${missing.join(", ")}` };
    const { variables, secrets } = environment.spec;
    return ok(`${Object.keys(variables).length} variables, ${Object.keys(secrets).length} secrets, all set`);
}

function checkRequest(request: ObjectOf<"HTTPRequest">, environments: readonly Environment[]): Verdict {
    if (request.spec.method !== "GET")
        return { state: "off", detail: `${request.spec.method}, not offered: only GET is` };
    const names = request.spec.environments ?? [request.spec.defaultEnvironment];
    const targets = names.map((name) => {
        const environment = chooseEnvironment(request, environments, name);
        const origin = resolveOrigin(request, environment);
        return environment ? `${environment.metadata.name} ${origin}` : origin;
    });
    return ok(`GET → ${targets.join(", ")}`);
}
