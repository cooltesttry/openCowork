from __future__ import annotations

import json
import tempfile
from pathlib import Path

from super_agent.team.memory_store import MemoryStore
from super_agent.team.models import Phase, Plan, TaskStep


def _make_plan() -> Plan:
    p0 = Phase(
        phase_id="phase_0",
        phase_index=0,
        description="Phase zero",
        tasks=[
            TaskStep(task_id="task_001", description="Research architecture", worker_type_id="default"),
            TaskStep(task_id="task_002", description="实现检索策略", worker_type_id="default"),
        ],
    )
    return Plan(
        plan_id="plan-test",
        objective="Build resilient long-running team orchestration",
        phases=[p0],
        version=1,
        planning_basis={
            "goal_alignment": "Keep context stable across phases",
            "deliverables_acceptance": "Memory, context pack, and phase recovery are implemented",
            "default_assumptions": "No vector DB in phase one",
        },
    )


def _make_phase(idx: int, *, task_id: str = "task_001", desc: str = "Phase task") -> Phase:
    return Phase(
        phase_id=f"phase_{idx}",
        phase_index=idx,
        description=f"Phase {idx}",
        tasks=[TaskStep(task_id=task_id, description=desc, worker_type_id="default")],
    )


def test_init_memory_creates_expected_files():
    with tempfile.TemporaryDirectory() as td:
        team_data_dir = Path(td)
        plan = _make_plan()
        store = MemoryStore(team_data_dir)
        logs_dir = team_data_dir / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)

        store.init_memory(
            plan=plan,
            workspace_dir=str(team_data_dir / "workspace"),
            project_dir=str(team_data_dir / "workspace" / "project"),
            logs_dir=str(logs_dir),
        )

        memory_dir = team_data_dir / "memory"
        assert (memory_dir / "north_star.md").exists()
        assert (memory_dir / "north_star_history.jsonl").exists()
        assert (memory_dir / "phase_summaries" / "index.jsonl").exists()
        assert (memory_dir / "knowledge" / "knowledge.jsonl").exists()
        assert (memory_dir / "knowledge" / "usage.json").exists()
        assert (memory_dir / "snapshot.json").exists()
        assert (memory_dir / "short_context.md").exists()

        snapshot = json.loads((memory_dir / "snapshot.json").read_text(encoding="utf-8"))
        assert snapshot["objective"] == plan.objective
        assert snapshot["project"]["current_phase_index"] == -1


def test_commit_phase_writes_single_summary_and_knowledge_and_promotes_north_star():
    with tempfile.TemporaryDirectory() as td:
        team_data_dir = Path(td)
        logs_dir = team_data_dir / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        (logs_dir / "workflow.md").write_text("workflow", encoding="utf-8")

        plan = _make_plan()
        phase = plan.phases[0]
        for task in phase.tasks:
            final_file = logs_dir / f"phase0_{task.task_id}_worker-{task.task_id}_submit1_msg-final_final.md"
            final_file.write_text(f"Result for {task.task_id}", encoding="utf-8")

        store = MemoryStore(team_data_dir)
        store.init_memory(
            plan=plan,
            workspace_dir=str(team_data_dir / "workspace"),
            project_dir=str(team_data_dir / "workspace" / "project"),
            logs_dir=str(logs_dir),
        )

        payload = {
            "phase_outcome": "success",
            "phase_summary_md": "# Phase 0 Summary\n\n## Achievements\n- done",
            "knowledge_items": [
                {
                    "title": "Phase boundary decision",
                    "keywords": ["session", "phase"],
                    "short_summary": "Cross-phase should not resume",
                    "full_content": "Always create a new lead session across phases to stabilize context.",
                    "north_star_candidate": True,
                    "importance": 0.92,
                    "refs": [{"type": "file", "path": str(logs_dir / "workflow.md")}],
                }
            ],
            "next_phase_focus": ["P0 validate resume fallback"],
        }

        out = store.commit_phase(
            phase_index=0,
            phase=phase,
            plan=plan,
            plan_data=plan.to_dict(),
            lead_phase_review_text="Phase review approved",
            logs_dir=str(logs_dir),
            memory_writer_payload=payload,
        )

        summary_file = Path(out["summary_file"])
        assert summary_file.exists()
        assert out["phase_outcome"] == "success"
        assert out["knowledge_items_added"] >= 1

        knowledge_lines = (team_data_dir / "memory" / "knowledge" / "knowledge.jsonl").read_text(encoding="utf-8").strip().splitlines()
        assert len(knowledge_lines) >= 1
        first = json.loads(knowledge_lines[0])
        assert first["title"] == "Phase boundary decision"
        assert first["phase_outcome"] == "success"
        assert first["validation_strength"] in {"medium", "high"}

        north_star_text = (team_data_dir / "memory" / "north_star.md").read_text(encoding="utf-8")
        assert "Phase boundary decision" in north_star_text

        summary_index_rows = [json.loads(line) for line in (team_data_dir / "memory" / "phase_summaries" / "index.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
        row0 = next(row for row in summary_index_rows if row.get("phase_index") == 0)
        assert row0["phase_outcome"] == "success"
        assert row0["validation_strength"] in {"low", "medium", "high"}


def test_search_and_mark_used_support_cjk_and_phase_summary_retrieval():
    with tempfile.TemporaryDirectory() as td:
        team_data_dir = Path(td)
        store = MemoryStore(team_data_dir)
        plan = _make_plan()
        logs_dir = team_data_dir / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        (logs_dir / "workflow.md").write_text("workflow", encoding="utf-8")

        store.init_memory(
            plan=plan,
            workspace_dir=str(team_data_dir / "workspace"),
            project_dir=str(team_data_dir / "workspace" / "project"),
            logs_dir=str(logs_dir),
        )

        phase = plan.phases[0]
        store.commit_phase(
            phase_index=0,
            phase=phase,
            plan=plan,
            plan_data=plan.to_dict(),
            lead_phase_review_text="发现中文检索问题",
            logs_dir=str(logs_dir),
            memory_writer_payload={
                "phase_outcome": "partial",
                "phase_summary_md": "# Phase 0 Summary\n\n## Lessons\n- 改进检索策略",
                "knowledge_items": [
                    {
                        "title": "中文检索命中",
                        "keywords": ["检索", "策略"],
                        "short_summary": "CJK n-gram should match 检索策略",
                        "full_content": "When query contains Chinese terms, n-gram matching improves recall.",
                        "north_star_candidate": False,
                        "importance": 0.8,
                        "refs": [{"type": "file", "path": str(logs_dir / "workflow.md")}],
                    }
                ],
            },
        )

        hits = store.search(query="请改进检索策略", top_k=5, current_phase_index=0)
        assert hits
        assert any(h["item_type"] == "knowledge" for h in hits)
        assert any(h["item_type"] == "phase_summary" for h in hits)

        use_ids = [h["item_id"] for h in hits[:2]]
        store.mark_used(use_ids, phase_index=1)
        usage = json.loads((team_data_dir / "memory" / "knowledge" / "usage.json").read_text(encoding="utf-8"))
        for iid in use_ids:
            assert usage[iid]["last_used_phase"] == 1
            assert usage[iid]["use_count"] >= 1


def test_commit_phase_fallback_generates_summary_and_minimal_knowledge():
    with tempfile.TemporaryDirectory() as td:
        team_data_dir = Path(td)
        logs_dir = team_data_dir / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        (logs_dir / "workflow.md").write_text("workflow", encoding="utf-8")

        plan = _make_plan()
        phase = plan.phases[0]
        store = MemoryStore(team_data_dir)
        store.init_memory(
            plan=plan,
            workspace_dir=str(team_data_dir / "workspace"),
            project_dir=str(team_data_dir / "workspace" / "project"),
            logs_dir=str(logs_dir),
        )

        out = store.commit_phase(
            phase_index=0,
            phase=phase,
            plan=plan,
            plan_data=plan.to_dict(),
            lead_phase_review_text="Review text",
            logs_dir=str(logs_dir),
            memory_writer_payload=None,
        )

        assert Path(out["summary_file"]).exists()
        assert out["phase_outcome"] == "partial"
        assert out["knowledge_items_added"] >= 1


def test_commit_phase_noop_payload_falls_back_and_autofills_refs():
    with tempfile.TemporaryDirectory() as td:
        team_data_dir = Path(td)
        logs_dir = team_data_dir / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        (logs_dir / "workflow.md").write_text("workflow", encoding="utf-8")

        plan = _make_plan()
        phase = plan.phases[0]
        store = MemoryStore(team_data_dir)
        store.init_memory(
            plan=plan,
            workspace_dir=str(team_data_dir / "workspace"),
            project_dir=str(team_data_dir / "workspace" / "project"),
            logs_dir=str(logs_dir),
        )

        out = store.commit_phase(
            phase_index=0,
            phase=phase,
            plan=plan,
            plan_data=plan.to_dict(),
            lead_phase_review_text="No major signal in this phase.",
            logs_dir=str(logs_dir),
            memory_writer_payload={
                "phase_outcome": "uncertain",
                "phase_summary_md": "",
                "knowledge_items": [],
                "next_phase_focus": [],
            },
        )

        summary_file = Path(out["summary_file"])
        summary_text = summary_file.read_text(encoding="utf-8")
        assert summary_text.strip()

        knowledge_rows = [
            json.loads(line)
            for line in (team_data_dir / "memory" / "knowledge" / "knowledge.jsonl")
            .read_text(encoding="utf-8")
            .splitlines()
            if line.strip()
        ]
        assert knowledge_rows
        first = knowledge_rows[0]
        assert first["phase_outcome"] == "uncertain"
        assert first["validation_strength"] == "low"
        assert first["refs"]
        assert first["refs"][0]["path"] == str(summary_file)


def test_uncertain_candidate_does_not_promote_north_star():
    with tempfile.TemporaryDirectory() as td:
        team_data_dir = Path(td)
        logs_dir = team_data_dir / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        (logs_dir / "workflow.md").write_text("workflow", encoding="utf-8")

        plan = _make_plan()
        phase = plan.phases[0]
        store = MemoryStore(team_data_dir)
        store.init_memory(
            plan=plan,
            workspace_dir=str(team_data_dir / "workspace"),
            project_dir=str(team_data_dir / "workspace" / "project"),
            logs_dir=str(logs_dir),
        )

        store.commit_phase(
            phase_index=0,
            phase=phase,
            plan=plan,
            plan_data=plan.to_dict(),
            lead_phase_review_text="Conflicting evidence",
            logs_dir=str(logs_dir),
            memory_writer_payload={
                "phase_outcome": "uncertain",
                "phase_summary_md": "# Phase 0 Summary\n\n## Risk\n- conflicting evidence",
                "knowledge_items": [
                    {
                        "title": "Candidate with uncertainty",
                        "keywords": ["memory", "decision"],
                        "short_summary": "Do not promote uncertain candidate.",
                        "full_content": "Evidence conflicts, keep this as searchable knowledge only.",
                        "north_star_candidate": True,
                        "importance": 0.95,
                        "refs": [{"type": "file", "path": str(logs_dir / "workflow.md")}],
                    }
                ],
            },
        )

        north_star = (team_data_dir / "memory" / "north_star.md").read_text(encoding="utf-8")
        assert "Candidate with uncertainty" not in north_star


def test_missing_refs_are_autofilled_to_phase_summary():
    with tempfile.TemporaryDirectory() as td:
        team_data_dir = Path(td)
        logs_dir = team_data_dir / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        (logs_dir / "workflow.md").write_text("workflow", encoding="utf-8")

        plan = _make_plan()
        phase = plan.phases[0]
        store = MemoryStore(team_data_dir)
        store.init_memory(
            plan=plan,
            workspace_dir=str(team_data_dir / "workspace"),
            project_dir=str(team_data_dir / "workspace" / "project"),
            logs_dir=str(logs_dir),
        )

        out = store.commit_phase(
            phase_index=0,
            phase=phase,
            plan=plan,
            plan_data=plan.to_dict(),
            lead_phase_review_text="phase0",
            logs_dir=str(logs_dir),
            memory_writer_payload={
                "phase_outcome": "partial",
                "phase_summary_md": "# Phase 0 Summary\n- note",
                "knowledge_items": [
                    {
                        "title": "Knowledge without refs",
                        "keywords": ["memory"],
                        "short_summary": "Should backfill refs.",
                        "full_content": "Refs were missing in writer output.",
                        "north_star_candidate": False,
                        "importance": 0.7,
                    }
                ],
            },
        )

        summary_file = str(Path(out["summary_file"]))
        rows = [
            json.loads(line)
            for line in (team_data_dir / "memory" / "knowledge" / "knowledge.jsonl")
            .read_text(encoding="utf-8")
            .splitlines()
            if line.strip()
        ]
        assert rows[0]["title"] == "Knowledge without refs"
        assert rows[0]["refs"][0]["path"] == summary_file


def test_high_impact_artifact_refs_are_preserved_and_searchable():
    with tempfile.TemporaryDirectory() as td:
        team_data_dir = Path(td)
        logs_dir = team_data_dir / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        (logs_dir / "workflow.md").write_text("workflow", encoding="utf-8")
        design_doc = team_data_dir / "workspace" / "project" / "docs" / "architecture_v2.md"
        design_doc.parent.mkdir(parents=True, exist_ok=True)
        design_doc.write_text("architecture content", encoding="utf-8")

        plan = _make_plan()
        phase = plan.phases[0]
        store = MemoryStore(team_data_dir)
        store.init_memory(
            plan=plan,
            workspace_dir=str(team_data_dir / "workspace"),
            project_dir=str(team_data_dir / "workspace" / "project"),
            logs_dir=str(logs_dir),
        )

        store.commit_phase(
            phase_index=0,
            phase=phase,
            plan=plan,
            plan_data=plan.to_dict(),
            lead_phase_review_text="Design baseline confirmed",
            logs_dir=str(logs_dir),
            memory_writer_payload={
                "phase_outcome": "success",
                "phase_summary_md": "# Phase 0 Summary\n\n- architecture baseline",
                "knowledge_items": [
                    {
                        "title": "Architecture design baseline",
                        "keywords": ["architecture", "design", "module-x"],
                        "short_summary": "Design doc location is critical for follow-up implementation.",
                        "full_content": "Use this design doc as the source of truth for module-x contracts.",
                        "north_star_candidate": False,
                        "importance": 0.86,
                        "refs": [{"type": "file", "path": str(design_doc)}],
                    }
                ],
            },
        )

        rows = [
            json.loads(line)
            for line in (team_data_dir / "memory" / "knowledge" / "knowledge.jsonl")
            .read_text(encoding="utf-8")
            .splitlines()
            if line.strip()
        ]
        assert rows
        artifact_row = next(row for row in rows if row.get("title") == "Architecture design baseline")
        assert artifact_row["refs"][0]["path"] == str(design_doc)

        hits = store.search(query="module-x architecture design", top_k=6, current_phase_index=0)
        knowledge_hits = [h for h in hits if h.get("item_type") == "knowledge"]
        assert knowledge_hits
        target_hit = next(
            h for h in knowledge_hits
            if any(str(ref.get("path", "")) == str(design_doc) for ref in h.get("refs", []))
        )
        assert target_hit["item_type"] == "knowledge"


def test_low_value_artifact_is_filtered_and_falls_back_to_anchor():
    with tempfile.TemporaryDirectory() as td:
        team_data_dir = Path(td)
        logs_dir = team_data_dir / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        (logs_dir / "workflow.md").write_text("workflow", encoding="utf-8")
        temp_log = logs_dir / "tmp_progress.log"
        temp_log.write_text("status update", encoding="utf-8")

        plan = _make_plan()
        phase = plan.phases[0]
        store = MemoryStore(team_data_dir)
        store.init_memory(
            plan=plan,
            workspace_dir=str(team_data_dir / "workspace"),
            project_dir=str(team_data_dir / "workspace" / "project"),
            logs_dir=str(logs_dir),
        )

        store.commit_phase(
            phase_index=0,
            phase=phase,
            plan=plan,
            plan_data=plan.to_dict(),
            lead_phase_review_text="Only low-signal progress logs",
            logs_dir=str(logs_dir),
            memory_writer_payload={
                "phase_outcome": "partial",
                "phase_summary_md": "# Phase 0 Summary\n\n- status only",
                "knowledge_items": [
                    {
                        "title": "Temp progress log",
                        "keywords": ["temp", "progress", "log"],
                        "short_summary": "Temporary progress status with no decision impact.",
                        "full_content": "This is a scratch status log and should not become durable memory.",
                        "north_star_candidate": False,
                        "importance": 0.56,
                        "refs": [{"type": "file", "path": str(temp_log)}],
                    }
                ],
            },
        )

        rows = [
            json.loads(line)
            for line in (team_data_dir / "memory" / "knowledge" / "knowledge.jsonl")
            .read_text(encoding="utf-8")
            .splitlines()
            if line.strip()
        ]
        assert rows
        assert all(row.get("title") != "Temp progress log" for row in rows)
        assert rows[0]["title"] == "Phase 0 Summary Anchor"


def test_north_star_conflict_prefers_validation_strength():
    with tempfile.TemporaryDirectory() as td:
        team_data_dir = Path(td)
        logs_dir = team_data_dir / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        (logs_dir / "workflow.md").write_text("workflow", encoding="utf-8")
        (logs_dir / "evidence_2.md").write_text("extra evidence", encoding="utf-8")

        plan = _make_plan()
        store = MemoryStore(team_data_dir)
        store.init_memory(
            plan=plan,
            workspace_dir=str(team_data_dir / "workspace"),
            project_dir=str(team_data_dir / "workspace" / "project"),
            logs_dir=str(logs_dir),
        )

        phase0 = _make_phase(0, task_id="task_001", desc="First pass")
        store.commit_phase(
            phase_index=0,
            phase=phase0,
            plan=plan,
            plan_data=plan.to_dict(),
            lead_phase_review_text="phase0",
            logs_dir=str(logs_dir),
            memory_writer_payload={
                "phase_outcome": "success",
                "phase_summary_md": "# Phase 0 Summary\n- baseline",
                "knowledge_items": [
                    {
                        "title": "Session boundary baseline",
                        "keywords": ["session", "boundary"],
                        "short_summary": "Keep a stable session boundary.",
                        "full_content": "Baseline rule with medium validation.",
                        "north_star_candidate": True,
                        "importance": 0.95,
                        "validation_strength": "medium",
                        "refs": [{"type": "file", "path": str(logs_dir / "workflow.md")}],
                    }
                ],
            },
        )

        phase1 = _make_phase(1, task_id="task_002", desc="Second pass")
        store.commit_phase(
            phase_index=1,
            phase=phase1,
            plan=plan,
            plan_data=plan.to_dict(),
            lead_phase_review_text="phase1",
            logs_dir=str(logs_dir),
            memory_writer_payload={
                "phase_outcome": "success",
                "phase_summary_md": "# Phase 1 Summary\n- stronger evidence",
                "knowledge_items": [
                    {
                        "title": "Session boundary baseline",
                        "keywords": ["session", "boundary"],
                        "short_summary": "Validation increased with stronger refs.",
                        "full_content": "A lower-importance item should still win when validation is stronger.",
                        "north_star_candidate": True,
                        "importance": 0.88,
                        "validation_strength": "high",
                        "refs": [
                            {"type": "file", "path": str(logs_dir / "workflow.md")},
                            {"type": "file", "path": str(logs_dir / "evidence_2.md")},
                        ],
                    }
                ],
            },
        )

        north_star = (team_data_dir / "memory" / "north_star.md").read_text(encoding="utf-8")
        assert "Validation increased with stronger refs." in north_star
        history_rows = [
            json.loads(line)
            for line in (team_data_dir / "memory" / "north_star_history.jsonl")
            .read_text(encoding="utf-8")
            .splitlines()
            if line.strip()
        ]
        assert any("validation_strength" in str(row.get("reason", "")) for row in history_rows)


def test_commit_phase_writes_plan_basis_delta_metadata_to_summary_index():
    with tempfile.TemporaryDirectory() as td:
        team_data_dir = Path(td)
        logs_dir = team_data_dir / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        (logs_dir / "workflow.md").write_text("workflow", encoding="utf-8")

        plan = _make_plan()
        phase = plan.phases[0]
        store = MemoryStore(team_data_dir)
        store.init_memory(
            plan=plan,
            workspace_dir=str(team_data_dir / "workspace"),
            project_dir=str(team_data_dir / "workspace" / "project"),
            logs_dir=str(logs_dir),
        )

        delta = {
            "plan_changed": True,
            "phases_changed": True,
            "planning_basis_changed": True,
            "basis_changed_fields": ["default_assumptions", "goal_alignment"],
            "change_brief": "default assumptions and remaining phases were updated",
            "pre_version": 1,
            "post_version": 2,
        }
        store.commit_phase(
            phase_index=0,
            phase=phase,
            plan=plan,
            plan_data=plan.to_dict(),
            lead_phase_review_text="phase review",
            logs_dir=str(logs_dir),
            memory_writer_payload={
                "phase_outcome": "partial",
                "phase_summary_md": (
                    "# Phase 0 Summary\n\n"
                    "## Plan & Basis Changes\n"
                    "- default assumptions adjusted\n"
                ),
                "knowledge_items": [],
            },
            plan_basis_delta=delta,
        )

        rows = [
            json.loads(line)
            for line in (team_data_dir / "memory" / "phase_summaries" / "index.jsonl")
            .read_text(encoding="utf-8")
            .splitlines()
            if line.strip()
        ]
        row0 = next(row for row in rows if int(row.get("phase_index", -1)) == 0)
        assert row0["plan_changed"] is True
        assert row0["phases_changed"] is True
        assert row0["planning_basis_changed"] is True
        assert row0["basis_changed_fields"] == ["default_assumptions", "goal_alignment"]
        assert row0["change_brief"] == "default assumptions and remaining phases were updated"
        assert row0["summary_has_plan_basis_section"] is True


def test_build_phase_pack_skips_notice_when_summary_already_has_plan_basis_section():
    with tempfile.TemporaryDirectory() as td:
        team_data_dir = Path(td)
        logs_dir = team_data_dir / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        (logs_dir / "workflow.md").write_text("workflow", encoding="utf-8")

        plan = _make_plan()
        plan.phases.append(_make_phase(1, task_id="task_010", desc="Next phase task"))
        store = MemoryStore(team_data_dir)
        store.init_memory(
            plan=plan,
            workspace_dir=str(team_data_dir / "workspace"),
            project_dir=str(team_data_dir / "workspace" / "project"),
            logs_dir=str(logs_dir),
        )

        store.commit_phase(
            phase_index=0,
            phase=plan.phases[0],
            plan=plan,
            plan_data=plan.to_dict(),
            lead_phase_review_text="phase review",
            logs_dir=str(logs_dir),
            memory_writer_payload={
                "phase_outcome": "partial",
                "phase_summary_md": (
                    "# Phase 0 Summary\n\n"
                    "## Plan & Basis Changes\n"
                    "- acceptance criteria changed\n"
                ),
                "knowledge_items": [],
            },
            plan_basis_delta={
                "plan_changed": True,
                "phases_changed": False,
                "planning_basis_changed": True,
                "basis_changed_fields": ["deliverables_acceptance"],
                "change_brief": "acceptance criteria changed",
            },
        )

        lead_pack, _ = store.build_lead_phase_pack(
            plan=plan,
            phase=plan.phases[1],
            phase_index=1,
            logs_dir=str(logs_dir),
        )
        worker_pack, _ = store.build_worker_phase_pack(
            plan=plan,
            phase=plan.phases[1],
            phase_index=1,
            logs_dir=str(logs_dir),
        )

        assert "## Previous Phase Change Notice" not in lead_pack
        assert "Change notice:" not in worker_pack


def test_build_phase_pack_injects_notice_when_delta_exists_but_summary_missing_section():
    with tempfile.TemporaryDirectory() as td:
        team_data_dir = Path(td)
        logs_dir = team_data_dir / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        (logs_dir / "workflow.md").write_text("workflow", encoding="utf-8")

        plan = _make_plan()
        plan.phases.append(_make_phase(1, task_id="task_011", desc="Next phase task"))
        store = MemoryStore(team_data_dir)
        store.init_memory(
            plan=plan,
            workspace_dir=str(team_data_dir / "workspace"),
            project_dir=str(team_data_dir / "workspace" / "project"),
            logs_dir=str(logs_dir),
        )

        store.commit_phase(
            phase_index=0,
            phase=plan.phases[0],
            plan=plan,
            plan_data=plan.to_dict(),
            lead_phase_review_text="phase review",
            logs_dir=str(logs_dir),
            memory_writer_payload={
                "phase_outcome": "partial",
                "phase_summary_md": "# Phase 0 Summary\n\n- regular summary only",
                "knowledge_items": [],
            },
            plan_basis_delta={
                "plan_changed": True,
                "phases_changed": True,
                "planning_basis_changed": True,
                "basis_changed_fields": ["default_assumptions"],
                "change_brief": "default assumptions and future phase order changed",
            },
        )

        lead_pack, _ = store.build_lead_phase_pack(
            plan=plan,
            phase=plan.phases[1],
            phase_index=1,
            logs_dir=str(logs_dir),
        )
        worker_pack, _ = store.build_worker_phase_pack(
            plan=plan,
            phase=plan.phases[1],
            phase_index=1,
            logs_dir=str(logs_dir),
        )

        assert "## Previous Phase Change Notice" in lead_pack
        assert "default_assumptions" in lead_pack
        assert "default assumptions and future phase order changed" in lead_pack
        assert "Change notice:" in worker_pack
