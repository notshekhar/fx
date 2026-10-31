/**
 * fx status against fakes that answer the way the real thing would: an HTTP
 * server playing Loki, Prometheus and an MCP server, a kubectl on PATH, a
 * database port nothing listens on, and one host that never answers.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHECK_TIMEOUT_MS, checkAll, type Health } from "../src/health";
import { parseObjects } from "../src/registry/store";
import { formatHealth } from "../src/sources";
import { useFxHome, yamlDoc } from "./helpers";

const fxHome = useFxHome();
const savedPath = process.env.PATH;
let server: Server<undefined>;
let results: Health[];

function fakeBackend(req: Request): Response | Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === "/loki/loki/api/v1/labels") return Response.json({ status: "success", data: ["app"] });
    if (pathname === "/prom/api/v1/status/buildinfo") return new Response("overloaded", { status: 503 });
    if (pathname === "/mcp-oauth") return new Response(null, { status: 401 });
    if (pathname === "/mcp-key") return new Response(null, { status: req.headers.get("x-key") === "k1" ? 405 : 401 });
    if (pathname === "/slow/api/services") return Bun.sleep(CHECK_TIMEOUT_MS + 2_000).then(() => Response.json({}));
    return new Response("not found", { status: 404 });
}

function registry(base: string) {
    const docs = [
        yamlDoc("Repository", "api", "url: https://example.invalid/api.git"),
        yamlDoc("Database", "orders", "type: postgres\nhost: 127.0.0.1\nport: 1\ndatabase: shop\nuser: ro"),
        yamlDoc("Kubernetes", "prod", "context: prod-eu"),
        yamlDoc("Telemetry", "logs", `type: loki\nurl: ${base}/loki`),
        yamlDoc("Telemetry", "metrics", `type: prometheus\nurl: ${base}/prom`),
        yamlDoc("Telemetry", "traces", `type: jaeger\nurl: ${base}/slow`),
        yamlDoc("McpServer", "cube", `url: ${base}/mcp-oauth\nauth: oauth`),
        yamlDoc("McpServer", "keyed", `url: ${base}/mcp-key\nheaders:\n  x-key: \${env:FX_TEST_MCP_KEY}`),
        yamlDoc(
            "Environment",
            "prod",
            "variables:\n  baseUrl: https://api.acme.test\nsecrets:\n  token: ${env:FX_TEST_UNSET}",
        ),
        yamlDoc("Environment", "stage", "variables:\n  baseUrl: https://stage.acme.test"),
        yamlDoc(
            "HTTPRequest",
            "get-user",
            'url: "{{baseUrl}}/v1/users/{id}"\nenvironments: [stage]\npathParams:\n  - name: id',
        ),
        yamlDoc(
            "HTTPRequest",
            "get-me",
            'url: "{{baseUrl}}/v1/me"\nheaders:\n  Authorization: "Bearer {{token}}"\nenvironments: [prod]',
        ),
        yamlDoc("HTTPRequest", "drop-user", 'method: DELETE\nurl: "https://x.test/u"'),
    ];
    const parsed = parseObjects(docs.join("---\n"), "all.yaml");
    expect(parsed.problems).toEqual([]);
    return { objects: parsed.objects, problems: [] };
}

beforeAll(async () => {
    const bin = join(fxHome(), "..", "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
        join(bin, "kubectl"),
        `#!/bin/sh\necho '{"clientVersion":{"gitVersion":"v1.31.0"},"serverVersion":{"gitVersion":"v1.30.4"}}'\n`,
    );
    chmodSync(join(bin, "kubectl"), 0o755);
    process.env.PATH = `${bin}:${savedPath}`;
    process.env.FX_TEST_MCP_KEY = "k1";
    server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: fakeBackend });
    results = await checkAll(registry(`http://127.0.0.1:${server.port}`));
}, CHECK_TIMEOUT_MS + 10_000);

afterAll(() => {
    server.stop(true);
    process.env.PATH = savedPath;
    delete process.env.FX_TEST_MCP_KEY;
});

const result = (name: string) => results.find((r) => r.name === name)!;

describe("fx status", () => {
    test("live checks say what answered and how fast", () => {
        expect(result("logs")).toMatchObject({ state: "ok", detail: "answering" });
        expect(result("logs").ms).toBeNumber();
        expect(result("prod")).toMatchObject({ state: "ok", detail: "server v1.30.4" });
        expect(result("keyed")).toMatchObject({ state: "ok", detail: "reachable" });
        expect(result("cube")).toMatchObject({ state: "ok", detail: expect.stringContaining("OAuth") });
    });

    test("a failure says why, in one line", () => {
        expect(result("metrics")).toMatchObject({ state: "failing", detail: expect.stringContaining("HTTP 503") });
        expect(result("orders").state).toBe("failing");
        expect(result("orders").detail).not.toContain("\n");
        expect(result("api")).toMatchObject({ state: "failing", detail: "not cloned yet" });
    });

    test("a host that never answers fails at the deadline without holding up the rest", () => {
        expect(result("traces")).toMatchObject({
            state: "failing",
            detail: `no answer in ${CHECK_TIMEOUT_MS / 1000}s`,
        });
        expect(result("traces").ms).toBeLessThan(CHECK_TIMEOUT_MS + 1_000);
    });

    test("environments and requests resolve without sending anything", () => {
        const prodEnv = results.find((r) => r.kind === "Environment" && r.name === "prod")!;
        expect(prodEnv).toMatchObject({ state: "failing", detail: "not set: ${env:FX_TEST_UNSET}" });
        expect(result("get-user")).toMatchObject({ state: "ok", detail: "GET → stage https://stage.acme.test" });
        expect(result("get-me")).toMatchObject({ state: "failing", detail: expect.stringContaining("FX_TEST_UNSET") });
        expect(result("drop-user")).toMatchObject({ state: "off" });
    });

    test("the report groups by kind and counts failures", () => {
        const text = formatHealth(results, []);
        expect(text).toContain("Telemetry:\n  ✓ logs");
        expect(text).toContain("  · drop-user");
        expect(text.split("\n").at(-1)).toBe(`${results.filter((r) => r.state === "failing").length} of 13 failing`);
    });
});

test("a skipped document counts against the summary", () => {
    expect(formatHealth([], ["a.yaml: bad"])).toBe("! a.yaml: bad\n\nall 0 working, 1 skipped");
    const one: Health = { kind: "Repository", name: "api", state: "ok", detail: "abc" };
    expect(formatHealth([one], ["a.yaml: bad"]).split("\n").at(-1)).toBe("all 1 working, 1 skipped");
});
