/**
 * Keeping the clones fresh, as drover does: each Repository is refreshed on
 * its own `refreshInterval` while fx is open, and a missing clone is made as
 * soon as fx starts. Every sync — scheduled, `fx sync`, /sync or the model's
 * sync_repo — goes through syncTracked, so its outcome is recorded for
 * /sources and two syncs of one repository never run at once.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ago, parseDuration } from "./duration";
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

/**
 * How often the schedule looks for a repository that is due. Looking reads
 * only local files, so it can be often — and a repository just saved into
 * ~/.fx starts cloning within this, not on some later minute.
 */
const TICK_MS = 5_000;

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

/**
 * Clones and fetches allowed at once. drover gives every repository its own
 * worker; a cap keeps that property — one huge repository never holds up the
 * rest — without fifty clones fighting over one link and one disk.
 */
const MAX_PARALLEL_SYNCS = 6;
let activeSyncs = 0;
const waitingForSlot: (() => void)[] = [];

/** Run `work` once a slot is free. A finished sync hands its slot straight to the next in line, so the cap is never overshot. */
async function withSyncSlot<T>(work: () => Promise<T>): Promise<T> {
    if (activeSyncs < MAX_PARALLEL_SYNCS) activeSyncs++;
    else await new Promise<void>((resolve) => waitingForSlot.push(resolve));
    try {
        return await work();
    } finally {
        const next = waitingForSlot.shift();
        if (next) next();
        else activeSyncs--;
    }
}

/** Sync one repository, joining a sync of it already under way. Resolves to the commit. */
export function syncTracked(repo: Repository, signal?: AbortSignal): Promise<string> {
    const name = repo.metadata.name;
    const running = inFlight.get(name);
    if (running) return running;
    const sync = withSyncSlot(() => syncRepo(repo, signal))
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

export interface SyncState {
    /** `pending`: on its way — syncing now, or registered and not yet tried. */
    state: "ok" | "failing" | "pending";
    detail: string;
}

/** A clone's state in one line: syncing, its commit and when, or why the last sync failed. */
export function describeSync(name: string, status = readSyncStatus()[name]): SyncState {
    if (inFlight.has(name)) return { state: "pending", detail: isCloned(name) ? "syncing now" : "cloning now" };
    if (status?.error)
        return { state: "failing", detail: `sync failed ${ago(status.at)}: ${status.error.split("\n")[0]}` };
    if (!isCloned(name)) return { state: "pending", detail: "not cloned yet — it will be shortly" };
    return { state: "ok", detail: status?.commit ? `${status.commit}, synced ${ago(status.at)}` : "cloned" };
}

/** Missing clones are always due; otherwise once `refreshInterval` has passed since the last attempt. */
export function isDue(repo: Repository, status: SyncStatus | undefined, nowMs: number): boolean {
    if (!isCloned(repo.metadata.name)) return true;
    if (repo.spec.refreshInterval === "never") return false;
    if (!status) return true;
    return nowMs - Date.parse(status.at) >= parseDuration(repo.spec.refreshInterval) * 1000;
}

/** One pass of the schedule: start every repository that is due and not already syncing, at most MAX_PARALLEL_SYNCS at a time. Failures are recorded, not thrown. */
export async function syncDueRepositories(nowMs = Date.now()): Promise<void> {
    const status = readSyncStatus();
    const due = objectsOf(loadRegistry(), "Repository").filter(
        (repo) => !inFlight.has(repo.metadata.name) && isDue(repo, status[repo.metadata.name], nowMs),
    );
    await Promise.all(due.map((repo) => syncTracked(repo).catch(() => {})));
}

/**
 * Run the schedule in the background for as long as the process lives. The
 * registry is re-read on every pass, so a repository applied while fx is open
 * is picked up. Nothing is printed: it runs under the chat screen.
 */
export function startAutoSync(): void {
    // No pass waits for the last: a repository already syncing is skipped, so
    // one long clone never delays a repository saved after it.
    const pass = () => void syncDueRepositories();
    pass();
    setInterval(pass, TICK_MS).unref();
}
