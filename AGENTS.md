# Repository Guidelines

## Project Structure & Module Organization
- `backend/`: FastAPI service and Claude Agent SDK integration. Core logic in `backend/core/`, API routes in `backend/routers/`, data models in `backend/models/`, entrypoint `backend/main.py`.
- `frontend/`: Next.js 16 + React 19 UI. App Router lives in `frontend/src/app/`, shared UI in `frontend/src/components/`, utilities in `frontend/src/lib/`.
- `simple-crawler/`: MCP server for web scraping (TypeScript + Playwright), source in `simple-crawler/src/`.
- `storage/`: runtime configuration persisted by the app (e.g., model/search settings).
- Root scripts: `install.sh` (smart installer) and `start.sh` (start/stop/restart services).

## Build, Test, and Development Commands
```bash
./install.sh                 # install deps for backend/frontend/crawler
./start.sh                   # start all services (UI on :3000, API on :8000)
./start.sh -f                # foreground mode
./start.sh stop|restart      # manage services
```
```bash
cd backend && python main.py # run API server directly
cd frontend && npm run dev   # Next.js dev server
cd frontend && npm run build # production build
cd simple-crawler && npm run build
```

## Coding Style & Naming Conventions
- Python: 4-space indentation, `snake_case` modules/functions, `PascalCase` classes; follow existing file formatting.
- Frontend: TypeScript/React with strict TS (`frontend/tsconfig.json`); components in `.tsx` using `PascalCase`, hooks prefixed with `use`.
- Linting: `frontend` uses ESLint (`npm run lint`) via Next.js defaults; no backend formatter/linter is configured.

## Testing Guidelines
- No centralized test runner is defined. Tests are currently ad-hoc scripts like `test_*.py` in the repo root and `backend/test_permission_callback.py`.
- Run a script directly, e.g. `python test_model_call.py`. Keep new tests in the same style unless introducing a framework is agreed upon.

## Commit & Pull Request Guidelines
- Git history currently contains only `init`, so no established convention. Prefer short, imperative messages (e.g., “Add MCP config validation”).
- PRs should include: concise description, how to run or verify changes, and screenshots for UI updates. Link related issues when applicable.

## Configuration & Secrets
- API keys live in `backend/.env` (e.g., `ANTHROPIC_API_KEY`), or via the UI which writes to `storage/`.
- Never commit secrets; prefer `.env` and local `storage/` state.
