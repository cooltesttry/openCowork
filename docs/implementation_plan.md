# Claude Agent Client 实施计划

构建一个基于 Claude Agent SDK 的客户端，采用现代全栈架构，具备美观的可视化界面和完整的配置管理功能。

## User Review Required

> [!IMPORTANT]
> **技术栈选择**：采用 **Next.js 15 + FastAPI** 全栈架构
> - **前端**: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS + shadcn/ui
> - **后端**: FastAPI + Python + Claude Agent SDK
> - **通信**: WebSocket 实时流式传输

> [!NOTE]
> 此架构支持：
> - 🎨 高度可定制的精美 UI (shadcn/ui 组件库)
> - 🔄 实时流式响应 (WebSocket + SSE)
> - 📱 响应式设计
> - 🧩 模块化可扩展

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                     Next.js Frontend                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Chat Panel  │  │Settings Tab │  │   Agent Visualizer  │ │
│  │ (streaming) │  │ (config)    │  │   (steps/tools)     │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
└─────────┼────────────────┼────────────────────┼─────────────┘
          │ WebSocket      │ REST               │
          ▼                ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                     FastAPI Backend                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Agent Core  │  │Config Store │  │   MCP Manager       │ │
│  │ (streaming) │  │ (CRUD)      │  │   (server mgmt)     │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
└─────────┼────────────────┼────────────────────┼─────────────┘
          │                │                    │
          ▼                ▼                    ▼
   Claude Agent SDK    config.json         MCP Servers
```

---

## 项目结构

```
stockagent/
├── frontend/                      # Next.js 前端
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx               # 主聊天界面
│   │   └── settings/
│   │       └── page.tsx           # 设置页面
│   ├── components/
│   │   ├── ui/                    # shadcn/ui 组件
│   │   ├── chat/
│   │   │   ├── chat-panel.tsx     # 聊天主面板
│   │   │   ├── message-list.tsx   # 消息列表
│   │   │   ├── message-item.tsx   # 单条消息
│   │   │   └── input-area.tsx     # 输入区域
│   │   ├── agent/
│   │   │   ├── step-viewer.tsx    # Agent 步骤可视化
│   │   │   └── tool-call.tsx      # 工具调用展示
│   │   └── settings/
│   │       ├── model-config.tsx   # 模型配置
│   │       ├── mcp-config.tsx     # MCP 服务器配置
│   │       └── search-config.tsx  # 搜索配置
│   ├── lib/
│   │   ├── websocket.ts           # WebSocket 客户端
│   │   └── api.ts                 # API 客户端
│   └── package.json
│
├── backend/                       # FastAPI 后端
│   ├── main.py                    # 应用入口
│   ├── routers/
│   │   ├── agent.py               # Agent WebSocket 端点
│   │   └── config.py              # 配置 REST API
│   ├── core/
│   │   ├── agent_client.py        # Claude Agent SDK 封装
│   │   ├── mcp_manager.py         # MCP 服务器管理
│   │   └── search_provider.py     # 搜索接口
│   ├── models/
│   │   └── settings.py            # Pydantic 数据模型
│   └── requirements.txt
│
└── storage/
    └── config.json                # 持久化配置
```

---

## Proposed Changes

### Backend (FastAPI + Claude Agent SDK)

#### [NEW] [main.py](file:///Users/huawang/pyproject/stockagent/backend/main.py)
FastAPI 应用入口：
- CORS 配置（允许前端访问）
- 挂载 routers
- WebSocket 端点

#### [NEW] [agent.py](file:///Users/huawang/pyproject/stockagent/backend/routers/agent.py)
Agent WebSocket 端点：
- `/ws/chat` - 实时聊天流
- 接收用户消息，调用 Claude Agent SDK
- 流式返回: thinking, tool_calls, content

#### [NEW] [config.py](file:///Users/huawang/pyproject/stockagent/backend/routers/config.py)
配置 REST API：
- `GET/PUT /api/config/model` - 模型配置
- `GET/POST/DELETE /api/config/mcp` - MCP 服务器 CRUD
- `GET/PUT /api/config/search` - 搜索配置

#### [NEW] [agent_client.py](file:///Users/huawang/pyproject/stockagent/backend/core/agent_client.py)
Claude Agent SDK 封装：
- 异步流式 API 调用
- 事件解析 (thinking, tool_use, text)
- MCP 服务器动态注册

---

### Frontend (Next.js 15 + shadcn/ui)

#### [NEW] [page.tsx](file:///Users/huawang/pyproject/stockagent/frontend/app/page.tsx)
主聊天界面：
- 左侧: 聊天历史
- 中间: 消息流 + 输入框
- 右侧: Agent 步骤可视化（可折叠）

#### [NEW] [chat-panel.tsx](file:///Users/huawang/pyproject/stockagent/frontend/components/chat/chat-panel.tsx)
聊天主面板：
- WebSocket 连接管理
- 流式消息渲染
- 自动滚动

#### [NEW] [step-viewer.tsx](file:///Users/huawang/pyproject/stockagent/frontend/components/agent/step-viewer.tsx)
Agent 步骤可视化：
- Turn 分隔
- 思考过程（可折叠）
- 工具调用详情

#### [NEW] [settings/page.tsx](file:///Users/huawang/pyproject/stockagent/frontend/app/settings/page.tsx)
设置页面 (Tabs):
- **模型 API**: 类型、Endpoint、API Key、参数
- **MCP 服务器**: 列表管理、增删改
- **搜索**: 提供商、API Key

---

## UI 设计要点

| 功能 | 设计 |
|------|------|
| **主题** | 暗色模式优先，支持切换 |
| **聊天气泡** | 用户/Assistant 区分，支持 Markdown |
| **工具调用** | 卡片式展示，图标 + 名称 + 参数折叠 |
| **思考过程** | 淡色背景，斜体，默认折叠 |
| **状态指示** | 打字动画、加载 spinner |
| **配置面板** | 表单验证、即时保存反馈 |

---

## Verification Plan

### 自动化测试

```bash
# 1. 后端启动
cd /Users/huawang/pyproject/stockagent/backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# 2. 前端启动
cd /Users/huawang/pyproject/stockagent/frontend
npm install
npm run dev
# 预期: http://localhost:3000
```

### 浏览器测试
1. 打开 http://localhost:3000
2. 验证聊天界面布局
3. 测试设置页面表单
4. 验证 WebSocket 流式响应

---

## 实施顺序

1. **Phase 1**: 项目初始化 (Next.js + FastAPI)
2. **Phase 2**: 后端 Agent 核心 + WebSocket
3. **Phase 3**: 前端聊天界面
4. **Phase 4**: 配置系统 (前后端)
5. **Phase 5**: UI 美化 + Agent 可视化
6. **Phase 6**: 集成测试

请审阅此计划，确认后我将开始实施。
