#!/bin/bash
# One-command context inspection: starts proxy, runs claude, renders the capture.
#
# Usage:
#   ./inspect.sh                    # Interactive claude session
#   ./inspect.sh -p "your prompt"   # Pipe mode (minimal context)

set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-9876}"

# Kill any existing proxy on the port
kill $(lsof -ti:"$PORT") 2>/dev/null || true
sleep 0.5

# Clean old captures
rm -f "$DIR/captures"/context-*.json "$DIR/captures"/context-*.html

# Start proxy in background
cd "$DIR" && bun run capture-proxy.ts > /tmp/context-inspector-proxy.log 2>&1 &
PROXY_PID=$!
trap "kill $PROXY_PID 2>/dev/null" EXIT
sleep 1

echo "Proxy running on :$PORT (PID $PROXY_PID)"
echo "Starting Claude Code through proxy..."
echo ""

# Run Claude — pass through all args
CLAUDECODE= ANTHROPIC_BASE_URL="http://localhost:$PORT" claude "$@"

echo ""
echo "Session ended. Rendering captures..."

# Render the most recent capture
cd "$DIR" && bun run view.ts
