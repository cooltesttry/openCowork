# Super Agent 架构文档

本文档详细描述 Super Agent 系统的工作流程、组件职责以及 Prompt 设计。

---

## 1. 系统概述

Super Agent 是一个自主任务执行系统，采用 **Worker-Checker 循环架构**，确保任务质量和可靠性。

```
┌─────────────────────────────────────────────────────────────┐
│                      Super Agent Session                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────┐    ┌─────────┐    ┌─────────┐                │
│   │  Cycle  │───▶│  Cycle  │───▶│  Cycle  │ ...            │
│   │    1    │    │    2    │    │    N    │                │
│   └─────────┘    └─────────┘    └─────────┘                │
│                                                             │
│   每个 Cycle:                                               │
│   ┌─────────┐    ┌─────────┐                               │
│   │ Worker  │───▶│ Checker │                               │
│   │ (执行)  │    │ (验证)  │                               │
│   └─────────┘    └─────────┘                               │
│        │              │                                     │
│        ▼              ▼                                     │
│   __output.json   verdict:                                  │
│                   - passed → 结束                          │
│                   - needs_improvement → 继续               │
│                   - failed → 继续                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 完整循环流程

### 2.1 Session 生命周期事件

| 事件类型 | 描述 | 触发时机 |
|---------|------|---------|
| `session_start` | Session 开始 | 创建新 Session 时 |
| `cycle_start` | Cycle 开始 | 每个循环开始时 |
| `worker_start` | Worker 开始执行 | 调用 Worker 前 |
| `worker_tool_call` | Worker 使用工具 | 每次工具调用时 |
| `worker_tool_result` | 工具返回结果 | 工具执行完成时 |
| `worker_complete` | Worker 完成 | Worker 返回时 |
| `checker_start` | Checker 开始验证 | 调用 Checker 前 |
| `checker_stream` | Checker 输出流 | Checker 生成响应时 |
| `checker_complete` | Checker 完成 | Checker 返回判决时 |
| `cycle_end` | Cycle 结束 | Checker 判决后 |
| `session_complete` | Session 完成 | 任务通过验证时 |
| `session_error` | Session 错误 | 发生异常时 |

### 2.2 循环判决逻辑

```python
if checker_result.verdict == "passed":
    # 任务完成，结束 Session
    session.status = "completed"
elif cycle_index >= max_cycles:
    # 达到最大循环数，失败
    session.status = "failed"
else:
    # 继续下一个 Cycle
    cycle_index += 1
    # 将 Checker 反馈传递给下一次 Worker 调用
    input_payload = checker_result.next_input
```

---

## 3. Worker 组件

### 3.1 职责

Worker 负责实际执行任务：
- 接收任务目标和输入
- 使用工具（读写文件、搜索、执行命令等）
- 生成交付物（文件、文本、代码等）
- 输出结构化结果到 `__output.json`

### 3.2 Worker System Prompt（Output Protocol）

```
CRITICAL OUTPUT PROTOCOL:
When you have completed the task, you MUST write your final structured response 
to a file named '__output.json' in the Current Working Directory.
The content MUST be valid JSON following this schema:
{
  "summary": "A short, single-line summary of what you achieved",
  "text_content": "Detailed text response, research findings, or explanation. (Fill this for text-based tasks)",
  "files": ["list", "of", "file_paths", "created"],
  "instruction_to_user": "Optional instructions (e.g. 'Run npm start')"
}
Notes:
- If you created files, you MUST list them in the 'files' array.
- If the result is text-only, leave 'files' empty.
Do not output the final JSON in text chat; just say you have written it.
```

### 3.3 Worker User Prompt 结构

```
Current Time: {YYYY-MM-DD HH:MM UTC}
Current Working Directory: {workspace_path}
IMPORTANT: Use the current time for any date-related tasks. Ensure all file operations are performed strictly within the Current Working Directory.

{task.objective}

{config.prompt.user}  # 可选的用户自定义 prompt

Input:
{JSON 格式的 input_payload}
```

### 3.4 Worker 配置参数

| 参数 | 描述 | 默认值 |
|-----|------|-------|
| `model` | 使用的模型 | - |
| `max_turns` | 最大对话轮数 | 50 |
| `permission_mode` | 权限模式 | `bypassPermissions` |
| `tools_allow` | 允许的工具列表 | null (全部) |
| `tools_block` | 禁止的工具列表 | null |
| `prompt.system` | 系统 prompt（会追加 Output Protocol） | - |
| `prompt.user` | 用户 prompt | - |

---

## 4. Checker 组件

### 4.1 职责

Checker 作为独立的 QA 审计员：
- **不信任** Worker 的自我报告
- **主动验证** 所有交付物（使用工具读取文件、检查代码等）
- 根据验证结果判决：passed / needs_improvement / failed
- 提供具体、可操作的改进反馈

### 4.2 Checker Judge Prompt（完整版）

```
You are an expert QA Auditor. Your job is to INDEPENDENTLY VERIFY the work submitted by an autonomous Worker.

⚠️ CRITICAL: Do NOT blindly trust the Worker's self-report. You MUST verify all claims using available tools.

# Task Objective
{task.objective}

# Expected Outcome (if specified)
{task.expected_output 或 "Not specified - use your judgment based on the objective."}

# Worker's Claimed Output
Summary: {result.summary}
Output: {result.output}
Error reported: {result.error 或 "None"}

---

# Verification Protocol

## Step 1: Identify Claimed Deliverables
What did the Worker claim to deliver? (files, code, text, research, etc.)

## Step 2: VERIFY Each Deliverable
⚠️ You MUST use tools to verify:
- **Files**: Use `Read` tool to read and verify file contents match the objective.
- **Code**: Read the code, check syntax, logic, and completeness.
- **Documents/Text**: Read and evaluate quality, accuracy, and completeness.
- **Data**: Verify data integrity and correctness.

Do NOT skip verification. Do NOT assume the Worker's report is accurate.

## Step 3: Render Verdict
After verification, respond with ONLY valid JSON (no markdown code blocks):

{
  "verdict": "failed" | "needs_improvement" | "passed",
  "reason": "Brief explanation of your verdict",
  "feedback": "Specific, actionable instructions for what to fix or improve. Leave empty if passed.",
  "verified": ["List what you actually verified with tools"]
}

### Verdict Definitions:
- **failed**: Task not completed, major errors, or Worker's claims don't match reality. Worker should retry.
- **needs_improvement**: Core task done but quality/completeness can be improved. Provide specific improvements needed.
- **passed**: Task fully completed, verified, and ready to deliver. No further work needed.
```

### 4.3 判决类型详解

| 判决 | 含义 | 后续动作 |
|-----|------|---------|
| `passed` | 任务完成，验证通过 | Session 结束，标记为 completed |
| `needs_improvement` | 核心完成但需改进 | 继续下一个 Cycle，带上改进反馈 |
| `failed` | 任务失败或验证不通过 | 继续下一个 Cycle，带上失败原因 |

### 4.4 Checker 配置

| 参数 | 值 | 说明 |
|-----|---|------|
| `model` | 与 Worker 相同 | 当前使用相同模型 |
| `max_turns` | 10 | 允许多轮工具验证 |
| `permission_mode` | `bypassPermissions` | 允许使用工具 |
| `setting_sources` | `[]` | 不加载额外配置 |

---

## 5. 数据流

### 5.1 Worker → Checker 数据传递

```
Worker 输出:
├── __output.json (结构化交付)
│   ├── summary
│   ├── text_content
│   ├── files[]
│   └── instruction_to_user
│
└── WorkerResult
    ├── status: "ok" | "error"
    ├── summary
    ├── output: {...}
    ├── artifacts: [...]
    └── error: null | string
```

### 5.2 Checker → Worker 反馈传递（下一 Cycle）

```python
next_input = {
    "review_verdict": "failed" | "needs_improvement",
    "review_feedback": "具体改进建议",
    "review_reason": "判决原因",
    "verified_items": ["已验证的内容列表"],
    "previous_attempt_summary": "上次尝试的摘要"
}
```

---

## 6. 目录结构

```
super_agent/
├── workspace/
│   └── workspace/
│       └── session-{id}/           # 每个 Session 的工作目录
│           ├── __output.json       # Worker 的结构化输出
│           ├── __output_cycle_0001.json  # 归档的历史输出
│           ├── state/
│           │   └── session.json    # Session 状态
│           └── {user_files}        # Worker 创建的文件
│
├── orchestrator.py                 # 编排器：管理循环
├── worker.py                       # Worker 实现
├── checker.py                      # Checker 实现
├── models.py                       # 数据模型定义
├── events.py                       # 事件系统
└── storage.py                      # 存储层
```

---

## 7. 配置示例

### 7.1 Worker 配置（workers.yaml）

```yaml
default:
  model: "claude-sonnet-4-20250514"
  provider: "anthropic"
  endpoint: "api.anthropic.com"
  max_turns: 50
  permission_mode: "bypassPermissions"
  prompt:
    system: |
      你是一个专业的软件开发助手。
      请认真完成用户的任务，确保代码质量和正确性。
    user: ""
  tools_allow: null
  tools_block: null
  mcp_servers: {}
```

### 7.2 任务定义

```python
TaskDefinition(
    objective="创建一个 Hello World 网页",
    expected_output={
        "files": ["index.html"],
        "requirements": ["包含标题和段落"]
    },
    inputs={}
)
```

---

## 8. 最佳实践

### 8.1 任务目标编写

- ✅ 明确、具体的目标
- ✅ 定义预期输出格式
- ✅ 提供必要的上下文
- ❌ 避免模糊、开放式目标

### 8.2 调试技巧

1. 查看 `backend/debug.log` 获取详细日志
2. 检查 `__output.json` 验证 Worker 输出
3. 查看事件流了解执行过程
4. 检查 Checker 的 verified 列表确认验证内容

---

*文档版本: 2026-01-26*
*适用于: Super Agent v1.0*
