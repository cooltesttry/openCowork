# Team Agent 完整说明文档

本文档整理了 Claude Code Team Agent 的所有工具定义、使用指南、最佳实践和反模式，供 Leader Agent 在团队协作中参考。

---

## 1. 工具总览

Team Agent 系统包含 12 个工具，分为 5 类：

| 类别 | 工具 | 一句话简介 |
|------|------|-----------|
| **团队管理** | `TeamCreate` | 创建团队和对应的任务列表 |
| | `TeamDelete` | 清理团队资源（需先关闭所有成员） |
| **任务管理** | `TaskCreate` | 创建新任务 |
| | `TaskUpdate` | 更新任务状态、描述、依赖和负责人 |
| | `TaskGet` | 获取单个任务的完整详情 |
| | `TaskList` | 列出所有任务的摘要状态 |
| **通信** | `SendMessage` | 发送消息、广播、关闭请求/响应、计划审批 |
| **Agent 调度** | `Task` | 生成子 Agent（队友或独立 Agent） |
| | `TaskOutput` | 获取后台运行的 Agent 输出 |
| | `TaskStop` | 停止正在运行的后台任务 |
| **计划** | `EnterPlanMode` | 进入计划模式（只能研究，不能修改文件） |
| | `ExitPlanMode` | 提交计划供用户审批 |

---

## 2. 工具详细定义

### 2.1 TeamCreate

创建新团队，同时创建团队配置文件和任务列表目录。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `team_name` | string | ✅ | 团队名称 |
| `description` | string | ❌ | 团队描述/用途 |
| `agent_type` | string | ❌ | 团队 Leader 的类型标识 |

**创建的资源：**
- 团队配置：`~/.claude/teams/{team-name}/config.json`
- 任务列表：`~/.claude/tasks/{team-name}/`

**config.json 结构：**
包含 `members` 数组，每个成员有：
- `name`：人类可读的名称（**始终使用此名称**进行通信和任务分配）
- `agentId`：唯一标识符（仅供内部引用）
- `agentType`：Agent 类型

---

### 2.2 TeamDelete

删除团队及其任务目录。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `reason` | string | ✅ | 删除原因 |

**注意：** 如果团队仍有活跃成员，删除会失败。必须先通过 `shutdown_request` 关闭所有队友。

---

### 2.3 TaskCreate

创建新任务，默认状态为 `pending`。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `subject` | string | ✅ | 简短的任务标题（祈使句） |
| `description` | string | ✅ | 详细描述，包含上下文和验收标准 |
| `activeForm` | string | ❌（强烈建议） | 进行时形式，在 spinner 中显示 |
| `metadata` | object | ❌ | 附加元数据，包含 `reason` 字段 |

**示例：**
```
TaskCreate:
  subject: "Implement user registration API"
  description: |
    实现用户注册接口 POST /api/users/register

    要求：
    - 接受 email, password, name
    - 密码用 bcrypt 加密
    - 返回 JWT token
    - 添加输入验证

    完成后向 leader 报告时请包含：
    1. 修改/创建了哪些文件
    2. 关键实现决策及原因
    3. 测试运行结果
    4. 是否有遗留问题或风险
  activeForm: "Implementing user registration API"
```

---

### 2.4 TaskUpdate

更新已有任务的各种属性。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `taskId` | string | ✅ | 任务 ID |
| `status` | string | ❌ | `pending` / `in_progress` / `completed`（另有 `deleted` 用于删除） |
| `subject` | string | ❌ | 新标题 |
| `description` | string | ❌ | 新描述 |
| `activeForm` | string | ❌ | 新的进行时形式 |
| `owner` | string | ❌ | 负责人（Agent 名称） |
| `addBlocks` | string[] | ❌ | 此任务阻塞的任务 ID 列表 |
| `addBlockedBy` | string[] | ❌ | 阻塞此任务的任务 ID 列表 |
| `metadata` | object | ❌ | 合并元数据（设 key 为 null 可删除） |

**常见操作：**
```
# 分配任务
TaskUpdate: taskId="1", owner="backend-dev"

# 标记完成
TaskUpdate: taskId="1", status="completed"

# 设置依赖
TaskUpdate: taskId="2", addBlockedBy=["1"]

# 删除任务
TaskUpdate: taskId="3", status="deleted"
```

---

### 2.5 TaskGet

获取单个任务的完整详情。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `taskId` | string | ✅ | 任务 ID |

**返回内容：** subject, description, status, blocks, blockedBy

**使用时机：** 开始工作前获取完整上下文，理解任务依赖关系。

---

### 2.6 TaskList

列出所有任务的摘要。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `reason` | string | ✅ | 查看原因 |

**返回内容：** 每个任务的 id, subject, status, owner, blockedBy

**使用时机：** 检查整体进度、查找可分配的任务、完成任务后寻找下一个。

---

### 2.7 SendMessage

团队内通信工具，支持 5 种消息类型。

**通用参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | ✅ | 消息类型（见下文） |

**type: "message" — 直接消息**

| 参数 | 必填 | 说明 |
|------|------|------|
| `recipient` | ✅ | 目标队友名称 |
| `content` | ✅ | 消息正文（自由文本） |
| `summary` | ✅ | 5-10 词摘要，在 UI 中预览 |

**type: "broadcast" — 广播消息**

| 参数 | 必填 | 说明 |
|------|------|------|
| `content` | ✅ | 广播内容 |
| `summary` | ✅ | 5-10 词摘要 |

⚠️ **成本警告：** 广播会向每个队友分别发送一条消息。N 个队友 = N 次投递。仅在关键的全团队事项时使用。

**type: "shutdown_request" — 请求关闭队友**

| 参数 | 必填 | 说明 |
|------|------|------|
| `recipient` | ✅ | 目标队友名称 |
| `content` | ❌ | 关闭原因 |

**type: "shutdown_response" — 响应关闭请求**

| 参数 | 必填 | 说明 |
|------|------|------|
| `request_id` | ✅ | 请求 ID（从收到的 JSON 消息中提取） |
| `approve` | ✅ | `true` 同意关闭 / `false` 拒绝 |
| `content` | ❌ | 拒绝时的原因 |

**type: "plan_approval_response" — 审批队友的计划**

| 参数 | 必填 | 说明 |
|------|------|------|
| `request_id` | ✅ | 请求 ID |
| `recipient` | ✅ | 提交计划的队友名称 |
| `approve` | ✅ | `true` 通过 / `false` 驳回 |
| `content` | ❌ | 驳回时的反馈 |

---

### 2.8 Task（生成 Agent）

生成子 Agent，可以是独立的也可以加入团队。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `description` | string | ✅ | 3-5 词的短描述 |
| `prompt` | string | ✅ | 详细的任务指令 |
| `subagent_type` | string | ✅ | Agent 类型（见下表） |
| `name` | string | ❌ | Agent 名称（加入团队时必须） |
| `team_name` | string | ❌ | 加入的团队名称 |
| `mode` | string | ❌ | 权限模式 |
| `model` | string | ❌ | 使用的模型 |
| `run_in_background` | boolean | ❌ | 是否后台运行 |
| `resume` | string | ❌ | 恢复之前的 Agent（传入 Agent ID） |
| `max_turns` | integer | ❌ | 最大对话轮次 |

**subagent_type 枚举：**

| 类型 | 可用工具 | 适用场景 |
|------|----------|----------|
| `general-purpose` | 所有工具（包括 Edit, Write, Bash） | 编写代码、编辑文件、运行命令 |
| `Explore` | 只读工具（Glob, Grep, Read, WebSearch, WebFetch） | 搜索、研究、代码库探索 |
| `Plan` | 只读工具（同 Explore） | 方案设计、架构规划 |
| `Bash` | 仅 Bash | git 操作、命令执行 |

⚠️ **关键规则：** 不要将实现类任务分配给只读 Agent（Explore, Plan）。它们无法编辑或写入文件。

**mode 枚举：**

| 模式 | 含义 |
|------|------|
| `default` | 默认权限，需要用户确认 |
| `acceptEdits` | 自动接受文件编辑 |
| `bypassPermissions` | 跳过所有权限检查 |
| `dontAsk` | 不向用户提问 |
| `plan` | 要求队友先提交计划供审批 |
| `delegate` | 委托模式 |

**model 枚举：**

| 模型 | 适用场景 |
|------|----------|
| `opus` | 最强能力，复杂推理任务 |
| `sonnet` | 能力与速度的平衡 |
| `haiku` | 最快速度，简单任务，节省成本 |

---

### 2.9 TaskOutput

获取后台运行的任务输出。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `task_id` | string | ✅ | 任务 ID |
| `block` | boolean | ✅ | 是否等待任务完成 |
| `timeout` | number | ✅ | 最大等待时间（毫秒，最大 600000） |

---

### 2.10 TaskStop

停止正在运行的后台任务。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `_` | boolean | ✅ | 占位参数 |
| `task_id` | string | ❌ | 要停止的任务 ID |

---

### 2.11 EnterPlanMode

进入计划模式，用于方案设计。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `reason` | string | ✅ | 进入计划模式的原因 |

**限制：** 计划模式中不能使用 Edit、Write、NotebookEdit 工具，只能研究和设计。

---

### 2.12 ExitPlanMode

提交计划供用户审批并退出计划模式。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `_` | boolean | ✅ | 占位参数 |
| `allowedPrompts` | array | ❌ | 实施计划所需的权限描述 |
| `pushToRemote` | boolean | ❌ | 是否推送到远程 session |

**注意：** 不要用 AskUserQuestion 问「计划可以吗？」——ExitPlanMode 本身就是在请求用户审批。

---

## 3. 计划创建指南

### 3.1 Plan Mode 的两层含义

Team Agent 中的「计划」有两层：

| 层次 | 工具 | 目的 | 时机 |
|------|------|------|------|
| **方案设计** | `EnterPlanMode` / `ExitPlanMode` | 与用户对齐实现方案 | 编码前 |
| **任务拆解** | `TaskCreate` + `TaskUpdate` | 将方案分解为可执行的任务单元 | 用户批准方案后 |

- Plan Mode 是**一次性的**预执行流程，执行过程中不能重新进入
- 任务拆解是方案获批后的执行层操作

### 3.2 何时进入 Plan Mode

当以下**任一**条件成立时，使用 EnterPlanMode：

| 场景 | 示例 |
|------|------|
| **新功能实现** | 「添加用户认证」—— 涉及架构决策（session vs JWT、存储位置、中间件结构） |
| **多种可行方案** | 「添加缓存」—— Redis vs 内存 vs 文件 |
| **修改现有行为** | 「更新登录流程」—— 需要明确什么变化 |
| **架构决策** | 「实时更新」—— WebSocket vs SSE vs polling |
| **多文件变更** | 重构涉及 3+ 文件 |
| **需求不清晰** | 「让应用更快」—— 需要先分析瓶颈 |

### 3.3 何时不需要 Plan Mode

- **简单修复：** 单行/几行改动（拼写错误、明显 bug）
- **需求明确的单函数任务：** 用户给出了非常具体的指令
- **研究型任务：** 纯粹的信息收集和代码理解（用 Explore Agent）

> 系统指令原文：「Only use this tool when the task requires planning the implementation steps of a task that requires writing code. For research tasks where you're gathering information, searching files, reading files or in general trying to understand the codebase - do NOT use this tool.」

### 3.4 Plan Mode 中的流程

1. 使用 Glob, Grep, Read **深入探索**代码库
2. 理解现有模式和架构
3. 设计实现方案
4. 如需澄清，使用 **AskUserQuestion**（不要只问「计划可以吗？」）
5. 写好计划后使用 **ExitPlanMode** 提交审批

### 3.5 Plan Mode 的限制

在计划模式中**不能：**
- 编辑文件（Edit）
- 写入文件（Write）
- 编辑 Notebook（NotebookEdit）

**只能**研究和设计方案。

### 3.6 计划内容应回答的四个问题

| 问题 | 内容 |
|------|------|
| **What**（做什么） | 需要变更的模块、文件、组件 |
| **How**（怎么做） | 实现方式、要遵循的模式 |
| **Why**（为什么） | 选择此方案而非其他方案的理由 |
| **Dependencies**（依赖） | 各部分工作之间的依赖关系 |

---

## 4. 任务管理指南

### 4.1 何时创建任务列表

**需要创建的情况：**
1. 任务需要 3 个或以上独立步骤
2. 工作非简单任务，有跟踪价值
3. 用户提供了多个待办事项
4. 在协调多个 Agent 的团队中
5. 使用 Plan Mode 后需要跟踪实施

**不需要的情况：**
1. 只有一个简单任务
2. 少于 3 个简单步骤即可完成
3. 纯对话或信息查询
4. 研究型任务（通常不需要）

### 4.2 命名规范

| 字段 | 语态 | 示例 |
|------|------|------|
| `subject` | 祈使句 | "Fix authentication bug in login flow" |
| `activeForm` | 现在进行时 | "Fixing authentication bug" |

两者必须对应：subject 用 "Run tests"，activeForm 用 "Running tests"。

### 4.3 description 质量要求

description 必须**详细到一个没有任何上下文的 Agent 能独立完成任务**。应包含：

- 需要创建或修改哪些文件
- 预期行为和验收标准
- 相关技术细节（API、数据结构、要遵循的约定）
- 对代码库中相关文件或模式的引用
- （可选）完成后的报告要求

### 4.4 粒度对照表

每个任务应该是一个 Agent 一轮工作能完成的单元：

| 太粗 ❌ | 合适 ✅ | 太细 ❌ |
|---------|---------|---------|
| "构建整个后端" | "实现用户注册 API" | "创建 users 表的 name 字段" |
| "创建前端" | "构建登录表单组件" | "给提交按钮加样式" |

### 4.5 状态管理规则

**状态流转：** `pending` → `in_progress` → `completed`

- 新任务默认 `pending`
- 开始工作**前**标记为 `in_progress`
- **只有完全完成后**才标记 `completed`

**不能标记 `completed` 的 4 种情况：**
1. 测试失败
2. 实现不完整
3. 存在未解决的错误
4. 找不到必要的文件或依赖

遇到阻塞或错误时，保持 `in_progress`，创建新任务描述需要解决的问题。

### 4.6 依赖管理

**只在真正的依赖关系时设置 `blockedBy`** —— 任务 B 确实需要任务 A 的产出才能开始。

**真依赖（应该设置）：**
- Schema/类型必须先于使用它们的代码
- 核心基础设施先于依赖它的功能
- 实现先于集成测试

**假依赖（不应该设置）：**
- 前端**不**一定要等后端（可以用 mock 数据）
- 测试可以与实现**并行**编写（TDD 风格）
- 独立功能**永远不应该**互相阻塞

### 4.7 任务排序原则

创建任务时，让 ID 反映执行优先级（Agent 默认按 ID 从小到大领取任务）：

1. **基础任务**（schema、配置、共享类型）→ 最小 ID
2. **核心实现**（主要业务逻辑）
3. **依赖功能**（建立在核心之上的功能）
4. **集成测试**（最后）→ 最大 ID

---

## 5. 团队组建与管理

### 5.1 何时需要团队

**需要：**
- 工作可以在多个 Agent 间有意义地并行化
- 任务有独立的子问题可同时处理
- 范围大到单个 Agent 效率太低

**不需要：**
- 所有任务都是串行的硬依赖
- 单个 Agent 能高效处理
- 协调开销超过收益

### 5.2 Agent 类型选择

| 任务类型 | Agent 类型 (`subagent_type`) | 可用工具 |
|----------|------------------------------|----------|
| 写代码、编辑文件、运行命令 | `general-purpose` | 所有工具 |
| 搜索、研究、阅读代码 | `Explore` | 只读（Glob, Grep, Read, WebSearch, WebFetch） |
| 设计架构、规划方案 | `Plan` | 只读（同 Explore） |
| 运行命令、git、构建 | `Bash` | 仅 Bash |

**关键规则：** 不要将实现类任务分配给只读 Agent（Explore, Plan），它们无法编辑或写入文件。

### 5.3 团队规模建议

- 匹配 Agent 数量与可并行的工作量
- 不要创建比独立任务更多的 Agent
- **2-4 个 Agent 是典型规模**；更多会增加协调开销
- 考虑 Agent 之间是否会冲突（编辑同一文件）

### 5.4 命名规范

| 好 ✅ | 差 ❌ |
|-------|-------|
| `backend-dev` | `agent-1` |
| `frontend-dev` | `agent-2` |
| `test-writer` | `agent-3` |

使用描述性角色名，不用编号。

### 5.5 完整生命周期流程

```
1. TeamCreate          → 创建团队
2. TaskCreate (×N)     → 创建多个任务
3. TaskUpdate          → 设置任务间的依赖关系
4. Task (×N)           → 生成多个队友（指定 team_name 和 name）
5. TaskUpdate          → 给队友分配任务（设 owner）
6. SendMessage         → 队友间协作沟通
7. TaskUpdate          → 队友完成后标记 completed
8. SendMessage         → shutdown_request 关闭所有队友
9. TeamDelete          → 清理团队资源
```

### 5.6 团队配置发现

队友可以通过读取配置文件发现其他成员：

- **配置位置：** `~/.claude/teams/{team-name}/config.json`
- 包含 `members` 数组，每个成员有 `name`, `agentId`, `agentType`
- **始终使用 `name`** 进行通信和任务分配，不要使用 UUID

### 5.7 Teammate Idle 状态说明

队友每轮对话后都会进入 idle 状态 —— **这是完全正常和预期的行为**。

- **Idle ≠ 出错或不可用**。队友发完消息后进入 idle 是正常流程
- Idle 的队友**可以接收消息**。发消息会唤醒他们
- Idle 通知是系统自动发送的，不需要对每个 idle 通知做出反应
- 不要将 idle 视为错误或需要处理的异常

### 5.8 自动消息投递机制

- 队友的消息会**自动投递**给你，不需要手动检查收件箱
- 如果你正在忙（mid-turn），消息会排队，在你的回合结束时投递
- 当队友向另一个队友发 DM 时，你会在 idle 通知中看到简短摘要
- 这些摘要是信息性的，不需要回应

---

## 6. 执行管理

### 6.1 任务分配流程

1. 生成队友后立即分配初始任务
2. 队友完成任务时，检查 TaskList 看有无新的可用任务
3. 分配下一个可用任务（**优先选择最小 ID**）
4. 被阻塞的任务（有未完成的 blockedBy）不能被领取

### 6.2 通信方式

| 方式 | 使用场景 |
|------|----------|
| `type: "message"` | **默认使用**。回复单个队友、正常来回沟通、跟进任务、分享发现 |
| `type: "broadcast"` | **谨慎使用**。仅用于需要所有人立即注意的关键事项（如阻塞性 bug） |

⚠️ 广播是昂贵的 —— N 个队友 = N 次消息投递。绝大多数情况应该用直接消息。

**关键规则：** 队友的纯文本输出对其他人**不可见**。必须使用 SendMessage 进行所有团队通信。

### 6.3 中途修改计划

Team Agent **没有内置的「暂停重新规划」机制**。修改是通过任务级操作增量完成的：

**可用的修改手段：**
- **TaskCreate** —— 随时创建新任务
- **TaskUpdate** —— 修改现有任务的描述、依赖、状态；删除不再需要的任务
- **SendMessage** —— 通知队友方向变化
- 重新分配 —— 通过 TaskUpdate 更改任务的 `owner`

**不能做的事：**
- 重新进入 Plan Mode 让用户重新审批（Plan Mode 是一次性的）
- 撤销已完成的任务（代码已写好，只能创建新任务来修改或回滚）
- 自动暂停正在执行的队友（需要发消息通知）

### 6.4 不同影响程度的处理方式

```
执行中发现问题
  │
Leader 评估影响
  │
  ├── 小调整 → 直接创建/修改任务，发消息通知相关队友
  │
  ├── 方向变更 → broadcast 通知所有人，重新组织任务
  │
  └── 根本性问题 → 停止当前工作，与用户沟通确认新方向
```

### 6.5 修改的增量本质

> Team Agent 的「计划修改」是**渐进式的** —— 通过不断创建、更新、删除任务来适应变化，而不是推倒重来。这也符合实际软件开发中敏捷迭代的方式。

---

## 7. 结果提交与审核

### 7.1 Sub Agent 报告规范

**系统级别没有固定格式。** SendMessage 的 `content` 是自由文本，队友发什么取决于：
1. Leader 是否在任务 description 中指定了报告要求
2. 队友自己的判断

**SendMessage 结构：**
```json
{
  "type": "message",
  "recipient": "team-lead",
  "content": "自由文本，无格式要求",
  "summary": "5-10 词的摘要"
}
```

### 7.2 禁止发送 JSON 状态消息

> 系统指令原文：「Do NOT send structured JSON status messages like `{"type":"idle",...}` or `{"type":"task_completed",...}`. Just communicate in plain text.」

队友应使用自然语言通信，不要发结构化的 JSON 状态消息。

### 7.3 推荐做法：在 TaskCreate 的 description 中指定报告要求

```
TaskCreate:
  subject: "Implement user registration API"
  description: |
    实现用户注册接口 POST /api/users/register
    ...

    完成后向 leader 报告时请包含：
    1. 修改/创建了哪些文件
    2. 关键实现决策及原因
    3. 测试运行结果
    4. 是否有遗留问题或风险
```

### 7.4 报告建议内容

1. **任务编号和状态** —— "Task #N 完成"
2. **变更文件列表** —— 列出所有修改或创建的文件路径
3. **关键决策** —— 如果做了非显而易见的选择，说明原因
4. **验证结果** —— 测试是否通过，手动验证结果
5. **遗留问题** —— 未解决的问题、潜在风险、对后续任务的影响

### 7.5 示例报告

```
SendMessage:
  type: "message"
  recipient: "team-lead"
  summary: "User registration API completed"
  content: |
    Task #1 完成。

    修改的文件：
    - src/routes/auth.ts — 新增 POST /api/users/register 路由
    - src/models/user.ts — 新增 User model 和验证逻辑
    - src/middleware/validation.ts — 新增注册请求的 schema 验证
    - tests/auth.test.ts — 添加了 5 个测试用例

    关键决策：
    - 使用 bcrypt（cost factor 12）加密密码
    - JWT 过期时间设为 24h，与项目中 login 接口保持一致

    测试结果：
    - 5/5 通过

    无遗留问题。
```

### 7.6 Leader 审核流程

系统**没有专用的审核工具**。审核通过组合现有机制完成：

```
队友发消息："Task #3 完成，实现了用户注册 API"
  │
Leader 收到消息
  │
1. Read 相关文件，检查代码质量和正确性
2. Bash 运行测试（单元测试、集成测试）
3. 对照任务 description 中的验收标准逐项核对
  │
判断结果
  ├── 通过 → 确认任务完成，给队友分配下一个任务
  ├── 小问题 → SendMessage 告知队友具体问题，要求修改
  └── 大问题 → 创建新任务描述修复工作，分配给同一个或其他队友
```

### 7.7 审核信息来源

1. **队友消息通知** —— 通过 SendMessage 收到的完成报告
2. **任务状态** —— 通过 TaskList / TaskGet 查看完成情况和验收标准
3. **直接检查产出** —— Read 读文件、Grep 搜索实现、Bash 跑测试

### 7.8 审核失败的处理方式

| 问题严重程度 | 处理方式 |
|------------|----------|
| **小瑕疵** | SendMessage 通知队友，让其修复 |
| **逻辑错误** | 将任务状态改回 `in_progress`，发消息说明问题 |
| **方向错误** | 创建新的修复任务，设置新的依赖关系 |
| **与其他工作冲突** | 协调相关队友，决定由谁解决冲突 |

### 7.9 Plan Approval 特殊机制

如果队友以 `mode: "plan"` 生成，队友会在执行前提交计划：

1. 队友调用 `ExitPlanMode` → Leader 收到 `plan_approval_request`
2. Leader 使用 `SendMessage(type: "plan_approval_response")` 审批或驳回
3. 如果驳回，附上反馈；队友修改后重新提交

这是**唯一的预执行审核机制** —— 在队友开始工作前审核方案，而非事后审核结果。

### 7.10 审核的固有局限性

- **没有代码审查工具** —— Leader 只能通过 Read 手动检查文件
- **没有自动化质量门** —— Leader 需要主动运行测试
- **没有回滚机制** —— 发现问题只能创建新任务修复
- **依赖 Leader 的主动性** —— 系统不强制审核

> 最佳实践：「设置清晰的验收标准（写在任务 description 里）和要求队友运行测试后再报告完成，比事后审核更有效。」

---

## 8. 研究型任务

### 8.1 与实现类任务的对比

| | 实现型任务 | 研究型任务 |
|---|---|---|
| **目标** | 产出代码/文件变更 | 产出信息/理解/答案 |
| **进入 Plan Mode？** | 通常是 | **不应该** |
| **创建任务列表？** | 复杂时需要 | **通常不需要** |
| **主要工具** | Edit, Write, Bash | Grep, Glob, Read, WebSearch, WebFetch |
| **适合的 Agent 类型** | `general-purpose` | `Explore` |

### 8.2 系统级规则

> 「Only use this tool [EnterPlanMode] when the task requires planning the implementation steps of a task that requires writing code. For research tasks... do NOT use this tool.」

> 「When NOT to Use [TaskCreate]: The task is purely conversational or informational」

### 8.3 决策流程图

```
用户请求
  │
是否需要写代码？
  ├── 是 → 评估复杂度 → Plan Mode / TaskCreate / Team
  └── 否（研究型）
        │
      简单直接搜索能解决？
        ├── 是 → 直接 Glob/Grep/Read
        └── 否
              │
            需要多少轮查询？
              ├── ≤3 轮 → 直接用工具
              └── >3 轮 → 用 Explore Agent
                    │
                  能并行拆分吗？
                    ├── 是 → 多个 Explore Agent 并行
                    └── 否 → 单个 Explore Agent，very thorough 模式
```

### 8.4 三个复杂度级别的处理方式

**简单研究 —— 直接使用工具：**
用户问：「这个项目的路由是怎么组织的？」
→ 直接 Glob + Grep + Read，不需要 Agent 也不需要任务列表。

**中等复杂度 —— 使用 Explore Agent：**
用户问：「帮我分析这个项目的依赖关系和架构」
→ 启动一个 Explore Agent，指定 thoroughness 级别（`quick` / `medium` / `very thorough`）。

**高复杂度 —— 多个 Explore Agent 并行：**
用户问：「对比分析这三个微服务的认证实现方式」
→ 同时启动多个 Explore Agent，各负责一个微服务，最后汇总结果：
```
// 在同一条消息中并行启动
Task(subagent_type="Explore", prompt="分析 service-A 的认证实现")
Task(subagent_type="Explore", prompt="分析 service-B 的认证实现")
Task(subagent_type="Explore", prompt="分析 service-C 的认证实现")
```

### 8.5 核心原则

> 研究型任务的原则是「用最轻量的方式获取信息」—— 能直接搜就不起 Agent，能起单个 Agent 就不建团队，尽量并行以提高效率。

---

## 9. 反模式

### 9.1 十条反模式

| # | 反模式 | 说明 |
|---|--------|------|
| 1 | **过度规划** | 不要为简单任务做计划。修拼写不需要 Plan Mode。 |
| 2 | **过度分解** | 不要创建 20 个小任务。每个任务应该有意义。 |
| 3 | **假依赖** | 不要把所有任务都串行化。前端不一定等后端、测试可以与实现并行、独立功能不应互相阻塞。 |
| 4 | **Agent 过载** | 不要为 3 个任务生成 8 个 Agent。Agent 数量不应超过独立任务数。 |
| 5 | **模糊描述** | 「Fix the thing」没用。description 要详细到无上下文的 Agent 能独立完成。 |
| 6 | **提前标完成** | 测试失败、实现不完整、存在未解决的错误时不能标 `completed`。 |
| 7 | **忽略现有代码** | 不要对没读过的代码提出修改建议。先 Explore 再动手。 |
| 8 | **过度工程** | 只做当前需要的。不要加未请求的功能、不必要的错误处理、假设性的未来需求。三行相似代码好过一个过早的抽象。 |
| 9 | **重复工作** | 如果已经委托 Agent 搜索，不要自己再做同样的搜索。 |
| 10 | **滥用广播** | 默认用直接消息。广播只用于需要全团队立即关注的关键事项。 |

### 9.2 补充指导原则

- **读后再改：** 不要对没读过的代码提出修改建议
- **谨慎操作：** 可逆的本地操作可以自由执行；不可逆或影响共享系统的操作要先确认
- **核心哲学：** 做最少必要的事，但把每件事做完整

---

## 附录

### A. 完整工作流程图

```
用户需求
  │
评估复杂度
  ├── 简单 → 直接执行
  └── 复杂 → 进入 Plan Mode
                │
              探索代码库，理解约束
                │
              设计方案，提交用户审批 (ExitPlanMode)
                │
              用户批准
                │
              TaskCreate (×N) — 将方案拆解为任务
                │
              TaskUpdate — 设好依赖关系 (blockedBy)
                │
              TeamCreate — 创建团队
                │
              Task (×N) — 生成队友
                │
              TaskUpdate — 分配初始任务 (owner)
                │
              执行循环：
              ┌─────────────────────────────┐
              │ 队友执行 → 报告完成          │
              │ Leader 审核 → 分配下一个任务  │
              │ 处理问题 → 调整计划          │
              └─────────────────────────────┘
                │
              所有任务完成
                │
              SendMessage (shutdown_request) → 关闭所有队友
                │
              TeamDelete → 清理资源
```

### B. 实例：Blog 系统

**场景：** 用户要求「帮我构建一个全栈博客系统」

**Step 1: 评估** — 新功能、多文件、有架构决策 → 进入 Plan Mode

**Step 2: 在 Plan Mode 中研究** — 探索现有代码结构、技术栈、模式

**Step 3: 设计方案并提交审批** — 技术选型、模块划分、Agent 分工

**Step 4: 用户批准后，创建团队和任务：**

```
TeamCreate: team_name="blog"

TaskCreate #1: "Set up database schema"
TaskCreate #2: "Implement backend API endpoints"
TaskCreate #3: "Build frontend blog list page"
TaskCreate #4: "Build frontend blog detail page"
TaskCreate #5: "Add authentication"
TaskCreate #6: "Write integration tests"

TaskUpdate: #2 blockedBy [#1]
TaskUpdate: #3 blockedBy [#2]
TaskUpdate: #4 blockedBy [#2]
TaskUpdate: #5 blockedBy [#2]
TaskUpdate: #6 blockedBy [#3, #4, #5]
```

**依赖关系可视化：**
```
#1 Schema
  └── #2 Backend API
        ├── #3 Blog List Page
        ├── #4 Blog Detail Page
        └── #5 Authentication
              │
              └── #6 Integration Tests (等 #3, #4, #5 全完成)
```

**Step 5: 生成队友并分配：**
```
Task(subagent_type="general-purpose", name="backend-dev", team_name="blog")
Task(subagent_type="general-purpose", name="frontend-dev", team_name="blog")

TaskUpdate: #1 owner="backend-dev"
// #1 完成后 → #2 分给 backend-dev
// #2 完成后 → #3 分给 frontend-dev, #5 分给 backend-dev
// 以此类推...
```

### C. 任务删除详解

通过 `TaskUpdate` 设置 `status: "deleted"` 删除任务：

| 任务状态 | 能删吗？ | 注意事项 |
|----------|---------|----------|
| `pending`，无 owner | ✅ 无风险 | 不需要通知任何人 |
| `pending`，有 owner | ✅ | 通知 owner 不要开始 |
| `in_progress` | ✅ | **必须**通知执行中的队友立即停止 |
| `completed` | ✅ 但无意义 | 代码已经写好，删任务不会撤销变更 |

**关键：** 系统**不会自动通知**被删任务的执行者。Leader 必须手动发消息。

**删除流程：**
```
发现 Task #3 不再需要
  │
1. SendMessage 通知 owner 停止工作（如果有 owner）
2. TaskUpdate: taskId="#3", status="deleted"
3. 检查是否有任务 blockedBy #3，如有则更新依赖
4. 必要时创建替代任务
```
