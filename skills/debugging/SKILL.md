---
name: debugging
description: Find the root cause of a bug, an error or an incident from its symptom, using code, history, data, cluster state and telemetry.
---

# Debugging

Work from the symptom to the cause, and prove each step.

1. **Pin the symptom.** Restate it exactly: the error text, the endpoint, the
   time window, who sees it. If any of that is missing and it changes where
   you look, ask once.
2. **Find where it happens.** grep the registered repositories for the error
   text, log message or route. Read the code around it until you know what
   inputs produce that output.
3. **Look at it happening.** Check telemetry for the window: error logs, the
   failing traces, the metric that moved. On a cluster: `get` the pods,
   `describe` the one that is unhealthy, read its events and `logs --tail`.
4. **Check the data.** If the code path depends on rows, query them with a
   LIMIT. Compare a failing case with a working one.
5. **Find what changed.** `git log` on the files involved over the window,
   `git log -S` for the symbol, `blame` the suspicious line, then `show` the
   commit and, if there is one, its pull request.
6. **Explain the cause.** One causal chain from trigger to symptom, each link
   backed by something you read: file:line, commit, query result, log line,
   trace id.

Report: the cause in one or two sentences, the evidence, what you could not
verify, and the smallest fix you would suggest. You do not apply fixes.
