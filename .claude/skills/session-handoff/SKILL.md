---
name: session-handoff
description: Use when a session is ending, before /compact, after a milestone (PR merged, deploy verified, change archived), when a hook reports HANDOFF.md is stale, or when the user asks to write, update, or overwrite HANDOFF.md so a follow-up session has context.
---

# Session Handoff

## Overview

`HANDOFF.md` at the repo root is the checkpoint a fresh session reads first. In this repo it
is **tracked and committed on the working branch**: sessions run in Claude Code cloud
containers that are discarded afterwards, so a local-only file would never reach the next
session. The branch is the only thing that survives.

Two repo-local hooks, registered in `.claude/settings.json`, make it automatic:

- `.claude/hooks/handoff-load.sh` (SessionStart) injects `HANDOFF.md` into context on
  startup, resume, clear, compact and fork, and reports whether it is stale.
- `.claude/hooks/handoff-stale.sh` (UserPromptSubmit) reminds once an hour when commits
  have landed after the commit that last touched `HANDOFF.md`.

Staleness is counted in commits, never file mtime: a fresh clone gives every file the clone
time. The file holds only what the repo, git history, and the project's instruction files
cannot tell a reader who has no chat history.

Write it at every milestone, not only at the end. A crash, compaction, or reclaimed
container loses everything since the last write.

## Steps

1. **Locate.** `top=$(git rev-parse --show-toplevel)`; the file is `$top/HANDOFF.md`.
2. **Make sure it can be committed.** An older version of this workflow excluded it locally;
   undo that if present, or `git add` will refuse the file.
   ```bash
   git check-ignore -q HANDOFF.md && sed -i '/^HANDOFF\.md$/d' .git/info/exclude
   ```
3. **Gather facts fresh; do not recall them.** `git log --oneline -5`, `git status --short`,
   `git worktree list`, `gh pr list --author @me --state open` (when `gh` exists), plus any
   environment state you verified this session. In a cloud session note the branch name the
   harness assigned (`git branch --show-current`); the next session is told the same branch.
4. **Overwrite the whole file** with the template below. Never append. Stale text is deleted,
   not marked stale.
5. **Verify.** The file is under about 150 lines; every item under **Next** names a command
   or file a stranger could act on; it contains no secret values.
6. **Commit and push it on the working branch**, on its own or with the milestone commit:
   ```bash
   git add HANDOFF.md && git commit -m "handoff: <one-line session name>" && git push -u origin "$(git branch --show-current)"
   ```
   An unpushed handoff is lost with the container. It is fine for the file to ride along in
   the pull request; it documents the work for the reviewer too.

## Template

```markdown
# HANDOFF — <repo> (written YYYY-MM-DD HH:MM, <one-line session name>)

Committed checkpoint for the next session. Read the project's instruction files first; this file holds only what the repo and git history cannot tell you.

## Where things are
- `main` = <sha> (<PR # / subject>). Working branch = <name>. Open PRs, branches, worktrees, open spec changes.
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
- Never a secret value, token, or password. Paths to them are fine. The file is committed
  and will be visible to anyone who can read the repository.

## Common mistakes

| Mistake | Fix |
|---|---|
| Append a dated section under the old one | Overwrite; one current file |
| Write the file but leave it uncommitted or unpushed | Step 6; a cloud container is discarded with the file in it |
| `git add` refuses the file as ignored | Step 2 removes the old `.git/info/exclude` entry |
| Drop the "dropped / do not do" items from the old file | Carry them into **Decisions and non-goals** |
| "Next: discuss with the user" | Name the command or file and the check that proves it done |
| Write it only when asked at session end | Write it after each merge, deploy, or archive, and before `/compact` |
