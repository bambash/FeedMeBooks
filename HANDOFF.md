# HANDOFF — FeedMeBooks (written 2026-10-05 15:21 UTC, make session-handoff hooks work in cloud sessions)

Committed checkpoint for the next session. Read the project's instruction files first; this file holds only what the repo and git history cannot tell you.

## Where things are
- `main` = 389378b ("remove openspec", direct push). Working branch = `ccr-6c1ca138-3eb13s`, not yet a PR. No worktrees, no open spec changes.
- Claude Code cloud sessions clone the repo fresh and discard the container afterwards; nothing under `~/.claude` from the user's laptop exists there.
- Lanes: none.

## What shipped this session
- `.claude/settings.json` now registers only the two handoff hooks, by `$CLAUDE_PROJECT_DIR` path. The user's global `wait-guard.py` PreToolUse hook was dropped from the project file because it is not in the repo.
- `.claude/hooks/handoff-load.sh` and `handoff-stale.sh` live in the repo. Staleness is "commits since the last commit touching HANDOFF.md", with an mtime fallback only when the file is untracked.
- HANDOFF.md is tracked and committed on the working branch; that is the only way it reaches the next cloud session.

## Next (in order)
1. Open a PR from `ccr-6c1ca138-3eb13s` to `main` and merge it, done when a new cloud session's startup context shows the "=== HANDOFF.md" block from `handoff-load.sh`.
2. On the laptop, run `sed -i '/^HANDOFF\.md$/d' .git/info/exclude` in this clone so the now-tracked file is not locally ignored, done when `git check-ignore HANDOFF.md` prints nothing.
3. If the laptop's global `~/.claude/settings.json` also runs `handoff-load.sh`, HANDOFF.md will be injected twice in this repo; drop the global SessionStart entry or guard it with `[ -f "$CLAUDE_PROJECT_DIR/.claude/hooks/handoff-load.sh" ] && exit 0`.

## Decisions and non-goals
- Decided: commit HANDOFF.md instead of git-excluding it, because cloud containers are ephemeral and the branch is the only persistent state.
- Decided: hooks resolve the repo root from `$CLAUDE_PROJECT_DIR` with a `git rev-parse --show-toplevel` fallback, so they also work when run by hand.
- Rejected: keeping absolute `/home/nate/...` hook paths or `$HOME` paths in the project settings, because the scripts are not present in cloud containers.
- Rejected: file-mtime staleness, because a fresh clone stamps every file with the clone time.

## Waiting on the user
- Merge of the PR for `ccr-6c1ca138-3eb13s` (nothing is wired into `main` until then).

## Gotchas learned this session (not in the repo)
- `git fetch origin <a> <b>` fails entirely if either ref is missing → the cloud harness pre-creates a local `origin/<branch>` ref that does not exist on GitHub → fetch refs one at a time.
- The once-an-hour stale reminder is throttled by a stamp file in `.git/`, so a manual test run looks silent on the second call → pass `--force`.
