"""Filesystem locations for the desktop shell."""
from __future__ import annotations

import os
import sys
from pathlib import Path

APP_NAME = "ThinkingCanvas"


def resource_dir() -> Path:
    """Directory that contains bundled web assets."""
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent.parent


def web_dir() -> Path:
    return resource_dir() / "web"


def app_data_dir() -> Path:
    base = os.environ.get("APPDATA")
    root = Path(base) if base else Path.home() / ".config"
    folder = root / APP_NAME
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def session_path() -> Path:
    return app_data_dir() / "session.json"


def recent_path() -> Path:
    return app_data_dir() / "recent.json"
