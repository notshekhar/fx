/**
 * api_list's fuzzy search, drover's rules: every term must hit somewhere in
 * what a request says (AND, so "issues prod" narrows), the name counts most,
 * and an abbreviation works ("lsiss" finds list-issues) as the weakest hit.
 */
export interface Searchable {
    /** Weighted highest, since it is what a caller ultimately passes. */
    name: string;
    /** Every other property: description, method, url, parameters, environments. */
    fields: string[];
}

function isSubsequence(needle: string, haystack: string): boolean {
    let i = 0;
    for (let j = 0; j < haystack.length && i < needle.length; j++) if (haystack[j] === needle[i]) i++;
    return i === needle.length;
}

function termScore(term: string, name: string, haystack: string): number {
    if (name === term) return 1000;
    if (name.startsWith(term)) return 500;
    if (name.includes(term)) return 300;
    if (haystack.includes(term)) return 100;
    return isSubsequence(term, name) ? 50 : 0;
}

/** How well a candidate matches, or undefined when some term hits nothing. */
function score(candidate: Searchable, terms: readonly string[]): number | undefined {
    const name = candidate.name.toLowerCase();
    const haystack = [name, ...candidate.fields].join(" ").toLowerCase();
    let total = 0;
    for (const term of terms) {
        const hit = termScore(term, name, haystack);
        if (hit === 0) return undefined;
        total += hit;
    }
    // A shorter name matching the same terms is the more specific hit.
    return total - name.length;
}

/** Filter and order by a query; an empty query keeps everything in its order. Ties keep the original order. */
export function rank<T>(items: readonly T[], query: string, key: (item: T) => Searchable): T[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [...items];
    return items
        .map((item, order) => ({ item, order, score: score(key(item), terms) }))
        .filter((hit): hit is { item: T; order: number; score: number } => hit.score !== undefined)
        .sort((a, b) => b.score - a.score || a.order - b.order)
        .map((hit) => hit.item);
}
