---
name: pr-review
description: Review a pull request in a registered repository for correctness, risk and missing tests. Use with a repository name and PR number.
---

# Pull request review

1. **Fetch it.** `pull_request` with the repository and number. It returns the
   base, the commits and the changed files.
2. **Understand the intent.** Read the commit messages. If the intent is still
   unclear, say so — a review against a guessed intent is worth little.
3. **Read the change in context.** `git diff <base>...refs/fx/pr/<n>` for the
   change, then `read` the surrounding code in the clone, at the PR's version
   where it matters (`git show refs/fx/pr/<n>:<path>`). Follow callers and
   callees of anything whose behaviour changed.
4. **Look for real problems**, in this order:
    - correctness: wrong conditions, unhandled errors, off-by-one, races, nil
      or empty cases, broken invariants;
    - compatibility: changed API shapes, migrations, config, defaults;
    - security: input reaching queries, shells or paths; secrets; auth checks;
    - tests: does a test fail without this change and pass with it?
5. **Check it against reality** where you can: the schema in the database,
   the config a cluster actually runs, the error rate the change claims to fix.

Report findings most severe first. Each one: file:line, what goes wrong, the
input or state that triggers it, and a suggested fix. Separate real problems
from style preferences, and say plainly when you found nothing serious.
