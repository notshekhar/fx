/** One tool over every registered logs / metrics / traces backend. */
import { tool, type Tool } from "ai";
import { z } from "zod";
import { parseDuration } from "../duration";
import type { Source, TelemetryQuery } from "../telemetry/http";
import { queryJaeger } from "../telemetry/jaeger";
import { queryLoki } from "../telemetry/loki";
import { queryPrometheus } from "../telemetry/prometheus";
import { queryTempo } from "../telemetry/tempo";
import { capped } from "./output";

type Backend = (source: Source, q: TelemetryQuery, signal?: AbortSignal) => Promise<string>;

const BACKENDS: Record<Source["spec"]["type"], { run: Backend; speaks: string }> = {
    loki: { run: queryLoki, speaks: 'logs — a LogQL query, e.g. {app="api"} |= "error"' },
    prometheus: {
        run: queryPrometheus,
        speaks: 'metrics — a PromQL query, e.g. rate(http_requests_total{status=~"5.."}[5m])',
    },
    tempo: { run: queryTempo, speaks: "traces — a trace id, or a TraceQL query, e.g. { status = error }" },
    jaeger: { run: queryJaeger, speaks: "traces — a trace id, or a service name to list its recent traces" },
};

export function createTelemetryTool(sources: readonly Source[], fallbackSignal?: AbortSignal): Tool {
    const catalog = sources
        .map((s) => `  - ${s.metadata.name} (${s.spec.type}): ${BACKENDS[s.spec.type].speaks}`)
        .join("\n");
    return tool({
        description: `Query a registered telemetry backend — logs, metrics or traces — over a recent window.\n\nSources:\n${catalog}`,
        inputSchema: z.object({
            source: z.string().describe("Registered telemetry source name"),
            query: z.string().describe("In the source's own query language (see the list above)"),
            since: z.string().default("1h").describe("How far back to look: 15m, 6h, 2d"),
            limit: z.number().int().positive().max(1000).default(100),
        }),
        execute: async ({ source: name, query, since, limit }, options) => {
            const source = sources.find((s) => s.metadata.name === name);
            if (!source) throw new Error(`no telemetry source named ${name}`);
            const q = { query, sinceSeconds: parseDuration(since), limit };
            return capped(await BACKENDS[source.spec.type].run(source, q, options?.abortSignal ?? fallbackSignal));
        },
    });
}
