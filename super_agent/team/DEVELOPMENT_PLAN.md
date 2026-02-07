# Agent Team 系统开发计划

## Context

全新的 Agent Team 编排系统，与现有 Super Agent 完全独立。核心理念：

- **主 Agent（Lead）只做计划、审查、指挥**，不做实际执行
- **计划按 Phase 组织**：Phase 间串行，Phase 内并行
- **Mailbox 双向通信**：Worker 完成后提交结果给 Lead，Lead 可以反馈让 Worker 在同一 session 中继续调整，多轮直到 Lead 放行
- **Phase 级总体审查**：所有 Worker 放行后，Lead 做一次总体审查，可动态调整后续计划
- **Phase 内任务可见**：每个 Worker 知道当前 Phase 内其他 Worker 的任务描述
- **程序化调度器**管理消息排队、Worker 生命周期、Phase 流转
- **结果持久化**：每个 task 的最终产出（文本 + 文件）持久化到共享工作区，供后续 Phase 引用
- **复用** `ClaudeSdkWorker` + `WorkerConfig`，其余全新

### 参考实现对比

参考了 `super_agent/claudeagent/` 中 Claude Code 的 Agent Team 实现。关键差异：

| 维度 | 参考实现（claudeagent） | 本系统设计 |
|------|----------------------|-----------|
| 调度方式 | Lead Agent 通过 LLM 工具调用逐个 spawn 子 Agent | 程序化调度器自动并行启动，不浪费 LLM token |
| 依赖管理 | 任意 DAG（blockedBy/blocks），由 LLM 构建和解析 | Phase 分组（Phase 内并行、Phase 间串行），更简洁可控 |
| 通信机制 | Mailbox + teammate-message 注入 + 共享 TaskList | Mailbox 消息队列 + Worker↔Lead 双向通信 |
| Worker 反馈 | 子 Agent 发 SendMessage 报告，Lead 无法要求修改 | Worker 提交后 Lead 可多轮反馈，Worker resume 继续调整 |
| Lead 角色 | 可以纯编排（研究型）或同时编码（工程型，73%编码） | 只做计划、审查、指挥，不做实际执行 |
| 计划调整 | 运行时 Lead 通过工具调用动态创建任务 | Phase 审查时 Lead 输出结构化调整，替换后续 phases |
| 跨 Agent 可见 | 子 Agent 可调 TaskList 看全局任务 | Worker 在 prompt 中看到同 Phase 其他 task 描述 |
| 产出持久化 | 共享文件系统 + mailbox 文本报告 | 每个 task 独立输出目录 + `__result.json` 结构化产出 |

---

## 执行流程总览

```
用户请求
  ↓
Lead Agent 规划 → 输出 Plan（phases 数组）
  ↓
┌─── Phase N ──────────────────────────────────────────┐
│                                                       │
│  调度器并行启动所有 Worker                              │
│    Worker-1 执行 ──→ 提交结果 ──→ Lead 审查            │
│    │                               ├─ "调整 X"        │
│    │                               │   → Worker-1 resume 继续  │
│    │                               │   → 再提交 → Lead 再审    │
│    │                               └─ "通过" → Worker-1 放行   │
│    Worker-2 执行 ──→ 提交结果 ──→ Lead 审查 → "通过"   │
│    Worker-3 执行 ──→ 提交结果 ──→ ...                  │
│                                                       │
│  所有 Worker 放行后：                                   │
│  Lead 做 Phase 总体审查（不重看结果，判断后续计划）      │
│    ├─ approve → 进入 Phase N+1                        │
│    ├─ modify → 调整后续 phases，进入下一个              │
│    └─ abort → 终止                                    │
└──────────────────────────────────────────────────────┘
  ↓
所有 Phase 完成 → Lead 生成最终汇总
```

---

## 共享工作区与产出持久化

### 目录结构

```
workspace/{session_id}/
├── phase_0/
│   ├── task_001/                    # 每个 task 的独立输出目录
│   │   ├── __result.json            # 结构化最终结果
│   │   ├── report.md                # Worker 产出的文件
│   │   └── data.csv                 # Worker 产出的文件
│   └── task_002/
│       ├── __result.json
│       └── analysis.py
├── phase_1/
│   └── ...
├── shared/                          # 跨 Phase 共享文件区（可选）
└── __final_output.json              # Lead 最终汇总
```

### `__result.json` 格式

Worker 完成任务后必须写入此文件：

```json
{
  "summary": "一句话任务完成总结",
  "content": "完整结果文本（研究报告、分析结论等）",
  "files": ["report.md", "data.csv"],
  "instruction": "对后续使用者的说明（可选）"
}
```

### 产出流转机制

1. **Worker 执行时**：Worker 的 `cwd` 设为自己的 task 目录（`workspace/phase_N/task_XXX/`），文件直接写到该目录
2. **提交结果时**：Worker 通过 mailbox 发送文本摘要给 Lead，同时 `__result.json` 已持久化到磁盘
3. **Lead 审查时**：Lead 看到文本结果 + 文件列表。如果需要看文件内容，Lead 可以指示 Worker 在反馈轮中展示
4. **后续 Phase 引用**：下一个 Phase 的 Worker prompt 中可以包含前置 Phase 的 `__result.json` 摘要和文件路径，Worker 可以直接读取
5. **最终汇总**：Lead 生成最终报告时，引用所有 Phase 的 `__result.json` 摘要

---

## 文件结构

```
super_agent/team/                    # 全新目录
├── __init__.py
├── models.py                        # Plan, Phase, TaskStep, TeamSession, Message
├── prompts.py                       # Lead prompt 模板（规划/task审查/phase审查/汇总）
├── mailbox.py                       # 消息队列 + 排队 + 终止信号
├── scheduler.py                     # Phase 调度器（Worker 生命周期 + 消息路由）
├── team_orchestrator.py             # 主编排器
└── persistence.py                   # TeamSession 持久化

backend/routers/team.py              # 新 API Router
backend/main.py                      # 注册新 router（一行）
super_agent/events.py                # 扩展 EventType 枚举
```

**复用的现有文件**（不修改）：
- `super_agent/worker.py` — `ClaudeSdkWorker`, `Worker` 基类
- `super_agent/models.py` — `WorkerConfig`, `LLMResult`
- `super_agent/events.py` — `SessionEventManager` (仅追加枚举值)
- `backend/routers/agents.py` — `load_agents()`
- `backend/routers/super_agent.py` — `get_worker_config()`

---

## 实现步骤

### Step 1: 数据模型 (`super_agent/team/models.py`)

**Message** — mailbox 消息
```python
def _new_msg_id() -> str:
    return f"msg-{uuid.uuid4().hex[:8]}"

@dataclass
class Message:
    from_id: str           # "worker-{task_id}" 或 "lead"
    to_id: str             # "lead" 或 "worker-{task_id}"
    task_id: str           # 关联的 task
    content: str           # 消息正文（Worker 的结果 或 Lead 的反馈）
    message_type: str      # "submit_result" | "feedback" | "approve"
    message_id: str = field(default_factory=_new_msg_id)
    timestamp: str = field(default_factory=utc_now)
```

**TaskResult** — Worker 的结构化产出
```python
@dataclass
class TaskResult:
    summary: str = ""              # 一句话总结
    content: str = ""              # 完整结果文本
    files: list[str] = field(default_factory=list)  # 产出文件路径列表
    instruction: str = ""          # 对后续使用者的说明
    output_dir: str = ""           # task 输出目录路径
```

**TaskStep** — 单个可执行任务
```python
@dataclass
class TaskStep:
    task_id: str
    description: str
    worker_type_id: str       # 引用 agents.json 中的 worker id
    context: dict = field(default_factory=dict)
    status: str = "pending"   # pending | running | submitted | approved | failed
    worker_sdk_session_id: Optional[str] = None
    messages: list[Message] = field(default_factory=list)
    result: Optional[TaskResult] = None  # 最终产出
    result_text: str = ""     # 最新提交的原始文本（mailbox 用）
    result_error: Optional[str] = None
    submit_count: int = 0
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
```

状态流转：
```
pending → running → submitted → (feedback→running→submitted)* → approved
                  → failed
```

**Phase** — 一组并行任务
```python
@dataclass
class Phase:
    phase_id: str
    phase_index: int = 0
    description: str = ""
    tasks: list[TaskStep] = field(default_factory=list)
    status: str = "pending"               # pending | running | completed | failed
    phase_review_decision: Optional[str] = None  # approve | modify | abort
    phase_review_notes: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
```

**Plan** — 完整执行计划（可动态调整）
```python
@dataclass
class Plan:
    plan_id: str
    objective: str = ""
    phases: list[Phase] = field(default_factory=list)
    version: int = 0
    change_log: list[str] = field(default_factory=list)
```

**TeamSession** — 会话全状态
```python
@dataclass
class TeamSession:
    session_id: str
    status: str = "pending"           # pending | planning | executing | phase_review | completed | failed | cancelled
    plan: Optional[Plan] = None
    current_phase_index: int = -1
    lead_config: Optional[WorkerConfig] = None   # Lead Agent 配置
    lead_sdk_session_id: Optional[str] = None
    workspace_dir: str = ""
    max_task_submits: int = 3
    created_at: str = field(default_factory=utc_now)
    updated_at: str = field(default_factory=utc_now)
    completed_at: Optional[str] = None
    final_output: Optional[str] = None
    error: Optional[str] = None
```

所有 dataclass 需要 `to_dict()` / `from_dict()` 方法，复用 `super_agent.models.utc_now`。

### Step 2: Mailbox (`super_agent/team/mailbox.py`)

消息队列 + **终止信号协议**，解决死锁问题。

```python
# 哨兵对象，用于唤醒阻塞的 receive
_SENTINEL_SHUTDOWN = object()
_SENTINEL_WORKER_FAILED = "___worker_failed___"

class Mailbox:
    """Phase 内的消息队列，管理 Worker↔Lead 通信。

    支持终止信号：worker_failed / cancelled / shutdown 都能唤醒阻塞的 receive。
    """

    def __init__(self):
        self._lead_queue: asyncio.Queue = asyncio.Queue()
        self._worker_queues: dict[str, asyncio.Queue] = {}
        self._cancelled = False

    def register_worker(self, task_id: str):
        self._worker_queues[task_id] = asyncio.Queue()

    async def send_to_lead(self, message: Message):
        await self._lead_queue.put(message)

    async def receive_for_lead(self) -> Message | None:
        """Lead 从队列取下一条。返回 None 表示收到终止信号。"""
        item = await self._lead_queue.get()
        if item is _SENTINEL_SHUTDOWN or self._cancelled:
            return None
        return item

    async def send_to_worker(self, task_id: str, message: Message):
        q = self._worker_queues.get(task_id)
        if q:
            await q.put(message)

    async def receive_for_worker(self, task_id: str) -> Message | None:
        """Worker 等待 Lead 反馈。返回 None 表示收到终止信号。"""
        q = self._worker_queues.get(task_id)
        if not q:
            return None
        item = await q.get()
        if item is _SENTINEL_SHUTDOWN or self._cancelled:
            return None
        return item

    async def notify_worker_failed(self, task_id: str):
        """Worker 失败时，发送哨兵消息给 Lead，防止 Lead 死等。"""
        fail_msg = Message(
            from_id=f"worker-{task_id}",
            to_id="lead",
            task_id=task_id,
            content="",
            message_type=_SENTINEL_WORKER_FAILED,
        )
        await self._lead_queue.put(fail_msg)

    def remove_worker(self, task_id: str):
        self._worker_queues.pop(task_id, None)

    async def shutdown(self):
        """取消所有阻塞等待。"""
        self._cancelled = True
        # 唤醒 Lead
        await self._lead_queue.put(_SENTINEL_SHUTDOWN)
        # 唤醒所有等待中的 Worker
        for q in self._worker_queues.values():
            await q.put(_SENTINEL_SHUTDOWN)
```

### Step 3: Prompt 模板 (`super_agent/team/prompts.py`)

五个 prompt 构建函数：

**`build_planning_prompt(objective, worker_types)`**
- System: "你是 Lead Agent，只做计划不做执行"
- 列出可用 worker types（id + 名称 + 工具能力）
- 输出 JSON Plan：phases 数组，每个 phase 含 tasks
- 规则：Phase 间串行、Phase 内并行、你会在每个 task 完成后审查并可要求调整、Phase 后做总体审查可调整后续计划
- User: 用户请求

**`build_worker_prompt(task, phase_tasks_overview, previous_results_summary)`**
- task description + context
- 当前 Phase 内其他 task 的描述列表（只看到描述，不看到结果）
- 前置 Phase 的结果摘要和文件路径（如有）
- 输出协议说明：必须在工作目录下写入 `__result.json`
- 指令："你是独立 Worker，专注完成你的任务。Phase 内的其他任务正在由其他 Worker 并行处理。"

**`build_task_review_prompt(task, message)`**
- "Worker {task_id} 提交了以下结果："
- 显示 task description + Worker 的 result_text + 文件列表
- 如有之前的消息历史，也列出
- 要求输出 JSON：`{"decision": "approve"}` 或 `{"decision": "feedback", "content": "..."}`

**`build_phase_review_prompt(phase, remaining_phases)`**
- "Phase {index} 所有 Worker 已通过，你之前已审查过每个 task 的结果"
- 列出每个 task 的最终结果摘要（一两行）
- 列出剩余 phases 的当前计划
- 要求输出 JSON：`{"decision": "approve"}` 或 `{"decision": "modify", "updated_phases": [...], "reason": "..."}` 或 `{"decision": "abort", "reason": "..."}`

**`build_final_summary_prompt(all_phases_summary)`**
- 所有 Phase 的 task 最终结果摘要
- 要求输出最终报告

### Step 4: Phase 调度器 (`super_agent/team/scheduler.py`)

核心模块。修复了死锁、状态覆盖、max_submits 未落实、取消机制等问题。

```python
class PhaseScheduler:
    def __init__(self, worker: Worker, workspace_dir: Path, mailbox: Mailbox,
                 event_emitter, max_task_submits: int = 3,
                 persist_fn: Callable = None)
        # persist_fn: 每次状态变化时调用的持久化回调

    async def execute_phase(self, phase: Phase, worker_configs, lead_review_fn) -> Phase:
        phase.status = "running"
        phase.started_at = utc_now()
        emit(TEAM_PHASE_START)
        self._persist()

        # 为每个 task 创建输出目录 + 注册 mailbox
        for task in phase.tasks:
            task_dir = self.workspace_dir / f"phase_{phase.phase_index}" / task.task_id
            task_dir.mkdir(parents=True, exist_ok=True)
            self.mailbox.register_worker(task.task_id)

        # 并行启动所有 Worker 协程
        worker_coros = {
            task.task_id: asyncio.create_task(
                self._worker_loop(task, worker_configs.get(task.worker_type_id), phase)
            )
            for task in phase.tasks
        }

        # 同时启动 Lead 审查协程
        lead_coro = asyncio.create_task(
            self._lead_review_loop(phase, lead_review_fn)
        )

        # 等待所有 Worker 结束（放行或失败）
        await asyncio.gather(*worker_coros.values(), return_exceptions=True)
        # Lead loop 在所有 Worker 结束后自然退出
        await lead_coro

        # ★ 失败优先：按实际 task 状态归并 Phase 状态
        has_failed = any(t.status == "failed" for t in phase.tasks)
        all_approved = all(t.status == "approved" for t in phase.tasks)

        if all_approved:
            phase.status = "completed"
        elif has_failed:
            phase.status = "failed"
        else:
            phase.status = "failed"  # 异常兜底

        phase.completed_at = utc_now()
        emit(TEAM_PHASE_COMPLETE, status=phase.status)
        self._persist()
        return phase

    async def _worker_loop(self, task, config, phase):
        """单个 Worker 的执行-提交-等待反馈循环。"""
        if not config:
            task.status = "failed"
            task.result_error = f"Worker type '{task.worker_type_id}' not found"
            emit(TEAM_TASK_FAILED, task_id=task.task_id, error=task.result_error)
            await self.mailbox.notify_worker_failed(task.task_id)  # ★ 防 Lead 死锁
            self._persist()
            return

        task.status = "running"
        task.started_at = utc_now()
        emit(TEAM_TASK_START, task_id=task.task_id)
        self._persist()

        # Worker 的 cwd 是 task 专属目录
        task_dir = self.workspace_dir / f"phase_{phase.phase_index}" / task.task_id
        prompt = build_worker_prompt(task, phase.tasks, ...)
        resume_session_id = None

        while True:
            # ★ max_task_submits 硬限制
            if task.submit_count >= self.max_task_submits:
                task.status = "failed"
                task.result_error = f"Exceeded max submits ({self.max_task_submits})"
                emit(TEAM_TASK_FAILED, task_id=task.task_id, error=task.result_error)
                await self.mailbox.notify_worker_failed(task.task_id)  # ★ 防 Lead 死锁
                self._persist()
                return

            try:
                result = await self.worker.run_async(
                    config=config,
                    prompt=prompt,
                    workspace=task_dir,  # ★ 每个 task 独立目录
                    resume_sdk_session_id=resume_session_id,
                )
                task.worker_sdk_session_id = result.sdk_session_id
                resume_session_id = result.sdk_session_id
                task.result_text = result.text
                task.submit_count += 1

                # 尝试读取 __result.json
                result_file = task_dir / "__result.json"
                if result_file.exists():
                    result_data = json.loads(result_file.read_text())
                    task.result = TaskResult(
                        summary=result_data.get("summary", ""),
                        content=result_data.get("content", ""),
                        files=result_data.get("files", []),
                        instruction=result_data.get("instruction", ""),
                        output_dir=str(task_dir),
                    )
            except Exception as e:
                task.status = "failed"
                task.result_error = str(e)
                emit(TEAM_TASK_FAILED, task_id=task.task_id, error=str(e))
                await self.mailbox.notify_worker_failed(task.task_id)  # ★ 防 Lead 死锁
                self._persist()
                return

            # 提交结果给 Lead
            submit_msg = Message(
                from_id=f"worker-{task.task_id}", to_id="lead",
                task_id=task.task_id, content=task.result_text,
                message_type="submit_result",
            )
            task.status = "submitted"
            task.messages.append(submit_msg)
            await self.mailbox.send_to_lead(submit_msg)
            emit(TEAM_TASK_RESUBMIT if task.submit_count > 1 else TEAM_TASK_COMPLETE,
                 task_id=task.task_id, submit_count=task.submit_count)
            self._persist()  # ★ 每次提交都持久化

            # 等待 Lead 反馈
            response = await self.mailbox.receive_for_worker(task.task_id)
            if response is None:
                # 收到终止信号（cancelled / shutdown）
                task.status = "failed"
                task.result_error = "Cancelled"
                return

            task.messages.append(response)
            self._persist()  # ★ 每次收到反馈都持久化

            if response.message_type == "approve":
                task.status = "approved"
                task.completed_at = utc_now()
                self.mailbox.remove_worker(task.task_id)
                emit(TEAM_TASK_COMPLETE, task_id=task.task_id)
                self._persist()
                return
            elif response.message_type == "feedback":
                task.status = "running"
                prompt = response.content
                emit(TEAM_TASK_FEEDBACK, task_id=task.task_id, feedback=response.content)
                self._persist()
                # 循环继续 → resume Worker session

    async def _lead_review_loop(self, phase, lead_review_fn):
        """Lead 依序处理消息队列中的 Worker 提交。"""
        resolved_count = 0  # approved + failed
        total_tasks = len(phase.tasks)

        while resolved_count < total_tasks:
            message = await self.mailbox.receive_for_lead()
            if message is None:
                # 终止信号
                break

            # ★ 处理 Worker 失败哨兵
            if message.message_type == _SENTINEL_WORKER_FAILED:
                resolved_count += 1
                continue

            task = next((t for t in phase.tasks if t.task_id == message.task_id), None)
            if not task:
                resolved_count += 1
                continue

            emit(TEAM_REVIEW_START, task_id=message.task_id)

            # 调用 Lead Agent 审查
            response = await lead_review_fn(task, message)

            # 发给 Worker
            await self.mailbox.send_to_worker(message.task_id, response)

            if response.message_type == "approve":
                resolved_count += 1

            emit(TEAM_REVIEW_COMPLETE, task_id=message.task_id, decision=response.message_type)
            self._persist()  # ★ 每次审查决策都持久化

    def _persist(self):
        """调用持久化回调（如果提供）。"""
        if self.persist_fn:
            self.persist_fn()
```

### Step 5: 主编排器 (`super_agent/team/team_orchestrator.py`)

```python
class TeamOrchestrator:
    def __init__(self, base_dir, worker: Worker, event_manager=None)

    def create_session(self, objective, lead_config, workspace_dir=None) -> TeamSession:
        session = TeamSession(
            session_id=f"team-{uuid.uuid4().hex[:12]}",
            lead_config=lead_config,
            workspace_dir=str(workspace_dir or base_dir / "workspace" / session_id),
            plan=Plan(plan_id=f"plan-{session_id}", objective=objective),
        )
        # 创建工作区目录
        Path(session.workspace_dir).mkdir(parents=True, exist_ok=True)
        self.store.save_session(session)
        return session

    async def run_async(self, session_id, available_worker_configs):
        session = self.store.load_session(session_id)
        emit(TEAM_SESSION_START)

        try:
            # ═══ 规划阶段 ═══
            session.status = "planning"
            self.store.save_session(session)
            emit(TEAM_PLANNING_START)
            lead_result = await self.worker.run_async(
                config=session.lead_config,
                prompt=build_planning_prompt(session.plan.objective, available_worker_configs),
            )
            session.lead_sdk_session_id = lead_result.sdk_session_id
            session.plan = parse_plan_json(lead_result.text, session.plan)
            self.store.save_session(session)
            emit(TEAM_PLANNING_COMPLETE, plan=session.plan.to_dict())

            # ═══ Phase 执行循环 ═══
            phase_idx = 0
            while phase_idx < len(session.plan.phases):
                phase = session.plan.phases[phase_idx]
                session.current_phase_index = phase_idx
                session.status = "executing"
                self.store.save_session(session)

                # 创建本 Phase 的 mailbox
                mailbox = Mailbox()

                # Lead 审查回调（闭包捕获 session）
                captured_session = session
                async def lead_review_fn(task, message):
                    return await self._lead_review_task(captured_session, task, message)

                # 调度器执行 Phase
                scheduler = PhaseScheduler(
                    worker=self.worker,
                    workspace_dir=Path(session.workspace_dir),
                    mailbox=mailbox,
                    event_emitter=self._emit,
                    max_task_submits=session.max_task_submits,
                    persist_fn=lambda: self.store.save_session(session),  # ★ Phase 内 checkpoint
                )
                phase = await scheduler.execute_phase(phase, available_worker_configs, lead_review_fn)
                session.plan.phases[phase_idx] = phase
                self.store.save_session(session)

                # ═══ Phase 总体审查 ═══
                session.status = "phase_review"
                self.store.save_session(session)
                emit(TEAM_PHASE_REVIEW_START)
                remaining_phases = session.plan.phases[phase_idx + 1:]
                review_result = await self._lead_phase_review(session, phase, remaining_phases)
                decision = parse_review_decision(review_result)

                if decision["decision"] == "approve":
                    phase.phase_review_decision = "approve"
                    phase_idx += 1
                elif decision["decision"] == "modify":
                    phase.phase_review_decision = "modify"
                    phase.phase_review_notes = decision.get("reason", "")
                    new_phases = [Phase.from_dict(p) for p in decision["updated_phases"]]
                    session.plan.phases = session.plan.phases[:phase_idx + 1] + new_phases
                    for i, p in enumerate(session.plan.phases):
                        p.phase_index = i
                    session.plan.version += 1
                    session.plan.change_log.append(
                        f"v{session.plan.version}: Phase {phase_idx} 后调整 - {decision.get('reason','')}"
                    )
                    emit(TEAM_PLAN_UPDATED, plan=session.plan.to_dict())
                    phase_idx += 1
                elif decision["decision"] == "abort":
                    session.status = "failed"
                    session.error = decision.get("reason", "Lead aborted")
                    break

                emit(TEAM_PHASE_REVIEW_COMPLETE, decision=decision["decision"])
                self.store.save_session(session)

            # ═══ 最终汇总 ═══
            if session.status != "failed":
                session.status = "completing"
                final = await self.worker.run_async(
                    config=session.lead_config,
                    prompt=build_final_summary_prompt(session.plan),
                    resume_sdk_session_id=session.lead_sdk_session_id,
                )
                session.final_output = final.text
                session.status = "completed"
                session.completed_at = utc_now()

        except asyncio.CancelledError:
            session.status = "cancelled"
        except Exception as e:
            session.status = "failed"
            session.error = str(e)
            emit(TEAM_SESSION_ERROR, error=str(e))

        self.store.save_session(session)
        emit(TEAM_SESSION_COMPLETE, status=session.status)

    async def _lead_review_task(self, session, task, message) -> Message:
        """Lead 审查单个 Worker 的提交结果。"""
        prompt = build_task_review_prompt(task, message)
        result = await self.worker.run_async(
            config=session.lead_config,
            prompt=prompt,
            resume_sdk_session_id=session.lead_sdk_session_id,
        )
        session.lead_sdk_session_id = result.sdk_session_id
        decision = parse_json(result.text)

        if decision.get("decision") == "approve":
            return Message(from_id="lead", to_id=f"worker-{task.task_id}",
                          task_id=task.task_id, content="approved",
                          message_type="approve")
        else:
            return Message(from_id="lead", to_id=f"worker-{task.task_id}",
                          task_id=task.task_id, content=decision.get("content", ""),
                          message_type="feedback")

    async def _lead_phase_review(self, session, phase, remaining_phases):
        """Lead 做 Phase 总体审查。"""
        prompt = build_phase_review_prompt(phase, remaining_phases)
        result = await self.worker.run_async(
            config=session.lead_config,
            prompt=prompt,
            resume_sdk_session_id=session.lead_sdk_session_id,
        )
        session.lead_sdk_session_id = result.sdk_session_id
        return result.text

    async def cancel(self, session_id):
        """取消运行中的 session。"""
        # 由 API 层调用：先 cancel asyncio.Task，再更新状态
        session = self.store.load_session(session_id)
        if session:
            session.status = "cancelled"
            self.store.save_session(session)
```

### Step 6: 持久化 (`super_agent/team/persistence.py`)

```python
class TeamSessionStore:
    def __init__(self, base_dir: Path)
    # 存储路径: base_dir / "team_sessions" / "{session_id}.json"
    def save_session(session: TeamSession)
    def load_session(session_id: str) -> TeamSession | None
    def list_sessions() -> list[dict]  # 摘要列表
```

### Step 7: 事件类型扩展 (`super_agent/events.py`)

在 `EventType` 枚举中追加：

```python
# Team Agent 事件
TEAM_SESSION_START = "team_session_start"
TEAM_SESSION_COMPLETE = "team_session_complete"
TEAM_SESSION_ERROR = "team_session_error"
TEAM_PLANNING_START = "team_planning_start"
TEAM_PLANNING_COMPLETE = "team_planning_complete"
TEAM_PHASE_START = "team_phase_start"
TEAM_PHASE_COMPLETE = "team_phase_complete"
TEAM_TASK_START = "team_task_start"
TEAM_TASK_COMPLETE = "team_task_complete"
TEAM_TASK_FAILED = "team_task_failed"
TEAM_TASK_FEEDBACK = "team_task_feedback"
TEAM_TASK_RESUBMIT = "team_task_resubmit"
TEAM_REVIEW_START = "team_review_start"
TEAM_REVIEW_COMPLETE = "team_review_complete"
TEAM_PHASE_REVIEW_START = "team_phase_review_start"
TEAM_PHASE_REVIEW_COMPLETE = "team_phase_review_complete"
TEAM_PLAN_UPDATED = "team_plan_updated"
```

### Step 8: Backend API Router (`backend/routers/team.py`)

```
POST /api/team/run
  Body: { objective, lead_worker_id, max_task_submits? }
  → 创建 session，启动后台 asyncio.Task
  → 后台 task 存入 _running_tasks[session_id]

GET /api/team/session/{session_id}
  → 完整 TeamSession（plan + 所有 phase/task 状态 + 消息历史 + 产出文件列表）

POST /api/team/session/{session_id}/cancel
  → 1. _running_tasks[session_id].cancel()
  → 2. mailbox.shutdown() 唤醒所有阻塞
  → 3. 更新 session 状态为 cancelled

GET /api/team/sessions
  → 所有 session 摘要列表

WebSocket /api/team/ws/{session_id}
  → 复用 SessionEventManager

GET /api/team/worker-types
  → agents.json 中所有 worker 配置摘要
```

### Step 9: 注册 Router (`backend/main.py`)

import 行追加 `team`，追加：
```python
app.include_router(team.router, prefix="/api/team", tags=["team"])
```

---

## 关键复用点

| 复用内容 | 来源文件 | 用途 |
|---------|---------|-----|
| `ClaudeSdkWorker` | `super_agent/worker.py:57` | Lead + Worker 的 LLM 执行 |
| `WorkerConfig` | `super_agent/models.py:21` | Worker 配置 |
| `LLMResult` | `super_agent/models.py:126` | LLM 执行结果 |
| `utc_now()` | `super_agent/models.py:8` | 时间戳 |
| `SessionEventManager` | `super_agent/events.py:68` | WebSocket 事件广播 |
| `get_or_create_manager` | `super_agent/events.py:159` | 事件管理器注册 |
| `load_agents()` | `backend/routers/agents.py` | 加载 agents.json |
| `get_worker_config()` | `backend/routers/super_agent.py:81` | Worker 配置 + MCP 继承 |

---

## 关键设计细节

### Worker 的 resume 机制
Worker 首次执行用 `resume_sdk_session_id=None`（新 session）。Lead 给反馈后，Worker 用 `resume_sdk_session_id=result.sdk_session_id` 继续同一 session，Lead 的反馈作为新的 prompt。Worker 保留完整上下文，增量修改而不是从零重做。

### Lead 的上下文保持
Lead Agent 全程使用同一个 `lead_sdk_session_id` resume。从规划 → task 审查 → phase 审查 → 下一轮 → 最终汇总，Lead 始终保持完整上下文。

### 消息排队
多个 Worker 同时完成时，结果进入 `_lead_queue`（asyncio.Queue）。Lead 审查协程依序取出，一个一个处理。Worker 在等待反馈期间阻塞在 `receive_for_worker`，不消耗资源。

### Phase 内任务可见
每个 Worker 的 prompt 中包含当前 Phase 内所有 task 的描述列表（不含其他 Worker 的结果）。

### 动态计划调整
Phase 审查时，Lead 可以输出 `updated_phases` 完全重新定义剩余 phases。Plan 的 `version` 递增，`change_log` 记录变更。

### 产出持久化与引用
- Worker 写文件到 `workspace/phase_N/task_XXX/`，同时写 `__result.json` 描述产出
- 后续 Phase 的 Worker prompt 中包含前置 Phase 结果摘要和文件路径
- Lead 最终汇总时引用所有 `__result.json` 摘要

---

## 已修复的设计约束

### P0: 失败场景死锁
- Worker 失败后调用 `mailbox.notify_worker_failed(task_id)`，发送哨兵消息到 Lead 队列
- `_lead_review_loop` 识别哨兵消息类型 `_SENTINEL_WORKER_FAILED`，递增 `resolved_count`
- Lead 不再死等已失败的 Worker

### P0: 数据模型一致性
- `Message` 的 `message_id` 和 `timestamp` 使用 `field(default_factory=...)` 自动生成
- `TeamSession` 包含 `lead_config: Optional[WorkerConfig]` 字段
- 所有可选字段使用 `Optional` 和默认值

### P1: Phase 状态覆盖
- `execute_phase` 末尾按实际 task 状态归并：`all_approved → completed`，`any_failed → failed`
- 不再无条件设为 `completed`

### P1: 取消机制闭环
- `Mailbox.shutdown()` 发送 `_SENTINEL_SHUTDOWN` 唤醒所有阻塞的 `receive_for_lead` 和 `receive_for_worker`
- `receive_*` 方法收到哨兵后返回 `None`，调用方检查 None 后退出循环
- API cancel 端点：先 `task.cancel()`，再 `mailbox.shutdown()`，最后更新状态
- `run_async` 主循环 catch `asyncio.CancelledError` 设状态为 `cancelled`

### P1: max_task_submits 落实
- `_worker_loop` 每次循环开始检查 `task.submit_count >= max_task_submits`
- 超限后标记 `failed`，发送失败哨兵给 Lead，退出循环
- 事件上报 `TEAM_TASK_FAILED` + error 原因

### P2: Phase 内 checkpoint
- `PhaseScheduler` 接收 `persist_fn` 回调
- 在以下时机调用 `_persist()`：
  - task 状态变化（start, submitted, feedback, approved, failed）
  - 每次消息收发
  - 每次 Lead 审查决策
- Phase 内崩溃后，重启可从最近的 checkpoint 恢复

---

## 验证方案

1. **单元测试**：Mailbox 消息排队 + 终止信号、模型序列化/反序列化、Plan 动态修改、`__result.json` 读写
2. **死锁测试**：Worker 全部失败时 Lead loop 能正常退出、cancel 时所有协程能正常退出
3. **集成测试（StubWorker）**：完整 planning → task review（含多轮反馈） → phase review → summary 流程
4. **端到端测试**：POST /api/team/run → WebSocket 监听事件流 → GET session 验证最终状态
5. **研究型任务测试**：使用 web search worker，执行一个 3-phase 研究任务，验证 Lead 的多轮反馈和计划调整
