# Project Dependencies Summary

Generated on 2026-01-30 by scanning source code imports and reading declared dependency files.

Scope:
- Python: `backend/`, `super_agent/`, and root `test_*.py`
- Node: `frontend/src/`, `simple-crawler/src/`, and root `*.js`
- Declared dependencies: `backend/requirements.txt`, `frontend/package.json`, `simple-crawler/package.json`

## Python

### Declared (backend/requirements.txt)
- fastapi>=0.115.0
- uvicorn[standard]>=0.32.0
- websockets>=14.0
- pydantic>=2.10.0
- pydantic-settings>=2.6.0
- python-dotenv>=1.0.1
- httpx>=0.28.0
- claude-agent-sdk>=0.1.0
- aiofiles>=24.1.0
- watchdog>=6.0.0
- pillow>=10.0.0
- pillow-heif>=0.13.0

### Imported in code (mapping to package)
- fastapi -> `fastapi`
- uvicorn -> `uvicorn`
- httpx -> `httpx`
- pydantic -> `pydantic`
- watchdog -> `watchdog`
- claude_agent_sdk -> `claude-agent-sdk`
- PIL -> `pillow`
- pillow_heif -> `pillow-heif`
- requests -> `requests`
- yaml -> `PyYAML`
- json_repair -> `json-repair`
- mcp -> `mcp` (Python MCP client library)

### Used in code but not declared in requirements
- requests (imported in `backend/mcp/*.py` and root test scripts)
- PyYAML (imported as `yaml` in `super_agent/config.py`)
- json-repair (imported as `json_repair` in `super_agent/orchestrator.py`)
- mcp (imported in `backend/core/mcp_inspector.py` and `backend/debug_inspector.py`)

## Node

### Frontend (frontend/package.json)
Dependencies:
- @cyntler/react-doc-viewer ^1.17.1
- @dnd-kit/core ^6.3.1
- @dnd-kit/sortable ^10.0.0
- @dnd-kit/utilities ^3.2.2
- @monaco-editor/react ^4.7.0
- @radix-ui/react-accordion ^1.2.12
- @radix-ui/react-alert-dialog ^1.1.15
- @radix-ui/react-checkbox ^1.3.3
- @radix-ui/react-collapsible ^1.1.12
- @radix-ui/react-dialog ^1.1.15
- @radix-ui/react-dropdown-menu ^2.1.16
- @radix-ui/react-label ^2.1.8
- @radix-ui/react-popover ^1.1.15
- @radix-ui/react-radio-group ^1.3.8
- @radix-ui/react-scroll-area ^1.2.10
- @radix-ui/react-select ^2.2.6
- @radix-ui/react-separator ^1.1.8
- @radix-ui/react-slot ^1.2.4
- @radix-ui/react-switch ^1.2.6
- @radix-ui/react-tabs ^1.1.13
- @radix-ui/react-tooltip ^1.2.8
- @tailwindcss/typography ^0.5.19
- @webcontainer/api ^1.6.1
- @xterm/addon-fit ^0.11.0
- @xterm/addon-web-links ^0.12.0
- class-variance-authority ^0.7.1
- clsx ^2.1.1
- cmdk ^1.1.1
- date-fns ^4.1.0
- dockview ^4.13.1
- katex ^0.16.27
- lucide-react ^0.562.0
- next 16.1.1
- next-themes ^0.4.6
- react 19.2.3
- react-dom 19.2.3
- react-markdown ^10.1.0
- react-resizable-panels ^4.4.0
- rehype-highlight ^7.0.2
- rehype-katex ^7.0.1
- remark-gfm ^4.0.1
- remark-math ^6.0.0
- sonner ^2.0.7
- styled-components ^6.3.8
- tailwind-merge ^3.4.0
- xterm ^5.3.0

Dev dependencies:
- @tailwindcss/postcss ^4
- @types/node ^20
- @types/react ^19
- @types/react-dom ^19
- eslint ^9
- eslint-config-next 16.1.1
- tailwindcss ^4
- tw-animate-css ^1.4.0
- typescript ^5

Frontend imports not declared in package.json (present in code under `frontend/src/`):
- highlight.js (CSS import used in `frontend/src/components/*`)
- react-pdf (CSS import used in `frontend/src/components/panels/file-preview-panel.tsx`)

### Simple Crawler (simple-crawler/package.json)
Dependencies:
- @modelcontextprotocol/sdk ^1.25.2
- @types/pdf-parse ^1.1.5
- cheerio ^1.0.0
- pdf-parse ^1.1.1
- playwright ^1.40.0
- playwright-extra ^4.3.6
- puppeteer-extra-plugin-stealth ^2.11.2
- turndown ^7.1.2
- turndown-plugin-gfm ^1.0.2
- user-agents ^1.1.0

Dev dependencies:
- @types/node ^20.10.0
- @types/turndown ^5.0.4
- tsx ^4.7.0
- typescript ^5.3.0

Simple-crawler imports not declared in package.json (present in code under `simple-crawler/src/`):
- zod (imported in `simple-crawler/src/mcp-server.ts`)

### Root JS
- Root `test_mcp_manual.js` only uses Node built-in modules (`child_process`, `path`). No additional dependencies.
