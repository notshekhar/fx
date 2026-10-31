/**
 * A fake kubectl on PATH prints the argv it was given, so these check what
 * fx would really run — the registered context first, always.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ObjectOf } from "../src/registry/kinds";
import { createKubernetesTool, refusedKubectlArgs } from "../src/tools/kubernetes";
import { call, useFxHome } from "./helpers";

const fxHome = useFxHome();
const savedPath = process.env.PATH;

const cluster = (namespaces?: string[]): ObjectOf<"Kubernetes"> => ({
    apiVersion: "fx/v1",
    kind: "Kubernetes",
    metadata: { name: "prod" },
    spec: { context: "prod-eu", ...(namespaces && { namespaces }) },
});

beforeAll(() => {
    const bin = join(fxHome(), "..", "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "kubectl"), '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    chmodSync(join(bin, "kubectl"), 0o755);
    process.env.PATH = `${bin}:${savedPath}`;
});

afterAll(() => {
    process.env.PATH = savedPath;
});

describe("kubernetes tool", () => {
    test("runs the verb against the registered context", async () => {
        const out = await call(createKubernetesTool([cluster()]), {
            cluster: "prod",
            verb: "get",
            args: ["pods"],
            namespace: "api",
        });
        expect(out.trim().split("\n")).toEqual(["--context", "prod-eu", "--namespace", "api", "get", "pods"]);
    });

    test("verbs that change a cluster are not on the list", async () => {
        await expect(
            call(createKubernetesTool([cluster()]), { cluster: "prod", verb: "delete", args: ["pod", "x"] }),
        ).rejects.toThrow();
    });

    test("namespaces are limited when the object limits them", async () => {
        const tool = createKubernetesTool([cluster(["api"])]);
        await expect(call(tool, { cluster: "prod", verb: "get", args: ["pods"] })).rejects.toThrow(
            "limited to namespaces api",
        );
        await expect(
            call(tool, { cluster: "prod", verb: "get", args: ["pods"], namespace: "kube-system" }),
        ).rejects.toThrow("kube-system is not one of api");
    });

    test.each([
        [["--context=other"], "away from the registered context"],
        [["--kubeconfig", "/tmp/k"], "away from the registered context"],
        [["--as=admin"], "away from the registered context"],
        [["-f"], "never return"],
        [["--watch"], "never return"],
        [["-A"], "namespace field"],
        [["--namespace=x"], "namespace field"],
    ])("refuses %p", (args, reason) => {
        expect(refusedKubectlArgs(args)).toContain(reason);
    });

    test("a bounded logs call passes through", () => {
        expect(refusedKubectlArgs(["deploy/api", "--tail=200", "--since=1h"])).toBeUndefined();
    });
});
