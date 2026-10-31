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

export interface Registry {
    objects: FxObject[];
    /** One line per document that could not be used, naming its file. */
    problems: string[];
}

interface Parsed {
    objects: FxObject[];
    problems: string[];
}

export function parseObjects(text: string, source: string): Parsed {
    const parsed: Parsed = { objects: [], problems: [] };
    parseAllDocuments(text).forEach((doc, index) => {
        const where = `${source} (document ${index + 1})`;
        if (doc.errors.length > 0) {
            parsed.problems.push(`${where}: ${doc.errors[0]!.message}`);
            return;
        }
        const value = doc.toJS();
        if (value === null || value === undefined) return;
        const instead = DROVER_ONLY_KINDS[(value as { kind?: string }).kind ?? ""];
        if (instead) {
            parsed.problems.push(`${where}: ${value.kind} is drover's; ${instead}`);
            return;
        }
        const result = fxObject.safeParse(value);
        if (result.success) parsed.objects.push(result.data);
        else parsed.problems.push(`${where}: ${describeIssue(result.error.issues[0])}`);
    });
    return parsed;
}

function describeIssue(issue: { path: PropertyKey[]; message: string } | undefined): string {
    if (!issue) return "invalid";
    return issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message;
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
function loadEntries(): { entries: Entry[]; problems: string[] } {
    const entries: Entry[] = [];
    const problems: string[] = [];
    for (const file of registryFiles()) {
        const parsed = parseObjects(readFileSync(file, "utf8"), basename(file));
        problems.push(...parsed.problems);
        for (const object of parsed.objects) {
            const first = entries.find((e) => key(e.object) === key(object));
            if (first)
                problems.push(
                    `${basename(file)}: ${key(object)} is already defined in ${basename(first.file)}; ignored`,
                );
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
    if (parsed.problems.length > 0) throw new Error(parsed.problems.join("\n"));
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
