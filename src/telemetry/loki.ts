/** Loki: LogQL over /loki/api/v1/query_range, newest first. */
import { getJson, nowSeconds, type Source, type TelemetryQuery } from "./http";

interface LokiResponse {
    data: {
        resultType: "streams" | "matrix" | "vector";
        result: Array<{
            stream?: Record<string, string>;
            metric?: Record<string, string>;
            values: [string, unknown][];
        }>;
    };
}

const NS_PER_S = 1_000_000_000n;

export async function queryLoki(source: Source, q: TelemetryQuery, signal?: AbortSignal): Promise<string> {
    const end = BigInt(nowSeconds()) * NS_PER_S;
    const start = end - BigInt(q.sinceSeconds) * NS_PER_S;
    const body = (await getJson(
        source,
        "loki/api/v1/query_range",
        { query: q.query, start: start.toString(), end: end.toString(), limit: q.limit, direction: "backward" },
        signal,
    )) as LokiResponse;
    if (body.data.resultType !== "streams") return JSON.stringify(body.data.result);

    const lines = body.data.result.flatMap((stream) =>
        stream.values.map(([ts, line]) => ({ ts: BigInt(ts), labels: stream.stream ?? {}, line: String(line) })),
    );
    lines.sort((a, b) => (a.ts > b.ts ? -1 : a.ts < b.ts ? 1 : 0));
    if (lines.length === 0) return "(no log lines)";
    return lines
        .slice(0, q.limit)
        .map((l) => `${new Date(Number(l.ts / 1_000_000n)).toISOString()} ${formatLabels(l.labels)} ${l.line}`)
        .join("\n");
}

function formatLabels(labels: Record<string, string>): string {
    return `{${Object.entries(labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(",")}}`;
}
