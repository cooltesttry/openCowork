"""Prompt templates for Agent Team system."""

from __future__ import annotations

import json
from typing import Optional

from .models import Phase, Plan, TaskStep, Message


def build_planning_prompt(objective: str, worker_types: list[dict]) -> str:
    """Build the planning prompt for Lead Agent."""
    worker_list = ""
    for wt in worker_types:
        worker_list += f"- **{wt.get('id', 'unknown')}** ({wt.get('name', '')}): {wt.get('description', wt.get('model', ''))}\n"
        tools = wt.get("tools_allow", [])
        if tools:
            worker_list += f"  Tools: {', '.join(tools)}\n"

    return f"""You are the Lead Agent in a Team Agent system. Your role is ONLY to plan, review, and direct — you do NOT execute tasks yourself.

## Available Worker Types
{worker_list}

## Planning Rules
1. Organize work into **Phases**. Phases execute **sequentially** (Phase 0 → Phase 1 → ...).
2. Within each Phase, tasks execute **in parallel** by independent Workers.
3. Each task is assigned to one worker type.
4. After each task completes, you will review the result and can request adjustments.
5. After all tasks in a Phase complete, you will do a Phase review and can adjust the remaining plan.
6. Keep phases focused — don't put dependent tasks in the same phase.

## Output Format
Return a JSON plan in this exact format (no markdown fencing):
{{
  "objective": "<restate the objective briefly>",
  "phases": [
    {{
      "phase_id": "phase_0",
      "description": "<what this phase accomplishes>",
      "tasks": [
        {{
          "task_id": "task_001",
          "description": "<detailed task description>",
          "worker_type_id": "<worker type id from the list above>",
          "context": {{}}
        }}
      ]
    }}
  ]
}}

## User Request
{objective}"""


def build_worker_prompt(
    task: TaskStep,
    phase_tasks: list[TaskStep],
    previous_results_summary: str = "",
) -> str:
    """Build the execution prompt for a Worker."""
    # Other tasks in the same phase (for awareness)
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

    return f"""You are an independent Worker in a Team Agent system. Focus on completing your assigned task.
{other_section}{prev_section}{context_section}

## Your Task
{task.description}

## Output Protocol
When you finish your task, you MUST create a file called `__result.json` in your working directory with this format:
{{
  "summary": "<one-line summary of what you accomplished>",
  "content": "<full result text — research findings, analysis, code explanation, etc.>",
  "files": ["<list of other files you created, if any>"],
  "instruction": "<optional notes for whoever uses your output next>"
}}

This file is critical — it's how your results are communicated to the Lead Agent and subsequent phases.

Now begin working on your task."""


def build_task_review_prompt(task: TaskStep, message: Message) -> str:
    """Build the review prompt for Lead to assess a Worker's submission."""
    # Message history for this task
    history = ""
    for msg in task.messages:
        if msg.message_id == message.message_id:
            continue
        role = "Worker" if msg.from_id.startswith("worker-") else "Lead"
        history += f"[{role}] ({msg.message_type}): {msg.content[:500]}\n"

    history_section = ""
    if history:
        history_section = f"""
## Previous Messages
{history}"""

    files_section = ""
    if task.result and task.result.files:
        files_section = f"\n## Output Files\n" + "\n".join(f"- {f}" for f in task.result.files)

    result_summary = ""
    if task.result and task.result.summary:
        result_summary = f"\nSummary: {task.result.summary}"

    return f"""Worker [{task.task_id}] has submitted results for review.

## Task Description
{task.description}

## Worker's Submission (attempt #{task.submit_count})
{message.content[:3000]}{result_summary}{files_section}{history_section}

## Your Decision
Review the submission and respond with JSON (no markdown fencing):
- If satisfactory: {{"decision": "approve"}}
- If needs changes: {{"decision": "feedback", "content": "<specific feedback for the worker>"}}

Be concise and actionable in your feedback."""


def build_phase_review_prompt(phase: Phase, remaining_phases: list[Phase]) -> str:
    """Build the Phase-level review prompt for Lead."""
    # Task summaries
    task_summaries = ""
    for task in phase.tasks:
        status = task.status
        summary = ""
        if task.result and task.result.summary:
            summary = task.result.summary
        elif task.result_text:
            summary = task.result_text[:200]
        elif task.result_error:
            summary = f"FAILED: {task.result_error}"
        task_summaries += f"- [{task.task_id}] ({status}): {summary}\n"

    # Remaining plan
    remaining_plan = ""
    if remaining_phases:
        for p in remaining_phases:
            remaining_plan += f"\n### Phase {p.phase_index}: {p.description}\n"
            for t in p.tasks:
                remaining_plan += f"  - [{t.task_id}] {t.description} (worker: {t.worker_type_id})\n"
    else:
        remaining_plan = "No remaining phases — this is the final phase."

    return f"""Phase {phase.phase_index} ("{phase.description}") is complete. You have already reviewed each task individually.

## Phase Results Summary
{task_summaries}

## Remaining Plan
{remaining_plan}

## Your Decision
Evaluate whether to proceed as planned or adjust. Respond with JSON (no markdown fencing):

- Proceed as planned: {{"decision": "approve"}}
- Modify remaining phases: {{"decision": "modify", "reason": "<why>", "updated_phases": [<new phase objects in same format as planning output>]}}
- Abort execution: {{"decision": "abort", "reason": "<why>"}}

Only modify if the results of this phase reveal something that requires changing the plan."""


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

    return f"""All phases are complete. Generate a final summary report.

## Objective
{plan.objective}

## All Phase Results
{all_results}

## Instructions
Write a comprehensive final report that:
1. Summarizes what was accomplished
2. Lists key findings or deliverables
3. Notes any issues or limitations
4. Provides recommendations if applicable

Be thorough but concise."""
