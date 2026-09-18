#!/usr/bin/env bash
# Enable the repo's versioned git hooks for this clone. Safe to re-run.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
chmod +x .githooks/* scripts/push-guard.py
git config core.hooksPath .githooks
echo "hooks enabled: core.hooksPath=.githooks (pre-push guard active)"
echo "private terms are read from \${ARYNWOOD_PRIVATE_DIR:-~/GitHub/arynwood-private}; missing => pushes are refused."
