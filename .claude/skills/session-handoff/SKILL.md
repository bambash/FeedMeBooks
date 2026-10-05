---
name: session-handoff
description: Use when a session is ending, before /compact, after a milestone (PR merged, deploy verified, change archived), when a hook reports HANDOFF.md is stale, or when the user asks to write, update, or overwrite HANDOFF.md so a follow-up session has context.
---

# Session Handoff

## Overview

`HANDOFF.md` at the repo root is the local-only checkpoint a fresh session reads first.
A global SessionStart hook (`~/.claude/hooks/handoff-load.sh`) injects it into context, and
a UserPromptSubmit hook (`~/.claude/hooks/handoff-stale.sh`) reminds once an hour when a
commit has landed after it was written. It holds only what the repo, git history, and the
project's instruction files cannot tell a reader who has no chat history.

Write it at every milestone, not only at the end. A crash or compaction loses everything
since the last write.

## Steps

1. **Locate.** `top=$(git rev-parse --show-toplevel)`; the file is `$top/HANDOFF.md`.
2. **Ensure it is ignored, then never stage it.**
   ```bash
   git check-ignore -q HANDOFF.md || echo HANDOFF.md >> .git/info/exclude
   ```
   Use `.git/info/exclude`, not the tracked `.gitignore`, so the tree stays clean.
3. **Gather facts fresh; do not recall them.** `git log --oneline -5`, `git status --short`,
   `git worktree list`, `gh pr list --author @me --state open` (when `gh` exists), plus any
   environment state you verified this session.
4. **Overwrite the whole file** with the template below. Never append. Stale text is deleted,
   not marked stale.
5. **Verify.** `git status --porcelain HANDOFF.md` prints nothing; the file is under about
   150 lines; every item under **Next** names a command or file a stranger could act on.

## Template

```markdown
# HANDOFF — <repo> (written YYYY-MM-DD HH:MM, <one-line session name>)

Local-only. Never commit. Read the project's instruction files first; this file holds only what the repo and git history cannot tell you.

## Where things are
- `main` = <sha> (<PR # / subject>). Open PRs, branches, worktrees, open spec changes.
- <environment> runs <sha>, verified by <check>. Config and credential *locations* (paths only, never values).
- Lanes: one line per running or stopped lane, `#<issue> → <branch> → PR #<n> → <phase> → <blocker>` (the `varroa-lane-brief` status board), or "none".

## What shipped this session
- <PR #> (<sha>): the one non-obvious behavior it introduced. One bullet per PR, deploy, or archive.

## Next (in order)
1. <first command to run or file to open>, done when <acceptance check>.

## Decisions and non-goals
- Decided: <choice> because <reason>.
- Rejected: <option> because <reason>. (Keeps the next session from re-proposing it.)

## Waiting on the user
- <action that needs explicit confirmation: deletes, merges, spend>.

## Gotchas learned this session (not in the repo)
- <symptom> → <cause> → <what worked>. One line each.
```

## Content rules

- A rejected option or a reversed decision stays in the file under **Decisions and non-goals**.
- **Next** items are commands and files with an acceptance check, never "confirm scope with the user".
- Nothing the repo can derive: file layout, function names, what a commit changed.
- Never a secret value, token, or password. Paths to them are fine.

## Common mistakes

| Mistake | Fix |
|---|---|
| Append a dated section under the old one | Overwrite; one current file |
| Notice the file is not ignored and leave it | Step 2 adds it to `.git/info/exclude` |
| Drop the "dropped / do not do" items from the old file | Carry them into **Decisions and non-goals** |
| "Next: discuss with the user" | Name the command or file and the check that proves it done |
| Write it only when asked at session end | Write it after each merge, deploy, or archive, and before `/compact` |
