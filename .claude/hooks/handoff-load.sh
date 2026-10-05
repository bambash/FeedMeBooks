#!/usr/bin/env bash
# SessionStart hook: inject HANDOFF.md into context so a fresh session
# (local or Claude Code cloud) starts with the previous session's checkpoint.
# Anything printed to stdout is added to Claude's context.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
handoff="$root/HANDOFF.md"

if [ ! -f "$handoff" ]; then
  echo "No HANDOFF.md at the repo root. If this continues earlier work, write one with the session-handoff skill at the first milestone."
  exit 0
fi

echo "=== HANDOFF.md (previous session checkpoint; read before acting) ==="
cat "$handoff"
echo "=== end HANDOFF.md ==="

# Report staleness once up front so the session knows whether to trust it.
"$root/.claude/hooks/handoff-stale.sh" --force || true
exit 0
