"""File and session API exposed to the web UI through pywebview."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any

MAX_PROJECT_BYTES = 20 * 1024 * 1024
PROJECT_FILTERS = ("Thinking Canvas (*.tcanvas.json)", "JSON (*.json)", "All files (*.*)")
SAMPLE_BOARD_NAME = "board-sample.tcanvas.json"


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

    def __init__(
        self,
        data_dir: Path | None = None,
        boards_dir: Path | None = None,
        *,
        ready_callback=None,
        heartbeat_callback=None,
        log_callback=None,
    ) -> None:
        # pywebview enumerates public js_api attributes; keep non-method state
        # private or it recursively walks the native Window/Path graphs.
        self._window = None
        self._folder = Path(data_dir) if data_dir else None
        self._boards_override = Path(boards_dir) if boards_dir else None
        self._boards_ready = False
        self._ready_callback = ready_callback
        self._heartbeat_callback = heartbeat_callback
        self._log_callback = log_callback
        self.smoke_mode = False
        self.smoke_payload: dict[str, Any] = {"ok": False, "error": "前端没有回报 smoke 结果。"}

    def js_log(self, message: str) -> dict[str, Any]:
        if self.smoke_mode:
            try:
                print(f"[js] {message}", flush=True)
            except Exception:
                pass
        if self._log_callback:
            self._log_callback(str(message))
        return {"ok": True}

    def boot_ready(self) -> dict[str, Any]:
        if self._ready_callback:
            self._ready_callback()
        return {"ok": True}

    def heartbeat(self) -> dict[str, Any]:
        if self._heartbeat_callback:
            self._heartbeat_callback()
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
        self._window = window

    # -- paths ---------------------------------------------------------
    def _data_dir(self) -> Path:
        if self._folder is not None:
            self._folder.mkdir(parents=True, exist_ok=True)
            return self._folder
        from .paths import app_data_dir

        return app_data_dir()

    def _session_file(self) -> Path:
        return self._data_dir() / "session.json"

    def _recent_file(self) -> Path:
        return self._data_dir() / "recent.json"

    def _ui_state_file(self) -> Path:
        return self._boards_dir() / ".ui-state.json"

    # -- info ----------------------------------------------------------
    def app_info(self) -> dict[str, Any]:
        import platform

        return {
            "ok": True,
            "version": "0.3.8",
            "platform": platform.system(),
            "dataDir": str(self._data_dir()),
            "boardsDir": str(self._boards_dir()),
            "smoke": self.smoke_mode,
        }

    # -- ui state ------------------------------------------------------
    def load_ui_state(self) -> dict[str, Any]:
        path = self._ui_state_file()
        try:
            state = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(state, dict):
                raise ValueError("UI 状态必须是对象。")
            return {"ok": True, "state": state}
        except FileNotFoundError:
            return {"ok": True, "state": {}}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def save_ui_state(self, state: Any) -> dict[str, Any]:
        if not isinstance(state, dict):
            return {"ok": False, "error": "UI 状态必须是对象。"}
        try:
            text = json.dumps(state, ensure_ascii=False)
            if len(text.encode("utf-8")) > 64 * 1024:
                return {"ok": False, "error": "UI 状态超过 64 KB。"}
            _atomic_write(self._ui_state_file(), text)
            return {"ok": True}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    # -- boards --------------------------------------------------------
    def _boards_dir(self) -> Path:
        if self._boards_override is not None:
            folder = self._boards_override
        else:
            from .paths import boards_dir

            folder = boards_dir()
        folder.mkdir(parents=True, exist_ok=True)
        return folder

    def _trash_dir(self) -> Path:
        from .paths import trash_dir

        if self._boards_override is not None:
            folder = self._boards_override / ".trash"
            folder.mkdir(parents=True, exist_ok=True)
            return folder
        return trash_dir()

    def _inside_boards(self, path: str | Path) -> Path:
        root = self._boards_dir().resolve()
        file = Path(path).resolve()
        if file.parent != root or not file.name.endswith(".tcanvas.json"):
            raise ValueError("画板文件必须位于 boards/ 目录。")
        return file

    def _ensure_boards(self) -> None:
        if self._boards_ready:
            return
        self._boards_dir()
        self._boards_ready = True
        legacy = self._session_file()
        if not legacy.exists():
            return
        try:
            payload = json.loads(legacy.read_text(encoding="utf-8"))
            content = payload.get("content", "")
            _valid_project_json(content)
            data = json.loads(content)
            if data.get("objects") or data.get("steps"):
                title = _title_from_json(content) or "恢复的画板"
                self.create_board(content, title)
            legacy.unlink(missing_ok=True)
        except Exception:
            # Keep a legacy file untouched if it cannot be migrated safely.
            pass

    def _board_item(self, path: Path) -> dict[str, Any]:
        try:
            text = _read_text(path)
            _valid_project_json(text)
            data = json.loads(text)
            return {
                "path": str(path),
                "title": str(data.get("title") or path.stem),
                "updatedAt": str(data.get("updatedAt") or ""),
                "mtime": path.stat().st_mtime,
                "size": path.stat().st_size,
                "invalid": False,
                "sample": path.name == SAMPLE_BOARD_NAME,
            }
        except Exception:
            return {
                "path": str(path),
                "title": path.stem,
                "updatedAt": "",
                "mtime": path.stat().st_mtime if path.exists() else 0,
                "size": path.stat().st_size if path.exists() else 0,
                "invalid": True,
                "sample": path.name == SAMPLE_BOARD_NAME,
            }

    def boards_info(self) -> dict[str, Any]:
        try:
            return {"ok": True, "dir": str(self._boards_dir())}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def list_boards(self) -> dict[str, Any]:
        try:
            self._ensure_boards()
            files = sorted(
                self._boards_dir().glob("*.tcanvas.json"),
                key=lambda path: path.stat().st_mtime,
                reverse=True,
            )
            return {"ok": True, "dir": str(self._boards_dir()), "items": [self._board_item(path) for path in files]}
        except Exception as exc:
            return {"ok": False, "error": str(exc), "items": []}

    def create_board(self, content: str, title: str = "未命名画板") -> dict[str, Any]:
        try:
            _valid_project_json(content)
            self._ensure_boards()
            path = self._boards_dir() / f"board-{uuid.uuid4().hex[:8]}.tcanvas.json"
            _atomic_write(path, content)
            return {"ok": True, "path": str(path), "item": self._board_item(path)}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def ensure_sample_board(self, content: str, title: str = "示例画板") -> dict[str, Any]:
        try:
            _valid_project_json(content)
            self._ensure_boards()
            path = self._boards_dir() / SAMPLE_BOARD_NAME
            created = not path.exists()
            if created:
                _atomic_write(path, content)
            return {"ok": True, "path": str(path), "created": created, "item": self._board_item(path)}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def save_board(self, path: str, content: str) -> dict[str, Any]:
        try:
            _valid_project_json(content)
            file = self._inside_boards(path)
            _atomic_write(file, content)
            return {"ok": True, "path": str(file), "item": self._board_item(file)}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def load_board(self, path: str) -> dict[str, Any]:
        try:
            file = self._inside_boards(path)
            text = _read_text(file)
            _valid_project_json(text)
            return {"ok": True, "path": str(file), "content": text}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def delete_board(self, path: str) -> dict[str, Any]:
        try:
            file = self._inside_boards(path)
            if file.name == SAMPLE_BOARD_NAME:
                return {"ok": False, "error": "示例画板不能删除。"}
            if not file.exists():
                return {"ok": False, "error": "画板文件不存在。"}
            target = self._trash_dir() / f"{int(time.time() * 1000)}-{file.name}"
            shutil.move(str(file), str(target))
            return {"ok": True, "trash": str(target)}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def open_boards_folder(self) -> dict[str, Any]:
        try:
            folder = str(self._boards_dir())
            if os.name == "nt":
                os.startfile(folder)  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                subprocess.Popen(["open", folder])
            else:
                subprocess.Popen(["xdg-open", folder])
            return {"ok": True}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    # -- dialogs -------------------------------------------------------
    def _dialog(self, kind: int, **kwargs):
        if self._window is None:
            raise RuntimeError("桌面窗口尚未就绪。")
        return self._window.create_file_dialog(kind, **kwargs)

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


