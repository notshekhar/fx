/** Tempo: a trace id fetches that trace; anything else is a TraceQL search. */
import { getJson, nowSeconds, type Source, type TelemetryQuery } from "./http";
import { formatTrace, isTraceId, type Span } from "./spans";

interface OtlpAttribute {
    key: string;
    value: { stringValue?: string };
}

interface OtlpResourceSpans {
    resource?: { attributes?: OtlpAttribute[] };
    scopeSpans?: Array<{ spans?: OtlpSpan[] }>;
    instrumentationLibrarySpans?: Array<{ spans?: OtlpSpan[] }>;
}

interface OtlpSpan {
    name: string;
    startTimeUnixNano: string;
    endTimeUnixNano: string;
    status?: { code?: number | string };
}

interface TempoSearch {
    traces?: Array<{
        traceID: string;
        rootServiceName?: string;
        rootTraceName?: string;
        startTimeUnixNano?: string;
        durationMs?: number;
    }>;
}

/** OTLP status code 2 is ERROR, spelled either way depending on the encoder. */
const isError = (code: number | string | undefined) => code === 2 || code === "STATUS_CODE_ERROR";

export async function queryTempo(source: Source, q: TelemetryQuery, signal?: AbortSignal): Promise<string> {
    if (isTraceId(q.query)) {
        const body = (await getJson(source, `api/traces/${q.query.trim()}`, {}, signal)) as {
            batches?: OtlpResourceSpans[];
            resourceSpans?: OtlpResourceSpans[];
        };
        return formatTrace(q.query.trim(), (body.batches ?? body.resourceSpans ?? []).flatMap(spansOf));
    }
    const end = nowSeconds();
    const body = (await getJson(
        source,
        "api/search",
        { q: q.query, start: end - q.sinceSeconds, end, limit: q.limit },
        signal,
    )) as TempoSearch;
    const traces = body.traces ?? [];
    if (traces.length === 0) return "(no traces)";
    return traces
        .map((t) => `${t.traceID}  ${t.durationMs ?? "?"}ms  ${t.rootServiceName ?? "?"}  ${t.rootTraceName ?? ""}`)
        .join("\n");
}

function spansOf(batch: OtlpResourceSpans): Span[] {
    const service = batch.resource?.attributes?.find((a) => a.key === "service.name")?.value.stringValue ?? "?";
    const scopes = batch.scopeSpans ?? batch.instrumentationLibrarySpans ?? [];
    return scopes.flatMap((scope) =>
        (scope.spans ?? []).map((span) => {
            const startMs = Number(BigInt(span.startTimeUnixNano) / 1000n) / 1000;
            const endMs = Number(BigInt(span.endTimeUnixNano) / 1000n) / 1000;
            return {
                service,
                name: span.name,
                startMs,
                durationMs: endMs - startMs,
                error: isError(span.status?.code),
            };
        }),
    );
}
