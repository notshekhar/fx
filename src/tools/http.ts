/** http_request — the registered GET requests, the way drover offers them to an agent. */
import { tool, type Tool } from "ai";
import { z } from "zod";
import { callRequest, chooseEnvironment, type Environment, type Request } from "../http/request";
import { capped } from "./output";

function describeRequest(request: Request): string {
    const params = [...request.spec.pathParams, ...request.spec.queryParams]
        .map((p) => `${p.name}${p.required ? "" : "?"}${p.description ? ` (${p.description})` : ""}`)
        .join(", ");
    const environments = request.spec.environments ? `; environments ${request.spec.environments.join(", ")}` : "";
    return `  - ${request.metadata.name}: ${request.spec.description ?? request.spec.url}${params ? `; params ${params}` : ""}${environments}`;
}

/** Only GET requests are offered; with none registered there is no tool. */
export function createHttpTool(
    requests: readonly Request[],
    environments: readonly Environment[],
    fallbackSignal?: AbortSignal,
): Tool | undefined {
    const offered = requests.filter((r) => r.spec.method === "GET");
    if (offered.length === 0) return undefined;
    return tool({
        description: `Call a registered read-only HTTP request (GET only). Supply its parameters; base URLs and credentials come from the environment and are never shown.\n\nRequests:\n${offered.map(describeRequest).join("\n")}`,
        inputSchema: z.object({
            request: z.string().describe("Registered request name"),
            params: z.record(z.string(), z.string()).default({}).describe("Parameter values by name"),
            environment: z.string().optional().describe("Environment to run in, when the request has more than one"),
        }),
        execute: async ({ request: name, params, environment }, options) => {
            const request = offered.find((r) => r.metadata.name === name);
            if (!request) {
                const names = offered.map((r) => r.metadata.name).join(", ");
                throw new Error(`no GET request named ${name} — offered: ${names}`);
            }
            const env = chooseEnvironment(request, environments, environment);
            return capped(await callRequest(request, env, params, options?.abortSignal ?? fallbackSignal));
        },
    });
}
