#!/usr/bin/env bun
// The AI SDK prints advisory warnings mid-stream, which tears the TUI's
// rendering — the same switch loop's own entry point sets first.
(globalThis as Record<string, unknown>).AI_SDK_LOG_WARNINGS = false;

// Imported after that line runs, which a static import would not be.
const { main } = await import("./cli");

try {
    await main(process.argv.slice(2));
} catch (err) {
    console.error(`fx: ${(err as Error).message}`);
    process.exit(1);
}

export {};
