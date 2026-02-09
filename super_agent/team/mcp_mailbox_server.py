"""Mailbox MCP server for Agent Team communication.

All Agents load this MCP. Provides send_mail, read_inbox, list_members tools.
Communication is file-based via .team/inboxes/{agent_id}.json.
"""

import fcntl
import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("team-mailbox")

# Valid agent ID pattern: alphanumeric, hyphens, underscores only
_VALID_AGENT_ID = re.compile(r"^[a-zA-Z0-9_-]+$")

# Environment variables set by Scheduler when launching each Agent
WORKSPACE = os.environ.get("TEAM_WORKSPACE", "")
AGENT_ID = os.environ.get("TEAM_AGENT_ID", "")


def _team_dir() -> Path:
    return Path(WORKSPACE)


def _inbox_path(agent_id: str) -> Path:
    return _team_dir() / "inboxes" / f"{agent_id}.json"


def _ensure_inbox(agent_id: str) -> Path:
    path = _inbox_path(agent_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text("[]")
    return path


def _append_mail(inbox_file: Path, mail: dict):
    """Append a mail to an inbox file with file locking for concurrent safety."""
    inbox_file.parent.mkdir(parents=True, exist_ok=True)
    if not inbox_file.exists():
        inbox_file.write_text("[]")

    with open(inbox_file, "r+") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            mails = json.loads(f.read())
            mails.append(mail)
            f.seek(0)
            f.truncate()
            f.write(json.dumps(mails, ensure_ascii=False, indent=2))
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


@mcp.tool(
    name="send_mail",
    description="发送邮件给团队成员。完成任务后用此工具向 Lead 提交结果，或与其他成员通信。",
)
def send_mail(to: str, content: str) -> str:
    """Send a mail to a team member.

    Args:
        to: Recipient ID ("lead" or "worker-{task_id}")
        content: Mail body (plain text)
    """
    if not WORKSPACE:
        return "错误：TEAM_WORKSPACE 环境变量未设置"
    if not AGENT_ID:
        return "错误：TEAM_AGENT_ID 环境变量未设置"
    if not to:
        return "错误：收件人不能为空"
    if not _VALID_AGENT_ID.match(to) or len(to) > 128:
        return "错误：收件人 ID 格式不合法（仅允许字母、数字、下划线、连字符）"
    if not content:
        return "错误：邮件内容不能为空"

    mail = {
        "id": f"msg-{uuid.uuid4().hex[:8]}",
        "from": AGENT_ID,
        "content": content,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "delivered": False,
    }

    inbox_file = _inbox_path(to)
    _append_mail(inbox_file, mail)

    return f"邮件已发送给 {to}"


@mcp.tool(
    name="read_inbox",
    description="读取自己的收件箱中未投递的邮件。通常不需要主动调用，调度器会自动投递。",
)
def read_inbox() -> str:
    """Read undelivered mails from own inbox."""
    if not WORKSPACE or not AGENT_ID:
        return "错误：环境变量未设置"

    inbox_file = _inbox_path(AGENT_ID)
    if not inbox_file.exists():
        return "收件箱为空"

    try:
        mails = json.loads(inbox_file.read_text())
        unread = [m for m in mails if not m.get("delivered")]
        if not unread:
            return "没有新邮件"
        parts = []
        for m in unread:
            parts.append(f"来自 {m['from']}（{m['timestamp']}）：\n{m['content']}")
        return "\n\n---\n\n".join(parts)
    except (json.JSONDecodeError, OSError) as e:
        return f"读取收件箱失败：{e}"


@mcp.tool(
    name="list_members",
    description="查看团队成员列表。",
)
def list_members() -> str:
    """List all team members."""
    if not WORKSPACE:
        return "错误：TEAM_WORKSPACE 环境变量未设置"

    config_path = _team_dir() / "config.json"
    if not config_path.exists():
        return "团队配置文件不存在"

    try:
        config = json.loads(config_path.read_text())
        members = config.get("members", [])
        if not members:
            return "团队暂无成员"
        parts = []
        for m in members:
            parts.append(f"- {m.get('id', '?')} ({m.get('role', '?')}): {m.get('description', '')}")
        return "\n".join(parts)
    except (json.JSONDecodeError, OSError) as e:
        return f"读取团队配置失败：{e}"


if __name__ == "__main__":
    mcp.run()
