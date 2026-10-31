# fx

A debugging agent that reads and never writes.

fx answers "why is this broken?" and "how does this actually work?" from the
sources you register with it — repositories, databases, Kubernetes clusters,
logs, metrics and traces — and it cannot change any of them. The one place it
can write is its own scratchpad.

It is [loop](https://github.com/notshekhar/loop) underneath: the same chat,
the same providers and logins, the same models. What is different is what it
can touch.

## What it can do

| tool                                 | what it reaches                                                                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read` `ls` `grep` `find`            | fx's clones of your registered repositories, plain files and plain ripgrep — nothing outside them, symlinks included                                     |
| `git`                                | read-only history in those clones: log, show, diff, blame, …                                                                                             |
| `sync_repo`                          | clone a registered repository, or reset fx's clone to the remote                                                                                         |
| `pull_request`                       | fetch a PR into fx's clone (as `refs/fx/pr/<n>`) and summarise it                                                                                        |
| `sql`                                | read-only queries against registered databases (loop's guard: a statement check, then a rolled-back `READ ONLY` transaction)                             |
| `kubernetes`                         | `get` `describe` `logs` `top` `events` … on registered contexts, limited to their namespaces if you set them                                             |
| `telemetry`                          | Loki (LogQL), Prometheus (PromQL), Tempo (trace ids, TraceQL), Jaeger (trace ids, services)                                                              |
| `api_list` `api_describe` `api_call` | your registered API calls, as in drover: fuzzy-search them, see one in full, call it — GET only; the model fills parameters, never URLs or credentials   |
| `bash`                               | an OS sandbox that writes only to `~/.fx/scratchpad`, has no network, and cannot read your home directory beyond `~/.fx` and the programs on your `PATH` |
| MCP servers                          | remote ones you register, such as CubeAPM                                                                                                                |

There is no edit or write tool, no sub-agents and no agent personas. A tool
appears only when something of its kind is registered.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/notshekhar/fx/main/install.sh | bash
```

That puts one binary in `~/.local/bin` (`FX_INSTALL_DIR` to change it) after
checking its sha256. Pin a release with `| bash -s -- --version v0.1.1`;
remove it with `| bash -s -- --uninstall`, which leaves `~/.fx` alone.

```bash
fx upgrade           # the newest release, in place
fx upgrade --check   # only say whether there is one
fx upgrade --to v0.1.0
```

### From source

fx runs loop from source, as a git submodule, so loop's improvements arrive by
moving the submodule — nothing is copied.

```bash
git clone --recursive https://github.com/notshekhar/fx
cd fx
bun install          # also installs loop's packages from loop's own lockfile
bun run build        # → dist/fx-<os>-<arch>
```

Or run it straight from the checkout with `bun run dev`.

## Sign in

fx shares loop's `~/.loop`: providers, logins, models and settings. If loop is
already signed in, so is fx. Otherwise run `/login` inside fx.

## Register what it may see

Every `*.yaml` in `~/.fx` is read before each message, so saving a file is
enough. `fx apply -f` checks a file and copies it in. drover's files work as
they are — `apiVersion: drover/v1`, its list of headers, `query:` — and
`config.yaml` is left alone as settings, as in drover.

```yaml
apiVersion: fx/v1
kind: Repository
metadata: { name: api }
spec:
    url: https://github.com/acme/api
    branch: main # optional
    refreshInterval: 15m # the default; or never
---
apiVersion: fx/v1
kind: Database
metadata: { name: orders }
spec:
    type: postgres # postgres | mysql | redshift
    host: orders.internal
    port: 5432
    database: orders
    user: readonly
    password: ${env:ORDERS_PASSWORD}
---
apiVersion: fx/v1
kind: Kubernetes
metadata: { name: prod }
spec:
    context: prod-eu # a context in your kubeconfig
    namespaces: [api, workers] # optional: the only namespaces fx may look in
---
apiVersion: fx/v1
kind: Telemetry
metadata: { name: logs }
spec:
    type: loki # loki | prometheus | tempo | jaeger
    url: https://loki.internal
    headers: { Authorization: "Bearer ${env:LOKI_TOKEN}" }
---
apiVersion: fx/v1
kind: McpServer
metadata: { name: cubeapm }
spec:
    url: https://mcp.cubeapm.example/mcp
    auth: oauth # or headers: { ... }
```

API calls are drover-shaped: an `Environment` holds base URLs and secret
references, and an `HTTPRequest` names one call. `{{name}}` comes from the
environment, `${env:NAME}` from your shell, and only `{name}` parameters come
from the model — so it cannot reach a credential by asking for one. Only GET
requests are offered; other methods can be stored but fx never runs them.

```yaml
apiVersion: fx/v1
kind: Environment
metadata: { name: prod }
spec:
    variables: { baseUrl: https://api.acme.com }
    secrets: { token: "${env:ACME_TOKEN}" } # a reference, never the value
---
apiVersion: fx/v1
kind: HTTPRequest
metadata: { name: get-user }
spec:
    description: Fetch one user by id
    url: "{{baseUrl}}/v1/users/{userId}"
    headers: { Authorization: "Bearer {{token}}" }
    environments: [prod]
    pathParams: [{ name: userId, description: "looks like usr_1a2b" }]
    queryParams: [{ name: fields, required: false }]
```

While fx is open it keeps the clones fresh on their own: a missing one is
cloned within seconds of being saved, and each is reset to its remote every
`refreshInterval`.

## Is everything working?

Under the welcome banner, a summary of every source stays current while fx is
open — a saved file or a finished sync shows within seconds, and databases,
clusters, telemetry and MCP servers are re-checked every minute:

```
 sources  ✓ 57 repos  ·  ✗ 1 of 2 databases failing  ·  ✓ 79 APIs  ·  ! 2 skipped
          checked 02:55 PM · /status for details
```

`/status` (or `fx status`) checks everything now and says why anything fails.
A long section shows its working entries as a count — `/status apis` lists
each one — and documents fx could not use are grouped by file and by what is
wrong with them. `fx status` exits 1 when something fails, for scripts.

```bash
fx apply -f sources.yaml   # clones repositories as it goes
fx get                     # what is registered (fx get databases, …)
fx delete database orders
fx sync                    # update every clone
```

MCP servers must be remote: a local one would be a process outside fx's
sandbox. They are connected at start, so a new one applies on the next start.

## Skills

`/debugging` and `/pr-review` ship with fx. Put your own in
`~/.fx/skills/<name>/SKILL.md`; one with the same name replaces the shipped one.
The model loads a skill itself when it fits, or you run it with `/<name>`.

## The prompt

`/prompt` writes fx's prompt to `~/.fx/prompt.md` for you to edit; it applies
from the next message. `/prompt reset` goes back to the built-in one. Either
way, fx appends what is registered so the model knows what exists.

## Where things live

```
~/.loop/            providers, logins, models, settings — shared with loop
~/.fx/
  *.yaml            the registry
  repos/<name>/     fx's clones (mirrors: a sync resets them)
  sync-status.json  when each clone last synced
  scratchpad/       the only place fx writes
  skills/           your skills
  prompt.md         your prompt, if you have one
  agent.db          fx's sessions
  datasources.json  derived from the Database objects
```

## Upgrading loop

```bash
git -C vendor/loop fetch --tags && git -C vendor/loop checkout v0.21.33
bun install && bun run test
```

`bun run test` type-checks fx against the new loop (Bun itself does not
type-check) and runs fx's tests, so a change in loop that fx depends on fails
there rather than at runtime.
