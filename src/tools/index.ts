/**
 * The tools fx gives the model in place of loop's: file tools fenced to fx's
 * directories, read-only git / kubectl / telemetry / sql / GET requests over what is
 * registered, and a bash that can write to the scratchpad and nowhere else.
 *
 * Built every turn from the registry as it is on disk, so a file saved in
 * ~/.fx applies on the next message. A tool for a kind with nothing
 * registered is left out rather than offered empty.
 */
import type { Tool } from "ai";
import { createSqlTool, type ToolContext } from "@notshekhar/loop-core";
import { loadRegistry, objectsOf } from "../registry/store";
import { createScratchpadBash } from "./bash";
import { createFileTools } from "./files";
import { createGitTools } from "./git";
import { createApiTools } from "./http";
import { createKubernetesTool } from "./kubernetes";
import { createTelemetryTool } from "./telemetry";

export function createFxTools(ctx: ToolContext): Record<string, Tool> {
    const registry = loadRegistry();
    const repos = objectsOf(registry, "Repository");
    const clusters = objectsOf(registry, "Kubernetes");
    const telemetry = objectsOf(registry, "Telemetry");
    const signal = ctx.abortSignal;

    return {
        ...createFileTools(ctx),
        ...(repos.length > 0 ? createGitTools(repos, signal) : {}),
        ...(clusters.length > 0 ? { kubernetes: createKubernetesTool(clusters, signal) } : {}),
        ...(telemetry.length > 0 ? { telemetry: createTelemetryTool(telemetry, signal) } : {}),
        ...(objectsOf(registry, "Database").length > 0 ? { sql: createSqlTool({ abortSignal: signal }) } : {}),
        ...createApiTools(objectsOf(registry, "HTTPRequest"), objectsOf(registry, "Environment"), signal),
        bash: createScratchpadBash(ctx),
    };
}
