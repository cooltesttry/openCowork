"""
Comprehensive test suite for Agent Team system.

Test layers:
  1. Unit tests for each module (models, mailbox, prompts, events, persistence, scheduler, orchestrator)
  2. Integration test: full StubWorker flow (planning → execution → review → summary)
  3. E2E test: API router with TestClient

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
from super_agent.team.mailbox import Mailbox, SENTINEL_WORKER_FAILED
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
    _extract_json,
    _parse_plan,
    _build_previous_results_summary,
    _sanitize_task_id,
    _ensure_unique_task_ids,
)
from super_agent.events import EventType


# ═══════════════════════════════════════════════════════════════
# Helper: reusable factory methods
# ═══════════════════════════════════════════════════════════════

def make_worker_config(wid="default") -> WorkerConfig:
    return WorkerConfig(id=wid, name=f"Worker-{wid}", model="test-model")

def make_message(task_id="t1", mtype="submit_result", content="hello") -> Message:
    return Message(
        from_id=f"worker-{task_id}", to_id="lead",
        task_id=task_id, content=content, message_type=mtype,
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
        self.assertEqual(msg.message_type, msg2.message_type)
        self.assertEqual(msg.content, msg2.content)
        self.assertTrue(msg2.message_id.startswith("msg-"))
        self.assertIn("T", msg2.timestamp)  # ISO format

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
        self.assertEqual(session2.max_task_submits, 3)

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
# 2. Unit Tests: mailbox.py
# ═══════════════════════════════════════════════════════════════

class TestMailbox(unittest.TestCase):
    """Test async mailbox operations."""

    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro)

    def test_send_receive_lead(self):
        async def go():
            mb = Mailbox()
            msg = make_message()
            await mb.send_to_lead(msg)
            received = await mb.receive_for_lead()
            self.assertEqual(received.task_id, msg.task_id)
            self.assertEqual(received.content, msg.content)
        self._run(go())

    def test_send_receive_worker(self):
        async def go():
            mb = Mailbox()
            mb.register_worker("t1")
            fb = Message(from_id="lead", to_id="worker-t1", task_id="t1",
                         content="fix it", message_type="feedback")
            await mb.send_to_worker("t1", fb)
            received = await mb.receive_for_worker("t1")
            self.assertEqual(received.message_type, "feedback")
            self.assertEqual(received.content, "fix it")
        self._run(go())

    def test_worker_failed_sentinel(self):
        async def go():
            mb = Mailbox()
            mb.register_worker("t1")
            await mb.notify_worker_failed("t1")
            received = await mb.receive_for_lead()
            self.assertEqual(received.message_type, SENTINEL_WORKER_FAILED)
            self.assertEqual(received.task_id, "t1")
        self._run(go())

    def test_shutdown_unblocks_lead(self):
        async def go():
            mb = Mailbox()
            async def shutdown_later():
                await asyncio.sleep(0.01)
                await mb.shutdown()
            asyncio.create_task(shutdown_later())
            result = await mb.receive_for_lead()
            self.assertIsNone(result)
        self._run(go())

    def test_shutdown_unblocks_worker(self):
        async def go():
            mb = Mailbox()
            mb.register_worker("t1")
            async def shutdown_later():
                await asyncio.sleep(0.01)
                await mb.shutdown()
            asyncio.create_task(shutdown_later())
            result = await mb.receive_for_worker("t1")
            self.assertIsNone(result)
        self._run(go())

    def test_receive_for_unregistered_worker(self):
        async def go():
            mb = Mailbox()
            result = await mb.receive_for_worker("nonexistent")
            self.assertIsNone(result)
        self._run(go())

    def test_remove_worker(self):
        async def go():
            mb = Mailbox()
            mb.register_worker("t1")
            mb.remove_worker("t1")
            result = await mb.receive_for_worker("t1")
            self.assertIsNone(result)
        self._run(go())

    def test_multiple_workers_ordering(self):
        """Multiple workers send messages, Lead receives them in order."""
        async def go():
            mb = Mailbox()
            for tid in ["t1", "t2", "t3"]:
                mb.register_worker(tid)
            # Send 3 messages in order
            for tid in ["t1", "t2", "t3"]:
                await mb.send_to_lead(make_message(task_id=tid))
            # Lead should receive in same order
            for expected_tid in ["t1", "t2", "t3"]:
                msg = await mb.receive_for_lead()
                self.assertEqual(msg.task_id, expected_tid)
        self._run(go())

    def test_send_to_nonexistent_worker_no_error(self):
        async def go():
            mb = Mailbox()
            # Should silently do nothing
            await mb.send_to_worker("nonexistent", make_message())
        self._run(go())


# ═══════════════════════════════════════════════════════════════
# 3. Unit Tests: prompts.py
# ═══════════════════════════════════════════════════════════════

class TestPrompts(unittest.TestCase):
    """Test prompt builder functions produce expected content."""

    def test_build_planning_prompt(self):
        prompt = build_planning_prompt("Research AI", [
            {"id": "researcher", "name": "Researcher", "tools_allow": ["Read", "Bash"]},
            {"id": "writer", "name": "Writer", "model": "claude-3"},
        ])
        self.assertIn("Lead Agent", prompt)
        self.assertIn("Research AI", prompt)
        self.assertIn("researcher", prompt)
        self.assertIn("Researcher", prompt)
        self.assertIn("Read, Bash", prompt)
        self.assertIn("writer", prompt)
        self.assertIn("phase_id", prompt)  # JSON format instructions

    def test_build_planning_prompt_empty_workers(self):
        prompt = build_planning_prompt("Do stuff", [])
        self.assertIn("Do stuff", prompt)
        self.assertIn("phases", prompt)

    def test_build_worker_prompt(self):
        t1 = make_task("t1", desc="Research papers")
        t2 = make_task("t2", desc="Search news")
        prompt = build_worker_prompt(t1, [t1, t2], "Phase 0 did X")
        self.assertIn("Research papers", prompt)
        self.assertIn("Search news", prompt)
        self.assertIn("Phase 0 did X", prompt)
        self.assertIn("__result.json", prompt)
        self.assertIn("independent Worker", prompt)

    def test_build_worker_prompt_no_siblings_no_prev(self):
        t1 = make_task("t1", desc="Solo task")
        prompt = build_worker_prompt(t1, [t1])
        self.assertIn("Solo task", prompt)
        self.assertNotIn("Other Tasks", prompt)
        self.assertNotIn("Previous Phases", prompt)

    def test_build_worker_prompt_with_context(self):
        t1 = make_task("t1")
        t1.context = {"url": "https://example.com"}
        prompt = build_worker_prompt(t1, [t1])
        self.assertIn("https://example.com", prompt)

    def test_build_task_review_prompt(self):
        task = make_task("t1", desc="Write a report")
        task.submit_count = 1
        task.result = TaskResult(summary="Report written", files=["report.md"])
        msg = make_message("t1", "submit_result", "Here is my report...")
        prompt = build_task_review_prompt(task, msg)
        self.assertIn("Write a report", prompt)
        self.assertIn("Here is my report", prompt)
        self.assertIn("report.md", prompt)
        self.assertIn("Report written", prompt)
        self.assertIn("approve", prompt)
        self.assertIn("feedback", prompt)

    def test_build_task_review_prompt_with_history(self):
        task = make_task("t1", desc="Task X")
        task.submit_count = 2
        old_msg = Message(from_id="worker-t1", to_id="lead", task_id="t1",
                          content="first attempt", message_type="submit_result")
        feedback = Message(from_id="lead", to_id="worker-t1", task_id="t1",
                           content="fix Y", message_type="feedback")
        task.messages = [old_msg, feedback]
        new_msg = make_message("t1", "submit_result", "second attempt")
        prompt = build_task_review_prompt(task, new_msg)
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
        self.assertIn("Phase 1", prompt)
        self.assertIn("approve", prompt)
        self.assertIn("modify", prompt)
        self.assertIn("abort", prompt)

    def test_build_phase_review_prompt_final_phase(self):
        phase = make_phase("p0", 0, [make_task("t1")])
        prompt = build_phase_review_prompt(phase, [])
        self.assertIn("final phase", prompt)

    def test_build_final_summary_prompt(self):
        t1 = make_task("t1")
        t1.result = TaskResult(summary="Found 5 papers", content="Details...", files=["papers.md"])
        plan = make_plan("Research AI", [make_phase("p0", 0, [t1])])
        prompt = build_final_summary_prompt(plan)
        self.assertIn("Research AI", prompt)
        self.assertIn("Found 5 papers", prompt)
        self.assertIn("Details...", prompt)
        self.assertIn("papers.md", prompt)
        self.assertIn("final report", prompt.lower())


# ═══════════════════════════════════════════════════════════════
# 4. Unit Tests: events.py
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
# 5. Unit Tests: persistence.py
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
        # Save a valid session
        self.store.save_session(make_session("s1"))
        # Write a corrupted file
        bad_path = self.store.sessions_dir / "bad.json"
        bad_path.write_text("not json!!!", encoding="utf-8")
        sessions = self.store.list_sessions()
        # Should still return the valid session
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
# 6. Unit Tests: scheduler.py (with mock Worker)
# ═══════════════════════════════════════════════════════════════

class _MockWorker(Worker):
    """Mock worker that returns configurable responses and writes __result.json."""

    def __init__(self, responses: list[str] | None = None, should_fail=False):
        self._responses = list(responses or ['{"summary":"done","content":"result text","files":[]}'])
        self._call_count = 0
        self._should_fail = should_fail

    async def run_async(self, config, prompt, workspace=None,
                        event_callback=None, resume_sdk_session_id=None) -> LLMResult:
        self._call_count += 1
        if self._should_fail:
            raise RuntimeError("Worker crashed")
        text = self._responses[min(self._call_count - 1, len(self._responses) - 1)]
        # Write __result.json if workspace exists
        if workspace:
            result_file = Path(workspace) / "__result.json"
            result_file.write_text(json.dumps({
                "summary": f"done (call {self._call_count})",
                "content": text,
                "files": [],
            }), encoding="utf-8")
        return LLMResult(
            text=text,
            sdk_session_id=f"sdk-{self._call_count}",
        )


class TestScheduler(unittest.TestCase):
    """Test PhaseScheduler with mock workers."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.events: list[tuple] = []

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _emitter(self, event_type, data=None):
        self.events.append((event_type, data))

    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro)

    def test_all_tasks_approved(self):
        """All workers succeed, Lead approves all."""
        async def go():
            worker = _MockWorker()
            mailbox = Mailbox()
            persist_calls = []

            scheduler = PhaseScheduler(
                worker_factory=lambda: worker,
                workspace_dir=self.tmpdir,
                mailbox=mailbox,
                event_emitter=self._emitter,
                max_task_submits=3,
                persist_fn=lambda: persist_calls.append(1),
            )

            phase = make_phase("p0", 0, [make_task("t1"), make_task("t2")])
            configs = {"default": make_worker_config()}

            async def lead_review(task, message):
                return Message(from_id="lead", to_id=f"worker-{task.task_id}",
                               task_id=task.task_id, content="ok",
                               message_type="approve")

            result = await scheduler.execute_phase(phase, configs, lead_review)
            self.assertEqual(result.status, "completed")
            for t in result.tasks:
                self.assertEqual(t.status, "approved")
                self.assertIsNotNone(t.result)
                self.assertIsNotNone(t.completed_at)
            self.assertTrue(len(persist_calls) > 0)

        self._run(go())

    def test_feedback_then_approve(self):
        """Lead gives feedback once, then approves."""
        async def go():
            worker = _MockWorker(["first attempt", "second attempt"])
            mailbox = Mailbox()

            scheduler = PhaseScheduler(
                worker_factory=lambda: worker,
                workspace_dir=self.tmpdir,
                mailbox=mailbox,
                event_emitter=self._emitter,
                max_task_submits=3,
            )

            phase = make_phase("p0", 0, [make_task("t1")])
            configs = {"default": make_worker_config()}
            review_count = [0]

            async def lead_review(task, message):
                review_count[0] += 1
                if review_count[0] == 1:
                    return Message(from_id="lead", to_id=f"worker-{task.task_id}",
                                   task_id=task.task_id, content="fix X",
                                   message_type="feedback")
                return Message(from_id="lead", to_id=f"worker-{task.task_id}",
                               task_id=task.task_id, content="ok",
                               message_type="approve")

            result = await scheduler.execute_phase(phase, configs, lead_review)
            self.assertEqual(result.status, "completed")
            task = result.tasks[0]
            self.assertEqual(task.status, "approved")
            self.assertEqual(task.submit_count, 2)
            self.assertEqual(len(task.messages), 4)  # submit, feedback, submit, approve

            # Check events include feedback
            event_types = [e[0] for e in self.events]
            self.assertIn(EventType.TEAM_TASK_FEEDBACK, event_types)
            self.assertIn(EventType.TEAM_TASK_RESUBMIT, event_types)

        self._run(go())

    def test_worker_exception_fails_task(self):
        """Worker raises exception → task fails, phase fails."""
        async def go():
            worker = _MockWorker(should_fail=True)
            mailbox = Mailbox()

            scheduler = PhaseScheduler(
                worker_factory=lambda: worker,
                workspace_dir=self.tmpdir,
                mailbox=mailbox,
                event_emitter=self._emitter,
                max_task_submits=3,
            )

            phase = make_phase("p0", 0, [make_task("t1")])
            configs = {"default": make_worker_config()}

            async def lead_review(task, message):
                return Message(from_id="lead", to_id=f"worker-{task.task_id}",
                               task_id=task.task_id, content="ok",
                               message_type="approve")

            result = await scheduler.execute_phase(phase, configs, lead_review)
            self.assertEqual(result.status, "failed")
            self.assertEqual(result.tasks[0].status, "failed")
            self.assertIn("Worker crashed", result.tasks[0].result_error)

        self._run(go())

    def test_max_submits_exceeded(self):
        """Worker exceeds max submits → fails."""
        async def go():
            worker = _MockWorker(["attempt"] * 5)
            mailbox = Mailbox()

            scheduler = PhaseScheduler(
                worker_factory=lambda: worker,
                workspace_dir=self.tmpdir,
                mailbox=mailbox,
                event_emitter=self._emitter,
                max_task_submits=2,  # Only allow 2
            )

            phase = make_phase("p0", 0, [make_task("t1")])
            configs = {"default": make_worker_config()}

            async def lead_review(task, message):
                # Always give feedback, never approve
                return Message(from_id="lead", to_id=f"worker-{task.task_id}",
                               task_id=task.task_id, content="not good enough",
                               message_type="feedback")

            result = await scheduler.execute_phase(phase, configs, lead_review)
            self.assertEqual(result.status, "failed")
            self.assertEqual(result.tasks[0].status, "failed")
            self.assertIn("max submits", result.tasks[0].result_error.lower())

        self._run(go())

    def test_missing_worker_config(self):
        """Task references unknown worker type → fails immediately."""
        async def go():
            worker = _MockWorker()
            mailbox = Mailbox()

            scheduler = PhaseScheduler(
                worker_factory=lambda: worker,
                workspace_dir=self.tmpdir,
                mailbox=mailbox,
                event_emitter=self._emitter,
            )

            phase = make_phase("p0", 0, [make_task("t1", worker_type="nonexistent")])
            configs = {"default": make_worker_config()}  # No "nonexistent"

            async def lead_review(task, message):
                return Message(from_id="lead", to_id=f"worker-{task.task_id}",
                               task_id=task.task_id, content="ok",
                               message_type="approve")

            result = await scheduler.execute_phase(phase, configs, lead_review)
            self.assertEqual(result.status, "failed")
            self.assertIn("not found", result.tasks[0].result_error)

        self._run(go())

    def test_mixed_success_and_failure(self):
        """One task succeeds, another fails → phase status is 'failed'."""
        async def go():
            call_count = [0]

            class MixedWorker(Worker):
                async def run_async(self, config, prompt, workspace=None,
                                    event_callback=None, resume_sdk_session_id=None):
                    call_count[0] += 1
                    if workspace and Path(workspace).name == "t2":
                        raise RuntimeError("t2 failed")
                    if workspace:
                        (Path(workspace) / "__result.json").write_text(
                            json.dumps({"summary": "ok", "content": "done", "files": []}))
                    return LLMResult(text="done", sdk_session_id=f"sdk-{call_count[0]}")

            mailbox = Mailbox()
            scheduler = PhaseScheduler(
                worker_factory=lambda: MixedWorker(),
                workspace_dir=self.tmpdir,
                mailbox=mailbox,
                event_emitter=self._emitter,
            )

            phase = make_phase("p0", 0, [make_task("t1"), make_task("t2")])
            configs = {"default": make_worker_config()}

            async def lead_review(task, message):
                return Message(from_id="lead", to_id=f"worker-{task.task_id}",
                               task_id=task.task_id, content="ok",
                               message_type="approve")

            result = await scheduler.execute_phase(phase, configs, lead_review)
            self.assertEqual(result.status, "failed")
            # t1 should be approved, t2 should be failed
            statuses = {t.task_id: t.status for t in result.tasks}
            self.assertEqual(statuses["t1"], "approved")
            self.assertEqual(statuses["t2"], "failed")

        self._run(go())

    def test_workspace_directories_created(self):
        """Verify task output directories are created."""
        async def go():
            worker = _MockWorker()
            mailbox = Mailbox()
            scheduler = PhaseScheduler(
                worker_factory=lambda: worker,
                workspace_dir=self.tmpdir,
                mailbox=mailbox,
                event_emitter=self._emitter,
            )
            phase = make_phase("p0", 0, [make_task("t1")])
            configs = {"default": make_worker_config()}

            async def lead_review(task, message):
                return Message(from_id="lead", to_id=f"worker-{task.task_id}",
                               task_id=task.task_id, content="ok",
                               message_type="approve")

            await scheduler.execute_phase(phase, configs, lead_review)
            task_dir = self.tmpdir / "phase_0" / "t1"
            self.assertTrue(task_dir.exists())
            self.assertTrue((task_dir / "__result.json").exists())
        self._run(go())

    def test_output_json_fallback(self):
        """Worker writes __output.json (old protocol) → scheduler reads and maps fields."""
        async def go():
            class OldProtocolWorker(Worker):
                _call = 0
                async def run_async(self, config, prompt, workspace=None,
                                    event_callback=None, resume_sdk_session_id=None):
                    self._call += 1
                    if workspace:
                        wdir = Path(workspace)
                        wdir.mkdir(parents=True, exist_ok=True)
                        # Write __output.json (old schema)
                        (wdir / "__output.json").write_text(json.dumps({
                            "summary": "old protocol result",
                            "text_content": "detailed old content",
                            "files": ["report.txt"],
                            "instruction_to_user": "run npm start",
                        }), encoding="utf-8")
                    return LLMResult(text="done", sdk_session_id=f"sdk-{self._call}")

            mailbox = Mailbox()
            scheduler = PhaseScheduler(
                worker_factory=lambda: OldProtocolWorker(),
                workspace_dir=self.tmpdir,
                mailbox=mailbox,
                event_emitter=self._emitter,
            )
            phase = make_phase("p0", 0, [make_task("t1")])
            configs = {"default": make_worker_config()}

            async def lead_review(task, message):
                return Message(from_id="lead", to_id=f"worker-{task.task_id}",
                               task_id=task.task_id, content="ok",
                               message_type="approve")

            result = await scheduler.execute_phase(phase, configs, lead_review)
            task = result.tasks[0]
            self.assertEqual(task.status, "approved")
            self.assertIsNotNone(task.result)
            # Verify field mapping: text_content → content, instruction_to_user → instruction
            self.assertEqual(task.result.summary, "old protocol result")
            self.assertEqual(task.result.content, "detailed old content")
            self.assertEqual(task.result.files, ["report.txt"])
            self.assertEqual(task.result.instruction, "run npm start")
        self._run(go())

    def test_result_json_preferred_over_output_json(self):
        """When both __result.json and __output.json exist, __result.json wins."""
        async def go():
            class BothFilesWorker(Worker):
                _call = 0
                async def run_async(self, config, prompt, workspace=None,
                                    event_callback=None, resume_sdk_session_id=None):
                    self._call += 1
                    if workspace:
                        wdir = Path(workspace)
                        wdir.mkdir(parents=True, exist_ok=True)
                        (wdir / "__result.json").write_text(json.dumps({
                            "summary": "new protocol",
                            "content": "new content",
                            "files": [],
                        }), encoding="utf-8")
                        (wdir / "__output.json").write_text(json.dumps({
                            "summary": "old protocol",
                            "text_content": "old content",
                            "files": [],
                        }), encoding="utf-8")
                    return LLMResult(text="done", sdk_session_id=f"sdk-{self._call}")

            mailbox = Mailbox()
            scheduler = PhaseScheduler(
                worker_factory=lambda: BothFilesWorker(),
                workspace_dir=self.tmpdir,
                mailbox=mailbox,
                event_emitter=self._emitter,
            )
            phase = make_phase("p0", 0, [make_task("t1")])
            configs = {"default": make_worker_config()}

            async def lead_review(task, message):
                return Message(from_id="lead", to_id=f"worker-{task.task_id}",
                               task_id=task.task_id, content="ok",
                               message_type="approve")

            result = await scheduler.execute_phase(phase, configs, lead_review)
            task = result.tasks[0]
            self.assertEqual(task.result.summary, "new protocol")
            self.assertEqual(task.result.content, "new content")
        self._run(go())


# ═══════════════════════════════════════════════════════════════
# 7. Unit Tests: team_orchestrator.py (utility functions)
# ═══════════════════════════════════════════════════════════════

class TestOrchestratorUtils(unittest.TestCase):
    """Test orchestrator utility functions."""

    def test_extract_json_direct(self):
        self.assertEqual(_extract_json('{"a": 1}'), {"a": 1})

    def test_extract_json_fenced(self):
        text = '```json\n{"a": 1}\n```'
        self.assertEqual(_extract_json(text), {"a": 1})

    def test_extract_json_embedded(self):
        text = 'Here is my plan: {"decision": "approve"} end.'
        self.assertEqual(_extract_json(text), {"decision": "approve"})

    def test_extract_json_invalid(self):
        self.assertEqual(_extract_json("no json here"), {})

    def test_extract_json_fenced_no_lang(self):
        text = '```\n{"a": 2}\n```'
        self.assertEqual(_extract_json(text), {"a": 2})

    def test_extract_json_trailing_comma(self):
        text = '{"decision": "approve", "reason": "good",}'
        result = _extract_json(text)
        self.assertEqual(result.get("decision"), "approve")

    def test_extract_json_single_quotes(self):
        text = "{'decision': 'approve'}"
        result = _extract_json(text)
        self.assertEqual(result.get("decision"), "approve")

    def test_extract_json_unquoted_keys(self):
        text = '{decision: "approve", reason: "looks good"}'
        result = _extract_json(text)
        self.assertEqual(result.get("decision"), "approve")

    def test_extract_json_with_comments(self):
        text = '{"decision": "approve" // this is approved\n}'
        result = _extract_json(text)
        self.assertEqual(result.get("decision"), "approve")

    def test_extract_json_missing_closing_brace(self):
        text = '{"decision": "approve", "reason": "ok"'
        result = _extract_json(text)
        self.assertEqual(result.get("decision"), "approve")

    def test_parse_plan_valid(self):
        plan_json = json.dumps({
            "objective": "Test",
            "phases": [
                {"phase_id": "p0", "description": "First",
                 "tasks": [
                     {"task_id": "t1", "description": "Do A", "worker_type_id": "w1"},
                     {"task_id": "t2", "description": "Do B", "worker_type_id": "w2"},
                 ]},
                {"phase_id": "p1", "description": "Second",
                 "tasks": [
                     {"task_id": "t3", "description": "Do C", "worker_type_id": "w1"},
                 ]},
            ]
        })
        plan = Plan(plan_id="test", objective="Test")
        result = _parse_plan(plan_json, plan)
        self.assertEqual(len(result.phases), 2)
        self.assertEqual(len(result.phases[0].tasks), 2)
        self.assertEqual(result.phases[0].tasks[0].worker_type_id, "w1")
        self.assertEqual(result.phases[1].phase_index, 1)

    def test_parse_plan_fallback(self):
        plan = Plan(plan_id="test", objective="Do things")
        result = _parse_plan("not valid json", plan)
        self.assertEqual(len(result.phases), 1)
        self.assertEqual(result.phases[0].tasks[0].description, "Do things")
        self.assertEqual(result.phases[0].tasks[0].worker_type_id, "default")

    def test_build_previous_results_summary(self):
        t1 = make_task("t1")
        t1.result = TaskResult(summary="Found data", files=["data.csv"], output_dir="/out/t1")
        p0 = make_phase("p0", 0, [t1])
        p0.status = "completed"
        p1 = make_phase("p1", 1, [make_task("t2")])
        plan = make_plan("test", [p0, p1])
        summary = _build_previous_results_summary(plan, 1)
        self.assertIn("Found data", summary)
        self.assertIn("data.csv", summary)
        self.assertIn("/out/t1", summary)

    def test_build_previous_results_summary_phase0(self):
        plan = make_plan("test", [make_phase("p0")])
        summary = _build_previous_results_summary(plan, 0)
        self.assertEqual(summary, "")


# ═══════════════════════════════════════════════════════════════
# 7b. Unit Tests: Worker Template Validation
# ═══════════════════════════════════════════════════════════════

class TestWorkerTemplates(unittest.TestCase):
    """Validate team-lead and team-worker templates in agents.json."""

    @classmethod
    def setUpClass(cls):
        agents_path = Path(__file__).parent / "storage" / "agents.json"
        with open(agents_path, encoding="utf-8") as f:
            data = json.load(f)
        cls.workers = {w["id"]: w for w in data.get("workers", [])}

    def test_team_lead_exists(self):
        self.assertIn("team-lead", self.workers)

    def test_team_lead_config(self):
        lead = self.workers["team-lead"]
        self.assertEqual(lead["name"], "Team Lead")
        self.assertEqual(lead["permission_mode"], "bypassPermissions")
        self.assertIn("Read", lead["tools_allow"])
        self.assertIn("Glob", lead["tools_allow"])
        self.assertNotIn("Bash", lead["tools_allow"])
        self.assertNotIn("Write", lead["tools_allow"])
        self.assertIn("Lead Agent", lead["prompt"]["system"])
        self.assertIn("strict JSON", lead["prompt"]["system"])

    def test_team_worker_exists(self):
        self.assertIn("team-worker", self.workers)

    def test_team_worker_config(self):
        worker = self.workers["team-worker"]
        self.assertEqual(worker["name"], "Team Worker")
        self.assertEqual(worker["permission_mode"], "bypassPermissions")
        self.assertIn("Read", worker["tools_allow"])
        self.assertIn("Write", worker["tools_allow"])
        self.assertIn("Edit", worker["tools_allow"])
        self.assertIn("Bash", worker["tools_allow"])
        self.assertIn("__result.json", worker["prompt"]["system"])
        self.assertNotIn("__output.json", worker["prompt"]["system"])
        self.assertIn("content", worker["prompt"]["system"])
        self.assertIn("instruction", worker["prompt"]["system"])


# ═══════════════════════════════════════════════════════════════
# 7c. Unit Tests: task_id sanitization
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
# 7d. Unit Tests: Lead review exception handling
# ═══════════════════════════════════════════════════════════════

class TestLeadReviewError(unittest.TestCase):
    """Test that Lead review exceptions don't deadlock the phase."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.events: list[tuple] = []

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _emitter(self, event_type, data=None):
        self.events.append((event_type, data))

    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro)

    def test_lead_review_exception_sends_feedback(self):
        """Lead review raises → worker gets feedback → eventually hits max_submits."""
        async def go():
            worker = _MockWorker(["attempt"] * 5)
            mailbox = Mailbox()

            scheduler = PhaseScheduler(
                worker_factory=lambda: worker,
                workspace_dir=self.tmpdir,
                mailbox=mailbox,
                event_emitter=self._emitter,
                max_task_submits=2,
            )

            phase = make_phase("p0", 0, [make_task("t1")])
            configs = {"default": make_worker_config()}

            async def lead_review_that_crashes(task, message):
                raise RuntimeError("LLM API unavailable")

            result = await scheduler.execute_phase(phase, configs, lead_review_that_crashes)
            # Phase should eventually fail (max submits) rather than deadlock
            self.assertEqual(result.status, "failed")
            self.assertEqual(result.tasks[0].status, "failed")

        self._run(go())


# ═══════════════════════════════════════════════════════════════
# 7e. Unit Tests: fallback TaskResult from result_text
# ═══════════════════════════════════════════════════════════════

class TestResultFallback(unittest.TestCase):
    """Test that missing __result.json produces fallback TaskResult."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.events: list[tuple] = []

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _emitter(self, event_type, data=None):
        self.events.append((event_type, data))

    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro)

    def test_no_result_file_generates_fallback(self):
        """Worker doesn't write any result file → fallback TaskResult from text."""
        async def go():
            class NoFileWorker(Worker):
                _call = 0
                async def run_async(self, config, prompt, workspace=None,
                                    event_callback=None, resume_sdk_session_id=None):
                    self._call += 1
                    # Deliberately do NOT write __result.json or __output.json
                    return LLMResult(text="I completed the task successfully",
                                    sdk_session_id=f"sdk-{self._call}")

            mailbox = Mailbox()
            scheduler = PhaseScheduler(
                worker_factory=lambda: NoFileWorker(),
                workspace_dir=self.tmpdir,
                mailbox=mailbox,
                event_emitter=self._emitter,
            )
            phase = make_phase("p0", 0, [make_task("t1")])
            configs = {"default": make_worker_config()}

            async def lead_review(task, message):
                return Message(from_id="lead", to_id=f"worker-{task.task_id}",
                               task_id=task.task_id, content="ok",
                               message_type="approve")

            result = await scheduler.execute_phase(phase, configs, lead_review)
            task = result.tasks[0]
            self.assertEqual(task.status, "approved")
            # Must have a fallback TaskResult
            self.assertIsNotNone(task.result)
            self.assertIn("I completed the task", task.result.content)
            self.assertEqual(task.result.files, [])
        self._run(go())


# ═══════════════════════════════════════════════════════════════
# 7e2. Unit Tests: JSON repair on __result.json
# ═══════════════════════════════════════════════════════════════

class TestResultJsonRepair(unittest.TestCase):
    """Test that malformed __result.json is auto-repaired."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.events: list[tuple] = []

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _emitter(self, event_type, data=None):
        self.events.append((event_type, data))

    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro)

    def test_trailing_comma_in_result_json(self):
        """__result.json with trailing comma → repaired and parsed."""
        async def go():
            class BadJsonWorker(Worker):
                _call = 0
                async def run_async(self, config, prompt, workspace=None,
                                    event_callback=None, resume_sdk_session_id=None):
                    self._call += 1
                    if workspace:
                        wdir = Path(workspace)
                        wdir.mkdir(parents=True, exist_ok=True)
                        # Write malformed JSON with trailing comma
                        (wdir / "__result.json").write_text(
                            '{"summary": "done", "content": "details", "files": [],}',
                            encoding="utf-8",
                        )
                    return LLMResult(text="done", sdk_session_id=f"sdk-{self._call}")

            mailbox = Mailbox()
            scheduler = PhaseScheduler(
                worker_factory=lambda: BadJsonWorker(),
                workspace_dir=self.tmpdir,
                mailbox=mailbox,
                event_emitter=self._emitter,
            )
            phase = make_phase("p0", 0, [make_task("t1")])
            configs = {"default": make_worker_config()}

            async def lead_review(task, message):
                return Message(from_id="lead", to_id=f"worker-{task.task_id}",
                               task_id=task.task_id, content="ok",
                               message_type="approve")

            result = await scheduler.execute_phase(phase, configs, lead_review)
            task = result.tasks[0]
            self.assertEqual(task.status, "approved")
            self.assertIsNotNone(task.result)
            self.assertEqual(task.result.summary, "done")
            self.assertEqual(task.result.content, "details")
        self._run(go())


# ═══════════════════════════════════════════════════════════════
# 7f. Unit Tests: worker_type_id fallback validation
# ═══════════════════════════════════════════════════════════════

class TestWorkerTypeFallback(unittest.TestCase):
    """Test _parse_plan validates worker_type_id against available configs."""

    def test_unknown_worker_type_falls_back(self):
        plan_json = json.dumps({
            "objective": "Test",
            "phases": [{
                "phase_id": "p0", "description": "Phase 0",
                "tasks": [
                    {"task_id": "t1", "description": "Do A", "worker_type_id": "nonexistent"},
                ]
            }]
        })
        plan = Plan(plan_id="test", objective="Test")
        result = _parse_plan(plan_json, plan, available_worker_ids={"researcher", "writer"})
        # Should fall back to first available (sorted), not "nonexistent"
        self.assertIn(result.phases[0].tasks[0].worker_type_id, {"researcher", "writer"})

    def test_valid_worker_type_preserved(self):
        plan_json = json.dumps({
            "objective": "Test",
            "phases": [{
                "phase_id": "p0", "description": "Phase 0",
                "tasks": [
                    {"task_id": "t1", "description": "Do A", "worker_type_id": "researcher"},
                ]
            }]
        })
        plan = Plan(plan_id="test", objective="Test")
        result = _parse_plan(plan_json, plan, available_worker_ids={"researcher", "writer"})
        self.assertEqual(result.phases[0].tasks[0].worker_type_id, "researcher")

    def test_fallback_without_default(self):
        """When 'default' isn't in available workers, falls back to first available."""
        plan = Plan(plan_id="test", objective="Do stuff")
        result = _parse_plan("not valid json", plan, available_worker_ids={"researcher"})
        self.assertEqual(result.phases[0].tasks[0].worker_type_id, "researcher")

    def test_no_available_ids_uses_default(self):
        """When no available_worker_ids provided, uses 'default'."""
        plan = Plan(plan_id="test", objective="Do stuff")
        result = _parse_plan("not valid json", plan)
        self.assertEqual(result.phases[0].tasks[0].worker_type_id, "default")


# ═══════════════════════════════════════════════════════════════
# 7g. Unit Tests: TEAM_TASK_SUBMITTED event
# ═══════════════════════════════════════════════════════════════

class TestTaskSubmittedEvent(unittest.TestCase):
    """Test that first submit emits TEAM_TASK_SUBMITTED, not TEAM_TASK_COMPLETE."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.events: list[tuple] = []

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _emitter(self, event_type, data=None):
        self.events.append((event_type, data))

    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro)

    def test_first_submit_emits_submitted_not_complete(self):
        async def go():
            worker = _MockWorker()
            mailbox = Mailbox()

            scheduler = PhaseScheduler(
                worker_factory=lambda: worker,
                workspace_dir=self.tmpdir,
                mailbox=mailbox,
                event_emitter=self._emitter,
            )
            phase = make_phase("p0", 0, [make_task("t1")])
            configs = {"default": make_worker_config()}

            async def lead_review(task, message):
                return Message(from_id="lead", to_id=f"worker-{task.task_id}",
                               task_id=task.task_id, content="ok",
                               message_type="approve")

            await scheduler.execute_phase(phase, configs, lead_review)

            event_types = [e[0] for e in self.events]
            # First submit should emit SUBMITTED, not COMPLETE
            submitted_events = [e for e in self.events if e[0] == EventType.TEAM_TASK_SUBMITTED]
            self.assertTrue(len(submitted_events) >= 1,
                          f"Expected TEAM_TASK_SUBMITTED event, got: {event_types}")
            # COMPLETE should only appear after approve
            complete_events = [e for e in self.events
                             if e[0] == EventType.TEAM_TASK_COMPLETE
                             and e[1].get("status") == "approved"]
            self.assertTrue(len(complete_events) >= 1,
                          "Expected TEAM_TASK_COMPLETE with status=approved")
        self._run(go())


# ═══════════════════════════════════════════════════════════════
# 8. Integration Test: Full StubWorker Flow
# ═══════════════════════════════════════════════════════════════

class _ScriptedWorker(Worker):
    """Worker that returns scripted responses based on call sequence.

    Simulates Lead planning, task execution, Lead reviewing, phase review, summary.
    """

    def __init__(self):
        self._call_count = 0
        self._calls: list[dict] = []

    async def run_async(self, config, prompt, workspace=None,
                        event_callback=None, resume_sdk_session_id=None) -> LLMResult:
        self._call_count += 1
        self._calls.append({
            "call": self._call_count,
            "prompt_prefix": prompt[:100],
            "resume": resume_sdk_session_id,
            "workspace": str(workspace) if workspace else None,
        })

        # Call 1: Planning
        if "Lead Agent" in prompt and "Planning Rules" in prompt:
            plan = json.dumps({
                "objective": "Test integration",
                "phases": [
                    {
                        "phase_id": "phase_0",
                        "description": "Research phase",
                        "tasks": [
                            {"task_id": "task_001", "description": "Research topic A",
                             "worker_type_id": "default"},
                            {"task_id": "task_002", "description": "Research topic B",
                             "worker_type_id": "default"},
                        ]
                    },
                    {
                        "phase_id": "phase_1",
                        "description": "Synthesis phase",
                        "tasks": [
                            {"task_id": "task_003", "description": "Write final report",
                             "worker_type_id": "default"},
                        ]
                    }
                ]
            })
            return LLMResult(text=plan, sdk_session_id="lead-session-1")

        # Worker execution: write __result.json
        if "independent Worker" in prompt:
            if workspace:
                wdir = Path(workspace)
                wdir.mkdir(parents=True, exist_ok=True)
                result_data = {
                    "summary": f"Completed work (call {self._call_count})",
                    "content": f"Detailed findings for {prompt[100:200]}",
                    "files": ["notes.md"],
                    "instruction": "Review carefully",
                }
                (wdir / "__result.json").write_text(json.dumps(result_data))
                (wdir / "notes.md").write_text(f"# Notes\nContent for call {self._call_count}")
            return LLMResult(
                text=f"Worker output (call {self._call_count})",
                sdk_session_id=f"worker-session-{self._call_count}",
            )

        # Task review (first time for task_001: feedback; otherwise: approve)
        if "has submitted results for review" in prompt:
            if "task_001" in prompt and "attempt #1" in prompt:
                return LLMResult(
                    text='{"decision": "feedback", "content": "Please add more detail to section 2"}',
                    sdk_session_id="lead-session-1",
                )
            return LLMResult(
                text='{"decision": "approve"}',
                sdk_session_id="lead-session-1",
            )

        # Phase review
        if "is complete" in prompt and "Remaining Plan" in prompt:
            return LLMResult(
                text='{"decision": "approve"}',
                sdk_session_id="lead-session-1",
            )

        # Final summary
        if "All phases are complete" in prompt:
            return LLMResult(
                text="# Final Report\n\nAll tasks completed successfully. Key findings: ...",
                sdk_session_id="lead-session-1",
            )

        # Feedback continuation (resume worker)
        if resume_sdk_session_id and resume_sdk_session_id.startswith("worker-"):
            if workspace:
                wdir = Path(workspace)
                result_data = {
                    "summary": f"Revised work (call {self._call_count})",
                    "content": "Added more detail to section 2",
                    "files": ["notes.md"],
                }
                (wdir / "__result.json").write_text(json.dumps(result_data))
            return LLMResult(
                text=f"Revised output (call {self._call_count})",
                sdk_session_id=resume_sdk_session_id,
            )

        # Fallback
        return LLMResult(text=f"Fallback (call {self._call_count})", sdk_session_id="fallback")


class TestIntegration(unittest.TestCase):
    """Integration test: full orchestrator flow with scripted worker."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.worker = _ScriptedWorker()
        self.orchestrator = TeamOrchestrator(
            base_dir=self.tmpdir,
            worker_factory=lambda: self.worker,
        )

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro)

    def test_full_flow(self):
        """Full planning → execution (with feedback) → phase review → summary."""
        async def go():
            # Create session
            lead_config = make_worker_config("lead")
            session = self.orchestrator.create_session(
                objective="Research and report on AI trends",
                lead_config=lead_config,
            )
            self.assertEqual(session.status, "pending")

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
            for task in p0.tasks:
                self.assertEqual(task.status, "approved")
                self.assertIsNotNone(task.result)
                self.assertIsNotNone(task.completed_at)

            # task_001 should have had feedback (submit_count > 1)
            t1 = p0.tasks[0]
            self.assertGreaterEqual(t1.submit_count, 2)  # At least 2 attempts
            self.assertTrue(
                any(m.message_type == "feedback" for m in t1.messages),
                "task_001 should have received feedback"
            )

            # Phase 1: 1 task
            p1 = final.plan.phases[1]
            self.assertEqual(p1.status, "completed")
            self.assertEqual(len(p1.tasks), 1)
            self.assertEqual(p1.tasks[0].status, "approved")

            # Check workspace directories
            ws = Path(final.workspace_dir)
            self.assertTrue(ws.exists())
            self.assertTrue((ws / "phase_0" / "task_001").exists())
            self.assertTrue((ws / "phase_0" / "task_002").exists())
            self.assertTrue((ws / "phase_1" / "task_003").exists())

            # Check __result.json files exist
            for phase_idx in range(2):
                phase = final.plan.phases[phase_idx]
                for task in phase.tasks:
                    task_dir = ws / f"phase_{phase_idx}" / task.task_id
                    self.assertTrue(
                        (task_dir / "__result.json").exists(),
                        f"Missing __result.json in {task_dir}"
                    )
                    # Verify it's valid JSON
                    data = json.loads((task_dir / "__result.json").read_text())
                    self.assertIn("summary", data)

            # Check notes.md files
            self.assertTrue((ws / "phase_0" / "task_001" / "notes.md").exists())

            # Check __final_output.json written to workspace root
            final_output_path = ws / "__final_output.json"
            self.assertTrue(final_output_path.exists(), "Missing __final_output.json in workspace")
            final_output_data = json.loads(final_output_path.read_text())
            self.assertIn("final_output", final_output_data)
            self.assertIn("Final Report", final_output_data["final_output"])

            # Verify Lead session continuity (same session ID for reviews)
            self.assertIsNotNone(final.lead_sdk_session_id)

            # Print call trace for debugging
            print(f"\n  Total worker calls: {self.worker._call_count}")
            for c in self.worker._calls:
                print(f"  Call {c['call']}: resume={c['resume']}, prompt={c['prompt_prefix'][:60]}...")

        self._run(go())


# ═══════════════════════════════════════════════════════════════
# 9. E2E Test: API Router with TestClient
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
        cls._original_base_dir = None

        # Patch the TEAM_BASE_DIR in the team router
        import routers.team as team_router_module
        cls._original_base_dir = team_router_module.TEAM_BASE_DIR
        team_router_module.TEAM_BASE_DIR = cls._tmpdir

        # Patch ClaudeSdkWorker to use our scripted worker
        cls._original_sdk_worker = team_router_module.ClaudeSdkWorker

        class TestSdkWorker(_ScriptedWorker):
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
        if cls._original_base_dir is not None:
            cls.team_module.TEAM_BASE_DIR = cls._original_base_dir
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
                # Start a run
                resp = await client.post("/api/team/run", json={
                    "objective": "Test E2E flow",
                    "lead_worker_id": "default",
                    "max_task_submits": 3,
                })
                self.assertEqual(resp.status_code, 201)
                data = resp.json()
                session_id = data["session_id"]
                self.assertTrue(session_id.startswith("team-"))

                # Poll with async sleep (allows background task to run)
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

                # Verify workspace files exist
                ws_dir = Path(session_data["workspace_dir"])
                if ws_dir.exists():
                    for phase in session_data["plan"]["phases"]:
                        for task in phase["tasks"]:
                            task_dir = ws_dir / f"phase_{phase['phase_index']}" / task["task_id"]
                            self.assertTrue(task_dir.exists(), f"Missing task dir: {task_dir}")
                            result_file = task_dir / "__result.json"
                            self.assertTrue(result_file.exists(), f"Missing __result.json: {result_file}")

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
