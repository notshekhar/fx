/**
 * Run a program with an argument list — never through a shell, so nothing the
 * model passes can become a second command — and bound how long it may take.
 */
export interface RunResult {
    code: number;
    stdout: string;
    stderr: string;
}

export interface RunOptions {
    cwd?: string;
    env?: Record<string, string | undefined>;
    timeoutMs: number;
    signal?: AbortSignal;
}

export async function run(argv: string[], opts: RunOptions): Promise<RunResult> {
    if (!Bun.which(argv[0]!)) throw new Error(`${argv[0]} is not installed or not on PATH`);
    const proc = Bun.spawn(argv, {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: opts.timeoutMs,
        signal: opts.signal,
    });
    const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    if (proc.signalCode) {
        throw new Error(`${argv[0]} stopped (${proc.signalCode}) after ${opts.timeoutMs / 1000}s or on abort`);
    }
    return { code, stdout, stderr };
}

/** run, failing with the program's own error text when it exits non-zero. */
export async function runOk(argv: string[], opts: RunOptions): Promise<string> {
    const result = await run(argv, opts);
    if (result.code !== 0) throw new Error(result.stderr.trim() || `${argv[0]} exited with ${result.code}`);
    return result.stdout;
}
