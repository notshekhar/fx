/** What /status, the skipped-documents block and the banner summary say. Output is plain here: no terminal, no colour. */
import { describe, expect, test } from "bun:test";
import type { Health } from "../src/health";
import type { Problem } from "../src/registry/problems";
import { formatProblems, formatStatus, formatSummary } from "../src/status-view";

const request = (name: string, state: Health["state"] = "ok"): Health => ({
    kind: "HTTPRequest",
    name,
    state,
    detail: state === "ok" ? "GET → prod https://api.test" : "${env:TOKEN} is not set in fx's environment",
});

describe("status view", () => {
    test("a long section shows its working entries as a count and lists only what needs a look", () => {
        const results = [
            ...Array.from({ length: 20 }, (_, i) => request(`get-${i}`)),
            request("get-broken", "failing"),
        ];
        const text = formatStatus(results, []);
        expect(text).toContain("API requests  21\n  ✓ 20 working  /status apis lists each one\n  ✗ get-broken");
        expect(text).not.toContain("get-3");
        expect(formatStatus(results, [], true)).toContain("get-3");
    });

    test("seventy documents failing one way are one line naming a few of them", () => {
        const problems: Problem[] = [
            ...Array.from({ length: 70 }, (_, i) => ({
                file: "apis.yaml",
                document: i + 1,
                name: `req-${i}`,
                message: "headers should be a map (name: value), not a list",
            })),
            { file: "apis.yaml", document: 71, message: "url is missing" },
        ];
        expect(formatProblems(problems)).toEqual([
            "Skipped  71 document(s) fx could not use",
            "  ! apis.yaml  71",
            "      70 × headers should be a map (name: value), not a list",
            "           req-0, req-1, req-2, +67 more",
            "      url is missing",
            "      document 71",
            "  fix the file and fx picks it up on your next message",
        ]);
    });

    test("the banner summary is always three lines: a token per kind, then when it was checked", () => {
        expect(formatSummary(undefined, [], undefined)).toEqual([" sources  checking…", "", ""]);
        const repo: Health = { kind: "Repository", name: "api", state: "ok", detail: "abc" };
        const at = new Date(2026, 9, 31, 14, 5);
        const lines = formatSummary(
            [repo, request("a"), request("b", "failing")],
            [{ file: "x.yaml", message: "bad" }],
            at,
        );
        expect(lines).toHaveLength(3);
        expect(lines[0]).toBe(" sources  ✓ 1 repo  ·  ✗ 1 of 2 APIs failing  ·  ! 1 skipped");
        const clock = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        expect(lines[1]).toContain(`checked ${clock} · /status for details`);
    });
});
