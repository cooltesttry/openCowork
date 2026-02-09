#!/usr/bin/env python3
"""
One-time migration: move TaskRunner event data from global storage/sessions/{id}/
to per-workspace .opencowork/sessions/{id}/ directories.

For each session in storage/sessions/:
  1. Look up which workspace owns it by scanning workspace .opencowork/sessions/{id}.json
  2. Move the directory (current.json + events.jsonl) into that workspace
  3. Sessions without a matching workspace are left in place as fallback

Usage:
    python migrate_task_events.py          # dry-run (default)
    python migrate_task_events.py --apply  # actually move files
"""
import json
import shutil
import sys
from pathlib import Path


STORAGE_DIR = Path(__file__).parent / "storage"
GLOBAL_SESSIONS = STORAGE_DIR / "sessions"
WORKSPACES_FILE = STORAGE_DIR / "workspaces.json"


def load_workspaces() -> list[dict]:
    if not WORKSPACES_FILE.exists():
        return []
    with open(WORKSPACES_FILE) as f:
        data = json.load(f)
    return data.get("recent", [])


def find_workspace_for_session(session_id: str, workspaces: list[dict]) -> Path | None:
    """Find which workspace owns a session by checking .opencowork/sessions/{id}.json."""
    for ws in workspaces:
        ws_path = Path(ws.get("path", ""))
        session_file = ws_path / ".opencowork" / "sessions" / f"{session_id}.json"
        if session_file.exists():
            return ws_path
    return None


def main():
    dry_run = "--apply" not in sys.argv

    if dry_run:
        print("=== DRY RUN (pass --apply to actually move files) ===\n")

    if not GLOBAL_SESSIONS.exists():
        print("No global sessions directory found. Nothing to migrate.")
        return

    workspaces = load_workspaces()
    if not workspaces:
        print("No workspaces found in workspaces.json. Nothing to migrate.")
        return

    print(f"Found {len(workspaces)} workspace(s)")

    migrated = 0
    skipped = 0
    no_match = 0

    for session_dir in sorted(GLOBAL_SESSIONS.iterdir()):
        if not session_dir.is_dir():
            continue

        session_id = session_dir.name
        state_file = session_dir / "current.json"
        if not state_file.exists():
            continue

        ws_path = find_workspace_for_session(session_id, workspaces)
        if ws_path is None:
            print(f"  [no-match] {session_id} — no workspace found, leaving in place")
            no_match += 1
            continue

        dest_dir = ws_path / ".opencowork" / "sessions" / session_id
        if dest_dir.exists():
            print(f"  [skip]     {session_id} — already exists in {ws_path.name}")
            skipped += 1
            continue

        print(f"  [migrate]  {session_id} -> {ws_path.name}/.opencowork/sessions/{session_id}/")
        if not dry_run:
            dest_dir.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(session_dir), str(dest_dir))
        migrated += 1

    print(f"\nSummary: {migrated} migrated, {skipped} skipped, {no_match} unmatched")
    if dry_run and migrated > 0:
        print("\nRe-run with --apply to perform the migration.")


if __name__ == "__main__":
    main()
