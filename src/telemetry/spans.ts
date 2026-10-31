/** One trace's spans as a timeline — the shape both trace backends are reduced to. */
export interface Span {
    service: string;
    name: string;
    startMs: number;
    durationMs: number;
    error: boolean;
}

export function formatTrace(id: string, spans: Span[]): string {
    if (spans.length === 0) return `trace ${id}: no spans`;
    const sorted = [...spans].sort((a, b) => a.startMs - b.startMs);
    const t0 = sorted[0]!.startMs;
    const errors = sorted.filter((s) => s.error).length;
    const rows = sorted.map(
        (s) =>
            `  +${(s.startMs - t0).toFixed(1).padStart(9)}ms ${s.durationMs.toFixed(1).padStart(9)}ms  ${s.service}  ${s.name}${s.error ? "  ERROR" : ""}`,
    );
    return [
        `trace ${id}: ${sorted.length} spans, ${errors} with errors`,
        "  offset      duration    service  operation",
        ...rows,
    ].join("\n");
}

export function isTraceId(query: string): boolean {
    return /^[0-9a-f]{16,32}$/i.test(query.trim());
}
