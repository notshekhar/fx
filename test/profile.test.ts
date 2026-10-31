/**
 * fx as loop sees it once startFx has run: loop's turn gets fx's tools and
 * prompt, loop's command list has fx's commands and skills and none of the
 * features fx leaves out, and fx's state lands in FX_HOME.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
    CommandRegistry,
    createBaseTools,
    getAppDataDir,
    getSetting,
    isSettingOffered,
    listDatasources,
    registerBuiltins,
    resetAppProfile,
} from "@notshekhar/loop-core";
// Not part of loop-core's public surface; the turn calls it with fx's profile set.
import { buildSystemPrompt } from "../vendor/loop/packages/core/src/agent/system-prompt";
import { startFx } from "../src/start";
import { useFxHome, yamlDoc } from "./helpers";

const fxHome = useFxHome();

beforeAll(() => {
    startFx();
    writeFileSync(
        join(fxHome(), "sources.yaml"),
        `${yamlDoc("Database", "orders", "type: postgres\nhost: db\nport: 5432\ndatabase: orders\nuser: ro")}---\n${yamlDoc(
            "Kubernetes",
            "prod",
            "context: prod-eu",
        )}`,
    );
    // Start again with something registered, as a user would after `fx apply`.
    startFx();
});

afterAll(() => resetAppProfile());

describe("fx profile", () => {
    test("state lives in FX_HOME", () => {
        expect(getAppDataDir()).toBe(fxHome());
        expect(listDatasources().map((d) => d.id)).toEqual(["orders"]);
        expect(existsSync(join(fxHome(), "datasources.json"))).toBe(true);
    });

    test("the turn's tools are fx's, with a tool per registered kind", () => {
        const tools = Object.keys(createBaseTools({ cwd: fxHome() })).sort();
        expect(tools).toEqual(["bash", "find", "grep", "kubernetes", "ls", "read", "sql"]);
    });

    test("the prompt is fx's and lists what is registered", () => {
        const prompt = buildSystemPrompt({ cwd: fxHome() });
        expect(prompt).toStartWith("You are fx");
        expect(prompt).toContain("Database orders: postgres orders (sql tool)");
        expect(prompt).toContain("Kubernetes prod: context prod-eu");
    });

    test("an edited prompt.md replaces fx's persona on the next turn", () => {
        writeFileSync(join(fxHome(), "prompt.md"), "You are the on-call helper.\n");
        expect(buildSystemPrompt({ cwd: fxHome() })).toStartWith("You are the on-call helper.");
    });

    test("loop features fx does not offer stay off whatever ~/.loop says, and /settings does not list them", () => {
        for (const key of [
            "subagents",
            "subagentModel",
            "threadTeams",
            "backgroundShells",
            "memory",
            "serve",
            "gateways",
        ]) {
            expect(isSettingOffered(key)).toBe(false);
        }
        expect(isSettingOffered("theme")).toBe(true);
        expect(getSetting("subagents")).toBe(false);
        expect(getSetting("threadTeams")).toBe(false);
        expect(getSetting("workspaceContext")).toBe(false);
        expect(getSetting("hooks")).toEqual({});
    });

    test("commands: fx's own and its skills by bare name; loop's writers and agents are gone", async () => {
        const reg = new CommandRegistry();
        await registerBuiltins(reg, { cwd: fxHome() });
        for (const name of ["sources", "sync", "prompt", "debugging", "pr-review", "model", "login"]) {
            expect(reg.has(name)).toBe(true);
        }
        for (const name of ["goal", "plan", "agents", "data", "init", "cd", "update", "extensions"]) {
            expect(reg.has(name)).toBe(false);
        }
    });
});
