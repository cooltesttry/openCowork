"""Prompt templates for Agent Team system.

Updated for dual MCP architecture:
- Workers use send_mail MCP tool to submit results
- Leader uses create_plan/update_task MCP tools for plan management
- Leader uses send_mail for communication with Workers
"""

from __future__ import annotations

import json
from typing import Optional

from .models import Phase, Plan, TaskStep


def build_planning_prompt(objective: str, worker_types: list[dict]) -> str:
    """Build the planning prompt for Lead Agent.

    Leader creates the plan via create_plan MCP tool (not JSON text output).
    """
    worker_list = ""
    for wt in worker_types:
        worker_list += f"- **{wt.get('id', 'unknown')}** ({wt.get('name', '')}): {wt.get('description', wt.get('model', ''))}\n"
        tools = wt.get("tools_allow", [])
        if tools:
            worker_list += f"  Tools: {', '.join(tools)}\n"

    return f"""你是 Team Agent 的 Lead。你的职责是规划、审核和指挥 — 你不执行具体任务。

## 可用 Worker 类型
{worker_list}

## 规划规则
1. 将工作组织为 **Phase**。Phase **顺序**执行（Phase 0 → Phase 1 → ...）。
2. 每个 Phase 内的 Task **并行**执行，由独立的 Worker 完成。
3. 每个 Task 分配一个 Worker 类型。
4. Phase 之间可以有依赖 — 不要把有依赖的任务放在同一 Phase。
5. 保持 Phase 聚焦 — 每个 Phase 有明确的目标。

## 操作方式
使用 `create_plan` 工具创建执行计划。参数：
- objective: 任务目标（简要概述）
- phases: JSON 字符串，格式如下：
  [
    {{
      "phase_id": "phase_0",
      "description": "这个 Phase 要完成什么",
      "tasks": [
        {{
          "task_id": "task_001",
          "description": "详细的任务描述，包含文件路径、预期行为、验收标准等",
          "worker_type_id": "从上方 Worker 类型中选择",
          "context": {{}}
        }}
      ]
    }}
  ]

## 用户请求
{objective}

请使用 create_plan 工具创建执行计划。不要执行任何具体任务。"""


def build_worker_prompt(
    task: TaskStep,
    phase_tasks: list[TaskStep],
    previous_results_summary: str = "",
) -> str:
    """Build the execution prompt for a Worker.

    Worker uses send_mail MCP tool to submit results (not __result.json).
    """
    other_tasks = ""
    for t in phase_tasks:
        if t.task_id != task.task_id:
            other_tasks += f"- [{t.task_id}] {t.description}\n"

    other_section = ""
    if other_tasks:
        other_section = f"""
## 同 Phase 的其他任务（其他 Worker 并行处理中）
{other_tasks}"""

    prev_section = ""
    if previous_results_summary:
        prev_section = f"""
## 之前 Phase 的结果
{previous_results_summary}"""

    context_section = ""
    if task.context:
        context_section = f"""
## 附加上下文
{json.dumps(task.context, ensure_ascii=False, indent=2)}"""

    return f"""你是 Team Agent 中的一名 Worker。专注完成你的任务。
{other_section}{prev_section}{context_section}

## 你的任务
{task.description}

## 团队通信
完成任务后，使用 `send_mail` 工具向 Lead 提交结果：
- 调用 send_mail(to="lead", content="你的报告")
- 报告应包含：
  1. 完成了什么
  2. 修改/创建了哪些文件
  3. 测试运行结果（如适用）
  4. 遗留问题或风险
- 发送后你的本轮工作结束，Lead 会审核并回复

如果收到 Lead 的反馈，请根据反馈继续修改，完成后再次用 send_mail 提交。

## 工作目录
你的工作目录是共享项目目录，其他 Worker 也在此目录工作。注意文件命名避免冲突。

现在开始你的任务。"""


def build_task_review_prompt(task: TaskStep, mail_content: str) -> str:
    """Build the review prompt for Lead to assess a Worker's submission.

    In the new architecture, this prompt is built from inbox mail content,
    not from a structured Message object.
    """
    history = ""
    for msg in task.messages:
        role = "Worker" if msg.from_id.startswith("worker-") else "Lead"
        history += f"[{role}]: {msg.content[:500]}\n"

    history_section = ""
    if history:
        history_section = f"""
## 之前的沟通记录
{history}"""

    return f"""Worker [{task.task_id}] 提交了工作结果，请审核。

## 任务描述
{task.description}

## Worker 的提交（第 {task.submit_count} 次）
{mail_content[:3000]}{history_section}

## 审核操作
审核后请执行以下操作：

**如果通过：**
1. 调用 update_task(task_id="{task.task_id}", status="approved")
2. 调用 send_mail(to="worker-{task.task_id}", content="approved")

**如果需要修改：**
1. 调用 send_mail(to="worker-{task.task_id}", content="具体的修改意见")
（不要改 task 状态，Worker 会继续工作后重新提交）

请简洁、可操作地给出反馈。"""


def build_phase_review_prompt(phase: Phase, remaining_phases: list[Phase]) -> str:
    """Build the Phase-level review prompt for Lead.

    Lead uses modify_phases MCP tool if plan adjustment is needed.
    """
    task_summaries = ""
    for task in phase.tasks:
        status = task.status
        summary = ""
        if task.result and task.result.summary:
            summary = task.result.summary
        elif task.result_text:
            summary = task.result_text[:200]
        elif task.result_error:
            summary = f"失败: {task.result_error}"
        task_summaries += f"- [{task.task_id}] ({status}): {summary}\n"

    remaining_plan = ""
    if remaining_phases:
        for p in remaining_phases:
            remaining_plan += f"\n### Phase {p.phase_index}: {p.description}\n"
            for t in p.tasks:
                remaining_plan += f"  - [{t.task_id}] {t.description} (worker: {t.worker_type_id})\n"
    else:
        remaining_plan = "没有后续 Phase — 这是最后一个 Phase。"

    return f"""Phase {phase.phase_index}（"{phase.description}"）已完成。

## Phase 结果概要
{task_summaries}

## 剩余计划
{remaining_plan}

## 审核操作
评估是否按计划继续：

**按计划继续：** 不需要额外操作，直接回复"Phase 审核通过，继续执行"。

**调整后续 Phase：** 使用 modify_phases 工具修改后续计划：
- 调用 modify_phases(from_index={phase.phase_index}, new_phases="[新的 phase JSON 数组]")
- 并说明修改原因。

**终止执行：** 如果发现严重问题需要停止，使用 `abort_plan` 工具终止执行：
- 调用 abort_plan(reason="终止原因说明")

只有当本 Phase 的结果揭示了需要改变计划的问题时，才需要修改。"""


def build_final_summary_prompt(plan: Plan) -> str:
    """Build the final summary prompt for Lead."""
    all_results = ""
    for phase in plan.phases:
        all_results += f"\n## Phase {phase.phase_index}: {phase.description}\n"
        for task in phase.tasks:
            summary = ""
            if task.result and task.result.summary:
                summary = task.result.summary
            elif task.result_text:
                summary = task.result_text[:300]
            content_preview = ""
            if task.result and task.result.content:
                content_preview = f"\n{task.result.content[:500]}"
            files = ""
            if task.result and task.result.files:
                files = f"\nFiles: {', '.join(task.result.files)}"
            all_results += f"- [{task.task_id}] {summary}{content_preview}{files}\n"

    return f"""所有 Phase 已完成，请生成最终报告。

## 目标
{plan.objective}

## 各 Phase 结果
{all_results}

## 要求
请写一份全面的最终报告，包括：
1. 完成了什么
2. 关键成果或交付物
3. 存在的问题或限制
4. 后续建议（如适用）

请简洁但全面。"""
