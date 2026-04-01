#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
RESET='\033[0m'

BACKEND_PID=""
FRONTEND_PID=""
SHUTTING_DOWN=false

cleanup() {
    $SHUTTING_DOWN && return
    SHUTTING_DOWN=true
    echo ""
    echo -e "${YELLOW}${BOLD}Shutting down...${RESET}"
    [[ -n "$FRONTEND_PID" ]] && kill "$FRONTEND_PID" 2>/dev/null
    [[ -n "$BACKEND_PID" ]] && kill "$BACKEND_PID" 2>/dev/null
    wait 2>/dev/null
    echo -e "${GREEN}${BOLD}Stopped.${RESET}"
}
trap 'cleanup; exit 0' INT TERM
trap cleanup EXIT

# --- Backend ---
PORT="${AGENTCANVAS_PORT:-8325}"
echo -e "${BLUE}${BOLD}[backend]${RESET}  Starting on :${PORT}..."
cd "$SCRIPT_DIR"
python -m uvicorn backend.main:app --host 127.0.0.1 --port "$PORT" --reload \
    --reload-dir "$SCRIPT_DIR/backend" 2>&1 | while IFS= read -r line; do
    printf "${BLUE}${BOLD}[backend]${RESET}  %s\n" "$line"
done &
BACKEND_PID=$!

# Wait for backend
echo -e "${YELLOW}Waiting for backend...${RESET}"
for i in $(seq 1 30); do
    curl -s -o /dev/null "http://127.0.0.1:${PORT}/api/health" 2>/dev/null && break
    sleep 1
done

# --- Frontend ---
echo -e "${GREEN}${BOLD}[frontend]${RESET} Starting on :5173..."
cd "$SCRIPT_DIR/frontend"
npx vite --host 127.0.0.1 2>&1 | while IFS= read -r line; do
    printf "${GREEN}${BOLD}[frontend]${RESET} %s\n" "$line"
done &
FRONTEND_PID=$!

echo ""
echo -e "${BOLD}Running. Open http://localhost:5173${RESET}"
echo -e "  Backend:  ${BLUE}http://localhost:${PORT}${RESET}"
echo -e "  Frontend: ${GREEN}http://localhost:5173${RESET}"
echo ""

wait
