# Agent 前端渲染架构分析

本文档总结了 Cherry Studio 项目中 Agent 模块的前端渲染实现机制。

## 1. 整体架构

```
AgentSessionMessages
        ↓
   MessageGroup
        ↓
   MessageItem
        ↓
  MessageContent
        ↓
MessageBlockRenderer ─→ 各类型 Block 组件
        ↓
    Markdown 组件
```

### 核心组件路径

| 组件 | 路径 |
|------|------|
| AgentSessionMessages | `src/renderer/src/pages/home/Messages/AgentSessionMessages.tsx` |
| MessageGroup | `src/renderer/src/pages/home/Messages/MessageGroup.tsx` |
| MessageItem | `src/renderer/src/pages/home/Messages/Message.tsx` |
| MessageContent | `src/renderer/src/pages/home/Messages/MessageContent.tsx` |
| MessageBlockRenderer | `src/renderer/src/pages/home/Messages/Blocks/index.tsx` |
| Markdown | `src/renderer/src/pages/home/Markdown/Markdown.tsx` |

---

## 2. 消息块类型

`MessageBlockRenderer` 根据不同的块类型分发到对应的渲染组件：

| 类型 | 组件 | 用途 |
|------|------|------|
| `MAIN_TEXT` / `CODE` | `MainTextBlock` | 主文本内容、代码 |
| `THINKING` | `ThinkingBlock` | AI 思考过程（可折叠） |
| `TOOL` | `ToolBlock` → `MessageTools` | 工具调用展示 |
| `IMAGE` | `ImageBlock` | 图片展示（支持分组） |
| `VIDEO` | `VideoBlock` | 视频展示 |
| `FILE` | `FileBlock` | 文件附件 |
| `CITATION` | `CitationBlock` | 引用来源 |
| `ERROR` | `ErrorBlock` | 错误信息 |
| `TRANSLATION` | `TranslationBlock` | 翻译内容 |
| `COMPACT` | `CompactBlock` | 紧凑模式 |

### 块状态

```typescript
MessageBlockStatus = 'streaming' | 'success' | 'paused' | 'error'
```

---

## 3. Markdown 渲染

### 使用的插件

| 类别 | 插件 | 功能 |
|------|------|------|
| **Remark** | `remark-gfm` | GitHub Flavored Markdown（表格、删除线等） |
| | `remark-math` | 数学公式支持 |
| | `remark-github-blockquote-alert` | GitHub 风格警告框 |
| | `remark-cjk-friendly` | 中日韩文字优化 |
| **Rehype** | `rehype-katex` / `rehype-mathjax` | 数学公式渲染 |
| | `rehype-raw` | 原生 HTML 支持 |
| | `rehype-scalable-svg` | SVG 缩放 |

### 自定义组件映射

```typescript
const components = {
  a: Link,           // 自定义链接
  code: CodeBlock,   // 代码块（带语法高亮）
  table: Table,      // 表格（带复制功能）
  img: ImageViewer,  // 图片查看器
  svg: MarkdownSvgRenderer  // SVG 渲染
}
```

### 流式渲染

使用 `useSmoothStream` Hook 实现平滑的流式输出效果：

```typescript
const { addChunk, reset } = useSmoothStream({
  onUpdate: (rawText) => setDisplayedContent(finalText),
  streamDone: isStreamDone,
  initialText: block.content
})
```

---

## 4. 表格处理

### 组件位置

`src/renderer/src/pages/home/Markdown/Table.tsx`

### 功能特性

1. **悬停工具栏**：鼠标悬停时显示复制按钮
2. **双格式复制**：同时复制 Markdown 源码和 HTML 格式
3. **源码提取**：根据 AST 节点位置从原始内容提取表格

### 复制实现

```typescript
const clipboardItem = new ClipboardItem({
  'text/plain': new Blob([tableMarkdown], { type: 'text/plain' }),
  'text/html': new Blob([tableHtml], { type: 'text/html' })
})
await navigator.clipboard.write([clipboardItem])
```

---

## 5. 计划与任务展示

### TodoWrite 工具

用于展示任务列表和完成度。

**数据结构**：

```typescript
interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm: string
}
```

**状态图标**：

| 状态 | 图标 | 颜色 |
|------|------|------|
| `pending` | ⭕ Circle | 灰色 |
| `in_progress` | 🕐 Clock | 主题色 |
| `completed` | ✅ CheckCircle | 绿色 |

### ExitPlanMode 工具

在 Plan 权限模式下，展示计划内容等待用户确认。

---

## 6. Agent 工具渲染

### 工具类型

```typescript
enum AgentToolsType {
  Read, Write, Edit, MultiEdit,
  Bash, BashOutput,
  Glob, Grep, Search,
  Task, Skill,
  TodoWrite, ExitPlanMode,
  WebSearch, WebFetch,
  NotebookEdit
}
```

### 渲染器映射

```typescript
// src/renderer/src/pages/home/Messages/Tools/MessageAgentTools/index.tsx
export const toolRenderers = {
  [AgentToolsType.Read]: ReadTool,
  [AgentToolsType.TodoWrite]: TodoWriteTool,
  [AgentToolsType.ExitPlanMode]: ExitPlanModeTool,
  // ...
}
```

---

## 7. 工具调用展示机制

### 完整数据流

```
Claude Agent SDK (后端)
        ↓ 1. SDKMessage (tool_use)
transform.ts (消息转换)
        ↓ 2. tool-call / tool-result / tool-error
handleToolCallChunk.ts (Chunk 处理)
        ↓ 3. ChunkType.MCP_TOOL_PENDING / MCP_TOOL_COMPLETE
Redux Store (状态管理)
        ↓ 4. ToolMessageBlock
MessageBlockRenderer → ToolBlock → MessageTool → MessageAgentTools
        ↓ 5. UI 渲染
```

### 后端转换 (transform.ts)

**位置**: `src/main/services/agents/services/claudecode/transform.ts`

当 Claude SDK 返回工具调用时，将其转换为 AiSDK 兼容的流事件：

```typescript
// 处理 tool_use 类型的内容块
function handleAssistantToolUse(block: ToolUseContent, ...) {
  const toolCallId = state.getNamespacedToolCallId(block.id)
  chunks.push({
    type: 'tool-call',          // ← 工具调用事件
    toolCallId,
    toolName: block.name,
    input: block.input,
    providerExecuted: true
  })
}
```

**工具相关事件类型**：

| 事件类型 | 说明 |
|----------|------|
| `tool-input-start` | 工具输入开始 |
| `tool-input-delta` | 工具输入增量 |
| `tool-input-end` | 工具输入结束 |
| `tool-call` | 工具调用完成 |
| `tool-result` | 工具执行结果 |
| `tool-error` | 工具执行错误 |

### 前端 Chunk 处理 (handleToolCallChunk.ts)

**位置**: `src/renderer/src/aiCore/chunk/handleToolCallChunk.ts`

`ToolCallChunkHandler` 类处理工具调用的流事件：

```typescript
class ToolCallChunkHandler {
  // 全局活跃工具调用追踪
  private static globalActiveToolCalls = new Map<string, ToolcallsMap>()

  // 处理工具调用
  handleToolCall(chunk: { type: 'tool-call' } & TypedToolCall) {
    const toolResponse: NormalToolResponse = {
      id: toolCallId,
      tool: tool,
      arguments: args,
      status: 'pending',    // ← 初始状态
      toolCallId: toolCallId
    }
    
    this.onChunk({
      type: ChunkType.MCP_TOOL_PENDING,
      responses: [toolResponse]
    })
  }

  // 处理工具结果
  handleToolResult(chunk: { type: 'tool-result' } & TypedToolResult) {
    const toolResponse: NormalToolResponse = {
      ...toolCallInfo,
      status: 'done',       // ← 完成状态
      response: output
    }
    
    this.onChunk({
      type: ChunkType.MCP_TOOL_COMPLETE,
      responses: [toolResponse]
    })
  }
}
```

### 工具状态流转

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   pending   │  →   │  executing  │  →   │    done     │
│  (等待执行)  │      │   (执行中)   │      │   (完成)    │
└─────────────┘      └─────────────┘      └─────────────┘
       ↓                                        ↓
MCP_TOOL_PENDING                        MCP_TOOL_COMPLETE
```

### NormalToolResponse 数据结构

```typescript
interface NormalToolResponse {
  id: string
  toolCallId: string
  tool: {
    id: string
    name: string
    type: 'builtin' | 'mcp' | 'provider'
    description?: string
  }
  arguments: Record<string, any>   // 工具输入参数
  response?: any                   // 工具输出结果
  status: 'pending' | 'done' | 'error'
}
```

### 前端渲染入口

**入口**: `MessageTool.tsx` → `MessageAgentTools`

```typescript
// src/renderer/src/pages/home/Messages/Tools/MessageTool.tsx
const ChooseTool = (toolResponse: NormalToolResponse) => {
  let toolName = toolResponse.tool.name
  
  // 内置工具
  if (toolName.startsWith('builtin_')) {
    switch (toolName.slice('builtin_'.length)) {
      case 'web_search': return <MessageWebSearchToolTitle />
      case 'knowledge_search': return <MessageKnowledgeSearchToolTitle />
    }
  }
  
  // Agent 工具
  if (isAgentTool(toolName)) {
    return <MessageAgentTools toolResponse={toolResponse} />
  }
}
```

### MessageAgentTools 渲染

```typescript
export function MessageAgentTools({ toolResponse }) {
  const { arguments: args, response, tool, status } = toolResponse

  // 等待权限批准时显示权限请求卡片
  if (status === 'pending') {
    if (pendingPermission) {
      return <ToolPermissionRequestCard toolResponse={toolResponse} />
    }
    return <ToolPendingIndicator toolName={tool?.name} />
  }

  // 工具完成后显示结果
  return <ToolContent toolName={tool.name} input={args} output={response} />
}
```

### 工具调用 UI 效果

#### Pending 状态
```
┌─────────────────────────────────────────────┐
│ ⏳  Read                                     │
│     Reading file...                          │
└─────────────────────────────────────────────┘
```

#### 完成状态 (可折叠)
```
┌─────────────────────────────────────────────┐
│ 📖 Read     /src/main.ts      145 lines   ▼ │
├─────────────────────────────────────────────┤
│ import { app } from 'electron'              │
│ ...                                          │
└─────────────────────────────────────────────┘
```

### 关键文件

| 层级 | 文件 | 职责 |
|------|------|------|
| **后端转换** | `claudecode/transform.ts` | Claude SDK → AiSDK 流事件 |
| **Chunk 处理** | `aiCore/chunk/handleToolCallChunk.ts` | 追踪活跃调用，生成 UI Chunk |
| **消息块存储** | Redux Store | 存储 `ToolMessageBlock` |
| **渲染入口** | `Tools/MessageTool.tsx` | 根据类型选择渲染器 |
| **Agent 工具** | `Tools/MessageAgentTools/` | 各类 Agent 工具渲染 |

---

## 8. 动画效果

使用 **Framer Motion** 实现消息块的入场动画：

```typescript
const blockWrapperVariants: Variants = {
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.3, type: 'spring', bounce: 0 }
  },
  hidden: {
    opacity: 0,
    x: 10
  }
}
```

---

## 9. 状态管理

### Redux Store

使用 Redux Toolkit + Entity Adapter 管理消息块：

```typescript
const blockEntities = useSelector((state: RootState) => 
  messageBlocksSelectors.selectEntities(state)
)
```

### API 通信

使用 `AgentApiClient` 类与后端交互：

```typescript
// src/renderer/src/api/agent.ts
class AgentApiClient {
  listAgents(options?: ListOptions): Promise<ListAgentsResponse>
  createSession(agentId: string, session: CreateSessionForm): Promise<...>
  getSession(agentId: string, sessionId: string): Promise<...>
}
```

---

## 10. 技术栈总结

| 功能 | 技术 |
|------|------|
| UI 框架 | React 19 + TypeScript |
| 组件库 | Ant Design 5 |
| 状态管理 | Redux Toolkit |
| 样式 | styled-components + TailwindCSS |
| Markdown | react-markdown + remark/rehype |
| 数学公式 | KaTeX / MathJax |
| 动画 | Framer Motion |
| 代码高亮 | Shiki |
| 数据验证 | Zod |
| HTTP | Axios |

---

## 11. 关键文件索引

```
src/renderer/src/
├── pages/home/
│   ├── Messages/
│   │   ├── AgentSessionMessages.tsx    # Agent 会话消息容器
│   │   ├── Message.tsx                 # 单条消息渲染
│   │   ├── MessageContent.tsx          # 消息内容
│   │   ├── MessageGroup.tsx            # 消息分组
│   │   ├── PermissionModeDisplay.tsx   # 权限模式展示
│   │   ├── Blocks/
│   │   │   ├── index.tsx               # 消息块分发器
│   │   │   ├── MainTextBlock.tsx       # 主文本块
│   │   │   ├── ThinkingBlock.tsx       # 思考块
│   │   │   ├── ToolBlock.tsx           # 工具块
│   │   │   └── ...
│   │   └── Tools/
│   │       ├── MessageTools.tsx        # 工具消息
│   │       ├── MessageMcpTool.tsx      # MCP 工具
│   │       └── MessageAgentTools/
│   │           ├── index.tsx           # Agent 工具入口
│   │           ├── TodoWriteTool.tsx   # 任务列表
│   │           ├── ExitPlanModeTool.tsx # 计划模式
│   │           └── types.ts            # 类型定义
│   └── Markdown/
│       ├── Markdown.tsx                # Markdown 渲染器
│       ├── Table.tsx                   # 表格组件
│       ├── CodeBlock.tsx               # 代码块
│       └── Link.tsx                    # 链接组件
├── api/
│   └── agent.ts                        # Agent API 客户端
├── hooks/agents/
│   ├── useAgentClient.ts               # Agent 客户端 Hook
│   ├── useSession.ts                   # 会话 Hook
│   └── ...
└── types/
    └── agent.ts                        # Agent 类型定义
```
