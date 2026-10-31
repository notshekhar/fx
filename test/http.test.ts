/** Registered HTTP requests, against a fake API that records what it was sent. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { parseObjects } from "../src/registry/store";
import type { Environment, Request } from "../src/http/request";
import { createHttpTool } from "../src/tools/http";
import { call, yamlDoc } from "./helpers";

let server: Server<undefined>;
let seen: { url: URL; auth: string | null }[] = [];

beforeAll(() => {
    process.env.FX_TEST_API_TOKEN = "tok-123";
    server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req) {
            seen.push({ url: new URL(req.url), auth: req.headers.get("authorization") });
            return Response.json({ id: new URL(req.url).pathname.split("/").pop(), name: "Ada" });
        },
    });
});

afterAll(() => {
    server.stop(true);
    delete process.env.FX_TEST_API_TOKEN;
});

function load(): { requests: Request[]; environments: Environment[] } {
    const text = [
        yamlDoc(
            "Environment",
            "stage",
            `variables:\n  baseUrl: http://127.0.0.1:${server.port}\nsecrets:\n  token: \${env:FX_TEST_API_TOKEN}`,
        ),
        yamlDoc(
            "HTTPRequest",
            "get-user",
            `description: Fetch one user\nurl: "{{baseUrl}}/v1/users/{userId}"\nheaders:\n  Authorization: "Bearer {{token}}"\nenvironments: [stage]\npathParams:\n  - name: userId\nqueryParams:\n  - name: fields\n    required: false`,
        ),
        yamlDoc(
            "HTTPRequest",
            "delete-user",
            `method: DELETE\nurl: "{{baseUrl}}/v1/users/{id}"\npathParams:\n  - name: id`,
        ),
    ].join("---\n");
    const parsed = parseObjects(text, "api.yaml");
    expect(parsed.problems).toEqual([]);
    return {
        requests: parsed.objects.filter((o): o is Request => o.kind === "HTTPRequest"),
        environments: parsed.objects.filter((o): o is Environment => o.kind === "Environment"),
    };
}

describe("http_request", () => {
    test("fills variables, secrets and parameters, and returns the response", async () => {
        const { requests, environments } = load();
        seen = [];
        const out = await call(createHttpTool(requests, environments), {
            request: "get-user",
            params: { userId: "usr 1/2", fields: "name" },
        });
        expect(out).toStartWith("HTTP 200");
        expect(out).toContain('"name":"Ada"');
        expect(seen[0]!.url.pathname).toBe("/v1/users/usr%201%2F2");
        expect(seen[0]!.url.searchParams.get("fields")).toBe("name");
        expect(seen[0]!.auth).toBe("Bearer tok-123");
    });

    test("only GET requests are offered", async () => {
        const { requests, environments } = load();
        const tool = createHttpTool(requests, environments)!;
        expect((tool as { description: string }).description).not.toContain("delete-user");
        await expect(call(tool, { request: "delete-user", params: { id: "1" } })).rejects.toThrow(
            "no GET request named",
        );
        expect(
            createHttpTool(
                requests.filter((r) => r.spec.method !== "GET"),
                environments,
            ),
        ).toBeUndefined();
    });

    test("a missing or unknown parameter is refused before anything is sent", async () => {
        const { requests, environments } = load();
        seen = [];
        const tool = createHttpTool(requests, environments);
        await expect(call(tool, { request: "get-user", params: {} })).rejects.toThrow("needs userId");
        await expect(call(tool, { request: "get-user", params: { userId: "1", token: "x" } })).rejects.toThrow(
            "has no parameter token",
        );
        expect(seen).toEqual([]);
    });

    test("a url parameter without a declaration, or a literal secret, does not register", () => {
        expect(parseObjects(yamlDoc("HTTPRequest", "bad", 'url: "http://x/{id}"'), "a.yaml").problems[0]).toContain(
            "{id} has no pathParams entry",
        );
        expect(
            parseObjects(yamlDoc("Environment", "prod", "secrets:\n  token: hunter2"), "b.yaml").problems[0],
        ).toContain("a secret is a ${env:VAR} reference");
    });
});
