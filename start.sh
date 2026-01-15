#!/bin/bash
# Enhanced startup script for the Claude Agent project
# Supports: start, restart, stop
# Auto-kills processes on occupied ports

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
BACKEND_PORT=8000
FRONTEND_PORT=3000

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Kill process on a specific port
kill_port() {
    local port=$1
    local pid=$(lsof -ti:$port 2>/dev/null || true)
    if [ -n "$pid" ]; then
        echo -e "${YELLOW}Killing process on port $port (PID: $pid)...${NC}"
        kill -9 $pid 2>/dev/null || true
        sleep 1
    fi
}

# Stop all services
stop_services() {
    echo -e "${BLUE}Stopping services...${NC}"
    kill_port $BACKEND_PORT
    kill_port $FRONTEND_PORT
    # Also kill by process name
    pkill -f "uvicorn main:app" 2>/dev/null || true
    pkill -f "next dev" 2>/dev/null || true
    echo -e "${GREEN}✓ Services stopped${NC}"
}

# Start services
start_services() {
    echo -e "${BLUE}Starting Claude Agent...${NC}"
    
    # Ensure ports are free
    kill_port $BACKEND_PORT
    kill_port $FRONTEND_PORT
    
    # Start backend
    echo -e "${GREEN}Starting Backend (FastAPI on port $BACKEND_PORT)...${NC}"
    cd "$BACKEND_DIR"
    .venv/bin/python main.py > /tmp/stockagent_backend.log 2>&1 &
    BACKEND_PID=$!
    
    # Wait for backend to start
    sleep 2
    
    # Start frontend
    echo -e "${GREEN}Starting Frontend (Next.js on port $FRONTEND_PORT)...${NC}"
    cd "$FRONTEND_DIR"
    npm run dev > /tmp/stockagent_frontend.log 2>&1 &
    FRONTEND_PID=$!
    
    echo -e "\n${GREEN}✓ Both servers are running!${NC}"
    echo -e "  Backend:  http://localhost:$BACKEND_PORT"
    echo -e "  Frontend: http://localhost:$FRONTEND_PORT"
    echo -e "  API Docs: http://localhost:$BACKEND_PORT/docs"
    echo -e "  Logs:     /tmp/stockagent_backend.log, /tmp/stockagent_frontend.log"
}

# Function to cleanup on exit (for foreground mode)
cleanup() {
    echo -e "\n${BLUE}Shutting down servers...${NC}"
    stop_services
    exit 0
}

# Main
case "${1:-start}" in
    start)
        start_services
        if [ "${2:-}" = "-f" ] || [ "${2:-}" = "--foreground" ]; then
            trap cleanup SIGINT SIGTERM
            echo -e "\nPress Ctrl+C to stop both servers.\n"
            wait
        fi
        ;;
    stop)
        stop_services
        ;;
    restart)
        stop_services
        sleep 1
        start_services
        ;;
    *)
        echo "Usage: $0 {start|stop|restart} [-f|--foreground]"
        echo "  start   - Start services (background by default)"
        echo "  stop    - Stop all services"
        echo "  restart - Stop then start services"
        echo "  -f      - Run in foreground (Ctrl+C to stop)"
        exit 1
        ;;
esac
