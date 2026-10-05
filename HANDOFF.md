# HANDOFF — FeedMeBooks (written 2026-10-05 22:21 UTC, session-handoff hooks merged to main)

Committed checkpoint for the next session. Read the project's instruction files first; this file holds only what the repo and git history cannot tell you.

## Where things are
- `main` = 0092c02 (PR #30, "make session-handoff hooks work in cloud sessions"). No open PRs, no worktrees, no open spec changes.
- Branch `ccr-6c1ca138-3eb13s` was restarted from that main and carries only this handoff refresh.
- Claude Code cloud sessions clone the repo fresh and discard the container afterwards; nothing under `~/.claude` from the user's laptop exists there. Project hooks in `.claude/settings.json` are what run.
- Lanes: none.

## What shipped this session
- PR #30 (0092c02): HANDOFF.md is tracked and committed; the SessionStart hook injects it and the UserPromptSubmit hook nags once an hour when commits land after it. Confirmed working: the resume hook injected this file inside the cloud session before the merge.

## Next (in order)
1. On the laptop, run `sed -i '/^HANDOFF\.md$/d' .git/info/exclude` in the FeedMeBooks clone, done when `git check-ignore HANDOFF.md` prints nothing.
2. On the laptop, check `~/.claude/settings.json` for a global `handoff-load.sh` SessionStart entry; drop it or guard it with `[ -f "$CLAUDE_PROJECT_DIR/.claude/hooks/handoff-load.sh" ] && exit 0`, done when a local `claude` start shows the HANDOFF block once, not twice.
3. On the laptop, the global `session-handoff` skill still says "never commit"; the project copy in `.claude/skills/session-handoff/SKILL.md` wins in this repo, but align or remove the global one so other repos do not drift, done when the two files agree on step 6.

## Decisions and non-goals
- Decided: commit HANDOFF.md instead of git-excluding it, because cloud containers are ephemeral and the branch is the only persistent state.
- Decided: hooks resolve the repo root from `$CLAUDE_PROJECT_DIR` with a `git rev-parse --show-toplevel` fallback, so they also work when run by hand.
- Decided: `wait-guard.py` stays a laptop-only global; it is not in the repo and would fail on every Bash call in the cloud.
- Rejected: absolute `/home/nate/...` or `$HOME` hook paths in project settings, because the scripts are not present in cloud containers.
- Rejected: file-mtime staleness, because a fresh clone stamps every file with the clone time.

## Waiting on the user
- Nothing.

## Gotchas learned this session (not in the repo)
- `git fetch origin <a> <b>` fails entirely if either ref is missing → the cloud harness pre-creates a local `origin/<branch>` ref that does not exist on GitHub → fetch refs one at a time.
- The once-an-hour stale reminder is throttled by a stamp file in `.git/`, so a manual test run looks silent on the second call → pass `--force`.
- A merged cloud branch must be restarted from main (`git checkout -B <branch> origin/main`) before any follow-up commit; stacking on merged history is not allowed.
