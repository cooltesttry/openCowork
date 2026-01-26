from __future__ import annotations

import json
from pathlib import Path
from typing import Tuple

from .models import TaskDefinition, WorkerConfig


def load_data(path: str | Path) -> dict:
    config_path = Path(path)
    if not config_path.exists():
        raise FileNotFoundError(f"config not found: {config_path}")
    if config_path.suffix.lower() in {".yaml", ".yml"}:
        try:
            import yaml
        except ImportError as exc:
            raise RuntimeError("pyyaml is required to load yaml configs") from exc
        with config_path.open("r", encoding="utf-8") as handle:
            data = yaml.safe_load(handle)
    else:
        with config_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError("config root must be an object")
    return data


def load_worker_config(path: str | Path) -> WorkerConfig:
    data = load_data(path)
    return WorkerConfig.from_dict(data)


def load_task_definition(path: str | Path) -> TaskDefinition:
    data = load_data(path)
    return TaskDefinition.from_dict(data)


def load_run_config(path: str | Path) -> Tuple[WorkerConfig, TaskDefinition, dict]:
    data = load_data(path)
    worker_data = data.get("worker")
    task_data = data.get("task")
    if not isinstance(worker_data, dict) or not isinstance(task_data, dict):
        raise ValueError("run config must include worker and task objects")
    session_data = data.get("session", {})
    if session_data is None:
        session_data = {}
    if not isinstance(session_data, dict):
        raise ValueError("session config must be an object")
    return (
        WorkerConfig.from_dict(worker_data),
        TaskDefinition.from_dict(task_data),
        session_data,
    )
