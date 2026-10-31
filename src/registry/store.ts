/**
 * The registry is every `*.yaml` in ~/.fx, read fresh each time it is asked
 * for — so saving a file is all it takes, as in drover. A broken document is
 * reported and skipped rather than hiding the rest.
 */
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseAllDocuments } from "yaml";
import { fxHome } from "../home";
import { DROVER_ONLY_KINDS, fxObject, type FxObject, type Kind, type ObjectOf } from "./kinds";
import { describeIssue, problemLine, type Problem } from "./problems";

export type { Problem } from "./problems";

export interface Registry {
    objects: FxObject[];
    /** Every document that could not be used. */
    problems: Problem[];
}

interface Parsed {
    objects: FxObject[];
    problems: Problem[];
}

export function parseObjects(text: string, source: string): Parsed {
    const parsed: Parsed = { objects: [], problems: [] };
    parseAllDocuments(text).forEach((doc, index) => {
        const problem = (message: string, name?: string) =>
            parsed.problems.push({ file: source, document: index + 1, ...(name && { name }), message });
        if (doc.errors.length > 0) return problem(`not valid YAML: ${doc.errors[0]!.message.split("\n")[0]}`);
        const value = doc.toJS() as { kind?: string; metadata?: { name?: unknown } } | null | undefined;
        if (value === null || value === undefined) return;
        const name = typeof value.metadata?.name === "string" ? value.metadata.name : undefined;
        const instead = DROVER_ONLY_KINDS[value.kind ?? ""];
        if (instead) return problem(`${value.kind} is drover's; ${instead}`, name);
        const result = fxObject.safeParse(value);
        if (result.success) parsed.objects.push(result.data);
        else problem(describeIssue(result.error.issues[0]), name);
    });
    return parsed;
}

/** As in drover, config.yaml is settings, not objects — so a drover config copied in is not reported as broken. */
const SETTINGS_FILE = "config.yaml";

function registryFiles(): string[] {
    if (!existsSync(fxHome())) return [];
    return readdirSync(fxHome())
        .filter((f) => (f.endsWith(".yaml") || f.endsWith(".yml")) && f !== SETTINGS_FILE)
        .sort()
        .map((f) => join(fxHome(), f));
}

const key = (o: FxObject) => `${o.kind}/${o.metadata.name}`;

interface Entry {
    object: FxObject;
    file: string;
}

/** Every valid object with the file it came from; a repeated kind/name keeps the first. */
function loadEntries(): { entries: Entry[]; problems: Problem[] } {
    const entries: Entry[] = [];
    const problems: Problem[] = [];
    for (const file of registryFiles()) {
        const parsed = parseObjects(readFileSync(file, "utf8"), basename(file));
        problems.push(...parsed.problems);
        for (const object of parsed.objects) {
            const first = entries.find((e) => key(e.object) === key(object));
            if (first)
                problems.push({
                    file: basename(file),
                    name: object.metadata.name,
                    message: `${object.kind} ${object.metadata.name} is already defined in ${basename(first.file)}; ignored`,
                });
            else entries.push({ object, file });
        }
    }
    return { entries, problems };
}

export function loadRegistry(): Registry {
    const { entries, problems } = loadEntries();
    return { objects: entries.map((e) => e.object), problems };
}

export function objectsOf<K extends Kind>(registry: Registry, kind: K): ObjectOf<K>[] {
    return registry.objects.filter((o): o is ObjectOf<K> => o.kind === kind);
}

/**
 * Copy a file into ~/.fx once every document in it is valid, replacing a file
 * of the same name. Refused outright otherwise: a half-applied file would
 * leave the registry in a state nobody wrote.
 */
export function applyFile(path: string): FxObject[] {
    const text = readFileSync(path, "utf8");
    const parsed = parseObjects(text, basename(path));
    if (parsed.problems.length > 0) throw new Error(parsed.problems.map(problemLine).join("\n"));
    if (parsed.objects.length === 0) throw new Error(`${basename(path)} holds no fx objects`);

    const destination = join(fxHome(), basename(path));
    const elsewhere = loadEntries().entries.filter((e) => e.file !== destination);
    for (const object of parsed.objects) {
        const clash = elsewhere.find((e) => key(e.object) === key(object));
        if (clash) throw new Error(`${key(object)} is already defined in ${basename(clash.file)}`);
    }
    if (resolve(path) !== destination) writeFileSync(destination, text);
    return parsed.objects;
}

/** Remove one object from whichever file holds it; a file left empty goes too. */
export function deleteObject(kind: Kind, name: string): boolean {
    for (const file of registryFiles()) {
        const docs = parseAllDocuments(readFileSync(file, "utf8"));
        const kept = docs.filter((doc) => {
            const value = doc.toJS() as { kind?: string; metadata?: { name?: string } } | null;
            return !(value?.kind === kind && value.metadata?.name === name);
        });
        if (kept.length === docs.length) continue;
        if (kept.length === 0) unlinkSync(file);
        else writeFileSync(file, kept.map((doc) => doc.toString()).join("---\n"));
        return true;
    }
    return false;
}
