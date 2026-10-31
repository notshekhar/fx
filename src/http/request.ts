/**
 * Turning an HTTPRequest into a fetch, drover's way. Three placeholders, kept
 * apart on purpose:
 *
 *   {{name}}      the selected Environment's variable or secret
 *   ${env:NAME}   fx's process environment (drover's ${NAME} too)
 *   {name}        a parameter the caller supplies
 *
 * Only the last is ever the caller's, so the model cannot reach a secret by
 * asking for it, and a resolved secret is never put in an error or a result.
 */
import { URL_PARAM, type ObjectOf } from "../registry/kinds";

export type Request = ObjectOf<"HTTPRequest">;
export type Environment = ObjectOf<"Environment">;

const HTTP_TIMEOUT_MS = 30_000;

function fromProcess(reference: string): string {
    const name = /^\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(reference)?.[1];
    const value = name ? process.env[name] : undefined;
    if (value === undefined) throw new Error(`${reference} is not set in fx's environment`);
    return value;
}

function expand(template: string, env: Environment | undefined): string {
    return template
        .replace(/\$\{(?:env:)?[A-Za-z_][A-Za-z0-9_]*\}/g, (ref) => fromProcess(ref))
        .replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (_, name: string) => {
            if (!env) throw new Error(`{{${name}}} needs an environment`);
            const variable = env.spec.variables[name];
            if (variable !== undefined) return variable;
            const secret = env.spec.secrets[name];
            if (secret !== undefined) return fromProcess(secret);
            throw new Error(`environment ${env.metadata.name} has no ${name}`);
        });
}

/** The environment this call runs in: the one asked for, the request's default, or its only one. */
export function chooseEnvironment(
    request: Request,
    environments: readonly Environment[],
    asked: string | undefined,
): Environment | undefined {
    const allowed = request.spec.environments;
    const name = asked ?? request.spec.defaultEnvironment ?? (allowed?.length === 1 ? allowed[0] : undefined);
    if (!name) return undefined;
    if (allowed && !allowed.includes(name))
        throw new Error(`${request.metadata.name} runs in ${allowed.join(", ")}, not ${name}`);
    const environment = environments.find((e) => e.metadata.name === name);
    if (!environment) throw new Error(`no environment named ${name}`);
    return environment;
}

function requireParams(request: Request, params: Record<string, string>): void {
    for (const p of [...request.spec.pathParams, ...request.spec.queryParams]) {
        if (p.required && params[p.name] === undefined) throw new Error(`${request.metadata.name} needs ${p.name}`);
    }
    const known = new Set([...request.spec.pathParams, ...request.spec.queryParams].map((p) => p.name));
    const unknown = Object.keys(params).filter((name) => !known.has(name));
    if (unknown.length) throw new Error(`${request.metadata.name} has no parameter ${unknown.join(", ")}`);
}

export function buildUrl(request: Request, environment: Environment | undefined, params: Record<string, string>): URL {
    requireParams(request, params);
    const withParams = request.spec.url.replace(URL_PARAM, (_, name: string) => encodeURIComponent(params[name] ?? ""));
    const url = new URL(expand(withParams, environment));
    for (const p of request.spec.queryParams) {
        if (params[p.name] !== undefined) url.searchParams.set(p.name, params[p.name]!);
    }
    return url;
}

/** Run a GET request. Anything else is refused: fx reads, it never writes. */
export async function callRequest(
    request: Request,
    environment: Environment | undefined,
    params: Record<string, string>,
    signal?: AbortSignal,
): Promise<string> {
    if (request.spec.method !== "GET")
        throw new Error(`${request.metadata.name} is a ${request.spec.method}; fx only makes GET requests`);
    const url = buildUrl(request, environment, params);
    const headers = Object.fromEntries(
        Object.entries(request.spec.headers ?? {}).map(([name, value]) => [name, expand(value, environment)]),
    );
    const timeout = AbortSignal.timeout(HTTP_TIMEOUT_MS);
    const response = await fetch(url, { headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    const body = await response.text();
    return `HTTP ${response.status} ${response.statusText}\ncontent-type: ${response.headers.get("content-type") ?? "?"}\n\n${body}`;
}
