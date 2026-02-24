"""Memory store for Team sessions.

Simplified architecture:
- One phase summary per phase (also used as handoff)
- Flat knowledge base for retrieval
- North Star with automatic promotion from qualified knowledge candidates
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from super_agent.models import utc_now

from .models import Phase, Plan

logger = logging.getLogger(__name__)

_CJK_RE = re.compile(r"[\u4e00-\u9fff]+")
_WORD_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_./:-]{1,}")
_CORE_RULE_RE_V2 = re.compile(
    r"^- \[(?P<id>[^\]]+)\]\[(?P<importance>[0-9]+(?:\.[0-9]+)?)\]\[(?P<validation>[a-z]+)\]\[(?P<outcome>[a-z]+)\]\[p(?P<phase_index>-?[0-9]+)\] (?P<title>.*?) :: (?P<summary>.*?)(?: \(ref: (?P<ref>.*?)\))?$"
)
_CORE_RULE_RE_V1 = re.compile(
    r"^- \[(?P<id>[^\]]+)\]\[(?P<importance>[0-9]+(?:\.[0-9]+)?)\] (?P<title>.*?) :: (?P<summary>.*?)(?: \(ref: (?P<ref>.*?)\))?$"
)
_PLAN_BASIS_SECTION_RE = re.compile(
    r"^\s*##\s*plan\s*&\s*basis\s*changes\s*$",
    flags=re.IGNORECASE | re.MULTILINE,
)
_MIN_SCORE = 0.05
_MAX_KNOWLEDGE_ITEMS_PER_PHASE = 8
_NORTH_STAR_PROMOTION_THRESHOLD = 0.85
_NORTH_STAR_MAX_RULES = 12
_VALIDATION_LEVELS = {"low": 0, "medium": 1, "high": 2}
_PHASE_OUTCOME_VALUES = {"success", "partial", "fail", "uncertain"}

_DEFAULT_STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "task",
    "phase",
    "project",
    "work",
    "this",
    "that",
    "from",
    "into",
    "need",
    "must",
    "will",
    "should",
    "have",
    "has",
    "在",
    "的",
    "了",
    "和",
    "是",
    "需要",
    "任务",
    "阶段",
    "项目",
    "进行",
    "完成",
}


def _atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        dir=str(path.parent), suffix=".tmp", prefix=f".{path.name}."
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        Path(tmp_path).replace(path)
    finally:
        try:
            Path(tmp_path).unlink(missing_ok=True)
        except Exception:
            pass


def _atomic_write_json(path: Path, data: dict[str, Any]) -> None:
    _atomic_write_text(path, json.dumps(data, ensure_ascii=False, indent=2))


def _atomic_write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    text = "\n".join(json.dumps(row, ensure_ascii=False) for row in rows)
    if text:
        text += "\n"
    _atomic_write_text(path, text)


def _read_json(path: Path, default: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    if not path.exists():
        return dict(default or {})
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return dict(default or {})
    if isinstance(data, dict):
        return data
    return dict(default or {})


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    row = json.loads(stripped)
                except json.JSONDecodeError:
                    continue
                if isinstance(row, dict):
                    out.append(row)
    except OSError:
        return []
    return out


def _append_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def _estimate_tokens(text: str) -> int:
    return max(1, math.ceil(len(text) / 4))


def _truncate_tokens(text: str, token_budget: int) -> str:
    if token_budget <= 0:
        return ""
    if _estimate_tokens(text) <= token_budget:
        return text
    max_chars = token_budget * 4
    if max_chars <= 3:
        return text[:max_chars]
    return text[: max_chars - 3].rstrip() + "..."


def _to_float(value: object, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _normalize_str_list(values: object) -> list[str]:
    if not isinstance(values, list):
        return []
    out: list[str] = []
    for item in values:
        if isinstance(item, str):
            stripped = item.strip()
            if stripped:
                out.append(stripped)
    return out


def _dedupe_keep_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for v in values:
        if v in seen:
            continue
        seen.add(v)
        out.append(v)
    return out


def _keyword_sets(query: str) -> tuple[set[str], set[str]]:
    tags: set[str] = set()
    entities: set[str] = set()

    for token in _WORD_RE.findall(query or ""):
        token_l = token.lower().strip()
        if len(token_l) < 2 or token_l in _DEFAULT_STOPWORDS:
            continue
        if any(ch in token_l for ch in ("/", ".", "_", ":")):
            entities.add(token_l)
        elif any(ch.isdigit() for ch in token_l):
            entities.add(token_l)
        else:
            tags.add(token_l)

    for chunk in _CJK_RE.findall(query or ""):
        chunk = chunk.strip()
        if len(chunk) < 2:
            continue
        for n in (2, 3):
            if len(chunk) < n:
                continue
            for i in range(len(chunk) - n + 1):
                gram = chunk[i : i + n]
                if gram not in _DEFAULT_STOPWORDS:
                    tags.add(gram)

    return tags, entities


def _fingerprint(title: str, summary: str) -> str:
    base = f"{title.strip()}::{summary.strip()}"
    return "sha1:" + hashlib.sha1(base.encode("utf-8")).hexdigest()


def _phase_summary_path(phase_summaries_dir: Path, phase_index: int) -> Path:
    return phase_summaries_dir / f"phase_{phase_index:03d}.md"


def _first_heading_or_default(text: str, default: str) -> str:
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            return stripped.lstrip("#").strip() or default
    return default


def _normalize_phase_outcome(value: object, default: str = "partial") -> str:
    outcome = str(value or "").strip().lower()
    if outcome in _PHASE_OUTCOME_VALUES:
        return outcome
    return default


def _validation_rank(value: object) -> int:
    key = str(value or "").strip().lower()
    return int(_VALIDATION_LEVELS.get(key, 1))


def _outcome_weight(value: object) -> float:
    outcome = _normalize_phase_outcome(value, default="partial")
    if outcome == "success":
        return 0.05
    if outcome == "fail":
        return 0.04
    if outcome == "uncertain":
        return -0.08
    return 0.0


def _infer_validation_strength(
    *,
    refs: list[dict[str, Any]],
    phase_outcome: str,
    importance: float,
) -> str:
    ref_count = len([r for r in refs if isinstance(r, dict) and str(r.get("path", "")).strip()])
    if phase_outcome == "uncertain":
        return "low"
    if ref_count >= 2 and importance >= 0.8:
        return "high"
    if ref_count >= 1 and importance >= 0.65:
        return "medium"
    return "low"


def _extract_phase_index_from_item_id(item_id: str) -> int:
    parts = str(item_id or "").split("-")
    if len(parts) >= 2 and parts[0] in {"K", "S"}:
        try:
            return int(parts[1])
        except ValueError:
            return -1
    return -1


def _summary_has_plan_basis_section(text: str) -> bool:
    if not text:
        return False
    return bool(_PLAN_BASIS_SECTION_RE.search(text))


def _normalize_plan_basis_delta(delta: Optional[dict[str, Any]]) -> dict[str, Any]:
    raw = delta if isinstance(delta, dict) else {}
    fields = _normalize_str_list(raw.get("basis_changed_fields"))
    return {
        "plan_changed": bool(raw.get("plan_changed", False)),
        "phases_changed": bool(raw.get("phases_changed", False)),
        "planning_basis_changed": bool(raw.get("planning_basis_changed", False)),
        "basis_changed_fields": fields,
        "change_brief": str(raw.get("change_brief", "")).strip(),
        "pre_version": int(raw.get("pre_version", 0) or 0),
        "post_version": int(raw.get("post_version", 0) or 0),
    }


def _is_low_value_artifact_noise(
    *,
    title: str,
    short_summary: str,
    keywords: list[str],
    importance: float,
) -> bool:
    """Conservative denoise for artifact-like low-signal notes."""
    if importance >= 0.7:
        return False
    haystack = f"{title} {short_summary} {' '.join(keywords)}".lower()
    explicit_low_signal_phrases = (
        "no decision impact",
        "status only",
        "temporary progress",
        "scratch status",
        "无决策影响",
        "仅状态更新",
        "临时进度",
    )
    if any(phrase in haystack for phrase in explicit_low_signal_phrases):
        return True
    low_signal_markers = (
        "temp",
        "tmp",
        "scratch",
        "progress",
        "status",
        "checkpoint",
        "draft",
        "log",
        "note",
        "todo",
        "临时",
        "进度",
        "草稿",
        "日志",
        "记录",
    )
    high_signal_markers = (
        "design",
        "architecture",
        "research",
        "finding",
        "decision",
        "risk",
        "report",
        "spec",
        "runbook",
        "验证",
        "实验",
        "结论",
        "故障",
        "复现",
        "验收",
        "方案",
        "文档",
        "contract",
        "api",
    )
    has_low_signal = any(marker in haystack for marker in low_signal_markers)
    has_high_signal = any(marker in haystack for marker in high_signal_markers)
    return has_low_signal and not has_high_signal


@dataclass
class SearchItem:
    item_type: str
    item_id: str
    title: str
    summary: str
    score: float
    refs: list[dict[str, Any]]


class MemoryStore:
    """File-backed simplified memory operations for Team sessions."""

    def __init__(
        self,
        team_data_dir: Path,
        *,
        short_context_token_budget: int = 1200,
    ):
        self.team_data_dir = team_data_dir
        self.memory_dir = team_data_dir / "memory"

        self.phase_summaries_dir = self.memory_dir / "phase_summaries"
        self.knowledge_dir = self.memory_dir / "knowledge"

        # Keep property name for compatibility with orchestrator pointers.
        self.ledger_dir = self.phase_summaries_dir

        self.north_star_file = self.memory_dir / "north_star.md"
        self.north_star_history_file = self.memory_dir / "north_star_history.jsonl"
        self.snapshot_file = self.memory_dir / "snapshot.json"
        self.short_context_file = self.memory_dir / "short_context.md"

        self.phase_summary_index_file = self.phase_summaries_dir / "index.jsonl"
        self.knowledge_file = self.knowledge_dir / "knowledge.jsonl"
        self.knowledge_usage_file = self.knowledge_dir / "usage.json"

        self.short_context_token_budget = short_context_token_budget

    def ensure_layout(self) -> None:
        self.memory_dir.mkdir(parents=True, exist_ok=True)
        self.phase_summaries_dir.mkdir(parents=True, exist_ok=True)
        self.knowledge_dir.mkdir(parents=True, exist_ok=True)
        if not self.phase_summary_index_file.exists():
            self.phase_summary_index_file.touch()
        if not self.knowledge_file.exists():
            self.knowledge_file.touch()
        if not self.north_star_history_file.exists():
            self.north_star_history_file.touch()
        if not self.knowledge_usage_file.exists():
            _atomic_write_json(self.knowledge_usage_file, {})

    def init_memory(
        self,
        *,
        plan: Plan,
        workspace_dir: str,
        project_dir: str,
        logs_dir: str,
    ) -> None:
        self.ensure_layout()
        north_star = self._build_initial_north_star(plan)
        _atomic_write_text(self.north_star_file, north_star)

        snapshot = {
            "version": 1,
            "objective": plan.objective,
            "planning_basis": dict(plan.planning_basis or {}),
            "project": {
                "team_data_dir": str(self.team_data_dir),
                "workspace_dir": workspace_dir,
                "project_dir": project_dir,
                "plan_version": int(plan.version or 1),
                "current_phase_index": -1,
            },
            "state": {
                "key_decisions": [],
                "key_facts": [],
                "open_issues": [],
                "risks": [],
            },
            "pointers": {
                "logs_dir": logs_dir,
                "workflow": str(Path(logs_dir) / "workflow.md") if logs_dir else "",
                "phase_summaries_dir": str(self.phase_summaries_dir),
                "knowledge_file": str(self.knowledge_file),
            },
            "updated_at": utc_now(),
        }
        _atomic_write_json(self.snapshot_file, snapshot)
        _atomic_write_text(self.short_context_file, self._build_short_context(snapshot, ""))

    def _build_initial_north_star(self, plan: Plan) -> str:
        basis = dict(plan.planning_basis or {})
        objective = (plan.objective or "").strip() or "No objective provided."
        goal_alignment = str(basis.get("goal_alignment", "Not provided")).strip()
        deliverables = str(basis.get("deliverables_acceptance", "Not provided")).strip()
        assumptions = str(basis.get("default_assumptions", "Not provided")).strip()
        return _truncate_tokens(
            (
                "# North Star\n\n"
                "## Objective\n"
                f"- {objective}\n\n"
                "## Acceptance\n"
                f"- {deliverables}\n\n"
                "## Alignment\n"
                f"- {goal_alignment}\n\n"
                "## Default Assumptions\n"
                f"- {assumptions}\n\n"
                "## Core Rules\n"
                "- (none yet)\n\n"
                "## Retrieval Rule\n"
                "- Use phase summaries and knowledge search for details.\n"
                "- Prefer refs from logs and summaries before making decisions.\n"
            ),
            800,
        )

    def read_north_star(self) -> str:
        if not self.north_star_file.exists():
            return ""
        return self.north_star_file.read_text(encoding="utf-8")

    def read_short_context(self) -> str:
        if not self.short_context_file.exists():
            return ""
        return self.short_context_file.read_text(encoding="utf-8")

    def read_snapshot(self) -> dict[str, Any]:
        return _read_json(self.snapshot_file, default={})

    def previous_handoff(self, phase_index: int) -> str:
        if phase_index <= 0:
            return ""
        prev_file = _phase_summary_path(self.phase_summaries_dir, phase_index - 1)
        if not prev_file.exists():
            return ""
        return prev_file.read_text(encoding="utf-8")

    def _phase_summary_index_row(self, phase_index: int) -> dict[str, Any]:
        rows = _read_jsonl(self.phase_summary_index_file)
        for row in rows:
            if not isinstance(row, dict):
                continue
            try:
                idx = int(row.get("phase_index", -1))
            except (TypeError, ValueError):
                continue
            if idx == phase_index:
                return row
        return {}

    def _build_previous_phase_change_notice(self, phase_index: int) -> str:
        prev_idx = phase_index - 1
        if prev_idx < 0:
            return ""
        row = self._phase_summary_index_row(prev_idx)
        if not row:
            return ""

        planning_basis_changed = bool(row.get("planning_basis_changed", False))
        phases_changed = bool(row.get("phases_changed", False))
        if not (planning_basis_changed or phases_changed):
            return ""

        if bool(row.get("summary_has_plan_basis_section", False)):
            return ""

        change_brief = str(row.get("change_brief", "")).strip()
        basis_fields = _normalize_str_list(row.get("basis_changed_fields"))

        lines = ["## Previous Phase Change Notice"]
        if planning_basis_changed:
            if basis_fields:
                lines.append(
                    "- Planning basis changed fields: " + ", ".join(basis_fields[:3])
                )
            else:
                lines.append("- Planning basis changed in previous phase.")
        if phases_changed:
            lines.append("- Remaining phases were updated in previous phase.")
        if change_brief:
            lines.append(f"- Brief: {change_brief}")
        return "\n".join(lines) + "\n\n"

    def _build_previous_phase_change_notice_line(self, phase_index: int) -> str:
        prev_idx = phase_index - 1
        if prev_idx < 0:
            return ""
        row = self._phase_summary_index_row(prev_idx)
        if not row:
            return ""
        planning_basis_changed = bool(row.get("planning_basis_changed", False))
        phases_changed = bool(row.get("phases_changed", False))
        if not (planning_basis_changed or phases_changed):
            return ""
        if bool(row.get("summary_has_plan_basis_section", False)):
            return ""
        change_brief = str(row.get("change_brief", "")).strip()
        if change_brief:
            return _truncate_tokens(
                f"Previous phase plan/basis changed: {change_brief}", 80
            )
        if planning_basis_changed and phases_changed:
            return "Previous phase updated both planning basis and remaining phases."
        if planning_basis_changed:
            return "Previous phase updated planning basis."
        return "Previous phase updated remaining phases."

    def build_lead_phase_pack(
        self,
        *,
        plan: Plan,
        phase: Phase,
        phase_index: int,
        logs_dir: str,
    ) -> tuple[str, list[str]]:
        snapshot = self.read_snapshot()
        query = " ".join(
            [
                phase.description,
                " ".join(task.description for task in phase.tasks),
                " ".join(_normalize_str_list(snapshot.get("state", {}).get("open_issues", []))[:5]),
            ]
        )
        retrieval = self.search(query=query, top_k=16, current_phase_index=phase_index)
        summary_items = [i for i in retrieval if i["item_type"] == "phase_summary"][:2]
        knowledge_items = [i for i in retrieval if i["item_type"] == "knowledge"][:8]
        used_ids = [i["item_id"] for i in summary_items + knowledge_items]

        phase_tasks = "\n".join(f"- [{t.task_id}] {t.description}" for t in phase.tasks)
        remaining = "\n".join(
            f"- Phase {p.phase_index}: {p.description}" for p in plan.phases[phase_index + 1 :]
        ) or "- (none)"

        retrieval_lines: list[str] = []
        if summary_items:
            retrieval_lines.append("### Relevant Phase Summaries")
            for item in summary_items:
                retrieval_lines.append(f"- [{item['item_id']}] {item['title']}: {item['summary']}")
        if knowledge_items:
            retrieval_lines.append("### Relevant Knowledge")
            for item in knowledge_items:
                refs = ", ".join(
                    str(r.get("path", ""))
                    for r in item.get("refs", [])[:2]
                    if isinstance(r, dict)
                )
                suffix = f" (refs: {refs})" if refs else ""
                retrieval_lines.append(f"- [{item['item_id']}] {item['summary']}{suffix}")

        previous_summary = _truncate_tokens(self.previous_handoff(phase_index).strip(), 600)
        previous_change_notice = self._build_previous_phase_change_notice(phase_index)
        text = (
            "## Mission Block\n"
            f"- Objective: {plan.objective}\n"
            f"- Planning basis: {json.dumps(plan.planning_basis or {}, ensure_ascii=False)}\n\n"
            "## Plan Slice\n"
            f"- Current phase: {phase.phase_index} {phase.description}\n"
            "### Current tasks\n"
            f"{phase_tasks}\n"
            "### Remaining phases\n"
            f"{remaining}\n\n"
            "## Memory Block\n"
            f"{self.read_north_star().strip()}\n\n"
        )
        if previous_change_notice:
            text += previous_change_notice
        if previous_summary:
            text += "## Previous Phase Summary\n" + previous_summary + "\n\n"
        if retrieval_lines:
            text += "## Dynamic Relevant Memory\n" + "\n".join(retrieval_lines) + "\n\n"
        text += (
            "## Memory Read Path (Quick Pass)\n"
            "- If task is simple and has no historical dependency, skip deep retrieval.\n"
            "- If task is ambiguous/high-risk/constraint-sensitive, run quick pass:\n"
            "  1) Read previous phase summary and north star\n"
            "  2) Search top knowledge by task keywords/entities\n"
            "  3) If conflict or low confidence, read refs files before deciding\n\n"
            "## Pointers Block\n"
            f"- Logs: {logs_dir}\n"
            f"- Workflow: {str(Path(logs_dir) / 'workflow.md') if logs_dir else ''}\n"
            f"- Phase summaries: {self.phase_summaries_dir}\n"
            f"- Knowledge: {self.knowledge_file}\n"
        )
        return _truncate_tokens(text, 2200), used_ids

    def build_worker_phase_pack(
        self,
        *,
        plan: Plan,
        phase: Phase,
        phase_index: int,
        logs_dir: str,
    ) -> tuple[str, list[str]]:
        query = " ".join([phase.description, " ".join(task.description for task in phase.tasks)])
        retrieval = self.search(query=query, top_k=10, current_phase_index=phase_index)
        summary_items = [i for i in retrieval if i["item_type"] == "phase_summary"][:1]
        knowledge_items = [i for i in retrieval if i["item_type"] == "knowledge"][:4]
        used_ids = [i["item_id"] for i in summary_items + knowledge_items]

        lines = [
            "## Memory Pack (Relevant, budgeted)",
            f"- Objective: {plan.objective}",
            "### Planning Basis",
            json.dumps(plan.planning_basis or {}, ensure_ascii=False),
            "### North Star",
            _truncate_tokens(self.read_north_star().strip(), 280),
        ]
        previous_change_notice_line = self._build_previous_phase_change_notice_line(phase_index)
        if previous_change_notice_line:
            lines.append(f"- Change notice: {previous_change_notice_line}")
        if summary_items:
            lines.append("### Previous Phase Summary")
            lines.append(f"- {summary_items[0]['summary']}")
        lines.append("### Relevant Knowledge")
        for item in knowledge_items:
            lines.append(f"- [{item['item_id']}] {item['summary']}")
        lines.extend(
            [
                "### Pointers",
                f"- Logs dir: {logs_dir}",
                f"- Workflow: {str(Path(logs_dir) / 'workflow.md') if logs_dir else ''}",
                f"- Phase summaries: {self.phase_summaries_dir}",
                f"- Knowledge file: {self.knowledge_file}",
            ]
        )
        return _truncate_tokens("\n".join(lines), 1300), used_ids

    def search(
        self,
        *,
        query: str,
        top_k: int = 10,
        filters: Optional[dict[str, list[str]]] = None,
        current_phase_index: Optional[int] = None,
    ) -> list[dict[str, Any]]:
        self.ensure_layout()
        filters = filters or {}
        type_filter = set(_normalize_str_list(filters.get("types")))
        tag_filter = set(s.lower() for s in _normalize_str_list(filters.get("tags")))
        entity_filter = set(s.lower() for s in _normalize_str_list(filters.get("entities")))

        query_tags, query_entities = _keyword_sets(query)
        knowledge_rows = _read_jsonl(self.knowledge_file)
        summary_rows = _read_jsonl(self.phase_summary_index_file)
        usage = _read_json(self.knowledge_usage_file, default={})

        results: list[SearchItem] = []

        for row in knowledge_rows:
            if not isinstance(row, dict):
                continue
            if type_filter and "knowledge" not in type_filter and "atom" not in type_filter:
                continue
            item_keywords = {k.lower() for k in _normalize_str_list(row.get("keywords"))}
            item_entities = {e.lower() for e in _normalize_str_list(row.get("entities"))}
            if tag_filter and not item_keywords.intersection(tag_filter):
                continue
            if entity_filter and item_entities and not item_entities.intersection(entity_filter):
                continue

            entity_hits = len(query_entities.intersection(item_entities))
            tag_hits = len(query_tags.intersection(item_keywords))
            entity_recall = entity_hits / max(1, len(query_entities))
            tag_recall = tag_hits / max(1, len(query_tags))
            relevance = 0.7 * entity_recall + 0.3 * tag_recall

            importance = _to_float(row.get("importance"), 0.6)
            validation_strength = str(row.get("validation_strength", "medium")).strip().lower()
            validation_boost = {  # small, deterministic boost
                "high": 0.04,
                "medium": 0.0,
                "low": -0.02,
            }.get(validation_strength, 0.0)
            recency = 0.5
            if current_phase_index is not None:
                created_phase = int(row.get("phase_index", 0))
                item_id = str(row.get("id", ""))
                u = usage.get(item_id, {}) if item_id else {}
                last_used = int(u.get("last_used_phase", created_phase))
                age = max(0, int(current_phase_index) - max(created_phase, last_used))
                recency = pow(0.8, age)

            score = 0.5 * relevance + 0.3 * importance + 0.2 * recency
            score += validation_boost
            score += _outcome_weight(row.get("phase_outcome"))
            if score < _MIN_SCORE:
                continue
            refs = row.get("refs", []) if isinstance(row.get("refs"), list) else []
            results.append(
                SearchItem(
                    item_type="knowledge",
                    item_id=str(row.get("id", "")),
                    title=str(row.get("title", "")),
                    summary=str(row.get("short_summary", row.get("title", ""))),
                    score=score,
                    refs=refs,
                )
            )

        for row in summary_rows:
            if not isinstance(row, dict):
                continue
            if type_filter and "phase_summary" not in type_filter and "summary" not in type_filter:
                continue
            item_keywords = {k.lower() for k in _normalize_str_list(row.get("keywords"))}
            entity_hits = 0
            tag_hits = len(query_tags.intersection(item_keywords))
            entity_recall = entity_hits / max(1, len(query_entities))
            tag_recall = tag_hits / max(1, len(query_tags))
            relevance = 0.7 * entity_recall + 0.3 * tag_recall

            importance = _to_float(row.get("importance"), 0.65)
            validation_strength = str(row.get("validation_strength", "medium")).strip().lower()
            validation_boost = {
                "high": 0.03,
                "medium": 0.0,
                "low": -0.01,
            }.get(validation_strength, 0.0)
            recency = 0.5
            if current_phase_index is not None:
                phase_idx = int(row.get("phase_index", 0))
                item_id = str(row.get("id", ""))
                u = usage.get(item_id, {}) if item_id else {}
                last_used = int(u.get("last_used_phase", phase_idx))
                age = max(0, int(current_phase_index) - max(phase_idx, last_used))
                recency = pow(0.8, age)

            score = 0.5 * relevance + 0.3 * importance + 0.2 * recency
            score += validation_boost
            score += _outcome_weight(row.get("phase_outcome"))
            if score < _MIN_SCORE:
                continue
            ref_path = str(row.get("path", ""))
            refs = [{"type": "file", "path": ref_path}] if ref_path else []
            results.append(
                SearchItem(
                    item_type="phase_summary",
                    item_id=str(row.get("id", "")),
                    title=str(row.get("title", "")),
                    summary=str(row.get("short_summary", "")),
                    score=score,
                    refs=refs,
                )
            )

        results.sort(key=lambda x: x.score, reverse=True)
        out: list[dict[str, Any]] = []
        for item in results[: max(1, int(top_k))]:
            out.append(
                {
                    "item_type": item.item_type,
                    "item_id": item.item_id,
                    "title": item.title,
                    "summary": item.summary,
                    "score": round(item.score, 4),
                    "refs": item.refs,
                }
            )
        return out

    def mark_used(self, item_ids: list[str], phase_index: int) -> None:
        self.ensure_layout()
        usage = _read_json(self.knowledge_usage_file, default={})
        now = utc_now()
        for item_id in item_ids:
            iid = str(item_id or "").strip()
            if not iid:
                continue
            row = usage.get(iid, {})
            row["last_used_phase"] = int(phase_index)
            row["last_used_at"] = now
            row["use_count"] = int(row.get("use_count", 0)) + 1
            usage[iid] = row
        _atomic_write_json(self.knowledge_usage_file, usage)

    def commit_phase(
        self,
        *,
        phase_index: int,
        phase: Phase,
        plan: Plan,
        plan_data: dict[str, Any],
        lead_phase_review_text: str,
        logs_dir: str,
        memory_writer_payload: Optional[dict[str, Any]] = None,
        plan_basis_delta: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        self.ensure_layout()
        payload = memory_writer_payload if isinstance(memory_writer_payload, dict) else {}
        normalized_delta = _normalize_plan_basis_delta(plan_basis_delta)

        submissions = self._collect_phase_submissions(
            phase_index=phase_index, phase=phase, logs_dir=logs_dir
        )

        phase_outcome = _normalize_phase_outcome(payload.get("phase_outcome"), default="partial")
        phase_summary = str(payload.get("phase_summary_md", "")).strip()
        if not phase_summary:
            # backward compatibility
            phase_summary = str(payload.get("handoff_md", "")).strip()
        next_focus = _normalize_str_list(payload.get("next_phase_focus"))
        if not phase_summary:
            phase_summary = self._build_default_phase_summary(
                phase_index=phase_index,
                phase=phase,
                submissions=submissions,
                phase_review_text=lead_phase_review_text,
                next_phase_focus=next_focus,
            )
        phase_summary = _truncate_tokens(phase_summary, 900)

        summary_file = _phase_summary_path(self.phase_summaries_dir, phase_index)
        _atomic_write_text(summary_file, phase_summary)
        summary_has_plan_basis_section = _summary_has_plan_basis_section(phase_summary)

        normalized_knowledge = self._normalize_knowledge_items(
            payload=payload,
            phase_index=phase_index,
            phase_outcome=phase_outcome,
            summary_path=summary_file,
            fallback_summary=phase_summary,
        )
        knowledge_rows = self._append_knowledge_items(phase_index=phase_index, rows=normalized_knowledge)

        summary_id = f"S-{phase_index:03d}"
        summary_validation_strength = self._derive_summary_validation_strength(
            knowledge_rows=knowledge_rows,
            phase_outcome=phase_outcome,
        )
        self._upsert_phase_summary_index(
            summary_id=summary_id,
            phase_index=phase_index,
            phase=phase,
            summary_text=phase_summary,
            summary_path=summary_file,
            phase_outcome=phase_outcome,
            validation_strength=summary_validation_strength,
            plan_basis_delta=normalized_delta,
            summary_has_plan_basis_section=summary_has_plan_basis_section,
        )

        snapshot = self.read_snapshot()
        snapshot = self._merge_snapshot(
            snapshot=snapshot,
            plan=plan,
            plan_data=plan_data,
            phase_index=phase_index,
            phase_outcome=phase_outcome,
            logs_dir=logs_dir,
            phase_summary=phase_summary,
            next_phase_focus=next_focus,
            knowledge_rows=knowledge_rows,
        )
        _atomic_write_json(self.snapshot_file, snapshot)
        short_context = self._build_short_context(snapshot, previous_phase_summary=phase_summary)
        _atomic_write_text(self.short_context_file, short_context)

        promoted_ids = self._promote_north_star(plan=plan, promoted_candidates=knowledge_rows)

        return {
            "phase_index": phase_index,
            "summary_file": str(summary_file),
            "phase_summary_file": str(summary_file),
            "phase_outcome": phase_outcome,
            "plan_changed": bool(normalized_delta.get("plan_changed", False)),
            "phases_changed": bool(normalized_delta.get("phases_changed", False)),
            "planning_basis_changed": bool(
                normalized_delta.get("planning_basis_changed", False)
            ),
            "basis_changed_fields": _normalize_str_list(
                normalized_delta.get("basis_changed_fields")
            ),
            "change_brief": str(normalized_delta.get("change_brief", "")).strip(),
            "summary_has_plan_basis_section": bool(summary_has_plan_basis_section),
            "knowledge_item_ids": [str(row.get("id", "")) for row in knowledge_rows],
            "knowledge_items_added": len(knowledge_rows),
            "promoted_north_star_ids": promoted_ids,
        }

    def _collect_phase_submissions(
        self,
        *,
        phase_index: int,
        phase: Phase,
        logs_dir: str,
    ) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        logs_path = Path(logs_dir)
        for task in phase.tasks:
            summary = ""
            pattern = f"phase{phase_index}_{task.task_id}_worker-{task.task_id}_submit*_final.md"
            matches = sorted(logs_path.glob(pattern)) if logs_path.exists() else []
            if matches:
                try:
                    summary = _truncate_tokens(matches[-1].read_text(encoding="utf-8"), 180)
                except OSError:
                    summary = ""
            if not summary:
                if task.result and task.result.summary:
                    summary = _truncate_tokens(task.result.summary, 180)
                elif task.result_text:
                    summary = _truncate_tokens(task.result_text, 180)
                elif task.result_error:
                    summary = f"Task failed: {task.result_error}"
            out.append((task.task_id, summary))
        return out

    def _build_default_phase_summary(
        self,
        *,
        phase_index: int,
        phase: Phase,
        submissions: list[tuple[str, str]],
        phase_review_text: str,
        next_phase_focus: list[str],
    ) -> str:
        achievements = "\n".join(
            f"- [{task_id}] {summary}" for task_id, summary in submissions if summary
        ) or "- (none)"
        focus_lines = "\n".join(f"- {item}" for item in next_phase_focus) or "- Continue with next phase tasks."
        return (
            f"# Phase {phase_index} Summary\n\n"
            "## Achievements\n"
            f"{achievements}\n\n"
            "## Phase Review Notes\n"
            f"{_truncate_tokens(phase_review_text or '', 280)}\n\n"
            "## Next Phase Focus\n"
            f"{focus_lines}\n"
        )

    def _upsert_phase_summary_index(
        self,
        *,
        summary_id: str,
        phase_index: int,
        phase: Phase,
        summary_text: str,
        summary_path: Path,
        phase_outcome: str,
        validation_strength: str,
        plan_basis_delta: Optional[dict[str, Any]] = None,
        summary_has_plan_basis_section: bool = False,
    ) -> None:
        normalized_delta = _normalize_plan_basis_delta(plan_basis_delta)
        rows = _read_jsonl(self.phase_summary_index_file)
        remaining = [
            row
            for row in rows
            if not (isinstance(row, dict) and int(row.get("phase_index", -1)) == phase_index)
        ]
        tags, entities = _keyword_sets(f"{phase.description}\n{summary_text}")
        short_summary = _truncate_tokens(summary_text, 160)
        entry = {
            "id": summary_id,
            "phase_index": phase_index,
            "title": _first_heading_or_default(summary_text, f"Phase {phase_index} Summary"),
            "keywords": sorted(_dedupe_keep_order(list(tags | entities)))[:24],
            "short_summary": short_summary,
            "path": str(summary_path),
            "importance": 0.65,
            "phase_outcome": _normalize_phase_outcome(phase_outcome, default="partial"),
            "validation_strength": (
                validation_strength
                if str(validation_strength).lower() in _VALIDATION_LEVELS
                else "medium"
            ),
            "plan_changed": bool(normalized_delta.get("plan_changed", False)),
            "phases_changed": bool(normalized_delta.get("phases_changed", False)),
            "planning_basis_changed": bool(
                normalized_delta.get("planning_basis_changed", False)
            ),
            "basis_changed_fields": _normalize_str_list(
                normalized_delta.get("basis_changed_fields")
            ),
            "change_brief": str(normalized_delta.get("change_brief", "")).strip(),
            "summary_has_plan_basis_section": bool(summary_has_plan_basis_section),
            "updated_at": utc_now(),
        }
        remaining.append(entry)
        remaining.sort(key=lambda r: int(r.get("phase_index", 0)))
        _atomic_write_jsonl(self.phase_summary_index_file, remaining)

    def _derive_summary_validation_strength(
        self,
        *,
        knowledge_rows: list[dict[str, Any]],
        phase_outcome: str,
    ) -> str:
        if not knowledge_rows:
            return "low" if phase_outcome in {"uncertain", "fail"} else "medium"
        rank = max(_validation_rank(row.get("validation_strength")) for row in knowledge_rows)
        if rank >= _validation_rank("high"):
            return "high"
        if rank >= _validation_rank("medium"):
            return "medium"
        return "low"

    def _normalize_knowledge_items(
        self,
        *,
        payload: dict[str, Any],
        phase_index: int,
        phase_outcome: str,
        summary_path: Path,
        fallback_summary: str,
    ) -> list[dict[str, Any]]:
        raw_items = payload.get("knowledge_items")
        if not isinstance(raw_items, list):
            raw_items = []

        # backward compatibility for older payloads
        if not raw_items:
            atoms = payload.get("atoms")
            if isinstance(atoms, list):
                for atom in atoms:
                    if not isinstance(atom, dict):
                        continue
                    raw_items.append(
                        {
                            "title": atom.get("title", ""),
                            "keywords": atom.get("tags", []),
                            "short_summary": atom.get("summary", ""),
                            "full_content": atom.get("summary", ""),
                            "north_star_candidate": False,
                            "importance": atom.get("importance", 0.6),
                            "refs": atom.get("refs", []),
                        }
                    )

        normalized: list[dict[str, Any]] = []
        for raw in raw_items[:_MAX_KNOWLEDGE_ITEMS_PER_PHASE]:
            if not isinstance(raw, dict):
                continue
            title = str(raw.get("title", "")).strip()
            short_summary = str(raw.get("short_summary", "")).strip()
            full_content = str(raw.get("full_content", "")).strip()
            if not title:
                continue
            if not short_summary and full_content:
                short_summary = _truncate_tokens(full_content, 120)
            if not full_content and short_summary:
                full_content = short_summary
            if not short_summary or not full_content:
                continue

            keywords = _normalize_str_list(raw.get("keywords"))
            if not keywords:
                tags, entities = _keyword_sets(f"{title} {short_summary}")
                keywords = sorted(_dedupe_keep_order(list(tags | entities)))[:16]

            refs = raw.get("refs", [])
            if not isinstance(refs, list) or not refs:
                refs = [{"type": "file", "path": str(summary_path)}]
            normalized_refs: list[dict[str, str]] = []
            for ref in refs:
                if not isinstance(ref, dict):
                    continue
                ref_type = str(ref.get("type", "file")).strip() or "file"
                ref_path = str(ref.get("path", "")).strip()
                if not ref_path:
                    continue
                normalized_refs.append({"type": ref_type, "path": ref_path})
            if not normalized_refs:
                normalized_refs = [{"type": "file", "path": str(summary_path)}]

            importance = max(0.0, min(1.0, _to_float(raw.get("importance"), 0.6)))
            if importance < 0.55:
                continue
            if _is_low_value_artifact_noise(
                title=title,
                short_summary=short_summary,
                keywords=keywords,
                importance=importance,
            ):
                continue

            item_outcome = _normalize_phase_outcome(raw.get("phase_outcome"), default=phase_outcome)
            validation_strength = str(raw.get("validation_strength", "")).strip().lower()
            if validation_strength not in _VALIDATION_LEVELS:
                validation_strength = _infer_validation_strength(
                    refs=normalized_refs,
                    phase_outcome=item_outcome,
                    importance=importance,
                )

            normalized.append(
                {
                    "phase_index": phase_index,
                    "phase_outcome": item_outcome,
                    "validation_strength": validation_strength,
                    "title": title,
                    "keywords": keywords,
                    "short_summary": short_summary,
                    "full_content": full_content,
                    "north_star_candidate": bool(raw.get("north_star_candidate", False)),
                    "importance": importance,
                    "refs": normalized_refs,
                    "fingerprint": _fingerprint(title, short_summary + "\n" + full_content),
                    "created_at": utc_now(),
                    "source_phase_summary": str(summary_path),
                }
            )

        if not normalized:
            normalized.append(
                {
                    "phase_index": phase_index,
                    "phase_outcome": _normalize_phase_outcome(phase_outcome, default="partial"),
                    "validation_strength": "low",
                    "title": f"Phase {phase_index} Summary Anchor",
                    "keywords": sorted(_keyword_sets(fallback_summary)[0])[:12],
                    "short_summary": _truncate_tokens(fallback_summary, 120),
                    "full_content": _truncate_tokens(fallback_summary, 400),
                    "north_star_candidate": False,
                    "importance": 0.6,
                    "refs": [{"type": "file", "path": str(summary_path)}],
                    "fingerprint": _fingerprint(
                        f"Phase {phase_index} Summary Anchor",
                        _truncate_tokens(fallback_summary, 200),
                    ),
                    "created_at": utc_now(),
                    "source_phase_summary": str(summary_path),
                }
            )

        return normalized

    def _append_knowledge_items(
        self,
        *,
        phase_index: int,
        rows: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        existing = _read_jsonl(self.knowledge_file)
        existing_fps = {str(row.get("fingerprint", "")) for row in existing}
        existing_ids = {str(row.get("id", "")) for row in existing}

        appended: list[dict[str, Any]] = []
        seq = 1
        for row in rows:
            fp = str(row.get("fingerprint", ""))
            if not fp or fp in existing_fps:
                continue
            while True:
                kid = f"K-{phase_index:03d}-{seq:03d}"
                seq += 1
                if kid not in existing_ids:
                    break
            row = dict(row)
            row["id"] = kid
            appended.append(row)
            existing_fps.add(fp)
            existing_ids.add(kid)

        _append_jsonl(self.knowledge_file, appended)
        return appended

    def _merge_snapshot(
        self,
        *,
        snapshot: dict[str, Any],
        plan: Plan,
        plan_data: dict[str, Any],
        phase_index: int,
        phase_outcome: str,
        logs_dir: str,
        phase_summary: str,
        next_phase_focus: list[str],
        knowledge_rows: list[dict[str, Any]],
    ) -> dict[str, Any]:
        if not snapshot:
            snapshot = {
                "version": 1,
                "objective": plan.objective,
                "planning_basis": dict(plan.planning_basis or {}),
                "project": {},
                "state": {},
                "pointers": {},
            }

        snapshot["version"] = int(snapshot.get("version", 1))
        snapshot["objective"] = plan.objective
        snapshot["planning_basis"] = dict(plan.planning_basis or {})

        project = snapshot.get("project")
        if not isinstance(project, dict):
            project = {}
        project["team_data_dir"] = str(self.team_data_dir)
        project["plan_version"] = int(plan_data.get("version", plan.version or 1))
        project["current_phase_index"] = int(phase_index)
        snapshot["project"] = project

        state = snapshot.get("state")
        if not isinstance(state, dict):
            state = {}

        key_decisions = _normalize_str_list(state.get("key_decisions"))
        key_facts = _normalize_str_list(state.get("key_facts"))
        open_issues = _normalize_str_list(state.get("open_issues"))
        risks = _normalize_str_list(state.get("risks"))

        for row in knowledge_rows:
            summary = str(row.get("short_summary", "")).strip()
            if summary:
                key_facts.append(summary)
            if bool(row.get("north_star_candidate", False)) and summary:
                key_decisions.append(summary)
            title_l = str(row.get("title", "")).lower()
            kws = {k.lower() for k in _normalize_str_list(row.get("keywords"))}
            if "risk" in title_l or "风险" in title_l or "risk" in kws or "风险" in kws:
                if summary:
                    risks.append(summary)

        open_issues.extend(next_phase_focus)

        state["key_decisions"] = _dedupe_keep_order(key_decisions)[-80:]
        state["key_facts"] = _dedupe_keep_order(key_facts)[-120:]
        state["open_issues"] = _dedupe_keep_order(open_issues)[-80:]
        state["risks"] = _dedupe_keep_order(risks)[-80:]
        state["last_phase_summary"] = _truncate_tokens(phase_summary, 300)
        state["last_phase_outcome"] = _normalize_phase_outcome(phase_outcome, default="partial")
        snapshot["state"] = state

        pointers = snapshot.get("pointers")
        if not isinstance(pointers, dict):
            pointers = {}
        pointers["logs_dir"] = logs_dir
        pointers["workflow"] = str(Path(logs_dir) / "workflow.md")
        pointers["phase_summaries_dir"] = str(self.phase_summaries_dir)
        pointers["knowledge_file"] = str(self.knowledge_file)
        snapshot["pointers"] = pointers

        snapshot["updated_at"] = utc_now()
        return snapshot

    def _build_short_context(self, snapshot: dict[str, Any], previous_phase_summary: str) -> str:
        state = snapshot.get("state", {})
        if not isinstance(state, dict):
            state = {}

        pieces = [
            "# Short Context",
            f"- Objective: {snapshot.get('objective', '')}",
            "## Key Decisions",
        ]
        for item in _normalize_str_list(state.get("key_decisions"))[-8:]:
            pieces.append(f"- {item}")

        pieces.append("## Key Facts")
        for item in _normalize_str_list(state.get("key_facts"))[-10:]:
            pieces.append(f"- {item}")

        pieces.append("## Open Issues")
        for item in _normalize_str_list(state.get("open_issues"))[-8:]:
            pieces.append(f"- {item}")

        pieces.append("## Risks")
        for item in _normalize_str_list(state.get("risks"))[-8:]:
            pieces.append(f"- {item}")

        if previous_phase_summary:
            pieces.append("## Last Phase Summary")
            pieces.append(_truncate_tokens(previous_phase_summary, 300))

        return _truncate_tokens("\n".join(pieces), self.short_context_token_budget)

    def _promote_north_star(
        self,
        *,
        plan: Plan,
        promoted_candidates: list[dict[str, Any]],
    ) -> list[str]:
        current_entries = self._parse_north_star_entries(self.read_north_star())
        by_theme: dict[str, dict[str, Any]] = {}
        for entry in current_entries:
            by_theme[str(entry.get("theme", ""))] = entry

        history_rows: list[dict[str, Any]] = []
        promoted_ids: list[str] = []

        for row in promoted_candidates:
            if not bool(row.get("north_star_candidate", False)):
                continue
            importance = _to_float(row.get("importance"), 0.0)
            refs = row.get("refs", []) if isinstance(row.get("refs"), list) else []
            phase_outcome = _normalize_phase_outcome(row.get("phase_outcome"), default="partial")
            validation_strength = str(row.get("validation_strength", "medium")).strip().lower()
            if validation_strength not in _VALIDATION_LEVELS:
                validation_strength = "medium"
            if (
                importance < _NORTH_STAR_PROMOTION_THRESHOLD
                or not refs
                or phase_outcome == "uncertain"
            ):
                continue

            item_id = str(row.get("id", "")).strip()
            title = str(row.get("title", "")).strip()
            summary = str(row.get("short_summary", "")).strip()
            if not item_id or not title or not summary:
                continue

            keywords = _normalize_str_list(row.get("keywords"))
            theme_source = title or (keywords[0] if keywords else summary)
            theme = theme_source.lower()[:64]
            ref_path = ""
            for ref in refs:
                if isinstance(ref, dict):
                    ref_path = str(ref.get("path", "")).strip()
                    if ref_path:
                        break
            candidate = {
                "id": item_id,
                "importance": importance,
                "title": title,
                "summary": summary,
                "ref": ref_path,
                "theme": theme,
                "validation_strength": validation_strength,
                "phase_outcome": phase_outcome,
                "phase_index": int(row.get("phase_index", _extract_phase_index_from_item_id(item_id))),
            }

            previous = by_theme.get(theme)
            if previous:
                prev_rank = (
                    _validation_rank(previous.get("validation_strength")),
                    _to_float(previous.get("importance"), 0.0),
                    int(previous.get("phase_index", _extract_phase_index_from_item_id(str(previous.get("id", ""))))),
                )
                cand_rank = (
                    _validation_rank(candidate.get("validation_strength")),
                    _to_float(candidate.get("importance"), 0.0),
                    int(candidate.get("phase_index", _extract_phase_index_from_item_id(item_id))),
                )
                if cand_rank <= prev_rank:
                    continue
                reason = (
                    f"validation_strength {candidate.get('validation_strength')} > {previous.get('validation_strength')}"
                    if cand_rank[0] != prev_rank[0]
                    else (
                        f"importance {_to_float(candidate.get('importance'), 0.0):.2f} > "
                        f"{_to_float(previous.get('importance'), 0.0):.2f}"
                        if cand_rank[1] != prev_rank[1]
                        else (
                            f"recency phase {candidate.get('phase_index')} > {previous.get('phase_index')}"
                        )
                    )
                )
            else:
                reason = "new_theme"
            if previous:
                history_rows.append(
                    {
                        "timestamp": utc_now(),
                        "action": "replaced",
                        "reason": reason,
                        "old": previous,
                        "new": candidate,
                    }
                )
            by_theme[theme] = candidate
            promoted_ids.append(item_id)

        entries = sorted(
            by_theme.values(),
            key=lambda x: (
                _validation_rank(x.get("validation_strength")),
                _to_float(x.get("importance"), 0.0),
                int(x.get("phase_index", _extract_phase_index_from_item_id(str(x.get("id", ""))))),
            ),
            reverse=True,
        )
        if len(entries) > _NORTH_STAR_MAX_RULES:
            trimmed = entries[_NORTH_STAR_MAX_RULES:]
            entries = entries[:_NORTH_STAR_MAX_RULES]
            for old in trimmed:
                history_rows.append(
                    {
                        "timestamp": utc_now(),
                        "action": "trimmed",
                        "reason": "capacity_limit",
                        "old": old,
                    }
                )

        _atomic_write_text(self.north_star_file, self._render_north_star(plan=plan, entries=entries))
        if history_rows:
            _append_jsonl(self.north_star_history_file, history_rows)
        return promoted_ids

    def _parse_north_star_entries(self, text: str) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        in_core_rules = False
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("## "):
                in_core_rules = stripped.lower() == "## core rules"
                continue
            if not in_core_rules or not stripped.startswith("- "):
                continue
            match_v2 = _CORE_RULE_RE_V2.match(stripped)
            if match_v2:
                entry = {
                    "id": match_v2.group("id"),
                    "importance": _to_float(match_v2.group("importance"), 0.0),
                    "validation_strength": str(match_v2.group("validation") or "medium").strip().lower(),
                    "phase_outcome": _normalize_phase_outcome(match_v2.group("outcome"), default="partial"),
                    "phase_index": int(match_v2.group("phase_index")),
                    "title": (match_v2.group("title") or "").strip(),
                    "summary": (match_v2.group("summary") or "").strip(),
                    "ref": (match_v2.group("ref") or "").strip(),
                }
            else:
                match_v1 = _CORE_RULE_RE_V1.match(stripped)
                if not match_v1:
                    continue
                entry = {
                    "id": match_v1.group("id"),
                    "importance": _to_float(match_v1.group("importance"), 0.0),
                    "validation_strength": "medium",
                    "phase_outcome": "partial",
                    "phase_index": _extract_phase_index_from_item_id(match_v1.group("id")),
                    "title": (match_v1.group("title") or "").strip(),
                    "summary": (match_v1.group("summary") or "").strip(),
                    "ref": (match_v1.group("ref") or "").strip(),
                }
            if str(entry.get("validation_strength", "")).lower() not in _VALIDATION_LEVELS:
                entry["validation_strength"] = "medium"
            theme_src = entry["title"] or entry["summary"]
            entry["theme"] = theme_src.lower()[:64]
            entries.append(entry)
        return entries

    def _render_north_star(self, *, plan: Plan, entries: list[dict[str, Any]]) -> str:
        basis = dict(plan.planning_basis or {})
        objective = (plan.objective or "").strip() or "No objective provided."
        goal_alignment = str(basis.get("goal_alignment", "Not provided")).strip()
        deliverables = str(basis.get("deliverables_acceptance", "Not provided")).strip()
        assumptions = str(basis.get("default_assumptions", "Not provided")).strip()

        lines = [
            "# North Star",
            "",
            "## Objective",
            f"- {objective}",
            "",
            "## Acceptance",
            f"- {deliverables}",
            "",
            "## Alignment",
            f"- {goal_alignment}",
            "",
            "## Default Assumptions",
            f"- {assumptions}",
            "",
            "## Core Rules",
        ]

        if not entries:
            lines.append("- (none yet)")
        else:
            for entry in entries:
                ref_suffix = f" (ref: {entry.get('ref', '')})" if entry.get("ref") else ""
                validation_strength = str(entry.get("validation_strength", "medium")).strip().lower()
                if validation_strength not in _VALIDATION_LEVELS:
                    validation_strength = "medium"
                phase_outcome = _normalize_phase_outcome(entry.get("phase_outcome"), default="partial")
                phase_index = int(
                    entry.get(
                        "phase_index",
                        _extract_phase_index_from_item_id(str(entry.get("id", ""))),
                    )
                )
                lines.append(
                    f"- [{entry.get('id', '')}]"
                    f"[{_to_float(entry.get('importance'), 0.0):.2f}]"
                    f"[{validation_strength}]"
                    f"[{phase_outcome}]"
                    f"[p{phase_index}] "
                    f"{entry.get('title', '')} :: {entry.get('summary', '')}{ref_suffix}"
                )

        lines.extend(
            [
                "",
                "## Retrieval Rule",
                "- Use phase summaries and knowledge search for details.",
                "- Prefer refs from logs and summaries before making decisions.",
                "",
            ]
        )
        return _truncate_tokens("\n".join(lines), 800)
