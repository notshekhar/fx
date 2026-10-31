/** The fx command, run as a real process against its own FX_HOME. */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };
import { parseArgs } from "../src/cli";
import { useFxHome, yamlDoc } from "./helpers";

const fxHome = useFxHome();
const MAIN = join(import.meta.dir, "..", "src", "main.ts");

function fx(...args: string[]) {
    const result = Bun.spawnSync(["bun", MAIN, ...args], { env: { ...process.env, FX_HOME: fxHome() } });
    return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

describe("fx cli", () => {
    test("version and help", () => {
        expect(fx("--version").out.trim()).toBe(pkg.version);
        expect(fx("help").out).toContain("fx apply -f <file.yaml>");
    });

    test("an unknown command or flag fails instead of opening a chat", () => {
        expect(fx("aply")).toMatchObject({ code: 1, err: expect.stringContaining("unknown command aply") });
        expect(fx("--modle", "x")).toMatchObject({ code: 1, err: expect.stringContaining("unknown flag --modle") });
    });

    test("apply, get and delete round-trip; deleting a repository removes fx's clone", () => {
        const file = join(fxHome(), "..", "dbs.yaml");
        writeFileSync(
            file,
            yamlDoc("Database", "orders", "type: mysql\nhost: db\nport: 3306\ndatabase: shop\nuser: ro"),
        );
        expect(fx("apply", "-f", file)).toMatchObject({ code: 0, out: "database/orders applied\n" });
        expect(fx("get", "databases").out).toContain("orders               mysql  db:3306/shop");

        writeFileSync(
            join(fxHome(), "repos.yaml"),
            yamlDoc("Repository", "api", "url: https://example.invalid/api.git"),
        );
        mkdirSync(join(fxHome(), "repos", "api", ".git"), { recursive: true });
        expect(fx("delete", "repository", "api")).toMatchObject({ code: 0 });
        expect(existsSync(join(fxHome(), "repos", "api"))).toBe(false);
        expect(fx("delete", "repository", "api")).toMatchObject({ code: 1, err: "fx: no Repository named api\n" });
    });

    test("apply reports what is wrong with a file and registers nothing", () => {
        const file = join(fxHome(), "..", "bad.yaml");
        writeFileSync(file, yamlDoc("Telemetry", "logs", "type: splunk\nurl: http://x"));
        const result = fx("apply", "-f", file);
        expect(result.code).toBe(1);
        expect(result.err).toContain("bad.yaml (document 1, logs): type must be loki or prometheus or tempo or jaeger");
        expect(existsSync(join(fxHome(), "bad.yaml"))).toBe(false);
    });

    test("argument parsing", () => {
        expect(parseArgs(["get", "repositories"])).toEqual({ command: "get", positional: ["repositories"], flags: {} });
        expect(parseArgs(["--model", "anthropic/claude-opus-5-5"]).flags).toEqual({
            model: "anthropic/claude-opus-5-5",
        });
        expect(() => parseArgs(["apply", "-f"])).toThrow("-f needs a value");
    });
});
