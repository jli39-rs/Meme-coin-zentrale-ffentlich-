#!/usr/bin/env bash
cd "$(dirname "$0")"
PORT="${PORT:-8080}"
(sleep 1 && (open "http://localhost:$PORT" 2>/dev/null || xdg-open "http://localhost:$PORT" 2>/dev/null)) &
python3 -m http.server "$PORT"
