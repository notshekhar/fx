/**
 * api_list, api_describe and api_call — drover's three tools over the
 * registered GET requests. Discovery happens through api_list, so no tool's
 * description grows with the number of requests: two hundred imported from
 * an OpenAPI spec cost the model nothing until it searches them.
 */
import { tool, type Tool } from "ai";
import { z } from "zod";
import { callRequest, chooseEnvironment, missingSecrets, type Environment, type Request } from "../http/request";
import { rank, type Searchable } from "../http/search";
import { capped } from "./output";

type Param = Request["spec"]["pathParams"][number];

const requestName = z.string().describe("Name of the request, as api_list returns it");

function searchable(request: Request): Searchable {
    const params = [...request.spec.pathParams, ...request.spec.queryParams];
    return {
        name: request.metadata.name,
        fields: [
            request.spec.description ?? "",
            request.spec.method,
            request.spec.url,
            ...(request.spec.environments ?? []),
            // "the org that owns it" should find a request whose owner parameter says that.
            ...params.map((p) => `${p.name} ${p.description ?? ""}`),
        ],
    };
}

function environmentsOf(request: Request): string | undefined {
    const names = request.spec.environments;
    if (!names?.length) return undefined;
    return names.map((name) => (name === request.spec.defaultEnvironment ? `${name} (default)` : name)).join(", ");
}

function summarizeRequest(request: Request): string {
    const params = [...request.spec.pathParams, ...request.spec.queryParams].map((p) => p.name);
    const environments = environmentsOf(request);
    return [
        `  ${request.metadata.name}`,
        request.spec.description && `      ${request.spec.description.split("\n")[0]}`,
        `      GET ${request.spec.url}`,
        params.length > 0 && `      params: ${params.join(", ")}`,
        environments && `      environments: ${environments}`,
    ]
        .filter(Boolean)
        .join("\n");
}

/** Secret names and whether each is set — never a value. */
function summarizeEnvironment(environment: Environment): string {
    const missing = new Set(missingSecrets(environment));
    const variables = Object.keys(environment.spec.variables);
    const secrets = Object.entries(environment.spec.secrets).map(
        ([name, reference]) => `${name} (${missing.has(reference) ? "NOT SET" : "set"})`,
    );
    return [
        `  ${environment.metadata.name}`,
        variables.length > 0 && `      variables: ${variables.join(", ")}`,
        secrets.length > 0 && `      secrets: ${secrets.join(", ")}`,
    ]
        .filter(Boolean)
        .join("\n");
}

function describeParam(param: Param, required: boolean): string {
    return [
        `  ${param.name}${required ? " (required)" : ""}`,
        param.description && `      ${param.description}`,
        param.example && `      example: ${param.example}`,
    ]
        .filter(Boolean)
        .join("\n");
}

function describeRequest(request: Request): string {
    const { spec } = request;
    const required = [...spec.pathParams, ...spec.queryParams.filter((q) => q.required)].map((p) => p.name);
    const environments = environmentsOf(request);
    const params = required.length ? `, "params": {${required.map((n) => `"${n}": "..."`).join(", ")}}` : "";
    return [
        request.metadata.name,
        spec.description && `\n${spec.description}`,
        `\nGET ${spec.url}`,
        spec.pathParams.length > 0 &&
            `\nPath parameters (all required):\n${spec.pathParams.map((p) => describeParam(p, true)).join("\n")}`,
        spec.queryParams.length > 0 &&
            `\nQuery parameters:\n${spec.queryParams.map((q) => describeParam(q, q.required)).join("\n")}`,
        // Names only: a header's value can carry a secret.
        spec.headers && `\nHeaders sent: ${Object.keys(spec.headers).join(", ")}`,
        environments && `\nEnvironments: ${environments}`,
        `\nCall it with:\n  api_call { "request": "${request.metadata.name}"${params} }`,
    ]
        .filter(Boolean)
        .join("\n");
}

function listRequests(offered: readonly Request[], environments: readonly Environment[], search = ""): string {
    const matched = rank(offered, search, searchable);
    if (matched.length === 0)
        return `No request matches "${search}". There are ${offered.length}; call api_list with no search to see them all.`;
    const heading = search
        ? `${matched.length} of ${offered.length} request(s) match "${search}":`
        : `${matched.length} request(s):`;
    // The environments too: choosing between stage and prod needs to know which exist.
    const envs = environments.length
        ? `\n\n${environments.length} environment(s):\n${environments.map(summarizeEnvironment).join("\n")}`
        : "";
    return `${heading}\n\n${matched.map(summarizeRequest).join("\n")}${envs}\n\nUse api_describe for one request's full parameters, then api_call to perform it.`;
}

/** Only GET requests are offered; with none registered there are no tools. */
export function createApiTools(
    requests: readonly Request[],
    environments: readonly Environment[],
    fallbackSignal?: AbortSignal,
): Record<string, Tool> {
    const offered = requests.filter((r) => r.spec.method === "GET");
    if (offered.length === 0) return {};
    const find = (name: string): Request => {
        const request = offered.find((r) => r.metadata.name === name);
        if (!request) throw new Error(`no GET request named ${name} — call api_list to see them`);
        return request;
    };

    return {
        api_list: tool({
            description: `List the HTTP requests fx can perform and the environments they run against: ${offered.length} request(s), ${environments.length} environment(s). Call this first to find a request, then api_describe for its parameters, then api_call. With no search it returns everything.`,
            inputSchema: z.object({
                search: z
                    .string()
                    .optional()
                    .describe(
                        "Fuzzy search over everything a request says — name, description, url, parameters, environments — so `issues`, `github repos` or an abbreviation all work. Omit to list everything.",
                    ),
            }),
            execute: async ({ search }) => listRequests(offered, environments, search),
        }),
        api_describe: tool({
            description:
                "Show one HTTP request in full: what it does, its url, every parameter with its description and example, its environments and the headers it sends. Use it before api_call when unsure what a request needs.",
            inputSchema: z.object({ request: requestName }),
            execute: async ({ request }) => describeRequest(find(request)),
        }),
        api_call: tool({
            description:
                "Perform one of the registered HTTP requests and return the response. Only GET requests exist here. Base URLs and credentials come from the environment and are never shown. Find a request with api_list and its parameters with api_describe.",
            inputSchema: z.object({
                request: requestName,
                params: z
                    .record(z.string(), z.coerce.string())
                    .default({})
                    .describe('The parameters by name, e.g. {"userId": "usr_1a2b"}'),
                environment: z
                    .string()
                    .optional()
                    .describe("Environment to run against; omit for the request's default"),
            }),
            execute: async ({ request: name, params, environment }, options) => {
                const request = find(name);
                const env = chooseEnvironment(request, environments, environment);
                return capped(await callRequest(request, env, params, options?.abortSignal ?? fallbackSignal));
            },
        }),
    };
}
