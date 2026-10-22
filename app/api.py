"""File and session API exposed to the web UI through pywebview."""
from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

MAX_PROJECT_BYTES = 20 * 1024 * 1024
PROJECT_FILTERS = ("Thinking Canvas (*.tcanvas.json)", "JSON (*.json)", "All files (*.*)")


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".thinking-canvas-", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def _read_text(path: Path) -> str:
    size = path.stat().st_size
    if size > MAX_PROJECT_BYTES:
        raise ValueError("文件超过 20 MB，未打开。")
    return path.read_text(encoding="utf-8")


def _valid_project_json(text: str) -> None:
    if len(text.encode("utf-8")) > MAX_PROJECT_BYTES:
        raise ValueError("画板数据超过 20 MB，未保存。")
    data = json.loads(text)
    if not isinstance(data, dict) or "objects" not in data or "steps" not in data:
        raise ValueError("这不是 Thinking Canvas 项目文件。")


class FileApi:
    """Methods called from JS as ``window.pywebview.api.<name>(...)``."""

    def __init__(self, data_dir: Path | None = None) -> None:
        self.window = None
        self.data_dir = data_dir
        self.folder = Path(data_dir) if data_dir else None
        self.smoke_mode = False
        self.smoke_payload: dict[str, Any] = {"ok": False, "error": "前端没有回报 smoke 结果。"}

    def js_log(self, message: str) -> dict[str, Any]:
        if self.smoke_mode:
            try:
                print(f"[js] {message}", flush=True)
            except Exception:
                pass
        return {"ok": True}

    def write_smoke_payload(self) -> None:
        try:
            path = self._data_dir() / "smoke.json"
            _atomic_write(path, json.dumps(self.smoke_payload, ensure_ascii=False))
        except Exception:
            pass

    def smoke_report(self, result: Any) -> dict[str, Any]:
        self.smoke_payload = result if isinstance(result, dict) else {"ok": False, "error": "smoke 返回值不是对象。"}
        if self.smoke_mode:
            self.write_smoke_payload()
            try:
                print(json.dumps(self.smoke_payload, ensure_ascii=False), flush=True)
            except Exception:
                pass
            threading.Timer(0.1, lambda: os._exit(0 if self.smoke_payload.get("ok") else 1)).start()
        return {"ok": True}

    def attach(self, window) -> None:
        self.window = window

    # -- paths ---------------------------------------------------------
    def _data_dir(self) -> Path:
        if self.folder is not None:
            self.folder.mkdir(parents=True, exist_ok=True)
            return self.folder
        from .paths import app_data_dir

        return app_data_dir()

    def _session_file(self) -> Path:
        return self._data_dir() / "session.json"

    def _recent_file(self) -> Path:
        return self._data_dir() / "recent.json"

    # -- info ----------------------------------------------------------
    def app_info(self) -> dict[str, Any]:
        import platform

        return {
            "ok": True,
            "version": "0.1.0",
            "platform": platform.system(),
            "dataDir": str(self._data_dir()),
            "smoke": self.smoke_mode,
        }

    # -- dialogs -------------------------------------------------------
    def _dialog(self, kind: int, **kwargs):
        if self.window is None:
            raise RuntimeError("桌面窗口尚未就绪。")
        return self.window.create_file_dialog(kind, **kwargs)

    # -- project files -------------------------------------------------
    def open_project(self) -> dict[str, Any]:
        try:
            import webview

            result = self._dialog(webview.OPEN_DIALOG, allow_multiple=False, file_types=PROJECT_FILTERS)
            if not result:
                return {"ok": False, "canceled": True}
            path = Path(result[0])
            text = _read_text(path)
            _valid_project_json(text)
            self.add_recent(str(path), _title_from_json(text))
            return {"ok": True, "path": str(path), "content": text}
        except Exception as exc:  # surfaced to the UI as a readable message
            return {"ok": False, "error": str(exc)}

    def open_recent(self, path: str) -> dict[str, Any]:
        try:
            file = Path(path)
            text = _read_text(file)
            _valid_project_json(text)
            self.add_recent(str(file), _title_from_json(text))
            return {"ok": True, "path": str(file), "content": text}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def save_project(self, path: str, content: str) -> dict[str, Any]:
        try:
            _valid_project_json(content)
            file = Path(path)
            _atomic_write(file, content)
            self.add_recent(str(file), _title_from_json(content))
            return {"ok": True, "path": str(file)}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def save_project_as(self, content: str, suggested_name: str = "未命名画板.tcanvas.json") -> dict[str, Any]:
        try:
            import webview

            _valid_project_json(content)
            result = self._dialog(
                webview.SAVE_DIALOG,
                save_filename=suggested_name,
                file_types=PROJECT_FILTERS,
            )
            if not result:
                return {"ok": False, "canceled": True}
            path = result if isinstance(result, str) else result[0]
            file = Path(path)
            if not file.name.lower().endswith(".json"):
                file = file.with_name(file.name + ".tcanvas.json")
            _atomic_write(file, content)
            self.add_recent(str(file), _title_from_json(content))
            return {"ok": True, "path": str(file)}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    # -- session / autosave -------------------------------------------
    def save_session(self, content: str, path: str = "") -> dict[str, Any]:
        try:
            _valid_project_json(content)
            payload = {"content": content, "path": path, "savedAt": time.time()}
            _atomic_write(self._session_file(), json.dumps(payload, ensure_ascii=False))
            return {"ok": True}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def load_session(self) -> dict[str, Any]:
        try:
            file = self._session_file()
            if not file.exists():
                return {"ok": False, "empty": True}
            payload = json.loads(file.read_text(encoding="utf-8"))
            content = payload.get("content", "")
            _valid_project_json(content)
            return {"ok": True, "content": content, "path": payload.get("path", "")}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def clear_session(self) -> dict[str, Any]:
        try:
            self._session_file().unlink(missing_ok=True)
            return {"ok": True}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    # -- recent files --------------------------------------------------
    def get_recent(self) -> dict[str, Any]:
        try:
            file = self._recent_file()
            if not file.exists():
                return {"ok": True, "items": []}
            items = json.loads(file.read_text(encoding="utf-8"))
            if not isinstance(items, list):
                items = []
            items = [item for item in items if isinstance(item, dict) and Path(item.get("path", "")).exists()]
            return {"ok": True, "items": items[:8]}
        except Exception:
            return {"ok": True, "items": []}

    def add_recent(self, path: str, title: str = "") -> None:
        try:
            file = self._recent_file()
            items = []
            if file.exists():
                loaded = json.loads(file.read_text(encoding="utf-8"))
                if isinstance(loaded, list):
                    items = [item for item in loaded if isinstance(item, dict)]
            items = [item for item in items if item.get("path") != path]
            items.insert(0, {"path": path, "title": title or Path(path).stem, "openedAt": time.time()})
            _atomic_write(file, json.dumps(items[:8], ensure_ascii=False, indent=2))
        except Exception:
            pass

    # -- export --------------------------------------------------------
    def export_text(self, suggested_name: str, content: str) -> dict[str, Any]:
        try:
            import webview

            result = self._dialog(
                webview.SAVE_DIALOG,
                save_filename=suggested_name,
                file_types=("All files (*.*)",),
            )
            if not result:
                return {"ok": False, "canceled": True}
            path = result if isinstance(result, str) else result[0]
            _atomic_write(Path(path), content)
            return {"ok": True, "path": path}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}


def _title_from_json(text: str) -> str:
    try:
        data = json.loads(text)
        title = data.get("title")
        return str(title)[:80] if title else ""
    except Exception:
        return ""
