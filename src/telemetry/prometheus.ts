/** Prometheus (and anything that speaks its API): PromQL over /api/v1/query_range. */
import { getJson, nowSeconds, type Source, type TelemetryQuery } from "./http";

interface PromResponse {
    data: { result: Array<{ metric: Record<string, string>; values: [number, string][] }> };
}

/** Enough points to see a shape without flooding the context. */
const POINTS = 30;

export async function queryPrometheus(source: Source, q: TelemetryQuery, signal?: AbortSignal): Promise<string> {
    const end = nowSeconds();
    const step = Math.max(1, Math.ceil(q.sinceSeconds / POINTS));
    const body = (await getJson(
        source,
        "api/v1/query_range",
        { query: q.query, start: end - q.sinceSeconds, end, step },
        signal,
    )) as PromResponse;
    const series = body.data.result.slice(0, q.limit);
    if (series.length === 0) return "(no series)";
    return series.map(formatSeries).join("\n\n");
}

function formatSeries(series: PromResponse["data"]["result"][number]): string {
    const numbers = series.values.map(([, v]) => Number(v));
    const labels = Object.entries(series.metric)
        .map(([k, v]) => `${k}="${v}"`)
        .join(",");
    const summary = `min ${Math.min(...numbers)} max ${Math.max(...numbers)} last ${numbers.at(-1)}`;
    const points = series.values.map(([t, v]) => `${new Date(t * 1000).toISOString().slice(11, 19)} ${v}`).join("  ");
    return `{${labels}}  ${summary}\n  ${points}`;
}
