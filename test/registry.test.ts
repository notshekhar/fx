import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
        expect(parsed.problems).toEqual([expect.stringMatching(/^mixed\.yaml \(document 2\): spec\.type/)]);
    });

    test("stdio MCP servers do not exist as a kind: an McpServer needs a URL", () => {
        const parsed = parseObjects(yamlDoc("McpServer", "local", "command: npx\nargs: [server]"), "mcp.yaml");
        expect(parsed.objects).toEqual([]);
        expect(parsed.problems[0]).toContain("spec.url");
    });

    test("the same kind and name in two files keeps the first and says so", () => {
        write("a.yaml", repo("dup"));
        write("b.yaml", repo("dup"));
        const registry = loadRegistry();
        expect(registry.objects.filter((o) => o.metadata.name === "dup")).toHaveLength(1);
        expect(registry.problems).toContain("b.yaml: Repository/dup is already defined in a.yaml; ignored");
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
