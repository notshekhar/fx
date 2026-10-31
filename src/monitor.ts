/**
 * The summary under the welcome banner, kept current while the chat is open,
 * as drover's dashboard is: what is registered and what answers.
 *
 * Two clocks, because the checks cost very different amounts. Reading the
 * registry and each clone's sync record touches only local files, so it runs
 * every few seconds and a saved YAML or a finished sync shows almost at once.
 * The live checks open connections, so they run once a minute.
 */
import type { WelcomePanel } from "@notshekhar/loop-core";
import { checkAll, isLiveKind, type Health } from "./health";
import { loadRegistry, type Problem, type Registry } from "./registry/store";
import { formatSummary } from "./status-view";

const LOCAL_EVERY_MS = 5_000;
const LIVE_EVERY_MS = 60_000;

const key = (h: { kind: string; name: string }) => `${h.kind}/${h.name}`;

export class StatusMonitor implements WelcomePanel {
    private results: Health[] | undefined;
    private problems: Problem[] = [];
    private checkedAt: Date | undefined;
    private liveRunning = false;
    private readonly listeners = new Set<() => void>();

    lines(): string[] {
        return formatSummary(this.results, this.problems, this.checkedAt);
    }

    subscribe(onChange: () => void): () => void {
        this.listeners.add(onChange);
        return () => this.listeners.delete(onChange);
    }

    /** Check now, then on both clocks for as long as the process lives. */
    start(): void {
        void this.refreshLive();
        setInterval(() => void this.refreshLocal(), LOCAL_EVERY_MS).unref();
        setInterval(() => void this.refreshLive(), LIVE_EVERY_MS).unref();
    }

    /** Everything, connections included. */
    async refreshLive(): Promise<void> {
        if (this.liveRunning) return;
        this.liveRunning = true;
        try {
            const registry = loadRegistry();
            this.publish(await checkAll(registry), registry, new Date());
        } finally {
            this.liveRunning = false;
        }
    }

    /** Only what local files answer; a live result is kept until its next check, and a new source shows as pending. */
    async refreshLocal(): Promise<void> {
        if (this.liveRunning || !this.results) return;
        const registry = loadRegistry();
        const local = await checkAll({ ...registry, objects: registry.objects.filter((o) => !isLiveKind(o.kind)) });
        const previous = new Map(this.results.map((h) => [key(h), h]));
        const fresh = new Map(local.map((h) => [key(h), h]));
        const merged = registry.objects.map(
            (o): Health =>
                fresh.get(key({ kind: o.kind, name: o.metadata.name })) ??
                previous.get(key({ kind: o.kind, name: o.metadata.name })) ?? {
                    kind: o.kind,
                    name: o.metadata.name,
                    state: "pending",
                    detail: "checking…",
                },
        );
        this.publish(merged, registry, this.checkedAt);
    }

    /** Store a new state, and tell the TUI only when what it shows changed. */
    private publish(results: Health[], registry: Registry, checkedAt: Date | undefined): void {
        const before = this.lines().join("\n");
        this.results = results;
        this.problems = registry.problems;
        this.checkedAt = checkedAt;
        if (this.lines().join("\n") !== before) for (const listener of this.listeners) listener();
    }
}
