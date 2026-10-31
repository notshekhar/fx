/**
 * Single-file fx binary: `bun scripts/build.ts [bun-<os>-<arch>]`, defaulting
 * to this machine. Writes dist/fx-<os>-<arch>[.exe].
 */
import { join } from "node:path";
import { $ } from "bun";

const target = process.argv[2] ?? `bun-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
const name = target.replace(/^bun-/, "");
const outfile = join(import.meta.dir, "..", "dist", `fx-${name}${name.startsWith("windows") ? ".exe" : ""}`);

const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "..", "src", "main.ts")],
    compile: { target: target as Bun.Build.CompileTarget, outfile },
    minify: true,
    // Resolved only by loop's own release build, which embeds `loop serve`'s
    // web UI. fx has no serve, and loop treats the module's absence as "none".
    external: ["loop:web-app-pack"],
});
if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
}

// bun --compile signs before appending the program, so the signature does not
// match the file; some Macs kill such a binary on exec. Re-sign ad hoc.
if (name.startsWith("darwin") && process.platform === "darwin") {
    await $`codesign --force --sign - ${outfile}`.quiet();
    await $`codesign --verify --strict ${outfile}`.quiet();
}
console.log(`built ${outfile}`);
