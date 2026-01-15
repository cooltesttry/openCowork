#!/bin/bash
# Smart Installation Script for Claude Agent Project
# Features: Pre-installation checks, skip if already installed, detailed status output

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
CRAWLER_DIR="$SCRIPT_DIR/simple-crawler"

# Required versions
MIN_PYTHON_VERSION="3.11"
MIN_NODE_VERSION="20"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

# Symbols
CHECK="✓"
CROSS="✗"
ARROW="→"
SKIP="⊘"

echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║      Claude Agent Project - Smart Installation Script      ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

#=============================================================================
# Helper Functions
#=============================================================================

# Compare version strings: returns 0 if $1 >= $2
version_gte() {
    [ "$(printf '%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]
}

# Print status with color
print_status() {
    local status=$1
    local message=$2
    case $status in
        ok)     echo -e "  ${GREEN}${CHECK}${NC} $message" ;;
        skip)   echo -e "  ${YELLOW}${SKIP}${NC} $message ${YELLOW}(skipped)${NC}" ;;
        error)  echo -e "  ${RED}${CROSS}${NC} $message" ;;
        info)   echo -e "  ${BLUE}${ARROW}${NC} $message" ;;
        action) echo -e "  ${CYAN}${ARROW}${NC} $message" ;;
    esac
}

#=============================================================================
# Step 1: Check System Dependencies
#=============================================================================

echo -e "${BLUE}[Step 1/5] Checking System Dependencies${NC}"
echo ""

SYSTEM_OK=true

# Check Python
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
    if version_gte "$PYTHON_VERSION" "$MIN_PYTHON_VERSION"; then
        print_status ok "Python $PYTHON_VERSION (required >= $MIN_PYTHON_VERSION)"
    else
        print_status error "Python $PYTHON_VERSION found, but >= $MIN_PYTHON_VERSION required"
        SYSTEM_OK=false
    fi
else
    print_status error "Python not found. Please install Python >= $MIN_PYTHON_VERSION"
    SYSTEM_OK=false
fi

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_VERSION" -ge "$MIN_NODE_VERSION" ]; then
        print_status ok "Node.js v$(node -v | sed 's/v//') (required >= $MIN_NODE_VERSION)"
    else
        print_status error "Node.js v$NODE_VERSION found, but >= $MIN_NODE_VERSION required"
        SYSTEM_OK=false
    fi
else
    print_status error "Node.js not found. Please install Node.js >= $MIN_NODE_VERSION"
    SYSTEM_OK=false
fi

# Check npm
if command -v npm &> /dev/null; then
    print_status ok "npm $(npm -v)"
else
    print_status error "npm not found"
    SYSTEM_OK=false
fi

# Check Git
if command -v git &> /dev/null; then
    print_status ok "Git $(git --version | awk '{print $3}')"
else
    print_status error "Git not found"
    SYSTEM_OK=false
fi

echo ""

if [ "$SYSTEM_OK" = false ]; then
    echo -e "${RED}System dependencies check failed. Please install missing dependencies:${NC}"
    echo -e "  macOS:   ${CYAN}brew install python@3.11 node git${NC}"
    echo -e "  Ubuntu:  ${CYAN}sudo apt install python3.11 nodejs npm git${NC}"
    exit 1
fi

#=============================================================================
# Step 2: Backend Setup (Python Virtual Environment)
#=============================================================================

echo -e "${BLUE}[Step 2/5] Setting up Backend (Python)${NC}"
echo ""

cd "$BACKEND_DIR"

# Check if venv exists and has correct Python version
VENV_OK=false
if [ -d ".venv" ] && [ -f ".venv/bin/python" ]; then
    VENV_PYTHON_VERSION=$(.venv/bin/python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null || echo "0.0")
    if version_gte "$VENV_PYTHON_VERSION" "$MIN_PYTHON_VERSION"; then
        VENV_OK=true
        print_status skip "Virtual environment exists (Python $VENV_PYTHON_VERSION)"
    else
        print_status info "Virtual environment has old Python ($VENV_PYTHON_VERSION), recreating..."
        rm -rf .venv
    fi
fi

if [ "$VENV_OK" = false ]; then
    print_status action "Creating virtual environment..."
    python3 -m venv .venv
    print_status ok "Virtual environment created"
fi

# Check if dependencies are installed
source .venv/bin/activate

# Use a marker file to track if deps were installed
DEPS_MARKER=".venv/.deps_installed"
REQUIREMENTS_HASH=$(md5 -q requirements.txt 2>/dev/null || md5sum requirements.txt | awk '{print $1}')

if [ -f "$DEPS_MARKER" ] && [ "$(cat "$DEPS_MARKER")" = "$REQUIREMENTS_HASH" ]; then
    print_status skip "Python dependencies already installed"
else
    print_status action "Installing Python dependencies..."
    pip install -q --upgrade pip
    pip install -q -r requirements.txt
    echo "$REQUIREMENTS_HASH" > "$DEPS_MARKER"
    print_status ok "Python dependencies installed"
fi

deactivate
echo ""

#=============================================================================
# Step 3: Frontend Setup (Node.js)
#=============================================================================

echo -e "${BLUE}[Step 3/5] Setting up Frontend (Next.js)${NC}"
echo ""

cd "$FRONTEND_DIR"

# Check if node_modules exists and matches package-lock.json
if [ -d "node_modules" ] && [ -f "node_modules/.package-lock.json" ]; then
    # Compare timestamps
    if [ "package-lock.json" -ot "node_modules/.package-lock.json" ]; then
        print_status skip "Frontend dependencies already installed"
    else
        print_status action "Installing frontend dependencies (package-lock.json updated)..."
        npm install --silent
        print_status ok "Frontend dependencies installed"
    fi
else
    print_status action "Installing frontend dependencies..."
    npm install --silent
    print_status ok "Frontend dependencies installed"
fi

echo ""

#=============================================================================
# Step 4: Simple-Crawler Setup (Node.js + Playwright)
#=============================================================================

echo -e "${BLUE}[Step 4/5] Setting up Simple-Crawler (MCP Server)${NC}"
echo ""

cd "$CRAWLER_DIR"

# Check node_modules
if [ -d "node_modules" ] && [ -f "node_modules/.package-lock.json" ]; then
    if [ "package-lock.json" -ot "node_modules/.package-lock.json" ]; then
        print_status skip "Crawler dependencies already installed"
    else
        print_status action "Installing crawler dependencies (package-lock.json updated)..."
        npm install --silent
        print_status ok "Crawler dependencies installed"
    fi
else
    print_status action "Installing crawler dependencies..."
    npm install --silent
    print_status ok "Crawler dependencies installed"
fi

# Check Playwright browsers
PLAYWRIGHT_BROWSERS_PATH="${HOME}/Library/Caches/ms-playwright"
if [ -d "$PLAYWRIGHT_BROWSERS_PATH" ] && [ -d "$PLAYWRIGHT_BROWSERS_PATH/chromium-"* ] 2>/dev/null; then
    CHROMIUM_VERSION=$(ls -d "$PLAYWRIGHT_BROWSERS_PATH/chromium-"* 2>/dev/null | head -1 | xargs basename)
    print_status skip "Playwright Chromium already installed ($CHROMIUM_VERSION)"
else
    print_status action "Installing Playwright Chromium browser..."
    npx playwright install chromium --quiet
    print_status ok "Playwright Chromium installed"
fi

echo ""

#=============================================================================
# Step 5: Environment Configuration
#=============================================================================

echo -e "${BLUE}[Step 5/5] Checking Environment Configuration${NC}"
echo ""

cd "$SCRIPT_DIR"

# Check for .env file or environment variables
ENV_OK=false
if [ -f "backend/.env" ]; then
    if grep -q "ANTHROPIC_API_KEY" backend/.env 2>/dev/null; then
        print_status ok "Environment file found with API key configured"
        ENV_OK=true
    else
        print_status error "Environment file exists but missing ANTHROPIC_API_KEY"
    fi
elif [ -n "$ANTHROPIC_API_KEY" ]; then
    print_status ok "ANTHROPIC_API_KEY found in environment"
    ENV_OK=true
else
    print_status error "No API key configured"
fi

# Make start.sh executable
if [ -f "start.sh" ]; then
    chmod +x start.sh
    print_status ok "start.sh is executable"
fi

echo ""

#=============================================================================
# Summary
#=============================================================================

echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Installation Complete!${NC}"
echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
echo ""

if [ "$ENV_OK" = false ]; then
    echo -e "${YELLOW}⚠ Action Required:${NC}"
    echo -e "  Create ${CYAN}backend/.env${NC} with your API key:"
    echo -e "  ${BLUE}echo 'ANTHROPIC_API_KEY=your_key_here' > backend/.env${NC}"
    echo ""
fi

echo -e "${GREEN}To start the application:${NC}"
echo -e "  ${CYAN}./start.sh${NC}          # Start in background"
echo -e "  ${CYAN}./start.sh -f${NC}       # Start in foreground"
echo ""
echo -e "${GREEN}Access:${NC}"
echo -e "  Frontend: ${CYAN}http://localhost:3000${NC}"
echo -e "  Backend:  ${CYAN}http://localhost:8000${NC}"
echo -e "  API Docs: ${CYAN}http://localhost:8000/docs${NC}"
echo ""
