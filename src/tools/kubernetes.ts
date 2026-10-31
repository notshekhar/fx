/**
 * kubectl, limited to verbs that only read, on registered contexts only.
 *
 * The verb is chosen from a list rather than parsed out of free text, and the
 * flags that would aim kubectl elsewhere (another context, cluster, user or
 * kubeconfig) or never return (watch, follow) are refused, so the context and
 * namespaces in the Kubernetes object are the ones actually used.
 */
import { tool, type Tool } from "ai";
import { z } from "zod";
import { runOk } from "../process";
import type { ObjectOf } from "../registry/kinds";
import { capped } from "./output";

type Cluster = ObjectOf<"Kubernetes">;

const READ_ONLY_VERBS = ["get", "describe", "logs", "top", "events", "explain", "api-resources", "version"] as const;

const RETARGETING = /^--(context|cluster|user|kubeconfig|server|token|as|as-group|as-uid)(=|$)/;
/** Watching and following never return; -f is also get's "read this local file". */
const UNBOUNDED = /^(-w|--watch|--watch-only|-f|--follow|--filename)(=|$)/;
const NAMESPACE = /^(-n|--namespace|-A|--all-namespaces)(=|$)/;

const KUBECTL_TIMEOUT_MS = 60_000;

/** Why these arguments are refused, or undefined when they are fine. */
export function refusedKubectlArgs(args: readonly string[]): string | undefined {
    const retarget = args.find((a) => RETARGETING.test(a));
    if (retarget) return `${retarget} would point kubectl away from the registered context`;
    const unbounded = args.find((a) => UNBOUNDED.test(a));
    if (unbounded)
        return `${unbounded} is not allowed — watch/follow never return (use logs --tail=200) and -f reads local files`;
    const namespace = args.find((a) => NAMESPACE.test(a));
    if (namespace) return `pass the namespace in the namespace field, not as ${namespace}`;
    return undefined;
}

/** kubectl aimed at the registered kubeconfig and context, before any verb. */
export function kubectlFor(cluster: Cluster): string[] {
    const kubeconfig = cluster.spec.kubeconfig ? ["--kubeconfig", cluster.spec.kubeconfig] : [];
    return ["kubectl", ...kubeconfig, "--context", cluster.spec.context];
}

function namespaceArgs(cluster: Cluster, namespace: string | undefined): string[] {
    const allowed = cluster.spec.namespaces;
    if (!allowed) return namespace ? ["--namespace", namespace] : [];
    if (!namespace)
        throw new Error(`${cluster.metadata.name} is limited to namespaces ${allowed.join(", ")} — pass one`);
    if (!allowed.includes(namespace)) throw new Error(`${namespace} is not one of ${allowed.join(", ")}`);
    return ["--namespace", namespace];
}

function describeClusters(clusters: readonly Cluster[]): string {
    return clusters
        .map(
            (c) =>
                `  - ${c.metadata.name} (context ${c.spec.context}${c.spec.namespaces ? `; namespaces ${c.spec.namespaces.join(", ")}` : ""})`,
        )
        .join("\n");
}

export function createKubernetesTool(clusters: readonly Cluster[], fallbackSignal?: AbortSignal): Tool {
    return tool({
        description: `Run a read-only kubectl command (${READ_ONLY_VERBS.join(", ")}) against a registered cluster. Bound what comes back: logs with --tail or --since, get with a selector.\n\nClusters:\n${describeClusters(clusters)}`,
        inputSchema: z.object({
            cluster: z.string().describe("Registered cluster name"),
            verb: z.enum(READ_ONLY_VERBS),
            args: z.array(z.string()).default([]).describe("Arguments after the verb, one per element"),
            namespace: z.string().optional(),
        }),
        execute: async ({ cluster: name, verb, args, namespace }, options) => {
            const cluster = clusters.find((c) => c.metadata.name === name);
            if (!cluster) throw new Error(`no cluster named ${name}`);
            const refused = refusedKubectlArgs(args);
            if (refused) throw new Error(refused);
            const argv = [...kubectlFor(cluster), ...namespaceArgs(cluster, namespace), verb, ...args];
            return capped(
                await runOk(argv, { timeoutMs: KUBECTL_TIMEOUT_MS, signal: options?.abortSignal ?? fallbackSignal }),
            );
        },
    });
}
