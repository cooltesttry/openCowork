"""Plan MCP server for Agent Team plan management.

Leader only. Provides create_plan, get_plan, update_task, modify_phases tools.
All operations target .team/plan.json with atomic writes.
"""

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("team-plan")

WORKSPACE = os.environ.get("TEAM_WORKSPACE", "")


def _team_dir() -> Path:
    return Path(WORKSPACE)


def _plan_path() -> Path:
    return _team_dir() / "plan.json"


def _atomic_write(path: Path, data: dict):
    """Write JSON atomically via temp file + rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        dir=str(path.parent), suffix=".tmp", prefix=".plan_"
    )
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.rename(tmp_path, str(path))
    except Exception:
        # Clean up temp file on failure
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _read_plan() -> dict | None:
    path = _plan_path()
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


@mcp.tool(
    name="create_plan",
    description="创建执行计划。将任务目标分解为多个 Phase，每个 Phase 包含可并行执行的 Tasks。你必须提供 project_name 参数（简短的 kebab-case 英文名称，如 market-analysis、code-review-report），系统会在工作目录下创建对应的项目文件夹。",
)
def create_plan(objective: str, phases: str, project_name: str = "") -> str:
    """Create an execution plan.

    Args:
        objective: Task objective description
        phases: JSON string describing phases and tasks. Format:
            [{"phase_id": "phase_0", "description": "...", "tasks": [
                {"task_id": "task_001", "description": "...", "worker_type_id": "default", "context": {}}
            ]}]
        project_name: Short kebab-case project name (e.g. "market-analysis"). Used to create a project directory in workspace.
    """
    if not WORKSPACE:
        return "错误：TEAM_WORKSPACE 环境变量未设置"

    try:
        phases_data = json.loads(phases)
    except json.JSONDecodeError as e:
        return f"错误：phases JSON 格式无效 — {e}"

    if not isinstance(phases_data, list):
        return "错误：phases 必须是数组"

    # Build plan structure
    plan = {
        "objective": objective,
        "project_name": project_name,
        "version": 1,
        "change_log": ["v1: initial plan"],
        "phases": [],
    }

    for i, phase_data in enumerate(phases_data):
        phase = {
            "phase_id": phase_data.get("phase_id", f"phase_{i}"),
            "phase_index": i,
            "description": phase_data.get("description", ""),
            "status": "pending",
            "tasks": [],
        }
        for task_data in phase_data.get("tasks", []):
            task = {
                "task_id": task_data.get("task_id", f"task_{i}_{len(phase['tasks'])}"),
                "description": task_data.get("description", ""),
                "worker_type_id": task_data.get("worker_type_id", "default"),
                "status": "pending",
                "context": task_data.get("context", {}),
            }
            phase["tasks"].append(task)
        plan["phases"].append(phase)

    _atomic_write(_plan_path(), plan)
    task_count = sum(len(p["tasks"]) for p in plan["phases"])
    return f"计划已创建：{len(plan['phases'])} 个 Phase，共 {task_count} 个 Task"


@mcp.tool(
    name="get_plan",
    description="查看当前执行计划的完整内容，包括所有 Phase 和 Task 的状态。",
)
def get_plan() -> str:
    """Read the current plan."""
    if not WORKSPACE:
        return "错误：TEAM_WORKSPACE 环境变量未设置"

    plan = _read_plan()
    if not plan:
        return "当前没有计划"

    return json.dumps(plan, ensure_ascii=False, indent=2)


@mcp.tool(
    name="update_task",
    description="更新指定 Task 的状态。审核通过时设为 approved，需要修改时保持 running。",
)
def update_task(task_id: str, status: str, notes: str = "") -> str:
    """Update a task's status in the plan.

    Args:
        task_id: The task ID to update
        status: New status - "pending", "running", "approved", or "failed"
        notes: Optional notes about the status change
    """
    if not WORKSPACE:
        return "错误：TEAM_WORKSPACE 环境变量未设置"

    valid_statuses = {"pending", "running", "approved", "failed"}
    if status not in valid_statuses:
        return f"错误：无效状态 '{status}'，可选值：{', '.join(sorted(valid_statuses))}"

    plan = _read_plan()
    if not plan:
        return "错误：计划不存在"

    # Find and update the task
    for phase in plan.get("phases", []):
        for task in phase.get("tasks", []):
            if task["task_id"] == task_id:
                old_status = task.get("status", "unknown")
                task["status"] = status
                if notes:
                    task["notes"] = notes
                _atomic_write(_plan_path(), plan)
                return f"Task {task_id} 状态已更新：{old_status} → {status}"

    return f"错误：未找到 Task '{task_id}'"


@mcp.tool(
    name="modify_phases",
    description="修改计划：替换指定索引之后的所有 Phase。用于 Phase Review 时调整后续计划。",
)
def modify_phases(from_index: int, new_phases: str) -> str:
    """Replace all phases after from_index with new phases.

    Args:
        from_index: Keep phases 0..from_index, replace everything after
        new_phases: JSON string of new phase objects
    """
    if not WORKSPACE:
        return "错误：TEAM_WORKSPACE 环境变量未设置"

    try:
        new_phases_data = json.loads(new_phases)
    except json.JSONDecodeError as e:
        return f"错误：new_phases JSON 格式无效 — {e}"

    if not isinstance(new_phases_data, list):
        return "错误：new_phases 必须是数组"

    plan = _read_plan()
    if not plan:
        return "错误：计划不存在"

    # Keep phases up to and including from_index
    kept = plan["phases"][: from_index + 1]

    # Build new phases with correct indices
    new_built = []
    for i, p_data in enumerate(new_phases_data):
        idx = from_index + 1 + i
        phase = {
            "phase_id": p_data.get("phase_id", f"phase_{idx}"),
            "phase_index": idx,
            "description": p_data.get("description", ""),
            "status": "pending",
            "tasks": [],
        }
        for task_data in p_data.get("tasks", []):
            task = {
                "task_id": task_data.get("task_id", f"task_{idx}_{len(phase['tasks'])}"),
                "description": task_data.get("description", ""),
                "worker_type_id": task_data.get("worker_type_id", "default"),
                "status": "pending",
                "context": task_data.get("context", {}),
            }
            phase["tasks"].append(task)
        new_built.append(phase)

    plan["phases"] = kept + new_built
    plan["version"] = plan.get("version", 0) + 1
    plan["change_log"] = plan.get("change_log", [])
    plan["change_log"].append(
        f"v{plan['version']}: modified phases from index {from_index + 1}"
    )

    _atomic_write(_plan_path(), plan)

    task_count = sum(len(p["tasks"]) for p in new_built)
    return (
        f"计划已修改（v{plan['version']}）：保留 {len(kept)} 个 Phase，"
        f"新增 {len(new_built)} 个 Phase（{task_count} 个 Task）"
    )


@mcp.tool(
    name="abort_plan",
    description="终止执行计划。当判断无法继续执行时使用此工具。",
)
def abort_plan(reason: str = "") -> str:
    """Abort the current plan.

    Args:
        reason: Reason for aborting the plan
    """
    if not WORKSPACE:
        return "错误：TEAM_WORKSPACE 环境变量未设置"

    plan = _read_plan()
    if not plan:
        return "错误：计划不存在"

    plan["abort"] = True
    if reason:
        plan["abort_reason"] = reason
    _atomic_write(_plan_path(), plan)

    return f"计划已标记为终止。原因：{reason or '(未提供)'}"


if __name__ == "__main__":
    mcp.run()
