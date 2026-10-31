/** The cheapest call each backend answers, so a probe proves the same API the tool uses works. */
import { getJson, type Source } from "./http";

const PROBE_PATHS: Record<Source["spec"]["type"], string> = {
    loki: "loki/api/v1/labels",
    prometheus: "api/v1/status/buildinfo",
    tempo: "api/search/tags",
    jaeger: "api/services",
};

export async function probeTelemetry(source: Source, signal: AbortSignal): Promise<void> {
    await getJson(source, PROBE_PATHS[source.spec.type], {}, signal);
}
