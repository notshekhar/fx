import { resolveSecrets } from "@notshekhar/loop-core";
import type { ObjectOf } from "../registry/kinds";

export type Source = ObjectOf<"Telemetry">;

/** What every backend is asked: a query over the last `sinceSeconds`, at most `limit` results. */
export interface TelemetryQuery {
    query: string;
    sinceSeconds: number;
    limit: number;
}

const HTTP_TIMEOUT_MS = 30_000;

/** GET a backend's JSON API. Only GET — every backend here answers queries over it. */
export async function getJson(
    source: Source,
    path: string,
    params: Record<string, string | number>,
    signal?: AbortSignal,
): Promise<unknown> {
    const url = new URL(path, source.spec.url.endsWith("/") ? source.spec.url : `${source.spec.url}/`);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
    const headers = Object.fromEntries(
        Object.entries(source.spec.headers ?? {}).map(([name, value]) => [name, resolveSecrets(value)]),
    );
    const timeout = AbortSignal.timeout(HTTP_TIMEOUT_MS);
    const response = await fetch(url, { headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    const body = await response.text();
    if (!response.ok) throw new Error(`${source.metadata.name}: HTTP ${response.status} ${body.slice(0, 500)}`);
    try {
        return JSON.parse(body);
    } catch {
        throw new Error(`${source.metadata.name}: not JSON: ${body.slice(0, 200)}`);
    }
}

export function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}
