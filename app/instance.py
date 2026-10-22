"""Runtime health state shared by normal app instances.

The file is a tiny hand-off marker: the running instance writes its PID and
heartbeat, and a second launch uses it to distinguish a healthy window from a
stale one. It is runtime state, not user data, so it lives under %TEMP%.
"""
from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any


def state_path() -> Path:
    folder = Path(tempfile.gettempdir()) / "ThinkingCanvas"
    folder.mkdir(parents=True, exist_ok=True)
    return folder / "instance.json"


def read_state(path: Path | None = None) -> dict[str, Any]:
    try:
        data = json.loads((path or state_path()).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def write_state(state: dict[str, Any], path: Path | None = None) -> None:
    target = path or state_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(f"{target.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, target)


def clear_state(pid: int | None = None, path: Path | None = None) -> None:
    target = path or state_path()
    if pid is not None:
        current = read_state(target)
        if current.get("pid") not in (None, pid):
            return
    try:
        target.unlink()
    except FileNotFoundError:
        pass


def heartbeat_age(state: dict[str, Any], now: float | None = None) -> float | None:
    stamp = state.get("heartbeat_at") or state.get("ready_at") or state.get("started_at")
    try:
        value = float(stamp)
    except (TypeError, ValueError):
        return None
    return max(0.0, (time.time() if now is None else now) - value)


def is_healthy(state: dict[str, Any], now: float | None = None, max_age: float = 6.0) -> bool:
    if state.get("state") != "ready":
        return False
    age = heartbeat_age(state, now)
    return age is not None and age <= max_age
