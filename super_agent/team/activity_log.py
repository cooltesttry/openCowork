"""Team activity log for real-time workflow documentation.

Writes structured logs to {team_data_dir}/logs/:
- workflow.md: Main narrative (self-contained, readable by agents)
- mail_log.jsonl: Raw mail records (written by MCP server + FileMailbox)
- phase*_*_submit*.md: Worker report files (full content preserved)
"""

from __future__ import annotations

import shutil
import threading
import json
from datetime import datetime
from pathlib import Path
from typing import Optional


class TeamActivityLog:
    """Real-time team activity logger writing to {team_data_dir}/logs/."""

    def __init__(self, team_data_dir: Path):
        self.logs_dir = team_data_dir / "logs"
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        self.workflow_file = self.logs_dir / "workflow.md"
        self.mail_log_file = team_data_dir / "mail_log.jsonl"
        self._lock = threading.Lock()
        self._seen_mail_ids: set[str] = set()
        self._mail_log_offset = 0
        self._submission_seq: dict[str, int] = {}  # task_id → next submit number

    def _ts(self) -> str:
        return datetime.now().strftime("%H:%M:%S")

    def _append_workflow(self, content: str):
        """Thread-safe append to workflow.md."""
        with self._lock:
            with open(self.workflow_file, "a", encoding="utf-8") as f:
                f.write(content)

    # ── Section / Event ──

    def log_section(self, title: str):
        self._append_workflow(f"\n\n---\n## [{self._ts()}] {title}\n\n")

    def log_event(self, event: str):
        self._append_workflow(f"- [{self._ts()}] {event}\n")

    # ── Lead content ──

    def log_lead_response(self, stage: str, text: str):
        self._append_workflow(f"### [{self._ts()}] Lead ({stage})\n\n{text}\n\n")

    def log_prompt_summary(self, stage: str, summary: str):
        self._append_workflow(
            f"> **[{self._ts()}] Prompt → Lead ({stage})**: {summary}\n\n"
        )

    def log_plan(self, plan_data: dict):
        """Log plan content as a readable table."""
        lines = [f"### [{self._ts()}] Plan Created\n\n"]
        lines.append("| Phase | Description | Tasks |\n")
        lines.append("|-------|-------------|-------|\n")
        for phase in plan_data.get("phases", []):
            pid = phase.get("phase_id", "")
            desc = phase.get("description", "")
            tasks = phase.get("tasks", [])
            for i, t in enumerate(tasks):
                tid = t.get("task_id", "")
                tdesc = t.get("description", "")[:80]
                wtype = t.get("worker_type_id", "")
                lines.append(
                    f"| {pid if i == 0 else ''} "
                    f"| {desc if i == 0 else ''} "
                    f"| {tid}: {tdesc} ({wtype}) |\n"
                )
        lines.append("\n")
        self._append_workflow("".join(lines))

    # ── Mail processing (drain from mail_log.jsonl) ──

    def drain_mail_log(self, phase_index: int):
        """Read new entries from mail_log.jsonl, format and write to workflow.md.

        Worker→Lead mails: save as independent report file + record reference in workflow.md
        Lead→Worker mails: inline into workflow.md
        """
        if not self.mail_log_file.exists():
            return

        new_entries = []
        with open(self.mail_log_file, "r", encoding="utf-8") as f:
            f.seek(self._mail_log_offset)
            for line in f:
                if line.strip():
                    try:
                        entry = json.loads(line)
                        mail_id = entry.get("id", "")
                        if mail_id and mail_id not in self._seen_mail_ids:
                            self._seen_mail_ids.add(mail_id)
                            new_entries.append(entry)
                    except json.JSONDecodeError:
                        pass
            self._mail_log_offset = f.tell()

        for entry in new_entries:
            from_id = entry.get("from", "")
            to_id = entry.get("to", "")
            content = entry.get("content", "")
            task_id = entry.get("task_id", "")
            mail_id = entry.get("id", "")

            if from_id.startswith("worker-"):
                # Worker→Lead: save as independent file + record reference
                # Maintain per-task submission sequence (1-based)
                seq = self._submission_seq.get(task_id, 0) + 1
                self._submission_seq[task_id] = seq
                filename = self._save_worker_report(
                    phase_index, task_id, from_id, seq, content, mail_id
                )
                self._append_workflow(
                    f"**[{self._ts()}] [MAIL RECEIVED]** {from_id} → {to_id}"
                    f" (task: {task_id})\n"
                    f"File: `{filename}`\n\n"
                )
            else:
                # Lead→Worker: inline
                quoted = "\n".join(f"> {line}" for line in content.split("\n"))
                self._append_workflow(
                    f"**[{self._ts()}] [MAIL SENT]** {from_id} → {to_id}"
                    f" (task: {task_id})\n"
                    f"{quoted}\n\n"
                )

    def _save_worker_report(self, phase_index: int, task_id: str,
                            agent_id: str, submit_count: int,
                            content: str, mail_id: str) -> str:
        """Save a Worker report file. Filename includes mail_id for uniqueness."""
        safe_mail_id = mail_id.replace("/", "_")[:16]
        filename = (
            f"phase{phase_index}_{task_id}_{agent_id}"
            f"_submit{submit_count}_{safe_mail_id}.md"
        )
        filepath = self.logs_dir / filename
        filepath.write_text(content, encoding="utf-8")
        return filename

    # ── Final marker ──

    def mark_final(self, phase_index: int, task_id: str,
                   agent_id: str) -> Optional[str]:
        """Copy the last submission as _final file and record in workflow.md."""
        seq = self._submission_seq.get(task_id, 0)
        if seq == 0:
            return None
        pattern = f"phase{phase_index}_{task_id}_{agent_id}_submit{seq}_*.md"
        matches = sorted(self.logs_dir.glob(pattern))
        # Exclude existing _final files
        matches = [m for m in matches if "_final" not in m.stem]
        if not matches:
            return None
        source = matches[-1]
        final_name = source.stem + "_final.md"
        final_path = self.logs_dir / final_name
        shutil.copy2(source, final_path)
        self._append_workflow(
            f"- [{self._ts()}] Task {task_id}: approved → Final: `{final_name}`\n"
        )
        return final_name
