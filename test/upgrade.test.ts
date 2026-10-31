/** fx upgrade's version lookup against a fake releases page, and its refusal to overwrite a checkout. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { join } from "node:path";
import { compareVersions, isCompiledBinary, latestVersion } from "../src/upgrade";

let server: Server<undefined>;
let latestTag = "v0.4.2";

beforeAll(() => {
    server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req) {
            const { pathname } = new URL(req.url);
            if (pathname !== "/releases/latest") return new Response("not found", { status: 404 });
            // GitHub answers with a redirect to the tag's page; with no release, to itself.
            return Response.redirect(`http://127.0.0.1:${server.port}/releases/${latestTag}`, 302);
        },
    });
});

afterAll(() => server.stop(true));

describe("fx upgrade", () => {
    test("the latest version comes from where /releases/latest redirects", async () => {
        const releases = `http://127.0.0.1:${server.port}/releases`;
        expect(await latestVersion(releases)).toBe("0.4.2");
        latestTag = "latest";
        await expect(latestVersion(releases)).rejects.toThrow("could not find the latest fx release");
    });

    test("versions compare by number, not as text", () => {
        expect(compareVersions("0.1.10", "0.1.9")).toBeGreaterThan(0);
        expect(compareVersions("v0.2.0", "0.2.0")).toBe(0);
        expect(compareVersions("0.1.1", "1.0.0")).toBeLessThan(0);
    });

    test("a checkout is updated with git, never overwritten by a release", () => {
        expect(isCompiledBinary("/Users/a/.local/bin/fx")).toBe(true);
        expect(isCompiledBinary("/Users/a/.bun/bin/bun")).toBe(false);

        const result = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "upgrade"]);
        expect(result.exitCode).toBe(1);
        expect(result.stderr.toString()).toContain("running from a checkout");
    });
});
