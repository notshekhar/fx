/** The banner summary follows ~/.fx on its own: a saved file shows without a reload, and nothing repaints for no change. */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { StatusMonitor } from "../src/monitor";
import { useFxHome, yamlDoc } from "./helpers";

const fxHome = useFxHome();

describe("status monitor", () => {
    test("a newly saved file shows on the local refresh, and an unchanged state does not repaint", async () => {
        mkdirSync(fxHome(), { recursive: true });
        writeFileSync(join(fxHome(), "env.yaml"), yamlDoc("Environment", "prod", "variables:\n  baseUrl: http://x"));
        const monitor = new StatusMonitor();
        let repaints = 0;
        monitor.subscribe(() => repaints++);

        await monitor.refreshLive();
        expect(monitor.lines()[0]).toBe(" sources  ✓ 1 environment");
        expect(repaints).toBe(1);

        await monitor.refreshLocal();
        expect(repaints).toBe(1);

        writeFileSync(join(fxHome(), "repos.yaml"), yamlDoc("Repository", "api", "url: https://example.invalid/a.git"));
        await monitor.refreshLocal();
        expect(monitor.lines()[0]).toBe(" sources  ◌ 1 repo, 1 on the way  ·  ✓ 1 environment");
        expect(repaints).toBe(2);
    });
});
