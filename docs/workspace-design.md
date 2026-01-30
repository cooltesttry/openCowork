# Workspace 功能设计方案

## 1. 概述

### 1.1 核心概念

**Workspace（工作空间）** 是 OpenCowork 的核心组织单位，将工作目录与会话管理紧密结合：

- **一个 Workspace = 一个工作目录**
- **一个 Workspace 可以包含多个 Session**
- **工作空间数据存储在工作目录的隐藏文件夹中**（如 `.opencowork/`）

### 1.2 设计目标

1. **本地化存储**：会话历史、记忆、配置都存储在对应工作目录中
2. **便携性**：工作空间可以随项目迁移（拷贝目录即可）
3. **隔离性**：不同工作空间的数据完全隔离
4. **直观性**：文件浏览器、终端自动切换到当前工作空间的目录

---

## 2. 数据模型

### 2.1 Workspace 结构

```typescript
interface Workspace {
    id: string;                  // UUID
    name: string;                // 显示名称（默认使用目录名）
    path: string;                // 工作目录的绝对路径
    created_at: number;          // 创建时间戳
    last_accessed_at: number;    // 最后访问时间戳
    icon?: string;               // 自定义图标（可选）
    color?: string;              // 主题色（可选）
}
```

### 2.2 Session 结构更新

```typescript
interface Session {
    id: string;
    workspace_id: string;        // 新增：所属工作空间
    title: string;
    created_at: number;
    updated_at: number;
    message_count: number;
    last_model_name?: string;
    last_endpoint_name?: string;
}

interface SessionDetail extends Session {
    messages: Message[];
    sdk_session_id?: string;
}
```

### 2.3 工作空间本地存储结构

```
/path/to/workspace/
├── .opencowork/                    # 隐藏的工作空间数据目录
│   ├── workspace.json              # 工作空间元数据
│   ├── sessions/                   # 会话存储
│   │   ├── {session-id}.json       # 会话数据
│   │   └── {session-id}/           # 会话附属文件（如有）
│   │       └── current.json
│   ├── memory/                     # AI 记忆存储
│   │   ├── context.md              # 项目上下文
│   │   └── preferences.json        # 用户偏好
│   ├── config.json                 # 工作空间级配置（MCP servers 等）
│   └── cache/                      # 临时缓存
│       └── file-index.json         # 文件索引缓存
├── .claude/                        # Claude Agent SDK 的 Skills 目录（SDK 自动识别）
│   └── commands/                   # 自定义 slash commands
└── ... (项目文件)
```

### 2.4 全局配置更新

`storage/config.json` 新增：
```json
{
  "workspaces": {
    "recent": [
      {
        "id": "uuid-1",
        "path": "/Users/user/projects/my-app",
        "name": "My App",
        "last_accessed_at": 1768907043
      }
    ],
    "current_workspace_id": "uuid-1"
  }
}
```

---

## 3. 后端 API 设计

### 3.1 Workspace API

```python
# routers/workspace.py

router = APIRouter(prefix="/api/workspace", tags=["workspace"])

# 列出最近的工作空间
@router.get("/recent")
async def list_recent_workspaces() -> List[Workspace]:
    """返回最近使用的工作空间列表"""

# 打开/创建工作空间
@router.post("/open")
async def open_workspace(path: str, name: str = None) -> Workspace:
    """
    打开指定目录作为工作空间
    - 如果 .opencowork/ 存在，读取已有数据
    - 如果不存在，初始化新工作空间
    """

# 获取当前工作空间信息
@router.get("/current")
async def get_current_workspace() -> Workspace:
    """返回当前活动的工作空间"""

# 切换工作空间
@router.post("/switch")
async def switch_workspace(workspace_id: str) -> Workspace:
    """切换到指定工作空间"""

# 更新工作空间设置
@router.patch("/{workspace_id}")
async def update_workspace(workspace_id: str, data: WorkspaceUpdate) -> Workspace:
    """更新工作空间名称、图标等"""

# 移除工作空间（仅从最近列表移除，不删除数据）
@router.delete("/{workspace_id}")
async def remove_workspace(workspace_id: str):
    """从最近列表移除工作空间"""
```

### 3.2 Session API 更新

```python
# routers/session.py 更新

# 现有会话 API 增加 workspace 作用域
@router.get("/sessions")
async def list_sessions(workspace_id: str = None) -> List[Session]:
    """
    列出会话
    - 如果指定 workspace_id，只返回该工作空间的会话
    - 会话数据从工作空间的 .opencowork/sessions/ 读取
    """

@router.post("/sessions")
async def create_session(workspace_id: str) -> Session:
    """在指定工作空间创建新会话"""

@router.get("/sessions/{session_id}")
async def get_session(session_id: str, workspace_id: str) -> SessionDetail:
    """获取会话详情（从工作空间本地存储读取）"""
```

### 3.3 工作空间存储管理器

```python
# core/workspace_storage.py

class WorkspaceStorage:
    """管理工作空间本地存储的读写操作"""

    def __init__(self, workspace_path: str):
        self.workspace_path = Path(workspace_path)
        self.data_dir = self.workspace_path / ".opencowork"

    def initialize(self) -> None:
        """初始化 .opencowork 目录结构"""

    def get_workspace_meta(self) -> dict:
        """读取 workspace.json"""

    def save_session(self, session: SessionDetail) -> None:
        """保存会话到 sessions/{id}.json"""

    def load_session(self, session_id: str) -> SessionDetail:
        """从本地加载会话"""

    def list_sessions(self) -> List[Session]:
        """列出所有会话（仅元数据）"""

    def get_memory_context(self) -> str:
        """读取 memory/context.md"""

    def save_memory_context(self, content: str) -> None:
        """保存项目上下文记忆"""
```

---

## 4. 前端设计

### 4.1 组件层次结构

```
App
├── WorkspaceProvider (新增)
│   └── ChatProvider
│       └── DockviewMain
│           ├── WorkspaceSidebar (新增，替代 SessionSidebar)
│           │   ├── WorkspaceHeader
│           │   ├── WorkspaceList
│           │   │   └── WorkspaceItem
│           │   │       └── SessionList (展开后显示)
│           │   │           └── SessionItem
│           │   └── AddWorkspaceButton
│           ├── ChatPanel
│           ├── EditorPanel
│           ├── TerminalPanel
│           └── FileExplorerPanel
```

### 4.2 新增 State 管理

```typescript
// lib/store.tsx 新增

interface WorkspaceContextType {
    // 工作空间列表（最近使用）
    workspaces: Workspace[];
    setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;

    // 当前工作空间
    currentWorkspace: Workspace | null;
    setCurrentWorkspace: React.Dispatch<React.SetStateAction<Workspace | null>>;

    // 当前工作空间的会话列表
    sessions: Session[];
    setSessions: React.Dispatch<React.SetStateAction<Session[]>>;

    // 当前会话
    currentSession: Session | null;
    setCurrentSession: React.Dispatch<React.SetStateAction<Session | null>>;

    // 操作
    openWorkspace: (path: string) => Promise<void>;
    switchWorkspace: (workspaceId: string) => Promise<void>;
    createSession: () => Promise<Session>;
    switchSession: (sessionId: string) => Promise<void>;
}
```

### 4.3 UI 设计

#### 4.3.1 左侧边栏 (WorkspaceSidebar)

```
┌─────────────────────────────────┐
│  ⚙️  OpenCowork              [+] │  <- 标题 + 添加工作空间按钮
├─────────────────────────────────┤
│                                 │
│  📁 my-app                   ▼  │  <- 当前工作空间（展开状态）
│     ├─ 💬 Chat about login       │
│     ├─ 💬 Fix bug #123          │
│     └─ 💬 New Chat              │  <- 会话列表
│                                 │
│  📁 another-project          ▶  │  <- 其他工作空间（折叠状态）
│                                 │
│  📁 old-project              ▶  │
│                                 │
├─────────────────────────────────┤
│  Open Folder...                 │  <- 打开新工作空间
└─────────────────────────────────┘
```

#### 4.3.2 工作空间切换行为

当用户切换工作空间时：

1. **文件浏览器** → 自动切换到新工作空间的目录
2. **终端** → 新终端自动 cd 到工作空间目录
3. **会话列表** → 显示新工作空间的会话
4. **编辑器** → 可选择是否保留当前打开的文件

#### 4.3.3 交互模式

**展开/折叠工作空间**
- 点击工作空间名称 → 展开/折叠会话列表
- 双击工作空间名称 → 切换到该工作空间

**创建新会话**
- 在当前工作空间右侧点击 [+] 按钮
- 或使用快捷键 Cmd/Ctrl + N

**切换会话**
- 单击会话名称即可切换

**删除操作**
- 右键菜单或悬停时显示删除按钮
- 删除工作空间：仅从列表移除（数据保留在目录中）
- 删除会话：删除 .opencowork/sessions/{id}.json

### 4.4 组件实现

#### WorkspaceSidebar 组件

```tsx
// components/workspace/workspace-sidebar.tsx

interface WorkspaceSidebarProps {
    isOpen: boolean;
    onToggle: () => void;
}

export function WorkspaceSidebar({ isOpen, onToggle }: WorkspaceSidebarProps) {
    const {
        workspaces,
        currentWorkspace,
        sessions,
        currentSession,
        switchWorkspace,
        switchSession,
        createSession,
        openWorkspace,
    } = useWorkspace();

    const [expandedWorkspaceId, setExpandedWorkspaceId] = useState<string | null>(
        currentWorkspace?.id ?? null
    );

    return (
        <div className={cn(
            "h-full bg-card border-r flex flex-col",
            isOpen ? "w-[280px]" : "w-0"
        )}>
            {/* Header */}
            <WorkspaceSidebarHeader onToggle={onToggle} />

            {/* Workspace List */}
            <ScrollArea className="flex-1">
                {workspaces.map(workspace => (
                    <WorkspaceItem
                        key={workspace.id}
                        workspace={workspace}
                        isActive={workspace.id === currentWorkspace?.id}
                        isExpanded={workspace.id === expandedWorkspaceId}
                        sessions={workspace.id === currentWorkspace?.id ? sessions : []}
                        currentSessionId={currentSession?.id}
                        onToggleExpand={() => setExpandedWorkspaceId(
                            expandedWorkspaceId === workspace.id ? null : workspace.id
                        )}
                        onSwitchWorkspace={() => switchWorkspace(workspace.id)}
                        onSwitchSession={switchSession}
                        onCreateSession={createSession}
                    />
                ))}
            </ScrollArea>

            {/* Open Folder Button */}
            <div className="p-3 border-t">
                <Button variant="outline" className="w-full" onClick={handleOpenFolder}>
                    <FolderOpen className="mr-2 h-4 w-4" />
                    Open Folder...
                </Button>
            </div>
        </div>
    );
}
```

#### WorkspaceItem 组件

```tsx
// components/workspace/workspace-item.tsx

interface WorkspaceItemProps {
    workspace: Workspace;
    isActive: boolean;
    isExpanded: boolean;
    sessions: Session[];
    currentSessionId?: string;
    onToggleExpand: () => void;
    onSwitchWorkspace: () => void;
    onSwitchSession: (sessionId: string) => void;
    onCreateSession: () => void;
}

export function WorkspaceItem({
    workspace,
    isActive,
    isExpanded,
    sessions,
    currentSessionId,
    onToggleExpand,
    onSwitchWorkspace,
    onSwitchSession,
    onCreateSession,
}: WorkspaceItemProps) {
    return (
        <div className={cn(
            "border-b border-border/50",
            isActive && "bg-accent/30"
        )}>
            {/* Workspace Header */}
            <div
                className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-accent/50"
                onClick={onToggleExpand}
                onDoubleClick={onSwitchWorkspace}
            >
                <ChevronRight className={cn(
                    "h-4 w-4 transition-transform",
                    isExpanded && "rotate-90"
                )} />
                <FolderIcon className="h-4 w-4 text-blue-500" />
                <span className="flex-1 truncate text-sm font-medium">
                    {workspace.name}
                </span>
                {isActive && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => {
                            e.stopPropagation();
                            onCreateSession();
                        }}
                    >
                        <Plus className="h-4 w-4" />
                    </Button>
                )}
            </div>

            {/* Sessions List (expanded) */}
            {isExpanded && (
                <div className="pl-6 pb-1">
                    {sessions.length === 0 ? (
                        <div className="text-xs text-muted-foreground py-2 px-3">
                            No conversations yet
                        </div>
                    ) : (
                        sessions.map(session => (
                            <SessionItem
                                key={session.id}
                                session={session}
                                isActive={session.id === currentSessionId}
                                onClick={() => onSwitchSession(session.id)}
                            />
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
```

---

## 5. 迁移策略

### 5.1 现有数据迁移

现有的 `storage/sessions/` 数据需要迁移到工作空间模式：

1. **创建默认工作空间**
   - 使用当前 `default_workdir` 作为默认工作空间
   - 如果未设置，使用用户主目录

2. **迁移现有会话**
   - 将 `storage/sessions/*.json` 移动到默认工作空间的 `.opencowork/sessions/`
   - 更新会话数据添加 `workspace_id` 字段

3. **向后兼容**
   - 保留旧的 `storage/sessions/` 结构一段时间
   - 提供迁移脚本和 UI 提示

### 5.2 迁移脚本

```python
# scripts/migrate_to_workspace.py

async def migrate_sessions_to_workspace(default_workspace_path: str):
    """将现有会话迁移到工作空间存储"""

    # 1. 初始化默认工作空间
    storage = WorkspaceStorage(default_workspace_path)
    storage.initialize()

    # 2. 复制现有会话
    old_sessions_dir = Path("storage/sessions")
    for session_file in old_sessions_dir.glob("*.json"):
        session_data = json.loads(session_file.read_text())
        session_data["workspace_id"] = storage.workspace_id
        storage.save_session(session_data)

    # 3. 更新全局配置
    config = load_config()
    config["workspaces"] = {
        "recent": [{
            "id": storage.workspace_id,
            "path": default_workspace_path,
            "name": Path(default_workspace_path).name,
            "last_accessed_at": time.time()
        }],
        "current_workspace_id": storage.workspace_id
    }
    save_config(config)
```

---

## 6. 附加功能

### 6.1 工作空间记忆 (Memory)

每个工作空间可以维护独立的 AI 记忆：

```
.opencowork/memory/
├── context.md        # 项目上下文（自动或手动维护）
├── preferences.json  # 用户偏好设置
└── knowledge.json    # 学习到的项目知识
```

**context.md 示例：**
```markdown
# Project Context

## Overview
This is a Next.js 14 application with TypeScript.

## Key Technologies
- React 19
- Tailwind CSS
- Prisma ORM

## Important Patterns
- All components use `cn()` for className merging
- API routes are in `/app/api/`

## User Preferences
- Prefer functional components over class components
- Use Tailwind instead of CSS modules
```

### 6.2 配置层级与合并

#### 6.2.1 配置层级

```
全局配置 (storage/config.json)
    ↓ 继承 + 覆盖
工作空间配置 (.opencowork/config.json)
```

**Skills**: 由 Claude Agent SDK 自动从工作目录的 `.claude/` 子目录读取，无需我们管理。

**MCP Servers**: 采用合并策略：
- 全局 MCP 服务器默认对所有工作空间可用
- 工作空间可以添加专属 MCP 服务器
- 工作空间可以禁用特定的全局 MCP 服务器

#### 6.2.2 工作空间配置文件

```json
// .opencowork/config.json
{
  "mcp_servers": [
    {
      "name": "project-db",
      "type": "stdio",
      "command": "./scripts/db-tool.py",
      "args": [],
      "enabled": true
    }
  ],
  "disabled_global_mcp": ["FMP"],  // 在此工作空间禁用的全局 MCP
  "model": {
    "preferred_endpoint": "Local",  // 可选：工作空间首选模型配置
    "preferred_model": "claude-3-opus"
  },
  "allowed_tools": ["Read", "Write", "Edit", "Bash", "Glob"]  // 可选：覆盖全局工具权限
}
```

#### 6.2.3 MCP 服务器合并逻辑

```python
def get_effective_mcp_servers(global_config, workspace_config):
    """计算工作空间的有效 MCP 服务器列表"""

    # 1. 从全局配置获取 MCP 服务器
    global_servers = global_config.get("mcp_servers", [])

    # 2. 过滤掉工作空间禁用的全局服务器
    disabled = set(workspace_config.get("disabled_global_mcp", []))
    active_global = [s for s in global_servers if s["name"] not in disabled]

    # 3. 添加工作空间专属服务器
    workspace_servers = workspace_config.get("mcp_servers", [])

    # 4. 合并（工作空间优先，可覆盖同名全局服务器）
    server_map = {s["name"]: s for s in active_global}
    for ws_server in workspace_servers:
        server_map[ws_server["name"]] = ws_server

    return list(server_map.values())
```

#### 6.2.4 Settings UI 更新

Settings 面板需要区分全局配置和工作空间配置：

```
┌─────────────────────────────────────────────┐
│  Settings                                   │
├─────────────────────────────────────────────┤
│  [Global] [Workspace: my-app]               │  <- Tab 切换
├─────────────────────────────────────────────┤
│                                             │
│  MCP Servers                                │
│  ┌─────────────────────────────────────┐    │
│  │ ☑ FMP (global)                      │    │
│  │ ☑ Doc (global)                      │    │
│  │ ☑ project-db (workspace)        [x] │    │
│  │                                     │    │
│  │ [+ Add MCP Server]                  │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  Model Preferences                          │
│  ┌─────────────────────────────────────┐    │
│  │ ○ Use global settings               │    │
│  │ ● Override for this workspace       │    │
│  │   Endpoint: [Local        ▼]        │    │
│  │   Model:    [claude-3-opus▼]        │    │
│  └─────────────────────────────────────┘    │
│                                             │
└─────────────────────────────────────────────┘
```

### 6.3 快速切换

- **Cmd/Ctrl + K** → 打开工作空间/会话快速切换面板
- 支持模糊搜索工作空间和会话名称

---

## 7. 实现顺序

### Phase 1: 基础架构
1. 创建 `WorkspaceStorage` 类
2. 创建 `Workspace` 相关 API endpoints
3. 更新 Session API 支持 workspace 作用域

### Phase 2: 前端基础
1. 创建 `WorkspaceProvider` 和 hooks
2. 创建 `WorkspaceSidebar` 组件
3. 集成到 DockviewMain

### Phase 3: 功能完善
1. 实现工作空间切换联动（文件浏览器、终端）
2. 实现数据迁移脚本和 UI
3. 工作空间级 MCP 配置管理
4. Settings UI 支持全局/工作空间配置切换

### Phase 4: 增强功能
1. 工作空间记忆系统
2. MCP 服务器合并逻辑优化
3. 快速切换面板

---

## 8. 技术考虑

### 8.1 性能

- 只加载当前工作空间的会话列表
- 懒加载其他工作空间的会话数量
- 使用 IndexedDB 缓存最近访问的工作空间元数据

### 8.2 安全

- `.opencowork/` 默认添加到 `.gitignore`
- 敏感信息（如 API keys）不存储在工作空间目录

### 8.3 同步（未来可能）

- 可选的云同步功能
- 仅同步会话元数据，不同步完整消息历史
- 或使用 Git 作为同步机制

---

## 9. 总结

本设计方案将 OpenCowork 从单一工作目录模式升级为多工作空间模式，主要优势：

1. **项目隔离**：每个项目有独立的会话历史、MCP 配置和记忆
2. **便携性**：工作空间数据随项目目录迁移
3. **直观性**：工作空间与目录一一对应，符合开发者习惯
4. **灵活配置**：全局 + 工作空间两级配置，支持继承和覆盖
5. **SDK 兼容**：Skills 由 Claude Agent SDK 从 `.claude/` 自动识别

设计保持了现有 Session 概念的连续性，同时引入 Workspace 作为更高层级的组织单位。
