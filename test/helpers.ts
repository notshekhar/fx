import { afterAll, beforeAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A fresh FX_HOME for the test file, removed afterwards. Returns a getter for its path. */
export function useFxHome(): () => string {
    let home = "";
    beforeAll(() => {
        home = mkdtempSync(join(tmpdir(), "fx-test-"));
        process.env.FX_HOME = join(home, "fx");
    });
    afterAll(() => {
        delete process.env.FX_HOME;
        rmSync(home, { recursive: true, force: true });
    });
    return () => join(home, "fx");
}

interface CallableTool {
    inputSchema: { parseAsync(input: unknown): Promise<unknown> };
    execute: (input: unknown, options: unknown) => Promise<string>;
}

/**
 * Call a tool the way the agent loop does: the input is validated against
 * its schema first (defaults filled, unknown enum values refused), then run.
 */
export async function call(tool: unknown, input: Record<string, unknown>): Promise<string> {
    const { inputSchema, execute } = tool as CallableTool;
    return execute(await inputSchema.parseAsync(input), { toolCallId: "test", messages: [] });
}

export const yamlDoc = (kind: string, name: string, spec: string) =>
    `apiVersion: fx/v1\nkind: ${kind}\nmetadata:\n  name: ${name}\nspec:\n${spec
        .trim()
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n")}\n`;
