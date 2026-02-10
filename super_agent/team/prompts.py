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


def build_planning_prompt(objective: str, worker_types: list[dict], workspace_path: str = "") -> str:
    """Build the planning prompt for Lead Agent.

    Leader creates the plan via create_plan MCP tool (not JSON text output).
    """
    worker_list = ""
    for wt in worker_types:
        worker_list += f"- **{wt.get('id', 'unknown')}**: {wt.get('description', '')}\n"

    return f"""You are the Lead of a Team Agent. Your role is to plan, review, and direct — you do not execute tasks yourself.

## Available Worker Types
{worker_list}

## Workspace
Current working directory: {workspace_path or '(not specified)'}
Workers operate within this directory. The system will create a project folder under this directory based on project_name.

## Planning Rules
1. Organize work into **Phases**. Phases execute **sequentially** (Phase 0 → Phase 1 → ...).
2. Tasks within each Phase execute **in parallel**, handled by independent Workers.
3. Assign a Worker type to each Task.
4. Phases can have dependencies — do not place dependent tasks in the same Phase.
5. Keep Phases focused — each Phase should have a clear objective.

## How to Operate
Use the `create_plan` tool to create an execution plan. Parameters:
- objective: Task objective (brief summary)
- project_name: Project name (short kebab-case English name, e.g. market-analysis, code-review-report). The system will create a corresponding project folder under the working directory.
- phases: JSON string in the following format:
  [
    {{
      "phase_id": "phase_0",
      "description": "What this Phase will accomplish",
      "tasks": [
        {{
          "task_id": "task_001",
          "description": "Detailed task description including file paths, expected behavior, acceptance criteria, etc.",
          "worker_type_id": "Choose from Worker types above",
          "context": {{}}
        }}
      ]
    }}
  ]

## User Request
{objective}

Please use the create_plan tool to create an execution plan. Do not execute any tasks yourself."""


def build_worker_prompt(
    task: TaskStep,
    phase_tasks: list[TaskStep],
    previous_results_summary: str = "",
    project_dir: str = "",
    logs_dir: str = "",
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
## Other Tasks in This Phase (being handled by other Workers in parallel)
{other_tasks}"""

    prev_section = ""
    if previous_results_summary:
        prev_section = f"""
## Results from Previous Phases
{previous_results_summary}"""

    context_section = ""
    if task.context:
        context_section = f"""
## Additional Context
{json.dumps(task.context, ensure_ascii=False, indent=2)}"""

    project_section = ""
    if project_dir:
        project_section = f"""
## Working Directory
Your working directory is the user's workspace.
The project directory {project_dir}/ already exists. Place all new files there directly — do not create or mkdir the project directory.
You may read other files in the workspace, but do not modify files outside the project directory."""

    logs_section = ""
    if logs_dir:
        logs_section = f"""
## Team Activity Log
Team work history: {logs_dir}
- `workflow.md`: Main workflow (Lead decisions, mail actions, plan)
- `phase*_*_submit*_final.md`: Approved submissions
Read these files if you need more context on previous work."""

    return f"""You are a Worker in a Team Agent. Focus on completing your task.
{other_section}{prev_section}{context_section}{project_section}{logs_section}

## Your Task
{task.description}

## Team Communication
After completing your task, use the `send_mail` tool to submit results to the Lead:
- Call send_mail(to="lead", content="your report")
- Your report should include:
  1. What was accomplished
  2. Which files were modified/created
  3. Test results (if applicable)
  4. Outstanding issues or risks
- After sending, your turn ends and the Lead will review and respond

If you receive feedback from the Lead, continue working based on the feedback and resubmit using send_mail.

Begin your task now."""


def build_task_review_prompt(task: TaskStep, mail_content: str, project_dir: str = "") -> str:
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
## Previous Communication History
{history}"""

    project_section = ""
    if project_dir:
        project_section = f"""
## Shared Project Directory
{project_dir}
"""

    return f"""Worker [{task.task_id}] has submitted work results. Please review.

## Task Description
{task.description}

## Worker's Submission (attempt #{task.submit_count})
{mail_content[:3000]}{history_section}{project_section}

## Review Actions
After reviewing, perform one of the following:

**If approved:**
1. Call update_task(task_id="{task.task_id}", status="approved")
2. Call send_mail(to="worker-{task.task_id}", content="approved")

**If revisions needed:**
1. Call send_mail(to="worker-{task.task_id}", content="specific revision instructions")
(Do not change task status — Worker will continue working and resubmit)

Please provide concise, actionable feedback."""


def build_phase_review_prompt(phase: Phase, remaining_phases: list[Phase], project_dir: str = "", logs_dir: str = "") -> str:
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
            summary = f"Failed: {task.result_error}"
        task_summaries += f"- [{task.task_id}] ({status}): {summary}\n"

    remaining_plan = ""
    if remaining_phases:
        for p in remaining_phases:
            remaining_plan += f"\n### Phase {p.phase_index}: {p.description}\n"
            for t in p.tasks:
                remaining_plan += f"  - [{t.task_id}] {t.description} (worker: {t.worker_type_id})\n"
    else:
        remaining_plan = "No remaining Phases — this is the final Phase."

    project_section = ""
    if project_dir:
        project_section = f"""
## Shared Project Directory
{project_dir}
"""

    logs_section = ""
    if logs_dir:
        logs_section = f"""
## Team Activity Log
Team work history: {logs_dir}
- `workflow.md`: Main workflow (Lead decisions, mail actions, plan)
- `phase*_*_submit*_final.md`: Approved submissions
"""

    return f"""Phase {phase.phase_index} ("{phase.description}") is complete.

## Phase Results Summary
{task_summaries}

## Remaining Plan
{remaining_plan}
{project_section}{logs_section}
## Review Actions
Evaluate whether to continue as planned:

**Continue as planned:** No additional action needed, simply reply "Phase review approved, continue execution."

**Adjust subsequent Phases:** Use the modify_phases tool to modify the remaining plan:
- Call modify_phases(from_index={phase.phase_index}, new_phases="[new phases JSON array]")
- Explain the reason for the modification.

**Terminate execution:** If a critical issue requires stopping, use the `abort_plan` tool:
- Call abort_plan(reason="reason for termination")

Only modify the plan when this Phase's results reveal issues that necessitate changes."""


def build_final_summary_prompt(plan: Plan, project_dir: str = "", logs_dir: str = "") -> str:
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

    project_section = ""
    if project_dir:
        project_section = f"""
## Project Directory
{project_dir}
"""

    logs_section = ""
    if logs_dir:
        logs_section = f"""
## Team Activity Log
Team work history: {logs_dir}
- `workflow.md`: Main workflow (Lead decisions, mail actions, plan)
- `phase*_*_submit*_final.md`: Approved submissions
Read these files if you need more detail beyond the summaries above.
"""

    return f"""All Phases are complete. Please generate the final report.

## Objective
{plan.objective}

## Results by Phase
{all_results}
{project_section}{logs_section}
## Requirements
Please write a comprehensive final report including:
1. What was accomplished
2. Key deliverables or outputs
3. Outstanding issues or limitations
4. Follow-up recommendations (if applicable)

Be concise but thorough."""
