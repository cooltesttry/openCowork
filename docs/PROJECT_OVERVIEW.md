# OpenCowork 项目说明

## 1. 项目定位与目标

OpenCowork 是一个自托管的 Claude Agent SDK Web 端实现，提供面向“知识工作”的多轮对话、工具调用、文件检视与终端能力。整体采用前后端分离架构，并通过 MCP（Model Context Protocol）扩展工具生态（如 Web 搜索与爬虫）。

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                          Frontend                           │
│           Next.js 16 + React 19 + Tailwind CSS               │
└─────────────────────────┬───────────────────────────────────┘
                          │ WebSocket / HTTP
┌─────────────────────────▼───────────────────────────────────┐
│                           Backend                            │
│             FastAPI + Claude Agent SDK + Python              │
└─────────────────────────┬───────────────────────────────────┘
                          │ MCP (stdio/http) / HTTP
┌─────────────────────────▼───────────────────────────────────┐
│                          MCP Servers                         │
│              Simple-Crawler / Search Providers               │
└─────────────────────────────────────────────────────────────┘
```

## 3. 模块与技术方案

### 3.1 前端（`frontend/`）

- **技术栈**：Next.js 16（App Router）、React 19、TypeScript、Tailwind CSS 4。
- **核心职责**：
  - 实时聊天 UI（WebSocket 流式响应）。
  - 会话管理、设置面板、MCP 配置、搜索配置。
  - 文件树与文件预览、终端模拟（xterm）。
- **关键依赖**：
  - UI 组件：Radix UI、cmdk、lucide-react。
  - 文本渲染：react-markdown、remark/rehype、katex。
  - 编辑与终端：@monaco-editor/react、xterm、@xterm/addon-fit。
  - 布局与交互：dockview、react-resizable-panels、@dnd-kit/*。

### 3.2 后端（`backend/`）

- **技术栈**：FastAPI + Uvicorn，Claude Agent SDK，Pydantic。
- **核心职责**：
  - WebSocket 流式输出（`/api/ws/chat`）。
  - 会话与消息持久化（`storage/sessions/`）。
  - 配置读写（`storage/config.json`）。
  - 文件浏览/读写（`/api/files`）。
  - 终端会话（`/ws/terminal/{session_id}`）。
  - MCP 服务器配置与工具探测。
- **核心模块**：
  - `core/agent_client.py`：SDK 封装、流式事件、工具调用。
  - `core/session_manager.py`：Claude SDK 客户端生命周期管理。
  - `core/task_runner.py`：会话级任务状态管理与事件缓存。
  - `core/file_watcher.py`：文件系统监听与变更推送。
  - `core/search_tools.py`：Serper/Tavily/Brave 搜索工具封装。
  - `core/session_storage.py`：会话读写存储。
  - `routers/*`：API 路由（agent/config/sessions/files/terminal）。

### 3.3 Simple-Crawler（`simple-crawler/`）

- **技术栈**：Node.js + TypeScript + Playwright + MCP SDK。
- **核心职责**：
  - 提供 MCP Web 抓取服务。
  - 支持 HTTP fetch + 浏览器渲染 fallback。
  - HTML 解析（cheerio）与 Markdown 转换（turndown）。

### 3.4 存储与运行态（`storage/`）

- `storage/config.json`：模型配置、MCP 服务器配置、搜索配置等。
- `storage/sessions/`：会话 JSON 持久化。

### 3.5 脚本与运维

- `install.sh`：智能安装（Python venv、npm 依赖、Playwright 浏览器）。
- `start.sh`：启动/停止/重启（后台或前台）。

## 4. 关键数据流

### 4.1 实时对话流（WebSocket）

1. 前端通过 WebSocket 连接 `/api/ws/chat`。
2. 后端通过 Claude Agent SDK 流式返回文本、工具调用与结果。
3. 服务端按事件流保存会话数据到 `storage/sessions/`。

### 4.2 配置与 MCP

1. 前端调用 `/api/config` 系列接口读写配置。
2. 后端写入 `storage/config.json` 并在内存中更新配置。
3. Claude SDK 根据配置组装 MCP 服务器与工具集。

### 4.3 文件与终端

- 文件接口：`/api/files/*` 负责文件树、文件内容的 CRUD。
- 终端接口：`/ws/terminal/{session_id}` 通过 PTY 与前端交互。
- 文件监听：`core/file_watcher.py` 使用 watchdog 推送变更。

## 5. 框架与依赖清单（按组件）

### 5.1 系统依赖

- Python 3.11+
- Node.js 20+
- npm
- Git

### 5.2 后端（`backend/requirements.txt`）

- fastapi
- uvicorn[standard]
- websockets
- pydantic
- pydantic-settings
- python-dotenv
- httpx
- claude-agent-sdk
- aiofiles
- watchdog

### 5.3 前端（`frontend/package.json`）

- next, react, react-dom
- tailwindcss, @tailwindcss/typography, tw-animate-css
- radix-ui 组件库：@radix-ui/react-*
- 编辑器/终端：@monaco-editor/react, xterm, @xterm/addon-fit, @xterm/addon-web-links
- Markdown/数学渲染：react-markdown, remark-gfm, remark-math, rehype-katex, rehype-highlight, katex
- 交互与布局：dockview, react-resizable-panels, @dnd-kit/*
- 其他：next-themes, lucide-react, sonner, styled-components, class-variance-authority, clsx

### 5.4 Simple-Crawler（`simple-crawler/package.json`）

- @modelcontextprotocol/sdk
- playwright, playwright-extra, puppeteer-extra-plugin-stealth
- cheerio
- turndown, turndown-plugin-gfm
- user-agents

### 5.5 Playwright 浏览器

- 安装脚本会自动下载 Chromium（`npx playwright install chromium`）。

## 6. 相关目录速览

```
backend/               FastAPI 服务与 Claude SDK 集成
frontend/              Next.js UI
simple-crawler/         MCP 爬虫服务
storage/               运行态配置与会话数据
install.sh             智能安装脚本
start.sh               启停服务脚本
```
