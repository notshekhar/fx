import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { problemLine } from "../src/registry/problems";
import { applyFile, deleteObject, loadRegistry, parseObjects } from "../src/registry/store";
import { useFxHome, yamlDoc } from "./helpers";

const fxHome = useFxHome();

const repo = (name: string) => yamlDoc("Repository", name, "url: https://example.com/acme.git");

function write(name: string, text: string): string {
    mkdirSync(fxHome(), { recursive: true });
    const path = join(fxHome(), name);
    writeFileSync(path, text);
    return path;
}

describe("registry", () => {
    test("a broken document is reported with its file, and the rest still load", () => {
        const parsed = parseObjects(
            `${repo("api")}---\n${yamlDoc("Database", "orders", "type: oracle\nhost: h\nport: 1\ndatabase: d\nuser: u")}`,
            "mixed.yaml",
        );
        expect(parsed.objects.map((o) => o.metadata.name)).toEqual(["api"]);
        expect(parsed.problems).toEqual([
            { file: "mixed.yaml", document: 2, name: "orders", message: "type must be postgres or mysql or redshift" },
        ]);
    });

    test("stdio MCP servers do not exist as a kind: an McpServer needs a URL", () => {
        const parsed = parseObjects(yamlDoc("McpServer", "local", "command: npx\nargs: [server]"), "mcp.yaml");
        expect(parsed.objects).toEqual([]);
        expect(parsed.problems[0]?.message).toBe("url is missing");
    });

    test("the same kind and name in two files keeps the first and says so", () => {
        write("a.yaml", repo("dup"));
        write("b.yaml", repo("dup"));
        const registry = loadRegistry();
        expect(registry.objects.filter((o) => o.metadata.name === "dup")).toHaveLength(1);
        expect(registry.problems.map(problemLine)).toContain(
            "b.yaml (dup): Repository dup is already defined in a.yaml; ignored",
        );
    });

    test("apply copies a valid file in, and refuses one with any invalid document", () => {
        const outside = join(fxHome(), "..", "new.yaml");
        writeFileSync(outside, repo("svc"));
        expect(applyFile(outside).map((o) => o.metadata.name)).toEqual(["svc"]);
        expect(readFileSync(join(fxHome(), "new.yaml"), "utf8")).toBe(repo("svc"));

        const broken = join(fxHome(), "..", "broken.yaml");
        writeFileSync(broken, `${repo("ok")}---\nkind: Nonsense\n`);
        expect(() => applyFile(broken)).toThrow(/document 2/);
        expect(existsSync(join(fxHome(), "broken.yaml"))).toBe(false);
    });

    test("apply refuses a name another file already holds", () => {
        write("held.yaml", repo("taken"));
        const other = join(fxHome(), "..", "other.yaml");
        writeFileSync(other, repo("taken"));
        expect(() => applyFile(other)).toThrow("Repository/taken is already defined in held.yaml");
    });

    test("delete removes one document and keeps the others; an emptied file goes", () => {
        const path = write("pair.yaml", `${repo("keep")}---\n${repo("drop")}`);
        expect(deleteObject("Repository", "drop")).toBe(true);
        expect(parseObjects(readFileSync(path, "utf8"), "pair.yaml").objects.map((o) => o.metadata.name)).toEqual([
            "keep",
        ]);
        expect(deleteObject("Repository", "keep")).toBe(true);
        expect(existsSync(path)).toBe(false);
        expect(deleteObject("Repository", "keep")).toBe(false);
    });
});

describe("drover files", () => {
    const drover = (kind: string, name: string, spec: string) =>
        yamlDoc(kind, name, spec).replace("apiVersion: fx/v1", "apiVersion: drover/v1");

    test("a drover file dropped into ~/.fx registers as it is", () => {
        write(
            "drover-repos.yaml",
            drover("Repository", "web", "url: https://example.com/web.git\nrefreshInterval: 5m"),
        );
        const registry = loadRegistry();
        expect(registry.problems.filter((p) => p.file === "drover-repos.yaml")).toEqual([]);
        expect(registry.objects.find((o) => o.metadata.name === "web")?.kind).toBe("Repository");
    });

    test("a drover kind fx does not have says what to write instead", () => {
        const parsed = parseObjects(drover("SQLConnection", "analytics", "provider: postgres\nurl: ${DB}"), "db.yaml");
        expect(parsed.problems[0]?.message).toContain("SQLConnection is drover's; write it as a Database");
    });

    test("drover's header list is read as headers, and a wrong shape says what it should be", () => {
        const parsed = parseObjects(
            yamlDoc("HTTPRequest", "h", 'url: "http://x/"\nheaders:\n  - name: Accept\n    value: application/json'),
            "h.yaml",
        );
        expect(parsed.objects[0]).toMatchObject({ spec: { headers: { Accept: "application/json" } } });
        const wrong = parseObjects(yamlDoc("Environment", "e", "variables: [a, b]"), "e.yaml");
        expect(wrong.problems[0]?.message).toBe("variables should be a map (name: value), not a list");
    });

    test("a Database keeps the sql tool's shorter names; other kinds take drover's", () => {
        const db = parseObjects(
            yamlDoc("Database", "orders.replica", "type: mysql\nhost: h\nport: 1\ndatabase: d\nuser: u"),
            "db.yaml",
        );
        expect(db.problems[0]?.message).toContain("it is the sql tool's connection id");
        expect(parseObjects(repo("a".repeat(63)), "r.yaml").problems).toEqual([]);
        expect(parseObjects(repo("a".repeat(64)), "r.yaml").problems[0]?.message).toContain("1-63");
        expect(parseObjects(repo("a.b.c"), "r.yaml").problems[0]?.message).toContain("at most one dot");
    });

    test("config.yaml is settings, never read as objects", () => {
        write("config.yaml", "current: local\nlisten: 127.0.0.1:7432\n");
        expect(loadRegistry().problems.filter((p) => p.file === "config.yaml")).toEqual([]);
    });
});
