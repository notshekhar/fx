/**
 * `fx upgrade`: find the newest release and re-run the installer over the
 * running binary, the way `loop upgrade` does.
 */
import { basename, dirname } from "node:path";
import pkg from "../package.json" with { type: "json" };

export const RELEASES_URL = "https://github.com/notshekhar/fx/releases";
const INSTALLER_URL = "https://raw.githubusercontent.com/notshekhar/fx/main/install.sh";

export interface UpgradeOptions {
    check: boolean;
    force: boolean;
    to?: string;
}

/** The newest release's version, read from where `/releases/latest` redirects — no API call, so no rate limit. */
export async function latestVersion(releasesUrl = RELEASES_URL): Promise<string> {
    const response = await fetch(`${releasesUrl}/latest`, { redirect: "manual" });
    const location = response.headers.get("location");
    const tag = location?.split("/").pop();
    if (!tag || tag === "latest") throw new Error(`could not find the latest fx release at ${releasesUrl}`);
    return stripV(tag);
}

/** Negative, zero or positive as a is older than, equal to or newer than b. */
export function compareVersions(a: string, b: string): number {
    const [x, y] = [a, b].map((v) => stripV(v).split(".").map(Number));
    for (let i = 0; i < 3; i++) {
        const diff = (x![i] ?? 0) - (y![i] ?? 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

function stripV(version: string): string {
    return version.replace(/^v/, "");
}

/** A compiled fx is its own executable; from a checkout, the executable is bun. */
export function isCompiledBinary(execPath = process.execPath): boolean {
    return !basename(execPath).startsWith("bun");
}

async function runInstaller(version: string, force: boolean): Promise<void> {
    const proc = Bun.spawn(["bash", "-c", `curl -fsSL ${INSTALLER_URL} | bash`], {
        env: {
            ...process.env,
            FX_VERSION: version,
            FX_FORCE: force ? "1" : "0",
            // Replace this binary where it is, not wherever the default would be.
            FX_INSTALL_DIR: dirname(process.execPath),
        },
        stdio: ["inherit", "inherit", "inherit"],
    });
    if ((await proc.exited) !== 0) throw new Error("the installer failed; fx was not changed");
}

export async function runUpgrade(options: UpgradeOptions, log: (line: string) => void): Promise<void> {
    if (!options.check && !isCompiledBinary()) {
        throw new Error(
            "fx is running from a checkout; update it with: git pull && git submodule update && bun install",
        );
    }
    const target = options.to ? stripV(options.to) : await latestVersion();
    const newer = compareVersions(target, pkg.version) > 0;
    if (options.check) {
        return log(
            newer
                ? `fx ${target} is available (you have ${pkg.version}) — run fx upgrade`
                : `fx ${pkg.version} is up to date`,
        );
    }
    // An explicit --to may go backwards; plain `fx upgrade` only moves forward.
    if (!newer && !options.to && !options.force) return log(`fx ${pkg.version} is up to date`);
    await runInstaller(target, options.force);
}
