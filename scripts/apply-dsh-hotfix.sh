#!/usr/bin/env bash
# Apply or revert the DSH ResolutionRouter hotfix (dsh-app-boot routeScoped resolve.paths fix).
# Thin wrapper: all logic lives in scripts/hotfix-core.mjs (cross-platform, testable).
# Usage: bash scripts/apply-dsh-hotfix.sh [--dsh-root <dir>] [--patch-file <file>] [--force] [--revert] [--dry-run]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE="$SCRIPT_DIR/hotfix-core.mjs"

if [[ ! -f "$CORE" ]]; then
	echo "hotfix-core.mjs not found next to this script ($SCRIPT_DIR)." >&2
	exit 1
fi

if ! command -v node >/dev/null 2>&1; then
	echo "node is required but was not found on PATH." >&2
	exit 1
fi

exec node "$CORE" "$@"
