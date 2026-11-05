#!/usr/bin/env bash
#
# Purpose: Dev server with COOP/COEP headers for SharedArrayBuffer (default)
#
# Serves with COOP/COEP headers so AudioBackend can use the SAB ring buffer.
# Multi-tab safe (no live-reload WebSocket).

set -Eeuo pipefail

source "$(dirname "$0")/run.sh"

if [[ -f /etc/NIXOS ]] || [[ -d /run/current-system/sw ]]; then
	if ! command -v esbuild &>/dev/null; then
		ESBUILD="nix run nixpkgs#esbuild --"
	else
		ESBUILD="esbuild"
	fi
else
	ESBUILD="$RUNX esbuild"
fi

PORT="${PORT:-4000}"

if holder=$(ss -ltnpH "sport = :$PORT" 2>/dev/null | head -n1) && [ -n "$holder" ]; then
	echo "Port $PORT is already in use, a previous dev stack is likely still running:" >&2
	echo "  $holder" >&2
	echo "Stop it first (pkill -f 'concurrently.*dev-server-sab') or set PORT=<other>." >&2
	exit 1
fi

# Children (esbuild watchers, server) must not outlive this script.
trap 'trap - EXIT TERM INT HUP; kill 0 2>/dev/null || true' EXIT TERM INT HUP

bash "$(dirname "$0")/build-wasm.sh"

open_browser_path=/index_debug.html
for arg in "$@"; do
	case "$arg" in
	'--headless') open_browser_path=false ;;
	esac
done

echo "Starting SAB-enabled dev server on http://localhost:$PORT"
echo "(COOP/COEP headers set for SharedArrayBuffer, no live-reload)"
echo "Multi-tab safe."

(
	sleep 1 && [ "$open_browser_path" != false ] && (
		command -v xdg-open &>/dev/null && xdg-open "http://localhost:$PORT$open_browser_path" 2>/dev/null
	) || true
) &

$RUNX concurrently --kill-others \
	"$ESBUILD --format=iife --keep-names --global-name=beepbox --bundle ./synth/synth.ts --outfile=website/beepbox_synth.js --sourcemap --watch" \
	"$ESBUILD --format=iife --keep-names --global-name=beepbox --bundle ./player/main.ts --outfile=website/player/beepbox_player.js --sourcemap --watch --define:OFFLINE=false" \
	"$ESBUILD --format=iife --keep-names --global-name=beepbox --bundle ./editor/main.ts --outfile=website/beepbox_editor.js --sourcemap --watch --define:GIT_HASH='\"$(git rev-parse --short HEAD 2>/dev/null || echo unknown)\"' --define:GIT_BRANCH='\"$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)\"' --define:BUILD_DATE='\"$(date +%Y%m%d)\"'" \
	"$ESBUILD --bundle ./synth/render/worklet.ts --outfile=website/beepbox_synth_worklet.js --sourcemap --watch" \
	"bun $(dirname "$0")/dev-server-sab.ts $PORT"
