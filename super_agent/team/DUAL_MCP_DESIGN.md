# 双 MCP 架构设计 — Plan MCP + Mailbox MCP

## Context

当前 Agent Team 系统的问题：
1. **工作目录隔离** — 每个 Worker cwd 在 `workspace/phase_N/task_XXX/`，互相不可见
2. **Scheduler 全能中间人** — Worker Agent 不知道通信的存在，Scheduler 替 Agent 读结果文件、发 mailbox、等回复、包装 prompt
3. **结果文件约定脆弱** — `__result.json` 写错目录、格式不对都会出问题

参考 Claude Team 的通信机制（`AGENT_TEAM_ARCHITECTURE_IMPLEMENTATION_ANALYSIS.md` 第 8 节、第 16.3 节）：
- Agent 调用 SendMessage 主动发邮件 → 邮件落盘 inbox → Agent turn 结束进入 idle → 系统检测 idle + inbox 有未读 → 包装为 `<teammate-message>` 注入为 user prompt → 开启新轮
- 邮件是纯文本，内容格式由 prompt 指导
- 业务结果走 SendMessage，任务状态走 TaskUpdate，解耦

目标：用两套 MCP 重构通信和计划管理，让 Agent 成为通信的主动参与者。

---

## Architecture

```
workspace/{session_id}/              ← 所有 Agent 共享此 cwd
  .team/
    config.json                      ← 团队成员信息
    plan.json                        ← Leader 通过 Plan MCP 创建/修改
    inboxes/
      lead.json                      ← Leader 的收件箱
      worker-{task_id}.json          ← 各 Worker 的收件箱
  [项目文件]                          ← 共享工作区

┌─────────────────────────────────────────────────────────┐
│ Scheduler (调度器)                                       │
│                                                          │
│  职责：                                                   │
│  1. 启动 Agent (connect + 首次 prompt)                   │
│  2. Agent idle 后检查 inbox                              │
│  3. 有未读邮件 → 包装为 prompt → query() 开启新轮        │
│  4. 无未读邮件 → 等待 inbox 有新邮件                     │
│  5. Phase 流转控制                                       │
│                                                          │
│  不再做：读结果文件、构造 Message、业务逻辑判断           │
└─────────────────────────────────────────────────────────┘

┌───────────────┐  ┌───────────────┐
│ Plan MCP      │  │ Mailbox MCP   │
│ (Leader only) │  │ (All Agents)  │
│               │  │               │
│ create_plan   │  │ send_mail     │
│ get_plan      │  │ read_inbox    │
│ update_task   │  │ list_members  │
│ modify_phases │  │               │
└───────────────┘  └───────────────┘
```

### Agent 加载关系

| Agent | Plan MCP | Mailbox MCP |
|-------|----------|-------------|
| Leader | ✅ | ✅ |
| Worker | ❌ | ✅ |

---

## 通信流程

### Worker 提交结果

```
1. Worker 执行任务（读写文件、跑代码等）
2. Worker 调用 send_mail(to="lead", content="Task #X 完成。\n修改文件：...\n测试结果：...")
   → MCP 写入 .team/inboxes/lead.json
   → 返回 "已发送"
3. Worker 的 run_async() 自然结束 → idle
4. Scheduler 检测 Worker idle
5. Scheduler 检查 Worker 的 inbox (.team/inboxes/worker-{task_id}.json)
   → 没有邮件 → 阻塞等待 (轮询文件)
6. [等待中... Leader 在审核]
```

### Leader 审核

```
1. Scheduler 检测 Leader idle
2. Scheduler 读取 Leader inbox (.team/inboxes/lead.json) 有 Worker 的提交邮件
3. Scheduler 包装 prompt：
   "来自 worker-task_001 的邮件：
    ─────────────────
    Task #task_001 完成。
    修改文件：src/main.py — 新增入口函数
    测试结果：3/3 passing
    ─────────────────
    请审核并回复。"
4. Scheduler 调用 leader.query(prompt) 开启新轮
5. Leader 审核后：
   - 通过: send_mail(to="worker-task_001", content="approved")
          + update_task(task_id="task_001", status="approved")
   - 反馈: send_mail(to="worker-task_001", content="请修改 X 部分...")
6. Leader run_async() 结束 → idle
7. 回到 Leader 调度循环 (可能还有其他 Worker 的邮件待审)
```

### Worker 收到反馈

```
1. Scheduler 检测到 Worker inbox 有新邮件 (Leader 的 approve/feedback)
2. Scheduler 包装 prompt：
   - feedback: "来自 lead 的反馈：\n─────\n请修改 X 部分...\n─────\n请根据反馈继续工作。"
   - approve: Scheduler 读 plan.json 发现 task status=="approved" → Worker 循环结束，不再投递
3. Worker 收到 feedback prompt → 继续工作 → 再次 send_mail 提交
```

### 批量投递

参照 Claude Team 的做法：如果 inbox 积压多封邮件，一次性全部注入。

---

## 任务状态

Task 状态定义（保持现有 + 理清语义）：

| 状态 | 含义 | 谁设置 |
|------|------|--------|
| `pending` | 等待执行 | 初始状态 |
| `running` | Worker 正在执行 | Scheduler 启动 Worker 时 |
| `approved` | Leader 审核通过 | Leader 调用 update_task MCP |
| `failed` | 执行失败 | Scheduler 检测到异常 / Leader 调用 update_task |

注意：**移除 `submitted` 状态**。原设计中 Scheduler 检测到 Worker 给 Lead 发邮件就标 `submitted`，但 Worker 可能发的是提问、进度同步等非提交邮件，导致状态污染。新设计中 Scheduler 不推断邮件语义，只负责投递。Task 的状态流转完全由 Leader 通过 `update_task` MCP 显式控制。

状态流转：
```
pending → running → approved
                  → failed
```

如果需要区分邮件类型（提交结果 vs 提问），由 **prompt** 引导 Worker 在邮件开头注明意图（如 "【提交结果】" vs "【提问】"），Leader 根据内容决定是否 `update_task(approved)`。不在 MCP/Scheduler 层面做邮件分类。

---

## Files to Create/Modify

| 文件 | 类型 | 说明 |
|------|------|------|
| `super_agent/team/mcp_plan_server.py` | **新建** | Plan MCP server (Leader only) |
| `super_agent/team/mcp_mailbox_server.py` | **新建** | Mailbox MCP server (All Agents) |
| `super_agent/team/scheduler.py` | **重写** | 调度循环改为 inbox 驱动 |
| `super_agent/team/mailbox.py` | **重写** | 从 asyncio.Queue 改为文件 inbox + 轮询 |
| `super_agent/team/prompts.py` | **修改** | Worker/Leader prompt 更新 |
| `super_agent/team/team_orchestrator.py` | **修改** | 适配新调度模式 |
| `super_agent/team/models.py` | **修改** | 新增/调整数据模型 |
| `super_agent/team/persistence.py` | 不变 | Session 持久化不变 |

---

## Step 1: Mailbox MCP (`mcp_mailbox_server.py`)

所有 Agent 加载。纯文件读写，无进程内状态。

### Tools

**`send_mail(to, content)`**
- `to`: 收件人 ID（"lead" 或 "worker-{task_id}"）
- `content`: 邮件正文（纯文本）
- 实现：追加到 `.team/inboxes/{to}.json`
- 返回："邮件已发送给 {to}"

**`read_inbox()`**
- 读取自己的 inbox（通过 TEAM_AGENT_ID 环境变量确定）
- 返回未读邮件列表（供 Agent 主动查看，通常不需要 — Scheduler 会投递）

**`list_members()`**
- 读取 `.team/config.json`
- 返回团队成员列表（name, role）

### Inbox 文件格式 (`.team/inboxes/{agent_id}.json`)

```json
[
  {
    "id": "msg-a1b2c3",
    "from": "worker-task_001",
    "content": "Task #task_001 完成。\n修改文件：...",
    "timestamp": "2026-02-08T10:30:00Z",
    "delivered": false
  }
]
```

注意：字段是 `delivered`（而非 `read`），由 Scheduler 在成功投递后标记。详见 Step 3 的投递确认机制。

### 并发写安全

多个 Worker 可能同时 `send_mail(to="lead")`，导致并发写同一个 inbox 文件。MCP server 使用 `fcntl.flock()` 文件锁保证原子性：

```python
import fcntl

def _append_mail(self, inbox_file: Path, mail: dict):
    with open(inbox_file, "r+") as f:
        fcntl.flock(f, fcntl.LOCK_EX)  # 独占锁
        try:
            mails = json.loads(f.read())
            mails.append(mail)
            f.seek(0)
            f.truncate()
            f.write(json.dumps(mails, ensure_ascii=False, indent=2))
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)
```

### 环境变量
- `TEAM_WORKSPACE`: workspace 根目录
- `TEAM_AGENT_ID`: 当前 Agent 的 ID ("lead" / "worker-task_001")

---

## Step 2: Plan MCP (`mcp_plan_server.py`)

仅 Leader 加载。管理计划的创建、查询和修改。

### Tools

**`create_plan(objective, phases)`**
- `objective`: 任务目标
- `phases`: JSON 字符串，描述 phases 和 tasks
- 实现：验证格式 → 写入 `.team/plan.json`
- 返回：创建结果确认

**`get_plan()`**
- 读取 `.team/plan.json`
- 返回当前计划全文

**`update_task(task_id, status, notes?)`**
- 更新 plan.json 中指定 task 的 status
- status: "pending" | "running" | "approved" | "failed"
- 返回：更新确认

**`modify_phases(from_index, new_phases)`**
- 替换 from_index 之后的所有 phases（phase review 时用）
- 实现：更新 plan.json，递增 version，记录 change_log
- 返回：修改确认

### Plan 文件格式 (`.team/plan.json`)

```json
{
  "objective": "...",
  "version": 1,
  "change_log": ["v1: initial plan"],
  "phases": [
    {
      "phase_id": "phase_0",
      "phase_index": 0,
      "description": "...",
      "status": "pending",
      "tasks": [
        {
          "task_id": "task_001",
          "description": "...",
          "worker_type_id": "default",
          "status": "pending",
          "context": {}
        }
      ]
    }
  ]
}
```

### 并发安全
- Plan MCP 只有 Leader 加载，单写者，无并发问题
- Scheduler 读 plan.json 时 Leader 不在执行（idle 状态），无读写竞争
- 防御性措施：plan.json 写入使用 write-to-temp + `os.rename()` 原子操作，避免 Scheduler 读到半写文件

```python
def _atomic_write_plan(self, plan_data: dict):
    plan_file = self.team_dir / "plan.json"
    tmp_file = plan_file.with_suffix(".json.tmp")
    tmp_file.write_text(json.dumps(plan_data, ensure_ascii=False, indent=2))
    os.rename(str(tmp_file), str(plan_file))  # 原子操作
```

---

## Step 3: 重写 Mailbox (`mailbox.py`)

从 asyncio.Queue 改为**文件 inbox + 轮询**。

### 核心设计

```python
class FileMailbox:
    def __init__(self, workspace_dir: Path):
        self.inbox_dir = workspace_dir / ".team" / "inboxes"
        self.inbox_dir.mkdir(parents=True, exist_ok=True)
        self.plan_file = workspace_dir / ".team" / "plan.json"

    def register_agent(self, agent_id: str):
        """初始化 Agent 的 inbox 文件"""
        inbox_file = self.inbox_dir / f"{agent_id}.json"
        if not inbox_file.exists():
            inbox_file.write_text("[]")

    async def wait_for_mail(self, agent_id: str, task_id: str | None = None) -> list[dict]:
        """Scheduler 调用：轮询等待直到有未读邮件或 task 状态变化

        task_id: 如果提供，同时检查 plan.json 中该 task 的状态。
                 当 status 变为 approved/failed 时也返回（空列表 + 状态标记）。
        """
        while True:
            unread = self._peek_unread(agent_id)
            if unread:
                return unread
            # 同时检查 plan.json 中的 task 状态，防止 Worker 永久阻塞
            if task_id and self._is_task_terminal(task_id):
                return []  # 返回空列表，调用方通过 task 状态判断
            await asyncio.sleep(0.5)

    def _peek_unread(self, agent_id: str) -> list[dict]:
        """读取未投递邮件（不修改 delivered 标记）"""
        inbox_file = self.inbox_dir / f"{agent_id}.json"
        if not inbox_file.exists():
            return []
        mails = json.loads(inbox_file.read_text())
        return [m for m in mails if not m.get("delivered")]

    def ack_delivered(self, agent_id: str, message_ids: list[str]):
        """Scheduler 成功投递后调用：标记为已投递"""
        inbox_file = self.inbox_dir / f"{agent_id}.json"
        with open(inbox_file, "r+") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            try:
                mails = json.loads(f.read())
                for m in mails:
                    if m["id"] in message_ids:
                        m["delivered"] = True
                f.seek(0)
                f.truncate()
                f.write(json.dumps(mails, ensure_ascii=False, indent=2))
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)

    def _is_task_terminal(self, task_id: str) -> bool:
        """检查 plan.json 中 task 是否已终态"""
        if not self.plan_file.exists():
            return False
        try:
            plan = json.loads(self.plan_file.read_text())
            for phase in plan.get("phases", []):
                for task in phase.get("tasks", []):
                    if task["task_id"] == task_id:
                        return task.get("status") in ("approved", "failed")
        except (json.JSONDecodeError, KeyError):
            return False
        return False
```

### 投递确认机制（Delivery-then-Ack）

邮件字段使用 `delivered`（非 `read`），采用两阶段投递：

1. `_peek_unread()` — 返回 `delivered=false` 的邮件，**不修改文件**
2. Scheduler 将邮件包装为 prompt 并成功调用 `query()` 投递给 Agent
3. `ack_delivered(message_ids)` — 投递成功后标记 `delivered=true`

如果 Scheduler 在步骤 2 崩溃，邮件仍为 `delivered=false`，重启后会重新投递。不丢消息。

### Worker 防永久阻塞

`wait_for_mail()` 接受可选的 `task_id` 参数。Worker 调度循环传入自己的 task_id，使 `wait_for_mail()` 同时轮询：
- inbox 文件（有新邮件 → 返回邮件）
- plan.json 中的 task status（已 approved/failed → 返回空列表）

这样即使 Leader 只调了 `update_task(approved)` 但忘记 `send_mail`，Worker 也不会永久阻塞。

MCP server 是独立 stdio 子进程，不能直接通知 Scheduler。Scheduler 用 0.5 秒轮询检测新邮件，简单可靠。

---

## Step 4: 重写 Scheduler (`scheduler.py`)

### 新的 Worker 调度循环

```python
async def _worker_loop(self, task, config, phase):
    # 1. 注入 Mailbox MCP
    config = self._inject_mailbox_mcp(config, task)

    # 2. 连接（共享 workspace 作为 cwd）
    worker = self.worker_factory()
    await worker.connect(config, workspace=self.workspace_dir)

    # 3. 首次执行
    prompt = build_worker_prompt(task, phase.tasks, self.previous_results_summary)
    await worker.run_async(config, prompt, workspace=self.workspace_dir)

    # 4. 调度循环：idle → 检查 inbox / plan 状态 → 投递 → 新轮
    while True:
        # 等待 inbox 有新邮件 或 task 状态变为终态
        mails = await self.mailbox.wait_for_mail(
            f"worker-{task.task_id}",
            task_id=task.task_id  # 同时监控 plan.json 中的 task 状态
        )

        # 检查 plan.json 中 task 是否已终态（approved/failed）
        if self._is_task_approved(task.task_id):
            task.status = "approved"
            break

        if not mails:
            # wait_for_mail 因 task 终态返回空列表
            continue

        # 包装 feedback 为 prompt 并投递
        prompt = self._wrap_mail_as_prompt(mails)
        task.status = "running"
        await worker.run_async(config, prompt, workspace=self.workspace_dir)

        # 投递成功后确认
        self.mailbox.ack_delivered(
            f"worker-{task.task_id}",
            [m["id"] for m in mails]
        )

    await worker.disconnect()
```

### 新的 Leader 调度循环

```python
async def _lead_loop(self, phase, lead_worker, session):
    while not self._all_tasks_resolved(phase):
        # 等待 Leader inbox 有新邮件
        mails = await self.mailbox.wait_for_mail("lead")

        if not mails:
            continue

        # 包装为 prompt
        prompt = self._wrap_mail_as_prompt(mails)

        # Leader 审核（Leader 会调用 send_mail 回复 + update_task）
        await lead_worker.run_async(session.lead_config, prompt)

        # 投递成功后确认
        self.mailbox.ack_delivered("lead", [m["id"] for m in mails])

        # 刷新 plan.json 获取最新 task 状态
        self._refresh_task_statuses(phase)
```

### Prompt 包装

```python
def _wrap_mail_as_prompt(self, mails: list[dict]) -> str:
    parts = []
    for mail in mails:
        parts.append(
            f"来自 {mail['from']} 的邮件：\n"
            f"─────────────────\n"
            f"{mail['content']}\n"
            f"─────────────────"
        )
    return "\n\n".join(parts)
```

### Approve 判定

Scheduler 不再通过邮件内容判断 approve/feedback，也不推断邮件语义设置 task 状态。改为读取 `plan.json` 中的 task status：
- Leader 调用 `update_task(task_id, status="approved")` → plan.json 更新
- Scheduler 在 Worker 收到邮件后检查 plan.json 中该 task 的 status
- `status == "approved"` → Worker 循环结束
- Worker 的 `wait_for_mail()` 也同时监控 plan.json，即使 Leader 忘记 send_mail 也能退出

**approve 判定走 Plan MCP（结构化），内容传递走 Mailbox MCP（纯文本），完全解耦。**

---

## Step 5: 修改 Prompts (`prompts.py`)

### Worker Prompt

```
你是 Team Agent 中的一名 Worker。

## 你的任务
{task.description}

## 团队通信
你可以使用 send_mail 工具与 Leader 通信：
- 完成任务后，用 send_mail(to="lead", content="你的报告") 提交结果
- 报告应包含：完成了什么、修改了哪些文件、测试结果、遗留问题
- 发送后你的本轮工作结束，Leader 会审核并回复

## 工作目录
你的工作目录是共享项目目录。其他 Worker 也在此目录工作，注意文件命名避免冲突。

{同 phase 其他 task 列表}
{之前 phase 结果摘要}
```

### Leader Planning Prompt

```
你是 Team Agent 的 Lead。你的职责是规划、审核和指挥。

## 可用工具
- Plan 工具：create_plan, get_plan, update_task, modify_phases
- 通信工具：send_mail, read_inbox, list_members

## 当前任务
{objective}

## 可用 Worker 类型
{worker_types_info}

请使用 create_plan 工具创建执行计划。
```

### Leader Review Prompt

```
审核后请：
- 通过：调用 update_task(task_id, status="approved") 并 send_mail(to="worker-{task_id}", content="approved")
- 反馈：send_mail(to="worker-{task_id}", content="具体修改意见")
```

---

## Step 6: 修改 Orchestrator (`team_orchestrator.py`)

### 主要变化

1. **Planning 阶段**：Leader 通过 Plan MCP `create_plan` 创建计划 → Scheduler 读 `plan.json` 获取计划（不再解析 Leader 的 JSON 文本输出）

2. **Phase 执行**：调用重写后的 Scheduler

3. **Phase Review**：Leader 通过 Plan MCP `modify_phases` 修改后续计划（不再输出 JSON 让 Scheduler 解析）

4. **_parse_plan() 删除** — 不再需要从 LLM 文本中提取 JSON

5. **Lead review callback 删除** — Leader 的审核通过 inbox 驱动，不再由 Scheduler 主动调用

### Orchestrator 简化

```python
async def run_async(self, session_id, available_worker_configs, worker_types_info):
    # 1. Planning: Leader 调用 create_plan MCP tool
    lead_worker = self.worker_factory()
    await lead_worker.connect(lead_config_with_both_mcps)
    await lead_worker.run_async(lead_config, planning_prompt)
    # → Leader 已通过 MCP 写入 plan.json

    plan = self._read_plan_from_file()  # 直接读文件，不解析 LLM 输出

    # 2. Phase 循环
    for phase in plan.phases:
        mailbox = FileMailbox(workspace_dir)
        scheduler = PhaseScheduler(...)
        await scheduler.execute_phase(phase, available_worker_configs)

        # Phase review: Leader 审核 phase 结果
        await lead_worker.run_async(lead_config, phase_review_prompt)
        # → Leader 可能调用 modify_phases MCP tool

        plan = self._read_plan_from_file()  # 刷新（可能被修改了）

    # 3. Final summary
    await lead_worker.run_async(lead_config, final_summary_prompt)
```

---

## Step 7: 修改 Models (`models.py`)

### 主要变化

- `Message` 简化 — 不再需要 `message_type` 枚举 (submit_result/feedback/approve)，邮件就是纯文本
- `TaskStep.result` / `TaskResult` — 保留用于 Scheduler 内部追踪，但不再依赖 `__result.json`
- `TeamSession` — 去掉 `max_task_submits`（反馈轮数不再硬编码，由 Scheduler 策略控制）

---

## Key Design Decisions

### 1. 邮件是纯文本
不在 MCP 层面强制结构化。报告格式由 Leader 在任务描述 prompt 中指定。这与 Claude Team 的 SendMessage 完全一致。

### 2. Approve 走 Plan MCP，内容走 Mailbox MCP
- Leader 调 `update_task(status="approved")` → 结构化状态变更
- Leader 调 `send_mail(content="approved")` → 文本通知
- Scheduler 根据 plan.json 的 task status 判断是否结束 Worker 循环
- 两个通道解耦，即使邮件内容不包含 "approved" 关键字也能正确判断
- 即使 Leader 忘记 send_mail，Worker 也不会永久阻塞（`wait_for_mail` 同时监控 plan.json）

### 3. Scheduler 只做调度
不再做：读结果文件、构造 Message 对象、判断 approve/feedback、解析 JSON 计划、推断邮件语义。
只做：启动 Agent → idle 后检查 inbox → 有邮件就包装投递 → 根据 plan.json 判断流转。

### 4. MCP server 是 stdio 子进程
每个 Agent 独立 MCP server 进程，通过文件系统交换状态。Scheduler 轮询 inbox 文件检测新邮件。简单可靠，无进程间通信复杂性。

### 5. 共享工作目录
所有 Agent 的 cwd 是 `workspace/{session_id}/`。`.team/` 子目录存放协调数据（inbox, plan），项目文件在根目录共享。

### 6. plan.json 是执行期唯一真相源
执行期间，task/phase 状态的权威来源是 `plan.json`（由 Plan MCP 管理）。Scheduler 在关键节点（phase 完成、session 结束）将 plan.json 的状态同步回 `TeamSession` 内存对象，再由 `TeamSessionStore` 持久化供 API 读取。

```
plan.json (MCP 管理)  →  TeamSession (内存)  →  TeamSessionStore (持久化)  →  API
         ↑ 写                    ↑ 同步                  ↑ 保存              ↑ 读
      Leader MCP            Scheduler               Scheduler          前端/API
```

不做双写：Leader 只写 plan.json，不直接操作 TeamSession。避免两个数据源不一致。

### 7. 邮件投递采用 Delivery-then-Ack
邮件标记 `delivered` 而非 `read`，采用两阶段确认：
1. Scheduler 读取 `delivered=false` 的邮件（不修改文件）
2. Scheduler 成功调用 `query()` 投递给 Agent
3. Scheduler 调用 `ack_delivered()` 标记已投递

崩溃安全：如果 Scheduler 在步骤 2-3 之间崩溃，重启后邮件仍为 `delivered=false`，会重新投递（at-least-once 语义）。

### 8. 并发写入安全
- **Inbox 文件**：多 Worker 可能并发写同一个 inbox（如 lead.json），MCP server 使用 `fcntl.flock()` 文件锁
- **Plan 文件**：单写者（Leader MCP），使用 write-to-temp + `os.rename()` 原子写入，防止 Scheduler 读到半写内容

---

## Verification

1. **Mailbox MCP 独立测试**：启动 server，手动调用 send_mail / read_inbox，检查文件读写
2. **Plan MCP 独立测试**：启动 server，手动调用 create_plan / update_task，检查 plan.json
3. **调度循环测试**：Worker 发 send_mail → Scheduler 检测到新邮件 → 包装投递给 Leader → Leader send_mail 回复 → Scheduler 投递给 Worker
4. **Approve 流程**：Leader 调 update_task(status="approved") + send_mail("approved") → Scheduler 读 plan.json → Worker 循环结束
5. **Feedback 循环**：Leader send_mail(feedback) → Worker 收到 → 修改 → 再次 send_mail → Leader 再审
6. **Phase 流转**：Phase 内所有 task approved → Phase review → Leader 可能 modify_phases → 下一 phase
7. **共享 cwd**：多个 Worker 能读写同一目录的文件
8. **前端 WebSocket**：事件流正常推送
