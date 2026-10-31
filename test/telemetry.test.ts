/**
 * Each backend against a fake HTTP server that answers in that backend's
 * shape and records what it was asked.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import type { Source } from "../src/telemetry/http";
import { parseDuration } from "../src/duration";
import { createTelemetryTool } from "../src/tools/telemetry";
import { call } from "./helpers";

let server: Server<undefined>;
const requests: URL[] = [];
const headers: Record<string, string | null> = {};

const NOW_NS = BigInt(Date.now()) * 1_000_000n;

const responses: Record<string, unknown> = {
    "/loki/api/v1/query_range": {
        data: {
            resultType: "streams",
            result: [
                {
                    stream: { app: "api" },
                    values: [
                        [String(NOW_NS - 2_000_000_000n), "older line"],
                        [String(NOW_NS), "newest line"],
                    ],
                },
            ],
        },
    },
    "/api/v1/query_range": {
        data: {
            result: [
                {
                    metric: { job: "api" },
                    values: [
                        [1700000000, "1"],
                        [1700000060, "5"],
                    ],
                },
            ],
        },
    },
    "/api/search": {
        traces: [{ traceID: "abc123", rootServiceName: "api", rootTraceName: "GET /orders", durationMs: 812 }],
    },
    "/api/traces/0af7651916cd43dd8448eb211c80319c": {
        batches: [
            {
                resource: { attributes: [{ key: "service.name", value: { stringValue: "api" } }] },
                scopeSpans: [
                    {
                        spans: [
                            { name: "GET /orders", startTimeUnixNano: "1000000000", endTimeUnixNano: "1500000000" },
                            {
                                name: "SELECT orders",
                                startTimeUnixNano: "1100000000",
                                endTimeUnixNano: "1400000000",
                                status: { code: 2 },
                            },
                        ],
                    },
                ],
            },
        ],
    },
    "/api/traces": {
        data: [
            {
                traceID: "t1",
                processes: { p1: { serviceName: "api" } },
                spans: [
                    {
                        operationName: "GET /orders",
                        startTime: 1000,
                        duration: 250_000,
                        processID: "p1",
                        tags: [{ key: "error", value: true }],
                    },
                ],
            },
        ],
    },
};

beforeAll(() => {
    process.env.FX_TEST_TOKEN = "s3cret";
    server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req) {
            const url = new URL(req.url);
            requests.push(url);
            headers.authorization = req.headers.get("authorization");
            const body = responses[url.pathname];
            return body ? Response.json(body) : new Response("not found", { status: 404 });
        },
    });
});

afterAll(() => {
    server.stop(true);
    delete process.env.FX_TEST_TOKEN;
});

const source = (name: string, type: Source["spec"]["type"]): Source => ({
    apiVersion: "fx/v1",
    kind: "Telemetry",
    metadata: { name },
    spec: { type, url: `http://127.0.0.1:${server.port}`, headers: { Authorization: "Bearer ${env:FX_TEST_TOKEN}" } },
});

const query = (type: Source["spec"]["type"], q: string, since = "1h") =>
    call(createTelemetryTool([source("src", type)]), { source: "src", query: q, since, limit: 100 });

describe("telemetry tool", () => {
    test("loki: LogQL over the window, newest line first, with the secret header resolved", async () => {
        const out = await query("loki", '{app="api"} |= "error"', "15m");
        expect(out.split("\n")[0]).toContain("newest line");
        const asked = requests.at(-1)!;
        expect(asked.searchParams.get("query")).toBe('{app="api"} |= "error"');
        const window = BigInt(asked.searchParams.get("end")!) - BigInt(asked.searchParams.get("start")!);
        expect(window).toBe(900n * 1_000_000_000n);
        expect(headers.authorization).toBe("Bearer s3cret");
    });

    test("prometheus: a range query summarised per series", async () => {
        const out = await query("prometheus", "up");
        expect(out).toContain('{job="api"}  min 1 max 5 last 5');
        expect(Number(requests.at(-1)!.searchParams.get("step"))).toBe(120);
    });

    test("tempo: TraceQL searches, a trace id fetches the trace", async () => {
        expect(await query("tempo", "{ status = error }")).toContain("abc123  812ms  api  GET /orders");
        const trace = await query("tempo", "0af7651916cd43dd8448eb211c80319c");
        expect(trace).toContain("2 spans, 1 with errors");
        expect(trace).toContain("SELECT orders  ERROR");
    });

    test("jaeger: a service name lists its traces", async () => {
        expect(await query("jaeger", "api")).toContain("t1  250.0ms  api  GET /orders  (1 spans, 1 errors)");
        expect(requests.at(-1)!.searchParams.get("lookback")).toBe("3600s");
    });

    test("a backend error is reported with its status", async () => {
        await expect(
            call(
                createTelemetryTool([
                    {
                        ...source("src", "loki"),
                        spec: { ...source("src", "loki").spec, url: `http://127.0.0.1:${server.port}/missing/` },
                    },
                ]),
                {
                    source: "src",
                    query: "{}",
                },
            ),
        ).rejects.toThrow("HTTP 404");
    });

    test("durations", () => {
        expect(parseDuration("90s")).toBe(90);
        expect(parseDuration("2d")).toBe(172800);
        expect(() => parseDuration("yesterday")).toThrow("duration like");
    });
});
