/**
 * What can be registered with fx, drover-style: one YAML document per thing,
 *
 *   apiVersion: fx/v1
 *   kind: Repository
 *   metadata: { name: api }
 *   spec: { url: https://github.com/acme/api }
 *
 * Kind names are spelled out, and a name is what the agent refers to the
 * thing by, so it has to be a plain identifier.
 */
import { z } from "zod";
import { DURATION } from "../duration";

export const API_VERSION = "fx/v1";

/** drover's files are accepted as they are: its Repository, Environment and HTTPRequest are fx's shapes too. */
const API_VERSIONS = [API_VERSION, "drover/v1"] as const;

/** drover kinds fx has no equivalent of, with what to do instead — so a copied drover file says why, not just "invalid". */
export const DROVER_ONLY_KINDS: Record<string, string> = {
    SQLConnection:
        "write it as a Database (type, host, port, database, user, password) — fx keeps the password a ${env:VAR} reference, which one url cannot be",
    DocumentStore: "fx has no document stores; it writes only to its scratchpad",
};

/** drover's names fit: up to 63 characters, with one dot for its namespacing (`api.get-user`). */
const name = z
    .string()
    .regex(
        /^(?=.{1,63}$)[a-z0-9][a-z0-9_-]*(\.[a-z0-9_-]+)?$/i,
        "a name is 1-63 letters, digits, - or _, starting with a letter or digit, with at most one dot",
    );

/** A Database's name is loop's sql connection id, which is stricter. */
const databaseName = z
    .string()
    .regex(
        /^[a-z0-9][a-z0-9_-]{0,31}$/i,
        "a Database name is 1-32 letters, digits, - or _, starting with a letter or digit (it is the sql tool's connection id)",
    );

/** `${env:VAR}` is allowed anywhere a secret goes, and resolved when it is used. */
const secret = z.string();

/** `${env:VAR}`, or drover's `${VAR}`, so a drover environment carries over. */
export const SECRET_REFERENCE = /^\$\{(?:env:)?[A-Za-z_][A-Za-z0-9_]*\}$/;

const duration = z.string().regex(DURATION, "a duration like 30m, 6h or 1d");

const repository = z.object({
    url: z.string().min(1),
    branch: z.string().min(1).optional(),
    /** How often fx refreshes its clone while it is open, or `never`. */
    refreshInterval: z.union([duration, z.literal("never")]).default("15m"),
});

const database = z.object({
    type: z.enum(["postgres", "mysql", "redshift"]),
    host: z.string().min(1),
    port: z.number().int().positive(),
    database: z.string().min(1),
    user: z.string().min(1),
    password: secret.optional(),
    ssl: z.boolean().optional(),
});

const kubernetes = z.object({
    /** A context in the kubeconfig. */
    context: z.string().min(1),
    kubeconfig: z.string().min(1).optional(),
    /** When set, the agent may only look inside these namespaces. */
    namespaces: z.array(z.string().min(1)).min(1).optional(),
});

const telemetry = z.object({
    type: z.enum(["loki", "prometheus", "tempo", "jaeger"]),
    url: z.url(),
    headers: z.record(z.string(), secret).optional(),
});

/**
 * Remote servers only: a local (stdio) server is a process fx would start
 * outside its sandbox, which could write anywhere.
 */
const mcpServer = z.object({
    url: z.url(),
    transport: z.enum(["http", "sse"]).default("http"),
    headers: z.record(z.string(), secret).optional(),
    auth: z.literal("oauth").optional(),
    allowedTools: z.array(z.string()).optional(),
    deniedTools: z.array(z.string()).optional(),
});

/**
 * A named stage — local, stage, prod — that requests fill `{{name}}` from.
 * A secret must be a reference, never a literal, so a credential cannot be
 * committed by accident; it is resolved when a request runs and never shown.
 */
const environment = z.object({
    variables: z.record(z.string(), z.string()).default({}),
    secrets: z.record(z.string(), z.string().regex(SECRET_REFERENCE, "a secret is a ${env:VAR} reference")).default({}),
});

/** A query parameter is optional unless it says otherwise, as in drover; a path parameter is always required. */
const param = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    required: z.boolean().default(false),
    example: z.string().optional(),
    /** Sent when the caller leaves the parameter out. */
    default: z.string().optional(),
});

const pathParam = param.transform((p) => ({ ...p, required: true }));

/** fx's map, or drover's list of `{name, value}` — the same headers either way. */
const headers = z.union([
    z.record(z.string(), z.string()),
    z
        .array(z.object({ name: z.string().min(1), value: z.string(), description: z.string().optional() }))
        .transform((list) => Object.fromEntries(list.map((h) => [h.name, h.value]))),
]);

/** drover calls the query parameters `query`. */
function acceptDroverQuery(spec: unknown): unknown {
    if (typeof spec !== "object" || spec === null || !("query" in spec) || "queryParams" in spec) return spec;
    const { query, ...rest } = spec as Record<string, unknown>;
    return { ...rest, queryParams: query };
}

/** `{name}` in a url: a value the caller supplies. `{{name}}` is an environment's, so it is excluded. */
export const URL_PARAM = /(?<!\{)\{([A-Za-z_][A-Za-z0-9_]*)\}(?!\})/g;

export function urlParams(url: string): string[] {
    return [...url.matchAll(URL_PARAM)].map((m) => m[1]!);
}

/**
 * One callable request, drover's shape. Only GET is ever offered to the
 * model; other methods may be stored but fx never runs them.
 */
const httpRequest = z.preprocess(
    acceptDroverQuery,
    z
        .object({
            description: z.string().optional(),
            method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).default("GET"),
            url: z.string().min(1),
            headers: headers.optional(),
            environments: z.array(z.string()).optional(),
            defaultEnvironment: z.string().optional(),
            pathParams: z.array(pathParam).default([]),
            queryParams: z.array(param).default([]),
        })
        .superRefine((spec, ctx) => {
            // Checked here so an offered request is always honest about what it needs.
            const inUrl = new Set(urlParams(spec.url));
            const declared = new Set(spec.pathParams.map((p) => p.name));
            for (const name of inUrl) {
                if (!declared.has(name))
                    ctx.addIssue({ code: "custom", path: ["url"], message: `{${name}} has no pathParams entry` });
            }
            for (const name of declared) {
                if (!inUrl.has(name))
                    ctx.addIssue({ code: "custom", path: ["pathParams"], message: `${name} is not in the url` });
            }
        }),
);

function kind<K extends string, S extends z.ZodType>(kind: K, spec: S, nameRule: z.ZodString = name) {
    return z.object({
        apiVersion: z.enum(API_VERSIONS),
        kind: z.literal(kind),
        metadata: z.object({ name: nameRule }),
        spec,
    });
}

export const fxObject = z.discriminatedUnion("kind", [
    kind("Repository", repository),
    kind("Database", database, databaseName),
    kind("Kubernetes", kubernetes),
    kind("Telemetry", telemetry),
    kind("McpServer", mcpServer),
    kind("Environment", environment),
    kind("HTTPRequest", httpRequest),
]);

export type FxObject = z.infer<typeof fxObject>;
export type Kind = FxObject["kind"];
export type ObjectOf<K extends Kind> = Extract<FxObject, { kind: K }>;

export const KINDS: readonly Kind[] = [
    "Repository",
    "Database",
    "Kubernetes",
    "Telemetry",
    "McpServer",
    "Environment",
    "HTTPRequest",
];
