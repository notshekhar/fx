import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from "@notshekhar/loop-core";

/**
 * Cap a tool's output the way loop's own tools do, and say so when it was
 * cut — a silently shortened log reads as a complete one.
 */
export function capped(text: string): string {
    const result = truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
    if (!result.truncated) return text || "(no output)";
    return `${result.content}\n\n[output cut at ${result.outputLines} of ${result.totalLines} lines — narrow the query]`;
}
