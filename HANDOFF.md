# HANDOFF — FeedMeBooks (written 2026-10-06 02:12 UTC, verify handoff hooks on main; no feature work)

Committed checkpoint for the next session. Read the project's instruction files first; this file holds only what the repo and git history cannot tell you.

## Where things are
- `main` = 0092c02 (PR #30, "make session-handoff hooks work in cloud sessions"). Working branch = `ccr-b0fac2fa-o3j2ps`, identical to `main` apart from this file. No open PRs, no worktrees, no open spec changes.
- Cloud sessions clone the repo fresh and discard the container afterwards; nothing under `~/.claude` from the user's laptop exists there. Only what is pushed survives.
- Lanes: none.

## What shipped this session
- Nothing new. Verified PR #30 is merged and working: this session's startup context contained the "=== HANDOFF.md" block injected by `.claude/hooks/handoff-load.sh`, and `handoff-stale.sh` reported the one post-write commit (the PR #30 merge) on the first prompt.

## Next (in order)
1. Laptop only: in the local clone run `sed -i '/^HANDOFF\.md$/d' .git/info/exclude`, done when `git check-ignore HANDOFF.md` prints nothing (the file is now tracked; the cloud clone is already clean).
2. Laptop only: if the global `~/.claude/settings.json` also runs a `handoff-load.sh` SessionStart hook, drop that entry or guard it with `[ -f "$CLAUDE_PROJECT_DIR/.claude/hooks/handoff-load.sh" ] && exit 0`, done when a fresh laptop session shows the HANDOFF block exactly once.
3. Pick up the next feature from `openspec/` or the user's request; there is no queued work in the repo.

## Decisions and non-goals
- Decided: commit HANDOFF.md instead of git-excluding it, because cloud containers are ephemeral and the branch is the only persistent state.
- Decided: hooks resolve the repo root from `$CLAUDE_PROJECT_DIR` with a `git rev-parse --show-toplevel` fallback, so they also work when run by hand.
- Decided: staleness is counted in commits since the last commit touching HANDOFF.md, with an mtime fallback only when the file is untracked.
- Rejected: absolute `/home/nate/...` or `$HOME` hook paths in project settings, because the scripts are not present in cloud containers.
- Rejected: file-mtime staleness, because a fresh clone stamps every file with the clone time.
- Rejected: the user's global `wait-guard.py` PreToolUse hook in the project settings file, because it is not in the repo.

## Waiting on the user
- Nothing. Steps 1 and 2 under Next can only be done on the laptop.

## Gotchas learned (not in the repo)
- `git fetch origin <a> <b>` fails entirely if either ref is missing → the cloud harness pre-creates a local `origin/<branch>` ref that does not exist on GitHub → fetch refs one at a time.
- The local `origin/main` ref in a fresh cloud clone can lag GitHub (here it pointed at PR #28 while GitHub was at PR #30) → run `git fetch origin main` before trusting it.
- The once-an-hour stale reminder is throttled by a stamp file in `.git/`, so a manual test run looks silent on the second call → pass `--force`.
