/**
 * Keeping the clones fresh, as drover does: each Repository is refreshed on
 * its own `refreshInterval` while fx is open, and a missing clone is made as
 * soon as fx starts. Every sync — scheduled, `fx sync`, /sync or the model's
 * sync_repo — goes through syncTracked, so its outcome is recorded for
 * /sources and two syncs of one repository never run at once.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDuration } from "./duration";
import { fxHome } from "./home";
import type { ObjectOf } from "./registry/kinds";
import { loadRegistry, objectsOf } from "./registry/store";
import { isCloned, syncRepo } from "./repos";

type Repository = ObjectOf<"Repository">;

export interface SyncStatus {
    /** When the last attempt finished, ISO time. */
    at: string;
    commit?: string;
    error?: string;
}

/** How often the schedule looks for a repository that is due; intervals are minutes, so this is plenty. */
const TICK_MS = 30_000;

function statusFile(): string {
    return join(fxHome(), "sync-status.json");
}

export function readSyncStatus(): Record<string, SyncStatus> {
    if (!existsSync(statusFile())) return {};
    try {
        return JSON.parse(readFileSync(statusFile(), "utf8")) as Record<string, SyncStatus>;
    } catch {
        return {};
    }
}

function recordSync(name: string, status: SyncStatus): void {
    writeFileSync(statusFile(), `${JSON.stringify({ ...readSyncStatus(), [name]: status }, null, 2)}\n`);
}

const inFlight = new Map<string, Promise<string>>();

/** Sync one repository, joining a sync of it already under way. Resolves to the commit. */
export function syncTracked(repo: Repository, signal?: AbortSignal): Promise<string> {
    const name = repo.metadata.name;
    const running = inFlight.get(name);
    if (running) return running;
    const sync = syncRepo(repo, signal)
        .then(
            (commit) => {
                recordSync(name, { at: new Date().toISOString(), commit });
                return commit;
            },
            (err: Error) => {
                recordSync(name, { at: new Date().toISOString(), error: err.message });
                throw err;
            },
        )
        .finally(() => inFlight.delete(name));
    inFlight.set(name, sync);
    return sync;
}

/** Missing clones are always due; otherwise once `refreshInterval` has passed since the last attempt. */
export function isDue(repo: Repository, status: SyncStatus | undefined, nowMs: number): boolean {
    if (!isCloned(repo.metadata.name)) return true;
    if (repo.spec.refreshInterval === "never") return false;
    if (!status) return true;
    return nowMs - Date.parse(status.at) >= parseDuration(repo.spec.refreshInterval) * 1000;
}

/** One pass of the schedule: sync, one at a time, every repository that is due. Failures are recorded, not thrown. */
export async function syncDueRepositories(nowMs = Date.now()): Promise<void> {
    const status = readSyncStatus();
    for (const repo of objectsOf(loadRegistry(), "Repository")) {
        if (!isDue(repo, status[repo.metadata.name], nowMs)) continue;
        await syncTracked(repo).catch(() => {});
    }
}

/**
 * Run the schedule in the background for as long as the process lives. The
 * registry is re-read on every pass, so a repository applied while fx is open
 * is picked up. Nothing is printed: it runs under the chat screen.
 */
export function startAutoSync(): void {
    let running = false;
    const pass = () => {
        if (running) return;
        running = true;
        void syncDueRepositories().finally(() => (running = false));
    };
    pass();
    setInterval(pass, TICK_MS).unref();
}
