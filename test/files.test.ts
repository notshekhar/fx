/**
 * The file tools see fx's directories and nothing else — including through a
 * symlink a repository carries, which is the escape a spelling check misses.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { checkSandboxDependencies, isSandboxSupported } from "@notshekhar/loop-sandbox";
import { ensureHome, reposDir, scratchpadDir } from "../src/home";
import { createFxTools } from "../src/tools";
import { call, useFxHome } from "./helpers";

/** The OS sandbox exists here and its tooling is installed (bubblewrap on Linux). */
const sandboxUsable = isSandboxSupported() && checkSandboxDependencies().errors.length === 0;

const fxHome = useFxHome();
let secret: string;

beforeAll(() => {
    ensureHome();
    const repo = join(reposDir(), "api");
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "main.go"), "package main // handler\n");
    secret = join(fxHome(), "..", "secret.txt");
    writeFileSync(secret, "do not read\n");
    symlinkSync(secret, join(repo, "escape.txt"));
});

const tools = () => createFxTools({ cwd: reposDir(), sessionId: "files-test" });

describe("file tools", () => {
    test("read takes paths relative to the repositories directory", async () => {
        expect(await call(tools().read, { path: "api/src/main.go" })).toContain("package main");
    });

    test("grep searches the repositories by default", async () => {
        expect(await call(tools().grep, { pattern: "handler" })).toContain("main.go");
    });

    test.each([
        ["a path that climbs out", () => "../secret.txt"],
        ["an absolute path elsewhere", () => secret],
        ["a symlink inside a repository pointing out", () => "api/escape.txt"],
        ["a URL", () => "https://example.com"],
        ["loop's docs", () => "loop://docs"],
    ])("read refuses %s", async (_, path) => {
        await expect(call(tools().read, { path: path() })).rejects.toThrow(/outside what fx may read|no URLs/);
    });

    test("ls, grep and find are fenced the same way", async () => {
        for (const name of ["ls", "grep", "find"]) {
            const input =
                name === "grep"
                    ? { pattern: "x", path: ".." }
                    : name === "find"
                      ? { pattern: "*", path: ".." }
                      : { path: ".." };
            await expect(call(tools()[name], input)).rejects.toThrow("outside what fx may read");
        }
    });

    test("there is no write or edit tool", () => {
        expect(Object.keys(tools())).not.toContain("write");
        expect(Object.keys(tools())).not.toContain("edit");
    });
});

describe.skipIf(!sandboxUsable)("bash", () => {
    test("runs in the scratchpad and can write there", async () => {
        await call(tools().bash, { command: "echo 1 > out.txt && pwd" });
        expect(existsSync(join(scratchpadDir(), "out.txt"))).toBe(true);
    });

    test("cannot write into a repository clone", async () => {
        const target = join(reposDir(), "api", "planted.txt");
        await call(tools().bash, { command: `echo x > ${target}` }).catch(() => "");
        expect(existsSync(target)).toBe(false);
    });

    test("cannot read the user's home directory", async () => {
        const out = await call(tools().bash, {
            command: `ls ${homedir()} >/dev/null 2>&1 && echo LISTED || echo BLOCKED`,
        });
        expect(out).toContain("BLOCKED");
    });

    test("has no network", async () => {
        const out = await call(tools().bash, { command: "curl -sS -m 5 https://example.com || echo BLOCKED" }).catch(
            (e) => String(e),
        );
        expect(out).toContain("BLOCKED");
    });
});
