/**
 * A document fx could not use, kept structured so a view can group them —
 * seventy documents failing the same way are one finding, not seventy — and
 * worded for the person fixing the file rather than echoed from the validator.
 */
export interface Problem {
    file: string;
    /** 1-based position in the file; absent for a problem with the file as a whole. */
    document?: number;
    /** The document's metadata.name, when it had one. */
    name?: string;
    message: string;
}

/** One line, for the places that list problems one by one. */
export function problemLine(problem: Problem): string {
    const where = [problem.document && `document ${problem.document}`, problem.name].filter(Boolean).join(", ");
    return `${problem.file}${where ? ` (${where})` : ""}: ${problem.message}`;
}

interface Issue {
    path: PropertyKey[];
    message: string;
}

const NOUNS: Record<string, string> = {
    record: "a map (name: value)",
    object: "a map",
    array: "a list",
    string: "text",
    number: "a number",
    boolean: "true or false",
};

const noun = (type: string) => NOUNS[type] ?? type;

/** `spec.headers` → `headers`, `metadata.name` → `name`: the field as the person wrote it. */
function fieldOf(path: PropertyKey[]): string {
    const parts = path.map(String);
    if (parts[0] === "spec" || parts[0] === "metadata") parts.shift();
    return parts.join(".") || "document";
}

/** The validator's wording, rewritten into what to change. Custom messages (fx's own rules) pass through. */
export function describeIssue(issue: Issue | undefined): string {
    if (!issue) return "invalid";
    const field = fieldOf(issue.path);
    const type = /^Invalid input: expected (\w+), received (\w+)$/.exec(issue.message);
    if (type) {
        const [, expected, received] = type;
        if (received === "undefined") return `${field} is missing`;
        return `${field} should be ${noun(expected!)}, not ${noun(received!)}`;
    }
    const option = /^Invalid (?:input|option): expected (?:one of )?(.+)$/.exec(issue.message);
    if (option) return `${field} must be ${option[1]!.replaceAll('"', "").split("|").join(" or ")}`;
    return `${field}: ${issue.message}`;
}
