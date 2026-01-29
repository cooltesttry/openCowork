# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenCowork is an open-source implementation of Claude Cowork — a web-based autonomous AI agent for knowledge work. Built on the Claude Agent SDK with a FastAPI backend and Next.js frontend.

## Development Commands

```bash
# Full stack
./install.sh                    # Install all dependencies (backend/frontend/crawler)
./start.sh                      # Start all services (frontend :3000, backend :8000)
./start.sh -f                   # Start in foreground mode
./start.sh stop                 # Stop all services
./start.sh restart              # Restart services

# Backend
cd backend && source .venv/bin/activate && python main.py

# Frontend
cd frontend && npm run dev      # Development server
cd frontend && npm run build    # Production build
cd frontend && npm run lint     # ESLint

# Simple-Crawler MCP Server
cd simple-crawler && npm run build
cd simple-crawler && npm run mcp  # Run MCP server
```

## Architecture

```
Frontend (Next.js 16 + React 19) ──HTTP/SSE──> Backend (FastAPI + Claude Agent SDK) ──stdio/HTTP──> MCP Servers
```

### Backend (`backend/`)
- `main.py` - FastAPI entry point
- `core/agent_client.py` - Claude Agent SDK wrapper, handles streaming chat
- `core/session_manager.py` - Chat session state management
- `core/task_runner.py` - Background task execution
- `core/image_pipeline/` - Modular image processing for LLM multimodal input (detection, loading, conversion, optimization, encoding)
- `routers/agent.py` - Main chat API with SSE streaming
- `routers/config.py` - Settings/configuration API
- `routers/super_agent.py` - Super Agent session management

### Frontend (`frontend/src/`)
- `app/` - Next.js App Router pages
- `components/chat/` - Chat UI (message-list, input-area)
- `components/blocks/` - Rendering for tool calls, thinking, code
- `components/agent/` - Super Agent panel and events display
- `components/dockview-layout/` - Multi-panel layout system
- `lib/api.ts` - Backend API client

### Super Agent (`super_agent/`)
Self-improving task execution system using Worker-Checker loops:
- `orchestrator.py` - Manages session lifecycle and cycle execution
- `worker.py` - Executes tasks using Claude Agent SDK
- `models.py` - Data models (TaskDefinition, WorkerResult, CheckerResult)
- `events.py` - Event system for real-time updates
- Worker outputs to `__output.json`, Checker verifies and judges (passed/needs_improvement/failed)

### Simple-Crawler (`simple-crawler/`)
MCP server for web scraping:
- TypeScript with Playwright browser automation
- Provides `WebFetch` and `GetLinks` tools
- HTTP and browser rendering engines

## Configuration

- API keys: `backend/.env` (e.g., `ANTHROPIC_API_KEY`)
- Runtime config: `storage/` directory (managed via Settings UI)
- MCP servers: Configurable via Settings → MCP Servers

## Coding Conventions

**Python**: 4-space indent, `snake_case` functions/variables, `PascalCase` classes

**TypeScript/React**: Strict TypeScript, `PascalCase` components, `use` prefix for hooks

**Testing**: Ad-hoc test scripts (`test_*.py` in root and `backend/`). Run directly: `python test_model_call.py`

## Logs

- Backend: `backend/debug.log` or `/tmp/stockagent_backend.log`
- Frontend: `/tmp/stockagent_frontend.log`
