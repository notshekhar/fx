/** "90s", "15m", "6h", "2d" — the durations fx's YAML and tools take. */
const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 } as const;

export const DURATION = /^(\d+)([smhd])$/;

export function parseDuration(text: string): number {
    const match = DURATION.exec(text.trim());
    if (!match) throw new Error(`${text}: use a duration like 15m, 6h or 2d`);
    return Number(match[1]) * UNIT_SECONDS[match[2] as keyof typeof UNIT_SECONDS];
}
