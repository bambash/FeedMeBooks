#!/usr/bin/env bash
# UserPromptSubmit hook: remind (at most once an hour) when commits have landed
# after HANDOFF.md was last written, so the checkpoint gets refreshed.
#
# Staleness is measured in commits, not file mtime: in a cloud session the repo
# is a fresh clone, so every file's mtime is the clone time. HANDOFF.md is
# tracked in this repo, so "last written" = the last commit that touched it.
#
#   --force   skip the once-an-hour throttle (used by handoff-load.sh)
set -uo pipefail

force=0
[ "${1:-}" = "--force" ] && force=1

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$root" || exit 0
handoff="HANDOFF.md"
[ -f "$handoff" ] || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# Uncommitted edits to HANDOFF.md mean it is being refreshed right now.
if ! git diff --quiet -- "$handoff" 2>/dev/null; then
  exit 0
fi

if git ls-files --error-unmatch -- "$handoff" >/dev/null 2>&1; then
  last_handoff_commit="$(git log -1 --format=%H -- "$handoff" 2>/dev/null || true)"
else
  last_handoff_commit=""
fi

if [ -z "$last_handoff_commit" ]; then
  # Untracked (local-only) file: fall back to mtime vs HEAD commit time.
  head_time="$(git log -1 --format=%ct HEAD 2>/dev/null || echo 0)"
  file_time="$(stat -c %Y "$handoff" 2>/dev/null || stat -f %m "$handoff" 2>/dev/null || echo 0)"
  [ "$head_time" -gt "$file_time" ] || exit 0
  behind="$(git log --oneline --since="@$file_time" HEAD 2>/dev/null | wc -l | tr -d ' ')"
else
  behind="$(git rev-list --count "$last_handoff_commit"..HEAD 2>/dev/null || echo 0)"
  [ "${behind:-0}" -gt 0 ] || exit 0
fi

# Throttle: once per hour, keyed on a stamp in the git dir (never committed).
if [ "$force" -eq 0 ]; then
  stamp="$(git rev-parse --git-dir)/handoff-stale.stamp"
  if [ -f "$stamp" ] && [ -n "$(find "$stamp" -mmin -60 2>/dev/null)" ]; then
    exit 0
  fi
  touch "$stamp"
fi

echo "HANDOFF.md is stale: $behind commit(s) have landed since it was last written. Refresh it with the session-handoff skill at the next milestone and commit it."
exit 0
