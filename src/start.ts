/**
 * Everything that has to be true before loop runs a turn as fx: the home
 * exists, the shipped skills are current, the databases match the registry,
 * and loop is running fx's profile.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { envName, setAppProfile, trustForSession } from "@notshekhar/loop-core";
import { syncDatasources } from "./datasources";
import { ensureHome, fxHome, scratchpadDir } from "./home";
import { createFxProfile } from "./profile";
import { loadRegistry } from "./registry/store";
import { installBuiltinSkills } from "./skills";

export function startFx(): void {
    ensureHome();
    installBuiltinSkills();
    const registry = loadRegistry();
    setAppProfile(createFxProfile(registry));
    syncDatasources(registry);
    // Skills load only in a trusted folder, and ~/.fx is fx's own.
    trustForSession(fxHome());
    // The bash sandbox points TMPDIR here; keep even temporary files in ~/.fx.
    const tmp = join(scratchpadDir(), ".tmp");
    mkdirSync(tmp, { recursive: true });
    process.env[envName("SANDBOX_TMPDIR")] = tmp;
}
