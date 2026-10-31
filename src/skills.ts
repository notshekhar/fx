/**
 * The skills fx ships. Embedded in the binary and written out to
 * ~/.fx/builtin-skills on every start, so an upgrade replaces them; the
 * user's own skills live in ~/.fx/skills and win on a name clash.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import debugging from "../skills/debugging/SKILL.md" with { type: "text" };
import prReview from "../skills/pr-review/SKILL.md" with { type: "text" };
import { builtinSkillsDir } from "./home";

const BUILTIN_SKILLS: Record<string, string> = {
    debugging,
    "pr-review": prReview,
};

export function installBuiltinSkills(): void {
    for (const [name, body] of Object.entries(BUILTIN_SKILLS)) {
        const dir = join(builtinSkillsDir(), name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "SKILL.md"), body);
    }
}
