#!/usr/bin/env bash
#
# Purpose: Runs typechecks and rejects lint drift against exact warning fingerprints.
#
# This script:
# - Captures all Biome and ESLint diagnostics without hiding warnings
# - Rejects new, moved, changed, or resolved warning fingerprints
# - Rejects forbidden cross-context imports and import-cycle growth
# - Type-checks editor, synth, and player source
# - Updates the reviewed baseline only when UPDATE_LINT_BASELINE=1

set -Eeuo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
cd "$ROOT_DIR"
source "$SCRIPT_DIR/run.sh"

BIOME=$(resolve_tool biome biome)
TSC=$(resolve_tool tsc tsc)
ESLINT=$(resolve_tool eslint eslint)
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT
BIOME_REPORT="$TEMP_DIR/biome.json"
ESLINT_REPORT="$TEMP_DIR/eslint.json"
BASELINE="lint-baseline.json"

run_js_tool() {
	local tool="$1"
	shift
	if [[ $tool == nix\ * ]]; then
		local command="$tool"
		local argument
		for argument in "$@"; do
			printf -v command '%s %q' "$command" "$argument"
		done
		eval "$command"
	else
		"$RUNNER" "$tool" "$@"
	fi
}

run_biome() {
	if echo "$BIOME" | grep -q '^nix '; then
		eval "$BIOME" check . --reporter=json --reporter-file="$BIOME_REPORT" 2>/dev/null
	else
		"$BIOME" check . --reporter=json --reporter-file="$BIOME_REPORT" 2>/dev/null
	fi
}

set +e
run_biome
BIOME_STATUS=$?
run_js_tool "$ESLINT" editor/ synth/ player/ shared/ --format json >"$ESLINT_REPORT"
ESLINT_STATUS=$?
set -e

if ((BIOME_STATUS != 0)); then
	if echo "$BIOME" | grep -q '^nix '; then
		eval "$BIOME" check . --diagnostic-level=error
	else
		"$BIOME" check . --diagnostic-level=error
	fi
	exit "$BIOME_STATUS"
fi
if ((ESLINT_STATUS != 0)); then
	run_js_tool "$ESLINT" editor/ synth/ player/ shared/
	exit "$ESLINT_STATUS"
fi

run_js_tool "$TSC" --noEmit -p tsconfig_editor.json
run_js_tool "$TSC" --noEmit -p tsconfig_synth.json
run_js_tool "$TSC" --noEmit -p tsconfig_player.json

BASELINE_MODE=""
if [[ ${UPDATE_LINT_BASELINE:-0} == 1 ]]; then
	BASELINE_MODE="--write"
fi
"$RUNNER" scripts/check-lint-baseline.mjs "$ESLINT_REPORT" "$BIOME_REPORT" "$BASELINE" "$BASELINE_MODE"
"$RUNNER" scripts/check-import-boundaries.ts
