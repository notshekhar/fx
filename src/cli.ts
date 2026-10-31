/** fx's command line: the chat by default, plus drover-style registry commands. */
import { rmSync } from "node:fs";
import pkg from "../package.json" with { type: "json" };
import { ensurePromptFile } from "./commands";
import { syncDatasources } from "./datasources";
import { fxHome } from "./home";
import { applyFile, deleteObject, loadRegistry } from "./registry/store";
import { repoDir } from "./repos";
import { checkAll } from "./health";
import { formatHealth, formatRegistry, parseKind, syncRepositories } from "./sources";
import { startFx } from "./start";
import { startAutoSync, syncTracked } from "./sync";
import { runUpgrade } from "./upgrade";

const HELP = `fx ${pkg.version} — a read-only debugging agent over what you register with it

usage:
  fx                         chat (--model <provider/model>, --session <id>)
  fx apply -f <file.yaml>    register what the file describes (copied into ~/.fx)
  fx get [kind]              list what is registered
  fx delete <kind> <name>    unregister one thing
  fx status [kind]           check that each source works now (exits 1 if one fails)
  fx sync [repository]       clone or update repositories
  fx prompt                  edit the system prompt in $EDITOR
  fx upgrade                 install the newest release (--check, --to <version>, --force)
  fx version

kinds: repository, database, kubernetes, telemetry, mcpserver, environment, httprequest
logins, providers and models are loop's: /login inside fx, or \`loop login\`.`;

interface Args {
    command?: string;
    positional: string[];
    flags: Record<string, string>;
}

const VALUE_FLAGS: Record<string, string> = {
    "-f": "file",
    "--file": "file",
    "--model": "model",
    "--session": "session",
    "--to": "to",
};

const SWITCHES: Record<string, string> = {
    "--check": "check",
    "--force": "force",
};

export function parseArgs(argv: readonly string[]): Args {
    const args: Args = { positional: [], flags: {} };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        const flag = VALUE_FLAGS[arg];
        if (flag) {
            const value = argv[++i];
            if (value === undefined) throw new Error(`${arg} needs a value`);
            args.flags[flag] = value;
        } else if (SWITCHES[arg]) args.flags[SWITCHES[arg]] = "true";
        else if (arg === "--help" || arg === "-h") args.command = "help";
        else if (arg === "--version" || arg === "-v") args.command = "version";
        else if (arg.startsWith("-")) throw new Error(`unknown flag ${arg}`);
        else if (args.command === undefined) args.command = arg;
        else args.positional.push(arg);
    }
    return args;
}

async function apply(file: string | undefined): Promise<void> {
    if (!file) throw new Error("apply needs -f <file.yaml>");
    const applied = applyFile(file);
    syncDatasources(loadRegistry());
    for (const object of applied) {
        console.log(`${object.kind.toLowerCase()}/${object.metadata.name} applied`);
        if (object.kind === "Repository") console.log(`  cloned at ${await syncTracked(object)}`);
    }
}

function remove(kindWord: string | undefined, name: string | undefined): void {
    if (!kindWord || !name) throw new Error("usage: fx delete <kind> <name>");
    const kind = parseKind(kindWord);
    if (!deleteObject(kind, name)) throw new Error(`no ${kind} named ${name}`);
    if (kind === "Repository") rmSync(repoDir(name), { recursive: true, force: true });
    syncDatasources(loadRegistry());
    console.log(`${kind.toLowerCase()}/${name} deleted`);
}

async function editPrompt(): Promise<void> {
    const file = ensurePromptFile();
    const editor = process.env.VISUAL || process.env.EDITOR;
    if (!editor) {
        console.log(`edit ${file} — set $EDITOR to have fx open it`);
        return;
    }
    await Bun.spawn([...editor.split(" "), file], { stdio: ["inherit", "inherit", "inherit"] }).exited;
}

async function status(kindWord: string | undefined): Promise<void> {
    const registry = loadRegistry();
    const results = await checkAll(registry, kindWord ? parseKind(kindWord) : undefined);
    console.log(formatHealth(results, registry.problems));
    // Exited outright: loop's database test leaves its own timeout running,
    // and the exit code is what makes `fx status` usable from a script.
    process.exit(results.some((r) => r.state === "failing") || registry.problems.length ? 1 : 0);
}

/**
 * Printed before the chat opens, where it stays visible above it: a document
 * fx skipped would otherwise only show up as a repository that never syncs.
 */
function reportProblems(problems: readonly string[]): void {
    if (problems.length === 0) return;
    console.error(`fx skipped ${problems.length} thing(s) in ${fxHome()}:`);
    for (const problem of problems) console.error(`  ! ${problem}`);
    console.error("  fix the file and fx picks it up on your next message; `/status` shows what works\n");
}

async function chat(args: Args): Promise<void> {
    const { runInteractive } = await import("@notshekhar/loop/interactive");
    reportProblems(loadRegistry().problems);
    startAutoSync();
    await runInteractive({ cwd: fxHome(), modelId: args.flags.model, sessionId: args.flags.session });
}

export async function main(argv: readonly string[]): Promise<void> {
    const args = parseArgs(argv);
    if (args.command === "help") return console.log(HELP);
    if (args.command === "version") return console.log(pkg.version);
    if (args.command === "upgrade") {
        const { check, force, to } = args.flags;
        return runUpgrade({ check: check === "true", force: force === "true", to }, (line) => console.log(line));
    }

    startFx();
    switch (args.command) {
        case undefined:
            return chat(args);
        case "apply":
            return apply(args.flags.file);
        case "get":
            return console.log(
                formatRegistry(loadRegistry(), args.positional[0] ? parseKind(args.positional[0]) : undefined),
            );
        case "delete":
            return remove(args.positional[0], args.positional[1]);
        case "status":
            return status(args.positional[0]);
        case "sync":
            return syncRepositories(args.positional[0], (line) => console.log(line));
        case "prompt":
            return editPrompt();
        default:
            throw new Error(`unknown command ${args.command} — run fx help`);
    }
}
