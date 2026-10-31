/** api_list, api_describe and api_call, against a fake API that records what it was sent. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { parseObjects } from "../src/registry/store";
import type { Environment, Request } from "../src/http/request";
import { createApiTools } from "../src/tools/http";
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
            `description: Fetch one user by their account id\nurl: "{{baseUrl}}/v1/users/{userId}"\nheaders:\n  Authorization: "Bearer {{token}}"\nenvironments: [stage]\npathParams:\n  - name: userId\n    description: the account that owns the session\n    example: usr_1a2b\nqueryParams:\n  - name: fields\n    required: false`,
        ),
        yamlDoc(
            "HTTPRequest",
            "list-issues",
            `description: Open issues on a repo\nurl: "{{baseUrl}}/v1/issues"\nenvironments: [stage]`,
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

function tools() {
    const { requests, environments } = load();
    return createApiTools(requests, environments);
}

describe("api tools", () => {
    test("api_list finds a request by name, description, parameter or abbreviation, and shows environments", async () => {
        const { api_list } = tools();
        const all = await call(api_list, {});
        expect(all).toStartWith("2 request(s):");
        expect(all).not.toContain("delete-user");
        expect(all).toContain("token (set)");
        expect(await call(api_list, { search: "issues" })).toContain('1 of 2 request(s) match "issues"');
        expect(await call(api_list, { search: "account owns" })).toContain("get-user");
        expect(await call(api_list, { search: "lsiss" })).toContain("list-issues");
        expect(await call(api_list, { search: "users stage" })).not.toContain("list-issues");
        expect(await call(api_list, { search: "invoices" })).toStartWith('No request matches "invoices"');
    });

    test("api_describe shows parameters and how to call, but header names only", async () => {
        const out = await call(tools().api_describe, { request: "get-user" });
        expect(out).toContain("userId (required)\n      the account that owns the session\n      example: usr_1a2b");
        expect(out).toContain("Headers sent: Authorization");
        expect(out).not.toContain("tok-123");
        expect(out).not.toContain("{{token}}");
        expect(out).toContain('api_call { "request": "get-user", "params": {"userId": "..."} }');
    });

    test("fills variables, secrets and parameters, and returns the response", async () => {
        seen = [];
        const out = await call(tools().api_call, {
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
        await expect(call(tools().api_call, { request: "delete-user", params: { id: "1" } })).rejects.toThrow(
            "no GET request named",
        );
        expect(
            createApiTools(
                requests.filter((r) => r.spec.method !== "GET"),
                environments,
            ),
        ).toEqual({});
    });

    test("a drover request — long dotted name, header list, `query`, defaults — works as written", async () => {
        const name = "workforce.partners-get-partner-by-phone-number-v2";
        const doc = yamlDoc(
            "HTTPRequest",
            name,
            [
                'url: "{{baseUrl}}/v1/partners/{phone}"',
                "environments: [stage]",
                "headers:",
                "  - name: Authorization",
                '    value: "Bearer {{token}}"',
                "pathParams:",
                "  - name: phone",
                "query:",
                "  - name: page",
                '    default: "1"',
                "  - name: fields",
            ].join("\n"),
        ).replace("apiVersion: fx/v1", "apiVersion: drover/v1");
        const parsed = parseObjects(doc, "pronto.yaml");
        expect(parsed.problems).toEqual([]);
        const { environments } = load();
        const tools = createApiTools(
            parsed.objects.filter((o): o is Request => o.kind === "HTTPRequest"),
            environments,
        );

        seen = [];
        await call(tools.api_call, { request: name, params: { phone: "9999" } });
        expect(seen[0]!.url.pathname).toBe("/v1/partners/9999");
        expect(seen[0]!.url.searchParams.get("page")).toBe("1");
        expect(seen[0]!.url.searchParams.has("fields")).toBe(false);
        expect(seen[0]!.auth).toBe("Bearer tok-123");
        expect(await call(tools.api_describe, { request: name })).toContain("page\n      default: 1");
    });

    test("a number for a parameter is taken as its text", async () => {
        seen = [];
        await call(tools().api_call, { request: "get-user", params: { userId: 42 } });
        expect(seen[0]!.url.pathname).toBe("/v1/users/42");
    });

    test("a missing or unknown parameter is refused before anything is sent", async () => {
        seen = [];
        const tool = tools().api_call;
        await expect(call(tool, { request: "get-user", params: {} })).rejects.toThrow("needs userId");
        await expect(call(tool, { request: "get-user", params: { userId: "1", token: "x" } })).rejects.toThrow(
            "has no parameter token",
        );
        expect(seen).toEqual([]);
    });

    test("a url parameter without a declaration, or a literal secret, does not register", () => {
        expect(
            parseObjects(yamlDoc("HTTPRequest", "bad", 'url: "http://x/{id}"'), "a.yaml").problems[0]?.message,
        ).toContain("{id} has no pathParams entry");
        expect(
            parseObjects(yamlDoc("Environment", "prod", "secrets:\n  token: hunter2"), "b.yaml").problems[0]?.message,
        ).toContain("a secret is a ${env:VAR} reference");
    });
});
