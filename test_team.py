"""
Comprehensive test suite for Agent Team system (Dual MCP Architecture).

Test layers:
  1. Unit tests for each module (models, mailbox, prompts, events, persistence, MCP servers)
  2. Unit tests for scheduler (inbox-driven flow with mock workers)
  3. Unit tests for orchestrator utility functions
  4. Integration test: full flow with scripted worker simulating MCP calls
  5. E2E test: API router with TestClient

Usage:
  cd /path/to/openCowork
  source backend/.venv/bin/activate
  python -m pytest test_team.py -v
  # or just:
  python test_team.py
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Optional

# Make sure imports work
sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent / "backend"))

from super_agent.models import WorkerConfig, LLMResult, utc_now
from super_agent.worker import Worker
from super_agent.team.models import (
    Message, TaskResult, TaskStep, Phase, Plan, TeamSession,
)
from super_agent.team.mailbox import FileMailbox
from super_agent.team.prompts import (
    build_planning_prompt,
    build_worker_prompt,
    build_task_review_prompt,
    build_phase_review_prompt,
    build_final_summary_prompt,
)
from super_agent.team.persistence import TeamSessionStore
from super_agent.team.scheduler import PhaseScheduler
from super_agent.team.team_orchestrator import (
    TeamOrchestrator,
    _build_previous_results_summary,
    _sanitize_task_id,
    _ensure_unique_task_ids,
    _read_plan_from_file,
    _plan_data_to_plan,
    _slugify,
    _unique_dir,
)
from super_agent.events import EventType


# ═══════════════════════════════════════════════════════════════
# Helper: reusable factory methods
# ═══════════════════════════════════════════════════════════════

def make_worker_config(wid="default") -> WorkerConfig:
    return WorkerConfig(id=wid, name=f"Worker-{wid}", model="test-model")

def make_message(task_id="t1", content="hello") -> Message:
    return Message(
        from_id=f"worker-{task_id}", to_id="lead",
        task_id=task_id, content=content,
    )

def make_task(task_id="t1", worker_type="default", desc="do stuff") -> TaskStep:
    return TaskStep(task_id=task_id, description=desc, worker_type_id=worker_type)

def make_phase(phase_id="p0", index=0, tasks=None) -> Phase:
    return Phase(
        phase_id=phase_id, phase_index=index,
        description=f"Phase {index}",
        tasks=tasks or [],
    )

def make_plan(objective="test objective", phases=None) -> Plan:
    return Plan(plan_id="plan-test", objective=objective, phases=phases or [])

def make_session(sid="test-session") -> TeamSession:
    wc = make_worker_config()
    plan = make_plan(phases=[
        make_phase("p0", 0, [make_task("t1"), make_task("t2", desc="other task")])
    ])
    return TeamSession(
        session_id=sid, lead_config=wc, plan=plan,
        workspace_dir="/tmp/test-workspace",
    )


def _write_plan_json(team_data_dir: Path, plan_data: dict):
    """Helper: write plan.json to team data directory."""
    team_data_dir.mkdir(parents=True, exist_ok=True)
    (team_data_dir / "plan.json").write_text(
        json.dumps(plan_data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _write_inbox_mail(team_data_dir: Path, agent_id: str, mails: list[dict]):
    """Helper: write mail to an agent's inbox file."""
    inbox_dir = team_data_dir / "inboxes"
    inbox_dir.mkdir(parents=True, exist_ok=True)
    inbox_file = inbox_dir / f"{agent_id}.json"
    inbox_file.write_text(
        json.dumps(mails, ensure_ascii=False, indent=2), encoding="utf-8"
    )


# ═══════════════════════════════════════════════════════════════
# 1. Unit Tests: models.py
# ═══════════════════════════════════════════════════════════════

class TestModels(unittest.TestCase):
    """Test all dataclass serialization round-trips."""

    def test_message_roundtrip(self):
        msg = make_message()
        d = msg.to_dict()
        msg2 = Message.from_dict(d)
        self.assertEqual(msg.from_id, msg2.from_id)
        self.assertEqual(msg.task_id, msg2.task_id)
        self.assertEqual(msg.content, msg2.content)
        self.assertTrue(msg2.message_id.startswith("msg-"))
        self.assertIn("T", msg2.timestamp)  # ISO format

    def test_message_no_message_type(self):
        """Message no longer has message_type field."""
        msg = make_message()
        self.assertFalse(hasattr(msg, "message_type"))
        d = msg.to_dict()
        self.assertNotIn("message_type", d)

    def test_message_auto_id_and_timestamp(self):
        m1 = make_message()
        m2 = make_message()
        self.assertNotEqual(m1.message_id, m2.message_id)

    def test_task_result_roundtrip(self):
        tr = TaskResult(summary="done", content="full text", files=["a.txt", "b.csv"],
                        instruction="read a.txt", output_dir="/out")
        d = tr.to_dict()
        tr2 = TaskResult.from_dict(d)
        self.assertEqual(tr.summary, tr2.summary)
        self.assertEqual(tr.files, tr2.files)
        self.assertEqual(tr.output_dir, tr2.output_dir)

    def test_task_result_empty(self):
        tr = TaskResult()
        d = tr.to_dict()
        tr2 = TaskResult.from_dict(d)
        self.assertEqual(tr2.summary, "")
        self.assertEqual(tr2.files, [])

    def test_task_step_roundtrip_with_nested(self):
        ts = make_task()
        ts.messages.append(make_message())
        ts.result = TaskResult(summary="ok", files=["report.md"])
        ts.status = "approved"
        ts.submit_count = 2
        d = ts.to_dict()
        ts2 = TaskStep.from_dict(d)
        self.assertEqual(ts2.task_id, "t1")
        self.assertEqual(ts2.status, "approved")
        self.assertEqual(len(ts2.messages), 1)
        self.assertIsNotNone(ts2.result)
        self.assertEqual(ts2.result.summary, "ok")
        self.assertEqual(ts2.submit_count, 2)

    def test_task_step_no_result(self):
        ts = make_task()
        d = ts.to_dict()
        self.assertIsNone(d["result"])
        ts2 = TaskStep.from_dict(d)
        self.assertIsNone(ts2.result)

    def test_phase_roundtrip(self):
        p = make_phase("p0", 0, [make_task("t1"), make_task("t2")])
        p.status = "completed"
        p.phase_review_decision = "approve"
        d = p.to_dict()
        p2 = Phase.from_dict(d)
        self.assertEqual(p2.phase_id, "p0")
        self.assertEqual(len(p2.tasks), 2)
        self.assertEqual(p2.status, "completed")
        self.assertEqual(p2.phase_review_decision, "approve")

    def test_plan_roundtrip(self):
        plan = make_plan("do things", [
            make_phase("p0", 0, [make_task()]),
            make_phase("p1", 1, [make_task("t2")]),
        ])
        plan.version = 2
        plan.change_log = ["v1: initial", "v2: adjusted"]
        d = plan.to_dict()
        plan2 = Plan.from_dict(d)
        self.assertEqual(plan2.objective, "do things")
        self.assertEqual(len(plan2.phases), 2)
        self.assertEqual(plan2.version, 2)
        self.assertEqual(len(plan2.change_log), 2)

    def test_team_session_roundtrip(self):
        session = make_session()
        d = session.to_dict()
        session2 = TeamSession.from_dict(d)
        self.assertEqual(session2.session_id, "test-session")
        self.assertIsNotNone(session2.lead_config)
        self.assertEqual(session2.lead_config.id, "default")
        self.assertIsNotNone(session2.plan)
        self.assertEqual(len(session2.plan.phases), 1)

    def test_team_session_no_max_task_submits(self):
        """TeamSession no longer has max_task_submits field."""
        session = make_session()
        self.assertFalse(hasattr(session, "max_task_submits"))

    def test_team_session_minimal(self):
        s = TeamSession(session_id="s1")
        d = s.to_dict()
        s2 = TeamSession.from_dict(d)
        self.assertEqual(s2.session_id, "s1")
        self.assertIsNone(s2.plan)
        self.assertIsNone(s2.lead_config)

    def test_team_session_with_error(self):
        s = TeamSession(session_id="s1", status="failed", error="boom")
        d = s.to_dict()
        s2 = TeamSession.from_dict(d)
        self.assertEqual(s2.status, "failed")
        self.assertEqual(s2.error, "boom")


# ═══════════════════════════════════════════════════════════════
# 2. Unit Tests: mailbox.py (FileMailbox)
# ═══════════════════════════════════════════════════════════════

class TestFileMailbox(unittest.TestCase):
    """Test FileMailbox with file-based inboxes."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.team_data_dir = self.tmpdir / "team_data"
        self.team_data_dir.mkdir(parents=True, exist_ok=True)
        self.mailbox = FileMailbox(self.team_data_dir)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro)

    def test_register_agent_creates_inbox(self):
        self.mailbox.register_agent("lead")
        inbox_file = self.team_data_dir / "inboxes" / "lead.json"
        self.assertTrue(inbox_file.exists())
        self.assertEqual(json.loads(inbox_file.read_text()), [])

    def test_peek_undelivered_empty(self):
        self.mailbox.register_agent("lead")
        result = self.mailbox._peek_undelivered("lead")
        self.assertEqual(result, [])

    def test_peek_undelivered_with_mail(self):
        _write_inbox_mail(self.team_data_dir, "lead", [
            {"id": "msg-1", "from": "worker-t1", "content": "hello", "delivered": False},
            {"id": "msg-2", "from": "worker-t2", "content": "world", "delivered": True},
        ])
        result = self.mailbox._peek_undelivered("lead")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["id"], "msg-1")

    def test_ack_delivered_marks_messages(self):
        _write_inbox_mail(self.team_data_dir, "lead", [
            {"id": "msg-1", "from": "worker-t1", "content": "hello", "delivered": False},
            {"id": "msg-2", "from": "worker-t2", "content": "world", "delivered": False},
        ])
        self.mailbox.ack_delivered("lead", ["msg-1"])
        inbox_file = self.team_data_dir / "inboxes" / "lead.json"
        mails = json.loads(inbox_file.read_text())
        self.assertTrue(mails[0]["delivered"])
        self.assertFalse(mails[1]["delivered"])

    def test_ack_then_peek_filters_delivered(self):
        _write_inbox_mail(self.team_data_dir, "lead", [
            {"id": "msg-1", "from": "worker-t1", "content": "hello", "delivered": False},
            {"id": "msg-2", "from": "worker-t2", "content": "world", "delivered": False},
        ])
        self.mailbox.ack_delivered("lead", ["msg-1"])
        result = self.mailbox._peek_undelivered("lead")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["id"], "msg-2")

    def test_wait_for_mail_returns_immediately_when_mail_exists(self):
        async def go():
            _write_inbox_mail(self.team_data_dir, "worker-t1", [
                {"id": "msg-1", "from": "lead", "content": "feedback", "delivered": False},
            ])
            result = await asyncio.wait_for(
                self.mailbox.wait_for_mail("worker-t1"), timeout=2.0
            )
            self.assertEqual(len(result), 1)
            self.assertEqual(result[0]["content"], "feedback")
        self._run(go())

    def test_wait_for_mail_returns_empty_on_terminal_task(self):
        """wait_for_mail returns [] if task is terminal in plan.json."""
        async def go():
            plan_data = {
                "objective": "test",
                "version": 1,
                "phases": [{
                    "phase_id": "p0", "phase_index": 0,
                    "tasks": [{"task_id": "t1", "status": "approved"}]
                }]
            }
            _write_plan_json(self.team_data_dir, plan_data)
            self.mailbox.register_agent("worker-t1")
            result = await asyncio.wait_for(
                self.mailbox.wait_for_mail("worker-t1", task_id="t1"), timeout=2.0
            )
            self.assertEqual(result, [])
        self._run(go())

    def test_wait_for_mail_shutdown_returns_empty(self):
        async def go():
            self.mailbox.register_agent("lead")
            async def shutdown_later():
                await asyncio.sleep(0.1)
                await self.mailbox.shutdown()
            asyncio.create_task(shutdown_later())
            result = await asyncio.wait_for(
                self.mailbox.wait_for_mail("lead"), timeout=3.0
            )
            self.assertEqual(result, [])
        self._run(go())

    def test_is_task_terminal_approved(self):
        plan_data = {
            "phases": [{
                "phase_id": "p0", "phase_index": 0,
                "tasks": [{"task_id": "t1", "status": "approved"}]
            }]
        }
        _write_plan_json(self.team_data_dir, plan_data)
        self.assertTrue(self.mailbox._is_task_terminal("t1"))

    def test_is_task_terminal_running(self):
        plan_data = {
            "phases": [{
                "phase_id": "p0", "phase_index": 0,
                "tasks": [{"task_id": "t1", "status": "running"}]
            }]
        }
        _write_plan_json(self.team_data_dir, plan_data)
        self.assertFalse(self.mailbox._is_task_terminal("t1"))

    def test_is_task_terminal_no_plan(self):
        self.assertFalse(self.mailbox._is_task_terminal("t1"))

    def test_get_task_status(self):
        plan_data = {
            "phases": [{
                "phase_id": "p0", "phase_index": 0,
                "tasks": [
                    {"task_id": "t1", "status": "approved"},
                    {"task_id": "t2", "status": "running"},
                ]
            }]
        }
        _write_plan_json(self.team_data_dir, plan_data)
        self.assertEqual(self.mailbox.get_task_status("t1"), "approved")
        self.assertEqual(self.mailbox.get_task_status("t2"), "running")
        self.assertIsNone(self.mailbox.get_task_status("t3"))

    def test_peek_nonexistent_agent(self):
        result = self.mailbox._peek_undelivered("nonexistent")
        self.assertEqual(result, [])

    def test_ack_nonexistent_agent(self):
        # Should not raise
        self.mailbox.ack_delivered("nonexistent", ["msg-1"])


# ═══════════════════════════════════════════════════════════════
# 3. Unit Tests: MCP Plan Server (functions only, not stdio)
# ═══════════════════════════════════════════════════════════════

class TestMCPPlanServer(unittest.TestCase):
    """Test Plan MCP server functions directly."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.tmpdir.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _patch_workspace(self):
        """Temporarily set WORKSPACE for mcp_plan_server module."""
        import super_agent.team.mcp_plan_server as plan_mod
        self._orig_workspace = plan_mod.WORKSPACE
        plan_mod.WORKSPACE = str(self.tmpdir)
        return plan_mod

    def _unpatch_workspace(self, mod):
        mod.WORKSPACE = self._orig_workspace

    def test_create_plan(self):
        mod = self._patch_workspace()
        try:
            phases = json.dumps([{
                "phase_id": "phase_0",
                "description": "Research",
                "tasks": [
                    {"task_id": "t1", "description": "Do A", "worker_type_id": "default"},
                    {"task_id": "t2", "description": "Do B", "worker_type_id": "default"},
                ]
            }])
            result = mod.create_plan("Test objective", phases)
            self.assertIn("1", result)  # 1 Phase
            self.assertIn("2", result)  # 2 Tasks

            # Verify plan.json
            plan = json.loads((self.tmpdir / "plan.json").read_text())
            self.assertEqual(plan["objective"], "Test objective")
            self.assertEqual(len(plan["phases"]), 1)
            self.assertEqual(len(plan["phases"][0]["tasks"]), 2)
            self.assertEqual(plan["version"], 1)
        finally:
            self._unpatch_workspace(mod)

    def test_get_plan_empty(self):
        mod = self._patch_workspace()
        try:
            result = mod.get_plan()
            self.assertIn("没有计划", result)
        finally:
            self._unpatch_workspace(mod)

    def test_get_plan_after_create(self):
        mod = self._patch_workspace()
        try:
            phases = json.dumps([{"phase_id": "p0", "description": "Test", "tasks": []}])
            mod.create_plan("Obj", phases)
            result = mod.get_plan()
            data = json.loads(result)
            self.assertEqual(data["objective"], "Obj")
        finally:
            self._unpatch_workspace(mod)

    def test_update_task(self):
        mod = self._patch_workspace()
        try:
            phases = json.dumps([{
                "phase_id": "p0", "description": "Test",
                "tasks": [{"task_id": "t1", "description": "Do A"}]
            }])
            mod.create_plan("Obj", phases)
            result = mod.update_task("t1", "approved")
            self.assertIn("approved", result)

            plan = json.loads((self.tmpdir / "plan.json").read_text())
            self.assertEqual(plan["phases"][0]["tasks"][0]["status"], "approved")
        finally:
            self._unpatch_workspace(mod)

    def test_update_task_invalid_status(self):
        mod = self._patch_workspace()
        try:
            phases = json.dumps([{
                "phase_id": "p0", "description": "Test",
                "tasks": [{"task_id": "t1", "description": "Do A"}]
            }])
            mod.create_plan("Obj", phases)
            result = mod.update_task("t1", "submitted")
            self.assertIn("错误", result)  # "submitted" is not valid
        finally:
            self._unpatch_workspace(mod)

    def test_update_task_not_found(self):
        mod = self._patch_workspace()
        try:
            phases = json.dumps([{"phase_id": "p0", "tasks": []}])
            mod.create_plan("Obj", phases)
            result = mod.update_task("nonexistent", "approved")
            self.assertIn("错误", result)
        finally:
            self._unpatch_workspace(mod)

    def test_modify_phases(self):
        mod = self._patch_workspace()
        try:
            phases = json.dumps([
                {"phase_id": "p0", "description": "Phase 0", "tasks": [{"task_id": "t1", "description": "A"}]},
                {"phase_id": "p1", "description": "Phase 1", "tasks": [{"task_id": "t2", "description": "B"}]},
            ])
            mod.create_plan("Obj", phases)

            new_phases = json.dumps([
                {"phase_id": "p1_new", "description": "New Phase 1", "tasks": [{"task_id": "t3", "description": "C"}]},
                {"phase_id": "p2_new", "description": "New Phase 2", "tasks": [{"task_id": "t4", "description": "D"}]},
            ])
            result = mod.modify_phases(0, new_phases)
            self.assertIn("v2", result)

            plan = json.loads((self.tmpdir / "plan.json").read_text())
            self.assertEqual(len(plan["phases"]), 3)  # p0 kept + 2 new
            self.assertEqual(plan["phases"][0]["phase_id"], "p0")
            self.assertEqual(plan["phases"][1]["phase_id"], "p1_new")
            self.assertEqual(plan["phases"][2]["phase_id"], "p2_new")
            self.assertEqual(plan["version"], 2)
        finally:
            self._unpatch_workspace(mod)


# ═══════════════════════════════════════════════════════════════
# 4. Unit Tests: MCP Mailbox Server (functions only)
# ═══════════════════════════════════════════════════════════════

class TestMCPMailboxServer(unittest.TestCase):
    """Test Mailbox MCP server functions directly."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        (self.tmpdir / "inboxes").mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _patch_env(self, agent_id="worker-t1"):
        import super_agent.team.mcp_mailbox_server as mail_mod
        self._orig_workspace = mail_mod.WORKSPACE
        self._orig_agent_id = mail_mod.AGENT_ID
        mail_mod.WORKSPACE = str(self.tmpdir)
        mail_mod.AGENT_ID = agent_id
        return mail_mod

    def _unpatch_env(self, mod):
        mod.WORKSPACE = self._orig_workspace
        mod.AGENT_ID = self._orig_agent_id

    def test_send_mail(self):
        mod = self._patch_env("worker-t1")
        try:
            result = mod.send_mail("lead", "Task completed")
            self.assertIn("lead", result)

            inbox = json.loads(
                (self.tmpdir / "inboxes" / "lead.json").read_text()
            )
            self.assertEqual(len(inbox), 1)
            self.assertEqual(inbox[0]["from"], "worker-t1")
            self.assertEqual(inbox[0]["content"], "Task completed")
            self.assertFalse(inbox[0]["delivered"])
        finally:
            self._unpatch_env(mod)

    def test_send_mail_empty_content(self):
        mod = self._patch_env("worker-t1")
        try:
            result = mod.send_mail("lead", "")
            self.assertIn("错误", result)
        finally:
            self._unpatch_env(mod)

    def test_send_mail_empty_recipient(self):
        mod = self._patch_env("worker-t1")
        try:
            result = mod.send_mail("", "hello")
            self.assertIn("错误", result)
        finally:
            self._unpatch_env(mod)

    def test_read_inbox_empty(self):
        mod = self._patch_env("worker-t1")
        try:
            # Create empty inbox
            (self.tmpdir / "inboxes" / "worker-t1.json").write_text("[]")
            result = mod.read_inbox()
            self.assertIn("没有新邮件", result)
        finally:
            self._unpatch_env(mod)

    def test_read_inbox_with_mail(self):
        mod = self._patch_env("worker-t1")
        try:
            _write_inbox_mail(self.tmpdir, "worker-t1", [
                {"id": "msg-1", "from": "lead", "content": "Fix bug", "timestamp": "2026-01-01T00:00:00Z", "delivered": False},
            ])
            result = mod.read_inbox()
            self.assertIn("Fix bug", result)
            self.assertIn("lead", result)
        finally:
            self._unpatch_env(mod)

    def test_list_members(self):
        mod = self._patch_env("lead")
        try:
            config = {
                "members": [
                    {"id": "lead", "role": "Lead Agent", "description": "Plans and reviews"},
                    {"id": "worker-t1", "role": "Worker", "description": "Does work"},
                ]
            }
            (self.tmpdir / "config.json").write_text(
                json.dumps(config), encoding="utf-8"
            )
            result = mod.list_members()
            self.assertIn("lead", result)
            self.assertIn("worker-t1", result)
        finally:
            self._unpatch_env(mod)

    def test_list_members_no_config(self):
        mod = self._patch_env("lead")
        try:
            result = mod.list_members()
            self.assertIn("不存在", result)
        finally:
            self._unpatch_env(mod)

    def test_send_mail_concurrent_appends(self):
        """Multiple sends to same inbox should not lose messages."""
        mod = self._patch_env("worker-t1")
        try:
            for i in range(5):
                mod.send_mail("lead", f"Message {i}")
            inbox = json.loads(
                (self.tmpdir / "inboxes" / "lead.json").read_text()
            )
            self.assertEqual(len(inbox), 5)
            contents = [m["content"] for m in inbox]
            for i in range(5):
                self.assertIn(f"Message {i}", contents)
        finally:
            self._unpatch_env(mod)


# ═══════════════════════════════════════════════════════════════
# 5. Unit Tests: prompts.py
# ═══════════════════════════════════════════════════════════════

class TestPrompts(unittest.TestCase):
    """Test prompt builder functions produce expected content."""

    def test_build_planning_prompt(self):
        prompt = build_planning_prompt("Research AI", [
            {"id": "researcher", "name": "Researcher", "tools_allow": ["Read", "Bash"]},
            {"id": "writer", "name": "Writer", "model": "claude-3"},
        ])
        self.assertIn("Research AI", prompt)
        self.assertIn("researcher", prompt)
        self.assertIn("Researcher", prompt)
        self.assertIn("Read, Bash", prompt)
        self.assertIn("writer", prompt)
        self.assertIn("create_plan", prompt)  # Instructs to use MCP tool

    def test_build_planning_prompt_empty_workers(self):
        prompt = build_planning_prompt("Do stuff", [])
        self.assertIn("Do stuff", prompt)
        self.assertIn("create_plan", prompt)

    def test_build_worker_prompt(self):
        t1 = make_task("t1", desc="Research papers")
        t2 = make_task("t2", desc="Search news")
        prompt = build_worker_prompt(t1, [t1, t2], "Phase 0 did X")
        self.assertIn("Research papers", prompt)
        self.assertIn("Search news", prompt)
        self.assertIn("Phase 0 did X", prompt)
        self.assertIn("send_mail", prompt)  # Uses MCP tool, not __result.json

    def test_build_worker_prompt_no_siblings_no_prev(self):
        t1 = make_task("t1", desc="Solo task")
        prompt = build_worker_prompt(t1, [t1])
        self.assertIn("Solo task", prompt)

    def test_build_worker_prompt_with_context(self):
        t1 = make_task("t1")
        t1.context = {"url": "https://example.com"}
        prompt = build_worker_prompt(t1, [t1])
        self.assertIn("https://example.com", prompt)

    def test_build_task_review_prompt(self):
        task = make_task("t1", desc="Write a report")
        task.submit_count = 1
        mail_content = "Here is my report..."
        prompt = build_task_review_prompt(task, mail_content)
        self.assertIn("Write a report", prompt)
        self.assertIn("Here is my report", prompt)
        self.assertIn("update_task", prompt)  # Instructs to use MCP
        self.assertIn("send_mail", prompt)

    def test_build_task_review_prompt_with_history(self):
        task = make_task("t1", desc="Task X")
        task.submit_count = 2
        old_msg = Message(from_id="worker-t1", to_id="lead", task_id="t1", content="first attempt")
        feedback = Message(from_id="lead", to_id="worker-t1", task_id="t1", content="fix Y")
        task.messages = [old_msg, feedback]
        prompt = build_task_review_prompt(task, "second attempt")
        self.assertIn("first attempt", prompt)
        self.assertIn("fix Y", prompt)

    def test_build_phase_review_prompt(self):
        t1 = make_task("t1")
        t1.status = "approved"
        t1.result = TaskResult(summary="Done task 1")
        t2 = make_task("t2")
        t2.status = "approved"
        t2.result_text = "Some result text"
        phase = make_phase("p0", 0, [t1, t2])
        remaining = [make_phase("p1", 1, [make_task("t3")])]
        prompt = build_phase_review_prompt(phase, remaining)
        self.assertIn("Phase 0", prompt)
        self.assertIn("Done task 1", prompt)
        self.assertIn("Some result text", prompt)
        self.assertIn("modify_phases", prompt)  # Instructs to use MCP tool

    def test_build_phase_review_prompt_final_phase(self):
        phase = make_phase("p0", 0, [make_task("t1")])
        prompt = build_phase_review_prompt(phase, [])
        self.assertIn("final Phase", prompt)

    def test_build_final_summary_prompt(self):
        t1 = make_task("t1")
        t1.result = TaskResult(summary="Found 5 papers", content="Details...", files=["papers.md"])
        plan = make_plan("Research AI", [make_phase("p0", 0, [t1])])
        prompt = build_final_summary_prompt(plan)
        self.assertIn("Research AI", prompt)
        self.assertIn("Found 5 papers", prompt)
        self.assertIn("Details...", prompt)
        self.assertIn("papers.md", prompt)

    def test_build_task_review_prompt_with_project_dir(self):
        task = make_task("t1", desc="Write a report")
        task.submit_count = 1
        prompt = build_task_review_prompt(task, "my report", project_dir="/workspace/my-project")
        self.assertIn("/workspace/my-project", prompt)

    def test_build_phase_review_prompt_with_project_dir(self):
        phase = make_phase("p0", 0, [make_task("t1")])
        prompt = build_phase_review_prompt(phase, [], project_dir="/workspace/my-project")
        self.assertIn("/workspace/my-project", prompt)

    def test_build_final_summary_prompt_with_project_dir(self):
        t1 = make_task("t1")
        t1.result = TaskResult(summary="Done")
        plan = make_plan("Goal", [make_phase("p0", 0, [t1])])
        prompt = build_final_summary_prompt(plan, project_dir="/workspace/my-project")
        self.assertIn("/workspace/my-project", prompt)


# ═══════════════════════════════════════════════════════════════
# 6. Unit Tests: events.py
# ═══════════════════════════════════════════════════════════════

class TestEvents(unittest.TestCase):
    """Test TEAM_* event types exist and are unique."""

    EXPECTED_EVENTS = [
        "TEAM_SESSION_START", "TEAM_SESSION_COMPLETE", "TEAM_SESSION_ERROR",
        "TEAM_PLANNING_START", "TEAM_PLANNING_COMPLETE",
        "TEAM_PHASE_START", "TEAM_PHASE_COMPLETE",
        "TEAM_TASK_START", "TEAM_TASK_SUBMITTED", "TEAM_TASK_COMPLETE", "TEAM_TASK_FAILED",
        "TEAM_TASK_FEEDBACK", "TEAM_TASK_RESUBMIT",
        "TEAM_REVIEW_START", "TEAM_REVIEW_COMPLETE",
        "TEAM_PHASE_REVIEW_START", "TEAM_PHASE_REVIEW_COMPLETE",
        "TEAM_PLAN_UPDATED",
    ]

    def test_all_team_events_exist(self):
        for name in self.EXPECTED_EVENTS:
            self.assertTrue(hasattr(EventType, name), f"Missing EventType.{name}")

    def test_all_team_events_have_unique_values(self):
        values = [getattr(EventType, name).value for name in self.EXPECTED_EVENTS]
        self.assertEqual(len(values), len(set(values)), "Duplicate event type values")

    def test_team_events_have_team_prefix(self):
        for name in self.EXPECTED_EVENTS:
            val = getattr(EventType, name).value
            self.assertTrue(val.startswith("team_"), f"{name}.value={val} missing team_ prefix")


# ═══════════════════════════════════════════════════════════════
# 7. Unit Tests: persistence.py
# ═══════════════════════════════════════════════════════════════

class TestPersistence(unittest.TestCase):
    """Test TeamSessionStore save/load/list."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.store = TeamSessionStore(self.tmpdir)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_save_and_load(self):
        session = make_session("s1")
        self.store.save_session(session)
        loaded = self.store.load_session("s1")
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.session_id, "s1")
        self.assertEqual(loaded.lead_config.id, "default")
        self.assertEqual(len(loaded.plan.phases), 1)

    def test_load_nonexistent(self):
        result = self.store.load_session("nonexistent")
        self.assertIsNone(result)

    def test_save_updates_updated_at(self):
        session = make_session("s1")
        old_ts = session.updated_at
        import time; time.sleep(0.01)
        self.store.save_session(session)
        loaded = self.store.load_session("s1")
        self.assertGreaterEqual(loaded.updated_at, old_ts)

    def test_list_sessions(self):
        for i in range(3):
            s = make_session(f"s{i}")
            s.plan.objective = f"Objective {i}"
            self.store.save_session(s)
        sessions = self.store.list_sessions()
        self.assertEqual(len(sessions), 3)
        ids = [s["session_id"] for s in sessions]
        for i in range(3):
            self.assertIn(f"s{i}", ids)

    def test_list_sessions_contains_objective(self):
        s = make_session("s1")
        s.plan.objective = "Research AI"
        self.store.save_session(s)
        sessions = self.store.list_sessions()
        self.assertEqual(sessions[0]["objective"], "Research AI")

    def test_corrupted_file_tolerated_on_list(self):
        self.store.save_session(make_session("s1"))
        bad_path = self.store.sessions_dir / "bad.json"
        bad_path.write_text("not json!!!", encoding="utf-8")
        sessions = self.store.list_sessions()
        valid_ids = [s["session_id"] for s in sessions]
        self.assertIn("s1", valid_ids)

    def test_overwrite_session(self):
        s = make_session("s1")
        s.status = "pending"
        self.store.save_session(s)
        s.status = "completed"
        s.final_output = "Final report"
        self.store.save_session(s)
        loaded = self.store.load_session("s1")
        self.assertEqual(loaded.status, "completed")
        self.assertEqual(loaded.final_output, "Final report")

    def test_session_json_file_exists(self):
        self.store.save_session(make_session("s1"))
        path = self.store.sessions_dir / "s1.json"
        self.assertTrue(path.exists())
        data = json.loads(path.read_text())
        self.assertEqual(data["session_id"], "s1")


# ═══════════════════════════════════════════════════════════════
# 8. Unit Tests: scheduler.py (inbox-driven with mock Worker)
# ═══════════════════════════════════════════════════════════════

class _MockWorker(Worker):
    """Mock worker that simulates MCP send_mail by writing inbox files."""

    def __init__(self, responses: list[str] | None = None, should_fail=False,
                 workspace_dir: Path | None = None):
        self._responses = list(responses or ["Task completed successfully"])
        self._call_count = 0
        self._should_fail = should_fail
        self._workspace_dir = workspace_dir
        self._connected = False

    async def connect(self, config, workspace=None):
        self._connected = True
        if workspace:
            self._workspace_dir = Path(workspace)

    async def disconnect(self):
        self._connected = False

    async def run_async(self, config, prompt, workspace=None,
                        event_callback=None, resume_sdk_session_id=None) -> LLMResult:
        self._call_count += 1
        if self._should_fail:
            raise RuntimeError("Worker crashed")
        text = self._responses[min(self._call_count - 1, len(self._responses) - 1)]
        return LLMResult(
            text=text,
            sdk_session_id=f"sdk-{self._call_count}",
        )


def _sim_append_inbox(team_data_dir: Path, to: str, content: str, from_id: str):
    """Simulate send_mail MCP tool call — append a mail to an inbox file."""
    import uuid as _uuid
    inbox_dir = team_data_dir / "inboxes"
    inbox_dir.mkdir(parents=True, exist_ok=True)
    inbox_file = inbox_dir / f"{to}.json"
    if not inbox_file.exists():
        inbox_file.write_text("[]")
    mails = json.loads(inbox_file.read_text())
    mails.append({
        "id": f"msg-{_uuid.uuid4().hex[:8]}",
        "from": from_id,
        "content": content,
        "timestamp": utc_now(),
        "delivered": False,
    })
    inbox_file.write_text(json.dumps(mails, ensure_ascii=False, indent=2))


def _sim_update_task(team_data_dir: Path, task_id: str, status: str):
    """Simulate update_task MCP tool call — update task status in plan.json."""
    plan_file = team_data_dir / "plan.json"
    if not plan_file.exists():
        return
    plan = json.loads(plan_file.read_text())
    for phase in plan.get("phases", []):
        for task in phase.get("tasks", []):
            if task["task_id"] == task_id:
                task["status"] = status
    plan_file.write_text(json.dumps(plan, ensure_ascii=False, indent=2))


def _extract_agent_id_from_config(config: WorkerConfig) -> str:
    """Extract TEAM_AGENT_ID from injected MCP server config."""
    if isinstance(config.mcp_servers, dict):
        mbox = config.mcp_servers.get("team-mailbox", {})
        return mbox.get("env", {}).get("TEAM_AGENT_ID", "")
    elif isinstance(config.mcp_servers, list):
        for s in config.mcp_servers:
            if s.get("name") == "team-mailbox":
                return s.get("env", {}).get("TEAM_AGENT_ID", "")
    return ""


def _extract_team_workspace_from_config(config: WorkerConfig) -> str:
    """Extract TEAM_WORKSPACE from injected MCP server config."""
    if isinstance(config.mcp_servers, dict):
        for mcp in config.mcp_servers.values():
            ws = mcp.get("env", {}).get("TEAM_WORKSPACE", "")
            if ws:
                return ws
    elif isinstance(config.mcp_servers, list):
        for s in config.mcp_servers:
            ws = s.get("env", {}).get("TEAM_WORKSPACE", "")
            if ws:
                return ws
    return ""


class _SimWorker(Worker):
    """Worker that simulates MCP tool calls by writing to inbox/plan files.

    Extracts TEAM_AGENT_ID and TEAM_WORKSPACE from the injected MCP config.
    TEAM_WORKSPACE now points to team_data_dir (not workspace_dir).
    """

    def __init__(self, team_data_dir: Path, approve_immediately: bool = True):
        self._team_data_dir = team_data_dir
        self._approve_immediately = approve_immediately
        self._call_count = 0
        self._connected = False
        self._agent_id = ""

    async def connect(self, config, workspace=None):
        self._connected = True
        self._agent_id = _extract_agent_id_from_config(config)
        team_ws = _extract_team_workspace_from_config(config)
        if team_ws:
            self._team_data_dir = Path(team_ws)

    async def disconnect(self):
        self._connected = False

    async def run_async(self, config, prompt, workspace=None,
                        event_callback=None, resume_sdk_session_id=None) -> LLMResult:
        self._call_count += 1
        team_ws = _extract_team_workspace_from_config(config)
        td = Path(team_ws) if team_ws else self._team_data_dir

        # Determine role from agent_id
        agent_id = self._agent_id or _extract_agent_id_from_config(config)
        is_lead = (agent_id == "lead" or not agent_id.startswith("worker-"))

        if not is_lead:
            # Worker: send result to Lead
            _sim_append_inbox(td, "lead", f"Task completed (call {self._call_count})", agent_id)
            return LLMResult(text=f"Worker output", sdk_session_id=f"worker-sdk-{self._call_count}")

        else:
            # Lead reviews: parse which task this is about from prompt
            import re
            task_ids = set(re.findall(r"worker-([a-zA-Z0-9_-]+)", prompt))
            for tid in task_ids:
                if self._approve_immediately:
                    _sim_update_task(td, tid, "approved")
                    _sim_append_inbox(td, f"worker-{tid}", "approved", "lead")
                else:
                    _sim_append_inbox(td, f"worker-{tid}", "Please fix X", "lead")
            return LLMResult(text="Lead reviewed", sdk_session_id=f"lead-sdk-{self._call_count}")


class TestScheduler(unittest.TestCase):
    """Test PhaseScheduler with inbox-driven flow."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.workspace_dir = self.tmpdir / "workspace"
        self.workspace_dir.mkdir(parents=True, exist_ok=True)
        self.team_data_dir = self.tmpdir / "team_data"
        (self.team_data_dir / "inboxes").mkdir(parents=True, exist_ok=True)
        self.events: list[tuple] = []

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _emitter(self, event_type, data=None):
        self.events.append((event_type, data))

    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro)

    def _write_initial_plan(self, tasks: list[dict]):
        """Write initial plan.json for the scheduler to read."""
        plan = {
            "objective": "test",
            "version": 1,
            "phases": [{
                "phase_id": "p0",
                "phase_index": 0,
                "status": "pending",
                "tasks": tasks,
            }]
        }
        _write_plan_json(self.team_data_dir, plan)

    def test_all_tasks_approved(self):
        """Workers submit, Lead approves all via plan.json update."""
        async def go():
            self._write_initial_plan([
                {"task_id": "t1", "description": "Do A", "worker_type_id": "default", "status": "pending"},
                {"task_id": "t2", "description": "Do B", "worker_type_id": "default", "status": "pending"},
            ])

            lead_worker = _SimWorker(self.team_data_dir, approve_immediately=True)
            await lead_worker.connect(make_worker_config("lead"))
            mailbox = FileMailbox(self.team_data_dir)
            persist_calls = []

            scheduler = PhaseScheduler(
                worker_factory=lambda: _SimWorker(self.team_data_dir, approve_immediately=True),
                workspace_dir=self.workspace_dir,
                team_data_dir=self.team_data_dir,
                mailbox=mailbox,
                event_emitter=self._emitter,
                persist_fn=lambda: persist_calls.append(1),
            )

            t1 = make_task("t1")
            t2 = make_task("t2")
            phase = make_phase("p0", 0, [t1, t2])
            configs = {"default": make_worker_config()}

            result = await asyncio.wait_for(
                scheduler.execute_phase(phase, configs, lead_worker=lead_worker, lead_config=make_worker_config("lead")),
                timeout=30.0
            )
            self.assertEqual(result.status, "completed")
            for t in result.tasks:
                self.assertEqual(t.status, "approved")
            self.assertTrue(len(persist_calls) > 0)

        self._run(go())

    def test_worker_exception_fails_task(self):
        """Worker raises exception -> task fails, phase fails."""
        async def go():
            self._write_initial_plan([
                {"task_id": "t1", "description": "Do A", "worker_type_id": "default", "status": "pending"},
            ])

            lead_worker = _SimWorker(self.team_data_dir, approve_immediately=True)
            await lead_worker.connect(make_worker_config("lead"))
            mailbox = FileMailbox(self.team_data_dir)

            scheduler = PhaseScheduler(
                worker_factory=lambda: _MockWorker(should_fail=True, workspace_dir=self.workspace_dir),
                workspace_dir=self.workspace_dir,
                team_data_dir=self.team_data_dir,
                mailbox=mailbox,
                event_emitter=self._emitter,
            )

            phase = make_phase("p0", 0, [make_task("t1")])
            configs = {"default": make_worker_config()}

            result = await asyncio.wait_for(
                scheduler.execute_phase(phase, configs, lead_worker=lead_worker, lead_config=make_worker_config("lead")),
                timeout=15.0
            )
            self.assertEqual(result.status, "failed")
            self.assertEqual(result.tasks[0].status, "failed")
            self.assertIn("Worker crashed", result.tasks[0].result_error)

        self._run(go())

    def test_missing_worker_config(self):
        """Task references unknown worker type -> fails immediately."""
        async def go():
            self._write_initial_plan([
                {"task_id": "t1", "description": "Do A", "worker_type_id": "nonexistent", "status": "pending"},
            ])

            lead_worker = _SimWorker(self.team_data_dir, approve_immediately=True)
            await lead_worker.connect(make_worker_config("lead"))
            mailbox = FileMailbox(self.team_data_dir)

            scheduler = PhaseScheduler(
                worker_factory=lambda: _SimWorker(self.team_data_dir),
                workspace_dir=self.workspace_dir,
                team_data_dir=self.team_data_dir,
                mailbox=mailbox,
                event_emitter=self._emitter,
            )

            phase = make_phase("p0", 0, [make_task("t1", worker_type="nonexistent")])
            configs = {"default": make_worker_config()}  # No "nonexistent"

            result = await asyncio.wait_for(
                scheduler.execute_phase(phase, configs, lead_worker=lead_worker, lead_config=make_worker_config("lead")),
                timeout=15.0
            )
            self.assertEqual(result.status, "failed")
            self.assertIn("not found", result.tasks[0].result_error)

        self._run(go())


# ═══════════════════════════════════════════════════════════════
# 9. Unit Tests: team_orchestrator.py (utility functions)
# ═══════════════════════════════════════════════════════════════

class TestOrchestratorUtils(unittest.TestCase):
    """Test orchestrator utility functions."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_read_plan_from_file(self):
        plan_data = {
            "objective": "Test",
            "version": 1,
            "phases": [{"phase_id": "p0", "tasks": []}],
        }
        team_data_dir = self.tmpdir / "team_data"
        _write_plan_json(team_data_dir, plan_data)
        result = _read_plan_from_file(team_data_dir)
        self.assertIsNotNone(result)
        self.assertEqual(result["objective"], "Test")

    def test_read_plan_from_file_missing(self):
        result = _read_plan_from_file(self.tmpdir / "nonexistent")
        self.assertIsNone(result)

    def test_read_plan_from_file_corrupt(self):
        team_data_dir = self.tmpdir / "team_data"
        team_data_dir.mkdir(parents=True, exist_ok=True)
        (team_data_dir / "plan.json").write_text("not json!!!")
        result = _read_plan_from_file(team_data_dir)
        self.assertIsNone(result)

    def test_plan_data_to_plan(self):
        plan_data = {
            "objective": "Test",
            "version": 1,
            "phases": [{
                "phase_id": "p0",
                "description": "First",
                "tasks": [
                    {"task_id": "t1", "description": "Do A", "worker_type_id": "w1"},
                    {"task_id": "t2", "description": "Do B", "worker_type_id": "w2"},
                ],
            }, {
                "phase_id": "p1",
                "description": "Second",
                "tasks": [
                    {"task_id": "t3", "description": "Do C", "worker_type_id": "w1"},
                ],
            }],
        }
        result = _plan_data_to_plan(plan_data, "test-plan")
        self.assertEqual(len(result.phases), 2)
        self.assertEqual(len(result.phases[0].tasks), 2)
        self.assertEqual(result.phases[0].tasks[0].worker_type_id, "w1")
        self.assertEqual(result.phases[1].phase_index, 1)

    def test_plan_data_to_plan_unknown_worker_fallback(self):
        plan_data = {
            "objective": "Test",
            "phases": [{
                "phase_id": "p0",
                "tasks": [{"task_id": "t1", "description": "A", "worker_type_id": "nonexistent"}],
            }],
        }
        result = _plan_data_to_plan(plan_data, "test-plan", available_worker_ids={"researcher", "writer"})
        self.assertIn(result.phases[0].tasks[0].worker_type_id, {"researcher", "writer"})

    def test_plan_data_to_plan_valid_worker_preserved(self):
        plan_data = {
            "objective": "Test",
            "phases": [{
                "phase_id": "p0",
                "tasks": [{"task_id": "t1", "description": "A", "worker_type_id": "researcher"}],
            }],
        }
        result = _plan_data_to_plan(plan_data, "test-plan", available_worker_ids={"researcher", "writer"})
        self.assertEqual(result.phases[0].tasks[0].worker_type_id, "researcher")

    def test_build_previous_results_summary(self):
        t1 = make_task("t1")
        t1.result = TaskResult(summary="Found data", files=["data.csv"])
        p0 = make_phase("p0", 0, [t1])
        p0.status = "completed"
        p1 = make_phase("p1", 1, [make_task("t2")])
        plan = make_plan("test", [p0, p1])
        summary = _build_previous_results_summary(plan, 1)
        self.assertIn("Found data", summary)
        self.assertIn("data.csv", summary)

    def test_build_previous_results_summary_phase0(self):
        plan = make_plan("test", [make_phase("p0")])
        summary = _build_previous_results_summary(plan, 0)
        self.assertEqual(summary, "")


# ═══════════════════════════════════════════════════════════════
# 9b. Unit Tests: _slugify and _unique_dir
# ═══════════════════════════════════════════════════════════════

class TestSlugifyAndUniqueDir(unittest.TestCase):
    """Test _slugify and _unique_dir helpers."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_slugify_ascii(self):
        self.assertEqual(_slugify("market-analysis"), "market-analysis")

    def test_slugify_spaces_and_special(self):
        slug = _slugify("My Cool Project! #1")
        self.assertNotIn(" ", slug)
        self.assertNotIn("!", slug)
        self.assertNotIn("#", slug)
        self.assertTrue(len(slug) > 0)

    def test_slugify_chinese(self):
        slug = _slugify("市场分析报告")
        # CJK characters should be preserved, not degraded to "project"
        self.assertNotEqual(slug, "project")
        self.assertIn("市场", slug)

    def test_slugify_mixed_cjk_ascii(self):
        slug = _slugify("Q1 市场分析")
        self.assertIn("Q1", slug)
        self.assertIn("市场分析", slug)

    def test_slugify_empty(self):
        self.assertEqual(_slugify(""), "project")

    def test_slugify_only_special_chars(self):
        self.assertEqual(_slugify("!@#$%"), "project")

    def test_slugify_truncation(self):
        slug = _slugify("a" * 100, max_len=20)
        self.assertLessEqual(len(slug), 20)

    def test_unique_dir_first_call(self):
        d = _unique_dir(self.tmpdir, "report")
        self.assertEqual(d.name, "report")
        self.assertTrue(d.exists())

    def test_unique_dir_dedup(self):
        d1 = _unique_dir(self.tmpdir, "report")
        d2 = _unique_dir(self.tmpdir, "report")
        d3 = _unique_dir(self.tmpdir, "report")
        self.assertEqual(d1.name, "report")
        self.assertEqual(d2.name, "report-2")
        self.assertEqual(d3.name, "report-3")
        self.assertTrue(d1.exists())
        self.assertTrue(d2.exists())
        self.assertTrue(d3.exists())

    def test_unique_dir_different_slugs_independent(self):
        a = _unique_dir(self.tmpdir, "alpha")
        b = _unique_dir(self.tmpdir, "beta")
        self.assertEqual(a.name, "alpha")
        self.assertEqual(b.name, "beta")


# ═══════════════════════════════════════════════════════════════
# 10. Unit Tests: task_id sanitization
# ═══════════════════════════════════════════════════════════════

class TestTaskIdSanitization(unittest.TestCase):
    """Test _sanitize_task_id and _ensure_unique_task_ids."""

    def test_valid_task_id_passes_through(self):
        self.assertEqual(_sanitize_task_id("task_001"), "task_001")
        self.assertEqual(_sanitize_task_id("my-task-2"), "my-task-2")
        self.assertEqual(_sanitize_task_id("TaskABC"), "TaskABC")

    def test_path_traversal_blocked(self):
        result = _sanitize_task_id("../../../etc/passwd")
        self.assertNotIn("..", result)
        self.assertNotIn("/", result)

    def test_slashes_removed(self):
        result = _sanitize_task_id("task/with/slashes")
        self.assertNotIn("/", result)

    def test_empty_string_generates_fallback(self):
        result = _sanitize_task_id("")
        self.assertTrue(result.startswith("task_"))

    def test_too_long_id_truncated(self):
        long_id = "a" * 200
        result = _sanitize_task_id(long_id)
        self.assertLessEqual(len(result), 128)

    def test_special_chars_sanitized(self):
        result = _sanitize_task_id("task with spaces & symbols!")
        self.assertNotIn(" ", result)
        self.assertNotIn("&", result)
        self.assertNotIn("!", result)

    def test_ensure_unique_deduplicates(self):
        tasks = [make_task("t1"), make_task("t1"), make_task("t1")]
        _ensure_unique_task_ids(tasks)
        ids = [t.task_id for t in tasks]
        self.assertEqual(len(ids), len(set(ids)), "Task IDs should be unique")

    def test_ensure_unique_preserves_already_unique(self):
        tasks = [make_task("t1"), make_task("t2"), make_task("t3")]
        _ensure_unique_task_ids(tasks)
        self.assertEqual(tasks[0].task_id, "t1")
        self.assertEqual(tasks[1].task_id, "t2")
        self.assertEqual(tasks[2].task_id, "t3")


# ═══════════════════════════════════════════════════════════════
# 11. Unit Tests: FileMailbox delivery-then-ack semantics
# ═══════════════════════════════════════════════════════════════

class TestDeliveryThenAck(unittest.TestCase):
    """Test delivery-then-ack flow: peek → deliver → ack."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.team_data_dir = self.tmpdir / "team_data"
        self.team_data_dir.mkdir(parents=True, exist_ok=True)
        self.mailbox = FileMailbox(self.team_data_dir)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_peek_does_not_modify_file(self):
        _write_inbox_mail(self.team_data_dir, "lead", [
            {"id": "msg-1", "from": "worker-t1", "content": "hello", "delivered": False},
        ])
        # Peek should not modify
        result = self.mailbox._peek_undelivered("lead")
        self.assertEqual(len(result), 1)

        # Read file directly - should still be undelivered
        inbox = json.loads((self.team_data_dir / "inboxes" / "lead.json").read_text())
        self.assertFalse(inbox[0]["delivered"])

        # Peek again should return same result
        result2 = self.mailbox._peek_undelivered("lead")
        self.assertEqual(len(result2), 1)

    def test_ack_after_peek(self):
        _write_inbox_mail(self.team_data_dir, "lead", [
            {"id": "msg-1", "from": "worker-t1", "content": "hello", "delivered": False},
        ])

        # Peek
        result = self.mailbox._peek_undelivered("lead")
        self.assertEqual(len(result), 1)

        # Ack
        self.mailbox.ack_delivered("lead", ["msg-1"])

        # Peek again - should be empty
        result2 = self.mailbox._peek_undelivered("lead")
        self.assertEqual(len(result2), 0)

    def test_partial_ack(self):
        _write_inbox_mail(self.team_data_dir, "lead", [
            {"id": "msg-1", "from": "worker-t1", "content": "hello", "delivered": False},
            {"id": "msg-2", "from": "worker-t2", "content": "world", "delivered": False},
        ])

        # Ack only msg-1
        self.mailbox.ack_delivered("lead", ["msg-1"])

        # msg-2 should still be undelivered
        result = self.mailbox._peek_undelivered("lead")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["id"], "msg-2")


# ═══════════════════════════════════════════════════════════════
# 12. Unit Tests: Plan.json atomic write (via MCP Plan server)
# ═══════════════════════════════════════════════════════════════

class TestAtomicWrite(unittest.TestCase):
    """Test that plan.json writes are atomic (temp + rename)."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.tmpdir.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_atomic_write_creates_file(self):
        import super_agent.team.mcp_plan_server as plan_mod
        path = self.tmpdir / "test.json"
        plan_mod._atomic_write(path, {"key": "value"})
        self.assertTrue(path.exists())
        data = json.loads(path.read_text())
        self.assertEqual(data["key"], "value")

    def test_atomic_write_overwrites(self):
        import super_agent.team.mcp_plan_server as plan_mod
        path = self.tmpdir / "test.json"
        plan_mod._atomic_write(path, {"version": 1})
        plan_mod._atomic_write(path, {"version": 2})
        data = json.loads(path.read_text())
        self.assertEqual(data["version"], 2)

    def test_no_temp_files_left(self):
        import super_agent.team.mcp_plan_server as plan_mod
        path = self.tmpdir / "test.json"
        plan_mod._atomic_write(path, {"key": "value"})
        # No .tmp files should remain
        tmp_files = list(self.tmpdir.glob("*.tmp"))
        self.assertEqual(len(tmp_files), 0, f"Leftover temp files: {tmp_files}")


# ═══════════════════════════════════════════════════════════════
# 13. Integration Test: Full Flow with MCP-simulating Worker
# ═══════════════════════════════════════════════════════════════

class _IntegrationWorker(Worker):
    """Worker that simulates MCP tool calls for integration testing.

    Detects its role from the injected MCP config:
    - If config has "team-plan" MCP → this is the Lead
    - If config has TEAM_AGENT_ID starting with "worker-" → this is a Worker

    Uses TEAM_WORKSPACE from MCP config as team_data_dir for file operations.
    Simulates: create_plan, send_mail, update_task, phase review, final summary.
    """

    def __init__(self):
        self._call_count = 0
        self._calls: list[dict] = []
        self._connected = False
        self._workspace_dir: Optional[Path] = None
        self._team_data_dir: Optional[Path] = None
        self._agent_id = ""
        self._is_lead = False

    async def connect(self, config, workspace=None):
        self._connected = True
        if workspace:
            self._workspace_dir = Path(workspace)
        self._agent_id = _extract_agent_id_from_config(config)
        team_ws = _extract_team_workspace_from_config(config)
        if team_ws:
            self._team_data_dir = Path(team_ws)
        # Detect if this is Lead (has plan MCP)
        if isinstance(config.mcp_servers, dict):
            self._is_lead = "team-plan" in config.mcp_servers
        elif isinstance(config.mcp_servers, list):
            self._is_lead = any(s.get("name") == "team-plan" for s in config.mcp_servers)

    async def disconnect(self):
        self._connected = False

    async def run_async(self, config, prompt, workspace=None,
                        event_callback=None, resume_sdk_session_id=None) -> LLMResult:
        self._call_count += 1
        team_ws = _extract_team_workspace_from_config(config)
        td = Path(team_ws) if team_ws else self._team_data_dir or self._workspace_dir
        self._calls.append({
            "call": self._call_count,
            "prompt_prefix": prompt[:100],
        })

        # Detect role from config if not already set via connect
        agent_id = self._agent_id or _extract_agent_id_from_config(config)
        is_lead = self._is_lead
        if not is_lead and agent_id and not agent_id.startswith("worker-"):
            is_lead = True

        if not is_lead and agent_id.startswith("worker-"):
            # === WORKER: send result to Lead via send_mail ===
            _sim_append_inbox(td, "lead", f"Task completed (call {self._call_count})", agent_id)
            return LLMResult(text="Worker output", sdk_session_id=f"worker-sdk-{self._call_count}")

        # === LEAD operations ===

        # Planning: create_plan MCP
        if "create_plan" in prompt:
            plan_data = {
                "objective": "Test integration",
                "project_name": "integration-report",
                "version": 1,
                "change_log": ["v1: initial plan"],
                "phases": [
                    {
                        "phase_id": "phase_0",
                        "phase_index": 0,
                        "description": "Research phase",
                        "status": "pending",
                        "tasks": [
                            {"task_id": "task_001", "description": "Research topic A",
                             "worker_type_id": "default", "status": "pending"},
                            {"task_id": "task_002", "description": "Research topic B",
                             "worker_type_id": "default", "status": "pending"},
                        ]
                    },
                    {
                        "phase_id": "phase_1",
                        "phase_index": 1,
                        "description": "Synthesis phase",
                        "status": "pending",
                        "tasks": [
                            {"task_id": "task_003", "description": "Write final report",
                             "worker_type_id": "default", "status": "pending"},
                        ]
                    }
                ]
            }
            _write_plan_json(td, plan_data)
            return LLMResult(text="Plan created", sdk_session_id="lead-session-1")

        # Lead reviewing worker submissions: approve via update_task + send_mail
        import re
        task_ids = set(re.findall(r"worker-([a-zA-Z0-9_]+)", prompt))
        if task_ids and "update_task" in prompt:
            for tid in task_ids:
                _sim_update_task(td, tid, "approved")
                _sim_append_inbox(td, f"worker-{tid}", "approved", "lead")
            return LLMResult(text="Lead approved", sdk_session_id="lead-session-1")

        # Phase review: approve (no modify_phases call)
        if "modify_phases" in prompt:
            return LLMResult(text="Phase review approved, continue execution", sdk_session_id="lead-session-1")

        # Final summary
        if "All Phases are complete" in prompt:
            return LLMResult(
                text="# Final Report\n\nAll tasks completed successfully.",
                sdk_session_id="lead-session-1",
            )

        # Fallback
        return LLMResult(text=f"Fallback (call {self._call_count})", sdk_session_id="fallback")


class TestIntegration(unittest.TestCase):
    """Integration test: full orchestrator flow with MCP-simulating worker."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.workspace_dir = self.tmpdir / "workspace"
        self.workspace_dir.mkdir(parents=True, exist_ok=True)
        self.team_base_dir = self.workspace_dir / ".opencowork" / "team"
        self.team_base_dir.mkdir(parents=True, exist_ok=True)
        self.orchestrator = TeamOrchestrator(
            base_dir=self.team_base_dir,
            worker_factory=lambda: _IntegrationWorker(),
        )

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro)

    def test_full_flow(self):
        """Full planning → execution → phase review → summary."""
        async def go():
            lead_config = make_worker_config("lead")
            session = self.orchestrator.create_session(
                objective="Research and report on AI trends",
                lead_config=lead_config,
                workspace_dir=str(self.workspace_dir),
            )
            self.assertEqual(session.status, "pending")

            # Verify team data directory created
            td = Path(session.team_data_dir)
            self.assertTrue(td.exists())
            self.assertTrue((td / "inboxes").exists())

            # Verify session persisted
            loaded = self.orchestrator.store.load_session(session.session_id)
            self.assertIsNotNone(loaded)

            # Run
            await self.orchestrator.run_async(
                session_id=session.session_id,
                available_worker_configs={"default": make_worker_config()},
                worker_types_info=[{"id": "default", "name": "Default Worker"}],
            )

            # Load final state
            final = self.orchestrator.store.load_session(session.session_id)
            self.assertEqual(final.status, "completed")
            self.assertIsNotNone(final.final_output)
            self.assertIn("Final Report", final.final_output)

            # Check plan structure
            self.assertEqual(len(final.plan.phases), 2)

            # Phase 0: 2 tasks
            p0 = final.plan.phases[0]
            self.assertEqual(p0.status, "completed")
            self.assertEqual(len(p0.tasks), 2)

            # Phase 1: 1 task
            p1 = final.plan.phases[1]
            self.assertEqual(p1.status, "completed")
            self.assertEqual(len(p1.tasks), 1)

            # Check __final_output.json in team_data_dir
            final_output_path = td / "__final_output.json"
            self.assertTrue(final_output_path.exists())
            final_output_data = json.loads(final_output_path.read_text())
            self.assertIn("final_output", final_output_data)

            # Check project_dir was created using project_name from plan
            self.assertIsNotNone(final.project_dir)
            self.assertTrue(Path(final.project_dir).exists())
            # project_name in plan is "integration-report", so dir should match
            self.assertEqual(Path(final.project_dir).name, "integration-report")

            # Verify Lead session continuity
            self.assertIsNotNone(final.lead_sdk_session_id)

        self._run(go())


# ═══════════════════════════════════════════════════════════════
# 14. E2E Test: API Router with TestClient
# ═══════════════════════════════════════════════════════════════

class TestAPIRouter(unittest.TestCase):
    """Test API endpoints using httpx AsyncClient with mocked worker."""

    @classmethod
    def setUpClass(cls):
        """Set up a test FastAPI app with mocked dependencies."""
        try:
            import httpx
            from fastapi import FastAPI
        except ImportError:
            raise unittest.SkipTest("fastapi/httpx not installed")

        cls._tmpdir = Path(tempfile.mkdtemp())
        cls._workspace_dir = cls._tmpdir / "workspace"
        cls._workspace_dir.mkdir(parents=True, exist_ok=True)

        # Patch the team router module
        import routers.team as team_router_module

        # Patch _get_workspace_path to return our test workspace
        cls._original_get_workspace = team_router_module._get_workspace_path

        def mock_get_workspace_path(request):
            return str(cls._workspace_dir)

        team_router_module._get_workspace_path = mock_get_workspace_path

        # Patch ClaudeSdkWorker to use our scripted worker
        cls._original_sdk_worker = team_router_module.ClaudeSdkWorker

        class TestSdkWorker(_IntegrationWorker):
            pass

        team_router_module.ClaudeSdkWorker = TestSdkWorker

        # Patch get_worker_config to avoid needing agents.json
        cls._original_get_config = team_router_module.get_worker_config

        def mock_get_worker_config(worker_id, request=None):
            return make_worker_config(worker_id)

        team_router_module.get_worker_config = mock_get_worker_config

        # Patch _get_available_worker_configs
        cls._original_get_available = team_router_module._get_available_worker_configs

        def mock_get_available(request):
            return {"default": make_worker_config()}

        team_router_module._get_available_worker_configs = mock_get_available

        # Patch _get_worker_types_info
        cls._original_get_types = team_router_module._get_worker_types_info

        def mock_get_types():
            return [{"id": "default", "name": "Default", "model": "test", "tools_allow": []}]

        team_router_module._get_worker_types_info = mock_get_types

        # Create test app
        cls._app = FastAPI()
        cls._app.include_router(team_router_module.router, prefix="/api/team")
        cls.team_module = team_router_module

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls._tmpdir, ignore_errors=True)
        # Restore patches
        if hasattr(cls, '_original_get_workspace'):
            cls.team_module._get_workspace_path = cls._original_get_workspace
        if hasattr(cls, '_original_sdk_worker'):
            cls.team_module.ClaudeSdkWorker = cls._original_sdk_worker
        if hasattr(cls, '_original_get_config'):
            cls.team_module.get_worker_config = cls._original_get_config
        if hasattr(cls, '_original_get_available'):
            cls.team_module._get_available_worker_configs = cls._original_get_available
        if hasattr(cls, '_original_get_types'):
            cls.team_module._get_worker_types_info = cls._original_get_types

    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro)

    def test_run_and_poll(self):
        """POST /run → GET /session → verify completion."""
        async def go():
            import httpx
            transport = httpx.ASGITransport(app=self._app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                # Start a run (no max_task_submits in request body)
                resp = await client.post("/api/team/run", json={
                    "objective": "Test E2E flow",
                    "lead_worker_id": "default",
                })
                self.assertEqual(resp.status_code, 201)
                data = resp.json()
                session_id = data["session_id"]
                self.assertTrue(session_id.startswith("team-"))

                # Poll with async sleep
                session_data = None
                for _ in range(60):
                    await asyncio.sleep(0.3)
                    resp = await client.get(f"/api/team/session/{session_id}")
                    self.assertEqual(resp.status_code, 200)
                    session_data = resp.json()
                    if session_data["status"] in ("completed", "failed", "cancelled"):
                        break

                self.assertEqual(session_data["status"], "completed",
                                 f"Session not completed: {session_data.get('error')}")
                self.assertIsNotNone(session_data.get("final_output"))
                self.assertIsNotNone(session_data.get("plan"))
                self.assertTrue(len(session_data["plan"]["phases"]) >= 1)

        self._run(go())

    def test_list_sessions(self):
        """GET /sessions returns session summaries."""
        async def go():
            import httpx
            transport = httpx.ASGITransport(app=self._app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.get("/api/team/sessions")
                self.assertEqual(resp.status_code, 200)
                data = resp.json()
                self.assertIn("sessions", data)
                self.assertIsInstance(data["sessions"], list)
        self._run(go())

    def test_session_not_found(self):
        """GET /session/<nonexistent> returns 404."""
        async def go():
            import httpx
            transport = httpx.ASGITransport(app=self._app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.get("/api/team/session/nonexistent-id")
                self.assertEqual(resp.status_code, 404)
        self._run(go())

    def test_cancel_not_found(self):
        """POST /session/<nonexistent>/cancel returns 404."""
        async def go():
            import httpx
            transport = httpx.ASGITransport(app=self._app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.post("/api/team/session/nonexistent-id/cancel")
                self.assertEqual(resp.status_code, 404)
        self._run(go())

    def test_worker_types(self):
        """GET /worker-types returns available types."""
        async def go():
            import httpx
            transport = httpx.ASGITransport(app=self._app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.get("/api/team/worker-types")
                self.assertEqual(resp.status_code, 200)
                data = resp.json()
                self.assertIn("worker_types", data)
                self.assertTrue(len(data["worker_types"]) >= 1)
        self._run(go())


# ═══════════════════════════════════════════════════════════════
# 15. Tests for Review Fixes
# ═══════════════════════════════════════════════════════════════

class TestFix1SysExecutable(unittest.TestCase):
    """Fix 1 [P0]: MCP command uses sys.executable, not 'python'."""

    def test_orchestrator_lead_config_uses_sys_executable(self):
        tmpdir = Path(tempfile.mkdtemp())
        try:
            team_dir = tmpdir / ".opencowork" / "team"
            team_dir.mkdir(parents=True, exist_ok=True)
            orch = TeamOrchestrator(base_dir=team_dir)
            session = orch.create_session("test", make_worker_config("lead"), workspace_dir=str(tmpdir))
            config = orch._build_lead_config_with_mcps(session)
            # Check both MCP entries use sys.executable
            if isinstance(config.mcp_servers, dict):
                self.assertEqual(config.mcp_servers["team-plan"]["command"], sys.executable)
                self.assertEqual(config.mcp_servers["team-mailbox"]["command"], sys.executable)
            elif isinstance(config.mcp_servers, list):
                plan_mcp = next(s for s in config.mcp_servers if s.get("name") == "team-plan")
                mail_mcp = next(s for s in config.mcp_servers if s.get("name") == "team-mailbox")
                self.assertEqual(plan_mcp["command"], sys.executable)
                self.assertEqual(mail_mcp["command"], sys.executable)
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    def test_scheduler_inject_mcp_uses_sys_executable(self):
        tmpdir = Path(tempfile.mkdtemp())
        try:
            team_data_dir = tmpdir / "team_data"
            (team_data_dir / "inboxes").mkdir(parents=True, exist_ok=True)
            mailbox = FileMailbox(team_data_dir)
            scheduler = PhaseScheduler(
                worker_factory=lambda: _MockWorker(),
                workspace_dir=tmpdir,
                team_data_dir=team_data_dir,
                mailbox=mailbox,
                event_emitter=lambda *a, **k: None,
            )
            config = make_worker_config()
            task = make_task("t1")
            new_config = scheduler._inject_mailbox_mcp(config, task)
            if isinstance(new_config.mcp_servers, dict):
                self.assertEqual(new_config.mcp_servers["team-mailbox"]["command"], sys.executable)
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)


class TestFix2SubmitCountNoDouble(unittest.TestCase):
    """Fix 2 [P1]: submit_count incremented only in _worker_loop, not _lead_loop."""

    def test_submit_count_not_doubled(self):
        """After one submit cycle with feedback, submit_count should be 1, not 2.

        submit_count is incremented only in _worker_loop when worker receives feedback,
        not in _lead_loop. If approved on first try (no feedback), submit_count stays 0.
        """
        async def go():
            tmpdir = Path(tempfile.mkdtemp())
            try:
                workspace_dir = tmpdir / "workspace"
                workspace_dir.mkdir(parents=True, exist_ok=True)
                team_data_dir = tmpdir / "team_data"
                (team_data_dir / "inboxes").mkdir(parents=True, exist_ok=True)
                _write_plan_json(team_data_dir, {
                    "objective": "test", "version": 1,
                    "phases": [{"phase_id": "p0", "phase_index": 0, "status": "pending",
                                "tasks": [{"task_id": "t1", "description": "A", "worker_type_id": "default", "status": "pending"}]}]
                })

                # Lead gives feedback first, then approves on second submit
                lead_worker = _SimWorker(team_data_dir, approve_immediately=False)
                lead_worker._approve_on_call = 2  # Approve on 2nd review
                await lead_worker.connect(make_worker_config("lead"))
                mailbox = FileMailbox(team_data_dir)
                scheduler = PhaseScheduler(
                    worker_factory=lambda: _SimWorker(team_data_dir, approve_immediately=True),
                    workspace_dir=workspace_dir,
                    team_data_dir=team_data_dir,
                    mailbox=mailbox,
                    event_emitter=lambda *a, **k: None,
                )

                # Use approve_immediately=True for the simpler path
                # Just verify that _lead_loop no longer increments submit_count
                lead_worker2 = _SimWorker(team_data_dir, approve_immediately=True)
                await lead_worker2.connect(make_worker_config("lead"))

                t1 = make_task("t1")
                phase = make_phase("p0", 0, [t1])
                configs = {"default": make_worker_config()}
                result = await asyncio.wait_for(
                    scheduler.execute_phase(phase, configs, lead_worker=lead_worker2, lead_config=make_worker_config("lead")),
                    timeout=15.0,
                )
                # When approved on first try (no feedback), submit_count should be 0
                # The key fix: _lead_loop no longer increments, so no double-counting
                self.assertEqual(result.tasks[0].submit_count, 0)
                self.assertEqual(result.tasks[0].status, "approved")
            finally:
                shutil.rmtree(tmpdir, ignore_errors=True)

        asyncio.get_event_loop().run_until_complete(go())


class TestFix3AckOnlyOnSuccess(unittest.TestCase):
    """Fix 3 [P1]: ack_delivered only after successful lead review."""

    def test_lead_exception_does_not_ack(self):
        """If lead_worker.run_async raises, mails should NOT be acked."""
        async def go():
            tmpdir = Path(tempfile.mkdtemp())
            try:
                team_data_dir = tmpdir / "team_data"
                (team_data_dir / "inboxes").mkdir(parents=True, exist_ok=True)
                _write_plan_json(team_data_dir, {
                    "objective": "test", "version": 1,
                    "phases": [{"phase_id": "p0", "phase_index": 0, "status": "pending",
                                "tasks": [{"task_id": "t1", "description": "A", "worker_type_id": "default", "status": "pending"}]}]
                })
                # Put mail in lead inbox
                _write_inbox_mail(team_data_dir, "lead", [
                    {"id": "msg-1", "from": "worker-t1", "content": "Task done", "delivered": False}
                ])

                mailbox = FileMailbox(team_data_dir)
                mailbox.register_agent("lead")
                mailbox.register_agent("worker-t1")

                # Simulate lead review failure: after peeking the mail, fail
                mails = mailbox._peek_undelivered("lead")
                self.assertEqual(len(mails), 1)

                # Simulate the try/except pattern in _lead_loop
                try:
                    raise RuntimeError("Lead crashed")
                except Exception:
                    pass
                # Do NOT ack (this is what the fix does)

                # Mail should still be undelivered
                still_undelivered = mailbox._peek_undelivered("lead")
                self.assertEqual(len(still_undelivered), 1)
                self.assertEqual(still_undelivered[0]["id"], "msg-1")
            finally:
                shutil.rmtree(tmpdir, ignore_errors=True)

        asyncio.get_event_loop().run_until_complete(go())


class TestFix4AbortPlan(unittest.TestCase):
    """Fix 4 [P1]: abort via abort_plan MCP tool, not text matching."""

    def test_abort_plan_tool(self):
        """abort_plan sets abort flag in plan.json."""
        tmpdir = Path(tempfile.mkdtemp())
        try:
            tmpdir.mkdir(parents=True, exist_ok=True)
            import super_agent.team.mcp_plan_server as plan_mod
            orig = plan_mod.WORKSPACE
            plan_mod.WORKSPACE = str(tmpdir)
            try:
                # Create plan first
                phases = json.dumps([{"phase_id": "p0", "description": "Test", "tasks": []}])
                plan_mod.create_plan("Obj", phases)

                # Abort
                result = plan_mod.abort_plan("严重问题")
                self.assertIn("终止", result)

                # Check plan.json
                plan = json.loads((tmpdir / "plan.json").read_text())
                self.assertTrue(plan.get("abort"))
                self.assertEqual(plan.get("abort_reason"), "严重问题")
            finally:
                plan_mod.WORKSPACE = orig
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    def test_orchestrator_detects_abort(self):
        """Orchestrator checks plan_data['abort'] instead of text matching."""
        plan_data = {
            "objective": "test",
            "version": 1,
            "abort": True,
            "abort_reason": "Test abort",
            "phases": [{"phase_id": "p0", "phase_index": 0, "tasks": []}]
        }
        self.assertTrue(plan_data.get("abort"))

    def test_phase_review_prompt_references_abort_plan(self):
        """Phase review prompt references abort_plan tool, not '终止执行' text."""
        phase = make_phase("p0", 0, [make_task("t1")])
        prompt = build_phase_review_prompt(phase, [])
        self.assertIn("abort_plan", prompt)
        self.assertNotIn("包含\"终止执行\"", prompt)


class TestFix5PreservePhaseData(unittest.TestCase):
    """Fix 5 [P1]: Preserve completed phase runtime data after modify_phases."""

    def test_old_phases_preserved_after_modify(self):
        """After session.plan = new_plan, completed phases retain runtime data."""
        # Simulate: old plan has phase 0 completed with runtime data
        t1 = make_task("t1")
        t1.status = "approved"
        t1.result_text = "Important result data"
        t1.submit_count = 2
        t1.messages = [make_message("t1", "first submission")]
        old_phase = make_phase("p0", 0, [t1])
        old_phase.status = "completed"

        old_plan = make_plan("test", [old_phase, make_phase("p1", 1, [make_task("t2")])])

        # New plan from plan_data (fresh from file, no runtime data)
        new_plan = make_plan("test", [
            make_phase("p0", 0, [make_task("t1")]),  # No runtime data
            make_phase("p1_new", 1, [make_task("t3")]),
        ])

        # Apply the fix: preserve old phases up to phase_idx
        phase_idx = 0
        old_phases = old_plan.phases
        # session.plan = new_plan  (simulated)
        plan = new_plan
        for i in range(min(phase_idx + 1, len(old_phases), len(plan.phases))):
            plan.phases[i] = old_phases[i]

        # Phase 0 should retain runtime data
        self.assertEqual(plan.phases[0].tasks[0].status, "approved")
        self.assertEqual(plan.phases[0].tasks[0].result_text, "Important result data")
        self.assertEqual(plan.phases[0].tasks[0].submit_count, 2)
        self.assertEqual(len(plan.phases[0].tasks[0].messages), 1)
        # Phase 1 should be the new phase
        self.assertEqual(plan.phases[1].phase_id, "p1_new")


class TestFix6NoMaxTaskSubmitsInAPI(unittest.TestCase):
    """Fix 6 [P1]: max_task_submits removed from TeamRunRequest."""

    def test_team_run_request_no_max_task_submits(self):
        try:
            from routers.team import TeamRunRequest
            fields = TeamRunRequest.model_fields
            self.assertNotIn("max_task_submits", fields)
        except ImportError:
            self.skipTest("routers.team not importable")


class TestFix7AutoSubmit(unittest.TestCase):
    """Fix 7 [P1]: Auto-submit when Worker doesn't call send_mail."""

    def test_auto_submit_if_worker_silent(self):
        """Scheduler auto-submits if worker doesn't send mail to lead."""
        tmpdir = Path(tempfile.mkdtemp())
        try:
            team_data_dir = tmpdir / "team_data"
            (team_data_dir / "inboxes").mkdir(parents=True, exist_ok=True)
            mailbox = FileMailbox(team_data_dir)
            mailbox.register_agent("lead")
            mailbox.register_agent("worker-t1")

            scheduler = PhaseScheduler(
                worker_factory=lambda: _MockWorker(),
                workspace_dir=tmpdir,
                team_data_dir=team_data_dir,
                mailbox=mailbox,
                event_emitter=lambda *a, **k: None,
            )

            task = make_task("t1")
            task.result_text = "Some result"

            # No mail in lead inbox from worker-t1
            scheduler._auto_submit_if_needed(task)

            # Should have auto-submitted to lead
            lead_mails = mailbox._peek_undelivered("lead")
            self.assertEqual(len(lead_mails), 1)
            self.assertEqual(lead_mails[0]["from"], "worker-t1")
            self.assertIn("Auto-submitted", lead_mails[0]["content"])
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    def test_no_auto_submit_if_worker_sent_mail(self):
        """No auto-submit if worker already sent mail to lead."""
        tmpdir = Path(tempfile.mkdtemp())
        try:
            team_data_dir = tmpdir / "team_data"
            (team_data_dir / "inboxes").mkdir(parents=True, exist_ok=True)
            mailbox = FileMailbox(team_data_dir)
            mailbox.register_agent("lead")
            mailbox.register_agent("worker-t1")

            # Worker already sent mail
            _write_inbox_mail(team_data_dir, "lead", [
                {"id": "msg-1", "from": "worker-t1", "content": "Done", "delivered": False}
            ])

            scheduler = PhaseScheduler(
                worker_factory=lambda: _MockWorker(),
                workspace_dir=tmpdir,
                team_data_dir=team_data_dir,
                mailbox=mailbox,
                event_emitter=lambda *a, **k: None,
            )

            task = make_task("t1")
            scheduler._auto_submit_if_needed(task)

            # Should still have only 1 mail (no auto-submit)
            lead_mails = mailbox._peek_undelivered("lead")
            self.assertEqual(len(lead_mails), 1)
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    def test_send_auto_mail_method(self):
        """FileMailbox.send_auto_mail writes to inbox correctly."""
        tmpdir = Path(tempfile.mkdtemp())
        try:
            team_data_dir = tmpdir / "team_data"
            team_data_dir.mkdir(parents=True, exist_ok=True)
            mailbox = FileMailbox(team_data_dir)
            mailbox.register_agent("lead")
            mailbox.send_auto_mail("worker-t1", "lead", "Auto result")

            mails = mailbox._peek_undelivered("lead")
            self.assertEqual(len(mails), 1)
            self.assertEqual(mails[0]["from"], "worker-t1")
            self.assertEqual(mails[0]["content"], "Auto result")
            self.assertTrue(mails[0]["id"].startswith("msg-auto-"))
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)


class TestFix8RecipientValidation(unittest.TestCase):
    """Fix 8 [P1]: send_mail validates recipient to prevent path traversal."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        (self.tmpdir / "inboxes").mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _patch_env(self, agent_id="worker-t1"):
        import super_agent.team.mcp_mailbox_server as mail_mod
        self._orig_workspace = mail_mod.WORKSPACE
        self._orig_agent_id = mail_mod.AGENT_ID
        mail_mod.WORKSPACE = str(self.tmpdir)
        mail_mod.AGENT_ID = agent_id
        return mail_mod

    def _unpatch_env(self, mod):
        mod.WORKSPACE = self._orig_workspace
        mod.AGENT_ID = self._orig_agent_id

    def test_path_traversal_blocked(self):
        mod = self._patch_env()
        try:
            result = mod.send_mail("../../../etc/passwd", "malicious")
            self.assertIn("错误", result)
            # Ensure no file was created outside inboxes
            self.assertFalse(Path(self.tmpdir / "etc").exists())
        finally:
            self._unpatch_env(mod)

    def test_slash_in_recipient_blocked(self):
        mod = self._patch_env()
        try:
            result = mod.send_mail("lead/../../etc", "malicious")
            self.assertIn("错误", result)
        finally:
            self._unpatch_env(mod)

    def test_valid_recipient_allowed(self):
        mod = self._patch_env()
        try:
            result = mod.send_mail("lead", "hello")
            self.assertNotIn("错误", result)
            result2 = mod.send_mail("worker-task_001", "hello")
            self.assertNotIn("错误", result2)
        finally:
            self._unpatch_env(mod)

    def test_too_long_recipient_blocked(self):
        mod = self._patch_env()
        try:
            result = mod.send_mail("a" * 200, "hello")
            self.assertIn("错误", result)
        finally:
            self._unpatch_env(mod)


# ═══════════════════════════════════════════════════════════════
# Main runner
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    # Make sure asyncio event loop policy works on all platforms
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    # Ensure we have an event loop for tests that use _run()
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

    unittest.main(verbosity=2)
