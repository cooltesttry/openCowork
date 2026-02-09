"""
Workspace storage service for managing workspace data.

Each workspace stores its data in a .opencowork/ directory within the workspace path:
- .opencowork/workspace.json      - Workspace metadata
- .opencowork/sessions/           - Session data files
- .opencowork/config.json         - Workspace-level config (enabled MCP IDs)
- .opencowork/memory/             - AI memory storage
"""
import json
import logging
import shutil
from pathlib import Path
from typing import Optional, List

from models.workspace import Workspace, WorkspaceConfig
from models.session import Session, SessionMessage


logger = logging.getLogger(__name__)

# Hidden directory name for workspace data
OPENCOWORK_DIR = ".opencowork"


class WorkspaceStorage:
    """
    Manages storage for a single workspace.

    All data is stored in the .opencowork/ subdirectory of the workspace path.
    """

    def __init__(self, workspace_path: str):
        self.workspace_path = Path(workspace_path).resolve()
        self.data_dir = self.workspace_path / OPENCOWORK_DIR
        self.sessions_dir = self.data_dir / "sessions"
        self.memory_dir = self.data_dir / "memory"
        self.search_dir = self.data_dir / "search"
        # Claude Agent SDK directories
        self.claude_dir = self.workspace_path / ".claude"
        self.skills_dir = self.claude_dir / "skills"
        self.commands_dir = self.claude_dir / "commands"
        self._workspace: Optional[Workspace] = None
        self._config: Optional[WorkspaceConfig] = None

    @property
    def workspace_file(self) -> Path:
        return self.data_dir / "workspace.json"

    @property
    def config_file(self) -> Path:
        return self.data_dir / "config.json"

    @property
    def context_file(self) -> Path:
        return self.memory_dir / "context.md"

    def exists(self) -> bool:
        """Check if this workspace has been initialized."""
        return self.workspace_file.exists()

    def initialize(self, name: Optional[str] = None) -> Workspace:
        """
        Initialize workspace storage.

        Creates the .opencowork/ directory structure and workspace.json.
        Also creates .claude/skills/ and .claude/commands/ for Claude Agent SDK.
        If already initialized, returns existing workspace.
        """
        if self.exists():
            # Ensure Claude SDK directories exist even for existing workspaces
            self._ensure_claude_directories()
            return self.get_workspace()

        # Create directory structure
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.sessions_dir.mkdir(exist_ok=True)
        self.memory_dir.mkdir(exist_ok=True)
        self.search_dir.mkdir(exist_ok=True)

        # Create Claude Agent SDK directories
        self._ensure_claude_directories()

        # Create workspace metadata
        workspace = Workspace.create(str(self.workspace_path), name)
        self._save_workspace(workspace)

        # Create empty config
        config = WorkspaceConfig()
        self._save_config(config)

        # Add .opencowork to .gitignore if git repo exists
        self._update_gitignore()

        logger.info(f"Initialized workspace: {workspace.name} at {self.workspace_path}")
        return workspace

    def _ensure_claude_directories(self) -> None:
        """Create Claude Agent SDK directories (.claude/skills/, .claude/commands/)."""
        try:
            self.claude_dir.mkdir(exist_ok=True)
            self.skills_dir.mkdir(exist_ok=True)
            self.commands_dir.mkdir(exist_ok=True)
            logger.debug(f"Ensured Claude SDK directories at {self.claude_dir}")
        except Exception as e:
            logger.warning(f"Failed to create Claude SDK directories: {e}")

    def get_workspace(self) -> Optional[Workspace]:
        """Get workspace metadata."""
        if self._workspace:
            return self._workspace

        if not self.workspace_file.exists():
            return None

        try:
            with open(self.workspace_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                self._workspace = Workspace.from_dict(data)
                return self._workspace
        except Exception as e:
            logger.error(f"Failed to load workspace: {e}")
            return None

    def _save_workspace(self, workspace: Workspace) -> bool:
        """Save workspace metadata."""
        try:
            with open(self.workspace_file, "w", encoding="utf-8") as f:
                json.dump(workspace.to_dict(), f, ensure_ascii=False, indent=2)
            self._workspace = workspace
            return True
        except Exception as e:
            logger.error(f"Failed to save workspace: {e}")
            return False

    def update_workspace(self, workspace: Workspace) -> bool:
        """Update workspace metadata."""
        return self._save_workspace(workspace)

    def touch(self) -> None:
        """Update last_accessed_at timestamp."""
        workspace = self.get_workspace()
        if workspace:
            workspace.touch()
            self._save_workspace(workspace)

    # ==================== Config ====================

    def get_config(self) -> WorkspaceConfig:
        """Get workspace configuration."""
        if self._config:
            return self._config

        if not self.config_file.exists():
            return WorkspaceConfig()

        try:
            with open(self.config_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                self._config = WorkspaceConfig.from_dict(data)
                # Auto-backfill new fields if missing
                expected_keys = set(WorkspaceConfig().to_dict().keys())
                if any(key not in data for key in expected_keys):
                    self._save_config(self._config)
                return self._config
        except Exception as e:
            logger.error(f"Failed to load workspace config: {e}")
            return WorkspaceConfig()

    def _save_config(self, config: WorkspaceConfig) -> bool:
        """Save workspace configuration."""
        try:
            with open(self.config_file, "w", encoding="utf-8") as f:
                json.dump(config.to_dict(), f, ensure_ascii=False, indent=2)
            self._config = config
            return True
        except Exception as e:
            logger.error(f"Failed to save workspace config: {e}")
            return False

    def update_config(self, config: WorkspaceConfig) -> bool:
        """Update workspace configuration."""
        return self._save_config(config)

    # ==================== Sessions ====================

    def _get_session_path(self, session_id: str) -> Path:
        """Get the file path for a session."""
        return self.sessions_dir / f"{session_id}.json"

    def list_sessions(self) -> List[dict]:
        """
        List all sessions in this workspace (metadata only).
        Returns sessions sorted by updated_at (newest first).
        """
        if not self.sessions_dir.exists():
            return []

        sessions = []
        for file_path in self.sessions_dir.glob("*.json"):
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    session = Session.from_dict(data)
                    sessions.append(session.to_summary())
            except Exception as e:
                logger.warning(f"Failed to load session {file_path}: {e}")
                continue

        sessions.sort(key=lambda s: s["updated_at"], reverse=True)
        return sessions

    def get_session(self, session_id: str) -> Optional[Session]:
        """Get a session by ID with full message history."""
        session_path = self._get_session_path(session_id)

        if not session_path.exists():
            return None

        try:
            with open(session_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return Session.from_dict(data)
        except Exception as e:
            logger.error(f"Failed to load session {session_id}: {e}")
            return None

    def create_session(self, title: str = "New Chat") -> Session:
        """Create a new session in this workspace."""
        session = Session.create(title=title)
        self.save_session(session)
        logger.info(f"Created session in workspace: {session.id}")
        return session

    def save_session(self, session: Session) -> bool:
        """Save a session to the workspace."""
        self.sessions_dir.mkdir(parents=True, exist_ok=True)
        session_path = self._get_session_path(session.id)

        try:
            with open(session_path, "w", encoding="utf-8") as f:
                json.dump(session.to_dict(), f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            logger.error(f"Failed to save session {session.id}: {e}")
            return False

    def delete_session(self, session_id: str) -> bool:
        """Delete a session from this workspace."""
        session_path = self._get_session_path(session_id)

        if not session_path.exists():
            return False

        try:
            session_path.unlink()
            logger.info(f"Deleted session: {session_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete session {session_id}: {e}")
            return False

    def add_message_to_session(self, session_id: str, message: SessionMessage) -> Optional[Session]:
        """Add a message to a session and save it."""
        session = self.get_session(session_id)
        if not session:
            return None

        session.add_message(message)
        self.save_session(session)
        return session

    # ==================== Memory ====================

    def get_context(self) -> str:
        """Get the project context from memory/context.md."""
        if not self.context_file.exists():
            return ""

        try:
            return self.context_file.read_text(encoding="utf-8")
        except Exception as e:
            logger.error(f"Failed to read context: {e}")
            return ""

    def save_context(self, content: str) -> bool:
        """Save project context to memory/context.md."""
        self.memory_dir.mkdir(parents=True, exist_ok=True)

        try:
            self.context_file.write_text(content, encoding="utf-8")
            return True
        except Exception as e:
            logger.error(f"Failed to save context: {e}")
            return False

    # ==================== Search ====================

    def ensure_search_index(self) -> bool:
        """Ensure search index exists, create if not."""
        from core.search.indexer import SearchIndex

        search_db = self.search_dir / "search.sqlite"
        if search_db.exists():
            return True

        try:
            self.search_dir.mkdir(exist_ok=True)
            indexer = SearchIndex(self.workspace_path)
            # Initialize database schema only, no full indexing
            conn = indexer._connect()
            vec_enabled = indexer._load_vec_extension(conn)
            indexer._init_schema(conn, vec_enabled)
            conn.close()
            logger.info(f"Initialized search index at {search_db}")
            return True
        except Exception as e:
            logger.warning(f"Failed to initialize search index: {e}")
            return False

    # ==================== Utilities ====================

    def _update_gitignore(self) -> None:
        """Add .opencowork to .gitignore if this is a git repo."""
        # Only update if .git directory exists (this is a git repo)
        git_dir = self.workspace_path / ".git"
        if not git_dir.exists():
            return

        gitignore_path = self.workspace_path / ".gitignore"

        try:
            if gitignore_path.exists():
                content = gitignore_path.read_text(encoding="utf-8")
                if OPENCOWORK_DIR not in content:
                    with open(gitignore_path, "a", encoding="utf-8") as f:
                        f.write(f"\n# OpenCowork workspace data\n{OPENCOWORK_DIR}/\n")
                    logger.info(f"Added {OPENCOWORK_DIR} to .gitignore")
            else:
                # Create new .gitignore
                gitignore_path.write_text(
                    f"# OpenCowork workspace data\n{OPENCOWORK_DIR}/\n",
                    encoding="utf-8"
                )
                logger.info(f"Created .gitignore with {OPENCOWORK_DIR}")
        except Exception as e:
            logger.warning(f"Failed to update .gitignore: {e}")


class WorkspaceManager:
    """
    Manages multiple workspaces and the global workspace registry.

    The registry is stored in storage/workspaces.json (separate from config.json).
    """

    def __init__(self, global_config_path: Path):
        # global_config_path points to storage/config.json
        # We use storage/workspaces.json for workspace data
        self.storage_dir = global_config_path.parent
        self.workspaces_file = self.storage_dir / "workspaces.json"
        self._storage_cache: dict[str, WorkspaceStorage] = {}

    def _load_workspaces_file(self) -> dict:
        """Load workspaces.json file."""
        if not self.workspaces_file.exists():
            return {"recent": [], "current_workspace_id": None}

        try:
            with open(self.workspaces_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to load workspaces.json: {e}")
            return {"recent": [], "current_workspace_id": None}

    def _save_workspaces_file(self, data: dict) -> bool:
        """Save workspaces.json file."""
        try:
            self.storage_dir.mkdir(parents=True, exist_ok=True)
            with open(self.workspaces_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            logger.error(f"Failed to save workspaces.json: {e}")
            return False

    def _get_workspaces_config(self) -> dict:
        """Get workspaces config."""
        return self._load_workspaces_file()

    def _save_workspaces_config(self, workspaces_config: dict) -> bool:
        """Save workspaces config."""
        return self._save_workspaces_file(workspaces_config)

    def get_recent_workspaces(self) -> List[dict]:
        """Get list of recent workspaces."""
        ws_config = self._get_workspaces_config()
        return ws_config.get("recent", [])

    def get_current_workspace_id(self) -> Optional[str]:
        """Get the current workspace ID."""
        ws_config = self._get_workspaces_config()
        return ws_config.get("current_workspace_id")

    def set_current_workspace_id(self, workspace_id: Optional[str]) -> bool:
        """Set the current workspace ID."""
        ws_config = self._get_workspaces_config()
        ws_config["current_workspace_id"] = workspace_id
        return self._save_workspaces_config(ws_config)

    def get_storage(self, workspace_path: str) -> WorkspaceStorage:
        """Get or create WorkspaceStorage for a path."""
        path_key = str(Path(workspace_path).resolve())
        if path_key not in self._storage_cache:
            self._storage_cache[path_key] = WorkspaceStorage(workspace_path)
        return self._storage_cache[path_key]

    def get_storage_by_id(self, workspace_id: str) -> Optional[WorkspaceStorage]:
        """Get WorkspaceStorage by workspace ID."""
        recent = self.get_recent_workspaces()
        for ws in recent:
            if ws.get("id") == workspace_id:
                return self.get_storage(ws["path"])
        return None

    def open_workspace(self, path: str, name: Optional[str] = None) -> Workspace:
        """
        Open a directory as a workspace.

        - If .opencowork/ exists, read existing workspace data
        - If not, initialize new workspace
        - Add to recent workspaces
        - Set as current workspace
        """
        storage = self.get_storage(path)

        if storage.exists():
            workspace = storage.get_workspace()
            workspace.touch()
            storage.update_workspace(workspace)
        else:
            workspace = storage.initialize(name)

        # Ensure search index exists
        storage.ensure_search_index()

        # Update recent workspaces
        self._add_to_recent(workspace)
        self.set_current_workspace_id(workspace.id)

        return workspace

    def _add_to_recent(self, workspace: Workspace) -> None:
        """Add workspace to recent list."""
        ws_config = self._get_workspaces_config()
        recent = ws_config.get("recent", [])

        # Log current state
        logger.debug(f"[WorkspaceManager] Adding workspace {workspace.id} to recent. Current count: {len(recent)}")

        # Remove existing entry with same path or id
        recent = [
            w for w in recent
            if w.get("id") != workspace.id and w.get("path") != workspace.path
        ]

        # Add to front
        recent.insert(0, workspace.to_summary())

        # Keep only last 20
        ws_config["recent"] = recent[:20]
        success = self._save_workspaces_config(ws_config)

        if success:
            logger.info(f"[WorkspaceManager] Added workspace {workspace.name} ({workspace.id}) to recent. Total: {len(ws_config['recent'])}")
        else:
            logger.error(f"[WorkspaceManager] FAILED to save workspace {workspace.id} to recent list!")

    def remove_from_recent(self, workspace_id: str) -> bool:
        """Remove workspace from recent list (does not delete data)."""
        ws_config = self._get_workspaces_config()
        recent = ws_config.get("recent", [])
        original_len = len(recent)

        recent = [w for w in recent if w.get("id") != workspace_id]

        if len(recent) == original_len:
            return False

        ws_config["recent"] = recent

        # Clear current if it was removed
        if ws_config.get("current_workspace_id") == workspace_id:
            ws_config["current_workspace_id"] = recent[0]["id"] if recent else None

        self._save_workspaces_config(ws_config)
        return True

    def get_current_workspace(self) -> Optional[Workspace]:
        """Get the current workspace."""
        workspace_id = self.get_current_workspace_id()
        if not workspace_id:
            return None

        storage = self.get_storage_by_id(workspace_id)
        if not storage:
            return None

        return storage.get_workspace()

    def switch_workspace(self, workspace_id: str) -> Optional[Workspace]:
        """Switch to a workspace by ID."""
        storage = self.get_storage_by_id(workspace_id)

        # If not found in recent list, try to find by scanning known workspace directories
        if not storage:
            logger.warning(f"[WorkspaceManager] Workspace {workspace_id} not in recent list, scanning disk...")
            storage = self._find_workspace_on_disk(workspace_id)

        if not storage:
            return None

        workspace = storage.get_workspace()
        if workspace:
            workspace.touch()
            storage.update_workspace(workspace)
            self._add_to_recent(workspace)
            self.set_current_workspace_id(workspace_id)

        return workspace

    def _find_workspace_on_disk(self, workspace_id: str) -> Optional[WorkspaceStorage]:
        """
        Fallback: scan common directories for a workspace with matching ID.
        This handles cases where workspace exists on disk but was removed from recent list.
        """
        import os

        # Directories to scan for workspaces
        scan_dirs = [
            os.path.expanduser("~/Documents"),
            os.path.expanduser("~/Projects"),
            os.path.expanduser("~/Desktop"),
            os.path.expanduser("~"),
        ]

        for scan_dir in scan_dirs:
            if not os.path.isdir(scan_dir):
                continue

            try:
                for entry in os.scandir(scan_dir):
                    if entry.is_dir():
                        workspace_json = os.path.join(entry.path, OPENCOWORK_DIR, "workspace.json")
                        if os.path.exists(workspace_json):
                            try:
                                with open(workspace_json, "r", encoding="utf-8") as f:
                                    data = json.load(f)
                                    if data.get("id") == workspace_id:
                                        logger.info(f"[WorkspaceManager] Found workspace {workspace_id} at {entry.path}")
                                        return self.get_storage(entry.path)
                            except Exception as e:
                                logger.debug(f"Error reading {workspace_json}: {e}")
            except PermissionError:
                continue

        return None

    def ensure_default_workspace(self, default_workdir: Optional[str]) -> Optional[Workspace]:
        """
        Ensure a default workspace exists.

        Called during app startup. If no workspaces exist and default_workdir is set,
        creates a default workspace and migrates existing sessions from storage/sessions/.

        Returns the current workspace (existing or newly created).
        """
        # Check if we already have workspaces
        recent = self.get_recent_workspaces()
        current_id = self.get_current_workspace_id()

        if recent and current_id:
            # Already have workspaces, return current
            return self.get_current_workspace()

        if not default_workdir:
            logger.info("[WorkspaceManager] No default_workdir configured, skipping default workspace creation")
            return None

        # Check if workdir exists
        workdir_path = Path(default_workdir)
        if not workdir_path.exists():
            logger.warning(f"[WorkspaceManager] default_workdir does not exist: {default_workdir}")
            return None

        logger.info(f"[WorkspaceManager] Creating default workspace at: {default_workdir}")

        # Create workspace
        workspace = self.open_workspace(default_workdir, workdir_path.name)

        # Migrate existing sessions from storage/sessions/
        self._migrate_legacy_sessions(workspace)

        return workspace

    def _migrate_legacy_sessions(self, workspace: Workspace) -> int:
        """
        Migrate sessions from legacy storage/sessions/ to workspace.

        Returns the number of sessions migrated.
        """
        # Legacy sessions directory
        legacy_dir = self.storage_dir / "sessions"

        if not legacy_dir.exists():
            logger.info("[WorkspaceManager] No legacy sessions to migrate")
            return 0

        storage = self.get_storage(workspace.path)
        migrated = 0
        errors = 0

        for session_file in legacy_dir.glob("*.json"):
            try:
                # Read legacy session
                with open(session_file, "r", encoding="utf-8") as f:
                    data = json.load(f)

                session = Session.from_dict(data)

                # Save to workspace
                storage.save_session(session)
                migrated += 1

                # Move legacy file to backup (rename with .migrated suffix)
                backup_path = session_file.with_suffix(".json.migrated")
                session_file.rename(backup_path)

            except Exception as e:
                logger.error(f"[WorkspaceManager] Failed to migrate session {session_file.name}: {e}")
                errors += 1

        if migrated > 0:
            logger.info(f"[WorkspaceManager] Migrated {migrated} sessions to workspace (errors: {errors})")

        return migrated
