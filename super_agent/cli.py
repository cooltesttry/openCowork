from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from typing import Optional, Tuple

# Checker now uses Worker directly, no separate checker class needed
from .config import load_run_config, load_task_definition, load_worker_config
from .models import SessionState, TaskDefinition, WorkerConfig
from .orchestrator import AsyncOrchestrator, Orchestrator
from .persistence import SessionStore
from .worker import ClaudeSdkWorker, StubWorker, Worker


def _build_worker(kind: str) -> Worker:
    if kind == "claude":
        return ClaudeSdkWorker()
    return StubWorker()


def _load_inputs(
    args: argparse.Namespace,
) -> Tuple[WorkerConfig, TaskDefinition, dict]:
    if args.config:
        return load_run_config(args.config)
    if not args.worker or not args.task:
        raise ValueError("worker and task configs are required unless --config is used")
    return load_worker_config(args.worker), load_task_definition(args.task), {}


def _make_orchestrator(
    base_dir: Optional[Path],
    worker: Worker,
    cycle_wait_seconds: int,
    use_async: bool,
):
    if use_async:
        return AsyncOrchestrator(
            base_dir=base_dir,
            worker=worker,
            cycle_wait_seconds=cycle_wait_seconds,
        )
    return Orchestrator(
        base_dir=base_dir,
        worker=worker,
        cycle_wait_seconds=cycle_wait_seconds,
    )


def _print_session(session: SessionState) -> None:
    print(json.dumps(session.to_dict(), indent=2, ensure_ascii=True))


def run_command(args: argparse.Namespace) -> None:
    base_dir = Path(args.base_dir) if args.base_dir else None
    worker = _build_worker(args.worker_type)
    orchestrator = _make_orchestrator(
        base_dir=base_dir,
        worker=worker,
        cycle_wait_seconds=args.cycle_wait_seconds,
        use_async=args.async_mode,
    )

    if args.session:
        session_id = args.session
    else:
        worker_config, task, session_cfg = _load_inputs(args)
        input_payload = session_cfg.get("input_payload")
        max_cycles = int(session_cfg.get("max_cycles", args.max_cycles))
        reset_on_max_cycles = bool(
            session_cfg.get("reset_on_max_cycles", args.reset_on_max_cycles)
        )
        max_resets = int(session_cfg.get("max_resets", args.max_resets))
        session = orchestrator.create_session(
            task=task,
            worker_config=worker_config,
            input_payload=input_payload,
            max_cycles=max_cycles,
            reset_on_max_cycles=reset_on_max_cycles,
            max_resets=max_resets,
        )
        session_id = session.session_id
        print(f"created session: {session_id}")

    if args.async_mode:
        session = asyncio.run(orchestrator.run(session_id))
    else:
        session = orchestrator.run(session_id)
    _print_session(session)


def run_once_command(args: argparse.Namespace) -> None:
    base_dir = Path(args.base_dir) if args.base_dir else None
    worker = _build_worker(args.worker_type)
    orchestrator = _make_orchestrator(
        base_dir=base_dir,
        worker=worker,
        cycle_wait_seconds=args.cycle_wait_seconds,
        use_async=args.async_mode,
    )

    if args.session:
        session_id = args.session
    else:
        worker_config, task, session_cfg = _load_inputs(args)
        input_payload = session_cfg.get("input_payload")
        max_cycles = int(session_cfg.get("max_cycles", args.max_cycles))
        reset_on_max_cycles = bool(
            session_cfg.get("reset_on_max_cycles", args.reset_on_max_cycles)
        )
        max_resets = int(session_cfg.get("max_resets", args.max_resets))
        session = orchestrator.create_session(
            task=task,
            worker_config=worker_config,
            input_payload=input_payload,
            max_cycles=max_cycles,
            reset_on_max_cycles=reset_on_max_cycles,
            max_resets=max_resets,
        )
        session_id = session.session_id
        print(f"created session: {session_id}")

    if args.async_mode:
        session = asyncio.run(orchestrator.run_once(session_id))
    else:
        session = orchestrator.run_once(session_id)
    _print_session(session)


def status_command(args: argparse.Namespace) -> None:
    store = SessionStore(Path(args.base_dir) if args.base_dir else None)
    session = store.load_session(args.session)
    if not session:
        raise SystemExit(f"session not found: {args.session}")
    _print_session(session)


def main(argv: Optional[list[str]] = None) -> None:
    parser = argparse.ArgumentParser(prog="super-agent")
    parser.add_argument("--base-dir", help="base directory for workspace")
    parser.add_argument(
        "--worker-type",
        choices=["stub", "claude"],
        default="stub",
        help="worker implementation",
    )
    parser.add_argument(
        "--cycle-wait-seconds",
        type=int,
        default=0,
        help="sleep between cycles",
    )
    parser.add_argument(
        "--async",
        dest="async_mode",
        action="store_true",
        help="use async orchestrator",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run", help="run until completion")
    run_parser.add_argument("--session", help="existing session id")
    run_parser.add_argument("--config", help="combined config file")
    run_parser.add_argument("--worker", help="worker config file")
    run_parser.add_argument("--task", help="task config file")
    run_parser.add_argument("--max-cycles", type=int, default=3)
    run_parser.add_argument("--reset-on-max-cycles", action="store_true")
    run_parser.add_argument("--max-resets", type=int, default=0)
    run_parser.set_defaults(func=run_command)

    once_parser = subparsers.add_parser("run-once", help="run a single cycle")
    once_parser.add_argument("--session", help="existing session id")
    once_parser.add_argument("--config", help="combined config file")
    once_parser.add_argument("--worker", help="worker config file")
    once_parser.add_argument("--task", help="task config file")
    once_parser.add_argument("--max-cycles", type=int, default=3)
    once_parser.add_argument("--reset-on-max-cycles", action="store_true")
    once_parser.add_argument("--max-resets", type=int, default=0)
    once_parser.set_defaults(func=run_once_command)

    status_parser = subparsers.add_parser("status", help="show session status")
    status_parser.add_argument("--session", required=True, help="session id")
    status_parser.set_defaults(func=status_command)

    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
