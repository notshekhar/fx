/** Jaeger: a trace id fetches that trace; anything else is a service name to list traces for. */
import { getJson, type Source, type TelemetryQuery } from "./http";
import { formatTrace, isTraceId, type Span } from "./spans";

interface JaegerTrace {
    traceID: string;
    spans: Array<{
        operationName: string;
        startTime: number;
        duration: number;
        processID: string;
        tags?: Array<{ key: string; value: unknown }>;
    }>;
    processes: Record<string, { serviceName: string }>;
}

export async function queryJaeger(source: Source, q: TelemetryQuery, signal?: AbortSignal): Promise<string> {
    if (isTraceId(q.query)) {
        const body = (await getJson(source, `api/traces/${q.query.trim()}`, {}, signal)) as { data?: JaegerTrace[] };
        const trace = body.data?.[0];
        return trace ? formatTrace(trace.traceID, spansOf(trace)) : `trace ${q.query.trim()} not found`;
    }
    const body = (await getJson(
        source,
        "api/traces",
        { service: q.query.trim(), limit: q.limit, lookback: `${q.sinceSeconds}s` },
        signal,
    )) as { data?: JaegerTrace[] };
    const traces = body.data ?? [];
    if (traces.length === 0) return "(no traces)";
    return traces.map(summarise).join("\n");
}

// Jaeger times are microseconds.
function spansOf(trace: JaegerTrace): Span[] {
    return trace.spans.map((s) => ({
        service: trace.processes[s.processID]?.serviceName ?? "?",
        name: s.operationName,
        startMs: s.startTime / 1000,
        durationMs: s.duration / 1000,
        error: s.tags?.some((t) => t.key === "error" && t.value === true) ?? false,
    }));
}

function summarise(trace: JaegerTrace): string {
    const spans = spansOf(trace);
    const root = spans.reduce((a, b) => (b.startMs < a.startMs ? b : a), spans[0]!);
    const errors = spans.filter((s) => s.error).length;
    return `${trace.traceID}  ${root.durationMs.toFixed(1)}ms  ${root.service}  ${root.name}  (${spans.length} spans, ${errors} errors)`;
}
