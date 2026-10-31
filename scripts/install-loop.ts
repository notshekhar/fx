/**
 * Install loop's libraries from loop's own lockfile, inside the submodule.
 *
 * fx does not resolve loop's dependencies itself: a fresh resolution picks
 * newer patch versions than loop was tested with (it did — two copies of
 * @ai-sdk/provider whose types no longer matched). Installing with loop's
 * lockfile, frozen, gives fx exactly the versions loop ships with, and only
 * for the packages fx runs — not loop's desktop and mobile apps.
 */
import { join } from "node:path";

const LOOP = join(import.meta.dir, "..", "vendor", "loop");
const PACKAGES = ["@notshekhar/loop", "@notshekhar/loop-core", "@notshekhar/loop-tui", "@notshekhar/loop-sandbox"];

const filters = PACKAGES.flatMap((name) => ["--filter", name]);
const install = Bun.spawnSync(["bun", "install", "--frozen-lockfile", ...filters], {
    cwd: LOOP,
    stdio: ["inherit", "inherit", "inherit"],
});
if (install.exitCode !== 0) {
    console.error("installing loop's packages failed — is the submodule checked out? (git submodule update --init)");
    process.exit(install.exitCode ?? 1);
}
