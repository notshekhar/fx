/**
 * How fx shows the state of what is registered: the /status report, the
 * skipped documents, and the one-line summary under the welcome banner.
 *
 * Coloured through loop's theme helpers, so it follows /theme; with no theme
 * active (`fx status` in a shell) they fall back to plain terminal colours,
 * and to none when the output is not a terminal.
 */
import { accent, dim, err, heading, ok, strong, warn } from "@notshekhar/loop/ui";
import type { Health, HealthState } from "./health";
import { KINDS, type Kind } from "./registry/kinds";
import type { Problem } from "./registry/problems";

const SECTION: Record<Kind, string> = {
    Repository: "Repositories",
    Database: "Databases",
    Kubernetes: "Kubernetes clusters",
    Telemetry: "Telemetry",
    McpServer: "MCP servers",
    Environment: "Environments",
    HTTPRequest: "API requests",
};

/** The word `/status <kind>` takes, shown where a section is collapsed. */
const KIND_WORD: Record<Kind, string> = {
    Repository: "repos",
    Database: "databases",
    Kubernetes: "clusters",
    Telemetry: "telemetry",
    McpServer: "mcp",
    Environment: "environments",
    HTTPRequest: "apis",
};

/** What the banner summary counts, one and many. */
const COUNTED: Record<Kind, readonly [string, string]> = {
    Repository: ["repo", "repos"],
    Database: ["database", "databases"],
    Kubernetes: ["cluster", "clusters"],
    Telemetry: ["telemetry source", "telemetry sources"],
    McpServer: ["MCP server", "MCP servers"],
    Environment: ["environment", "environments"],
    HTTPRequest: ["API", "APIs"],
};

const counted = (kind: Kind, n: number) => `${n} ${COUNTED[kind][n === 1 ? 0 : 1]}`;

const MARK: Record<HealthState, (s: string) => string> = {
    ok: (s) => ok(s),
    failing: (s) => err(s),
    pending: (s) => accent(s),
    off: (s) => dim(s),
};
const SYMBOL: Record<HealthState, string> = { ok: "✓", failing: "✗", pending: "◌", off: "·" };

/** A section longer than this shows its working entries as one count; `/status <kind>` lists them all. */
const COLLAPSE_OVER = 8;
/** Names past this are cut, so one long name does not push every detail off the screen. */
const NAME_COLUMN_MAX = 34;
/** How many names a group of skipped documents spells out before "+N more". */
const NAMES_SHOWN = 3;

function fitName(name: string, width: number): string {
    return name.length > width ? `${name.slice(0, width - 1)}…` : name.padEnd(width);
}

function count(results: readonly Health[], state: HealthState): number {
    return results.filter((r) => r.state === state).length;
}

function headline(results: readonly Health[], problems: readonly Problem[]): string {
    const failing = count(results, "failing");
    const pending = count(results, "pending");
    const parts = [ok(`✓ ${count(results, "ok")} working`)];
    if (failing) parts.push(err(`✗ ${failing} failing`));
    if (pending) parts.push(accent(`◌ ${pending} on the way`));
    if (problems.length) parts.push(warn(`! ${problems.length} skipped`));
    return `${heading("fx status")}   ${parts.join("   ")}`;
}

function entryLine(result: Health, nameWidth: number): string {
    const detail = result.state === "failing" ? err(result.detail) : dim(result.detail);
    const took = result.ms === undefined ? "" : dim(` · ${result.ms}ms`);
    return `  ${MARK[result.state](SYMBOL[result.state])} ${strong(fitName(result.name, nameWidth))}  ${detail}${took}`;
}

function section(kind: Kind, results: readonly Health[], full: boolean): string[] {
    const nameWidth = Math.min(NAME_COLUMN_MAX, Math.max(...results.map((r) => r.name.length)));
    const lines = [`${heading(SECTION[kind])}  ${dim(String(results.length))}`];
    const collapse = !full && results.length > COLLAPSE_OVER;
    const working = results.filter((r) => r.state === "ok");
    if (collapse && working.length > 0) {
        lines.push(
            `  ${ok("✓")} ${strong(`${working.length} working`)}  ${dim(`/status ${KIND_WORD[kind]} lists each one`)}`,
        );
    }
    for (const result of collapse ? results.filter((r) => r.state !== "ok") : results) {
        lines.push(entryLine(result, nameWidth));
    }
    return lines;
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
    const groups = new Map<string, T[]>();
    for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
    return groups;
}

function which(problems: readonly Problem[]): string {
    const names = problems.map((p) => p.name ?? (p.document ? `document ${p.document}` : p.file));
    const more = names.length > NAMES_SHOWN ? `, +${names.length - NAMES_SHOWN} more` : "";
    return names.slice(0, NAMES_SHOWN).join(", ") + more;
}

/**
 * Skipped documents, grouped by file and then by what is wrong — seventy
 * documents failing one way read as one line saying so, naming a few of them.
 */
export function formatProblems(problems: readonly Problem[]): string[] {
    if (problems.length === 0) return [];
    const files = groupBy(problems, (p) => p.file);
    const lines = [`${heading("Skipped")}  ${dim(`${problems.length} document(s) fx could not use`)}`];
    for (const [file, inFile] of files) {
        lines.push(`  ${warn("!")} ${strong(file)}  ${dim(String(inFile.length))}`);
        for (const [message, same] of groupBy(inFile, (p) => p.message)) {
            const times = same.length > 1 ? `${same.length} × ` : "";
            lines.push(`      ${warn(times)}${message}`);
            lines.push(`      ${" ".repeat(times.length)}${dim(which(same))}`);
        }
    }
    lines.push(dim("  fix the file and fx picks it up on your next message"));
    return lines;
}

/** /status and `fx status`. `full` lists every entry, as `/status <kind>` does. */
export function formatStatus(results: readonly Health[], problems: readonly Problem[], full = false): string {
    if (results.length === 0 && problems.length === 0)
        return dim("nothing registered — drop YAML into ~/.fx, or `fx apply -f <file>.yaml`");
    const blocks: string[][] = [[headline(results, problems)]];
    for (const kind of KINDS) {
        const ofKind = results.filter((r) => r.kind === kind);
        if (ofKind.length > 0) blocks.push(section(kind, ofKind, full));
    }
    const skipped = formatProblems(problems);
    if (skipped.length) blocks.push(skipped);
    return blocks.map((block) => block.join("\n")).join("\n\n");
}

function summaryToken(kind: Kind, results: readonly Health[]): string | undefined {
    const live = results.filter((r) => r.state !== "off");
    if (live.length === 0) return undefined;
    const failing = count(live, "failing");
    if (failing) return err(`✗ ${failing} of ${counted(kind, live.length)} failing`);
    const pending = count(live, "pending");
    if (pending) return accent(`◌ ${counted(kind, live.length)}, ${pending} on the way`);
    return ok(`✓ ${counted(kind, live.length)}`);
}

/**
 * The lines under the welcome banner: a token per kind, when it was checked,
 * and a blank to set it off from the startup lines. Always three, so the
 * panel keeps one height as it updates.
 */
export function formatSummary(
    results: readonly Health[] | undefined,
    problems: readonly Problem[],
    checkedAt: Date | undefined,
): string[] {
    const label = ` ${accent("sources")}  `;
    if (!results) return [`${label}${dim("checking…")}`, "", ""];
    const tokens = KINDS.map((kind) =>
        summaryToken(
            kind,
            results.filter((r) => r.kind === kind),
        ),
    ).filter((t): t is string => t !== undefined);
    if (problems.length) tokens.push(warn(`! ${problems.length} skipped`));
    if (tokens.length === 0) return [`${label}${dim("none yet — drop YAML into ~/.fx")}`, "", ""];
    const when = checkedAt
        ? `checked ${checkedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : "checking…";
    return [`${label}${tokens.join(dim("  ·  "))}`, ` ${dim(`${" ".repeat(9)}${when} · /status for details`)}`, ""];
}
