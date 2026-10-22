"""Thinking Canvas desktop entry point (pywebview + local web assets)."""
from __future__ import annotations

import json
import logging
import os
import sys
import tempfile
import threading
from pathlib import Path

# PyInstaller's windowed mode leaves stdout/stderr as None; pywebview and
# pythonnet expect real streams, and can otherwise hang during WebView2 setup.
def _ensure_streams() -> None:
    if sys.stdout is not None and sys.stderr is not None:
        return
    try:
        log_dir = Path(os.environ.get("APPDATA", str(Path.home()))) / "ThinkingCanvas"
        log_dir.mkdir(parents=True, exist_ok=True)
        stream = open(log_dir / "shell.log", "a", encoding="utf-8", buffering=1)
    except Exception:
        stream = open(os.devnull, "w", encoding="utf-8", buffering=1)
    if sys.stdout is None:
        sys.stdout = stream
    if sys.stderr is None:
        sys.stderr = stream


_ensure_streams()

import webview

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from app.api import FileApi
    from app.paths import web_dir
else:
    from .api import FileApi
    from .paths import web_dir

WINDOW_TITLE = "Thinking Canvas"

logging.getLogger("pywebview").setLevel(logging.CRITICAL)


def _show_error(message: str) -> None:
    print(message, file=sys.stderr)
    if sys.platform == "win32":
        try:
            import ctypes

            ctypes.windll.user32.MessageBoxW(0, message, WINDOW_TITLE, 0x10)
        except Exception:
            pass


def _smoke_timeout(api: FileApi) -> None:
    api.smoke_payload = {"ok": False, "error": "前端没有在 40 秒内回报 smoke 结果。"}
    api.write_smoke_payload()
    try:
        print(json.dumps(api.smoke_payload, ensure_ascii=False), flush=True)
    except Exception:
        pass
    import os

    os._exit(1)


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    smoke = "--smoke" in argv
    debug = "--dev" in argv
    api = FileApi(boards_dir=tempfile.mkdtemp(prefix="tc-smoke-boards-") if smoke else None)
    query = "?desktop=1&smoke=1" if smoke else "?desktop=1"
    url = str(web_dir() / "index.html") + query
    window = webview.create_window(
        WINDOW_TITLE,
        url=url,
        js_api=api,
        width=1450,
        height=900,
        min_size=(1100, 700),
        background_color="#f7f5ef",
        text_select=True,
        hidden=False,
        on_top=smoke,
        focus=True,
        confirm_close=False,
    )
    api.attach(window)
    try:
        if smoke:
            api.smoke_mode = True
            watchdog = threading.Timer(40, lambda: _smoke_timeout(api))
            watchdog.daemon = True
            watchdog.start()
            webview.start(
                http_server=True,
                debug=False,
                private_mode=True,
                storage_path=tempfile.mkdtemp(prefix="tc-smoke-"),
            )
            return 0
        webview.start(
            http_server=True,
            debug=debug,
            private_mode=True,
            storage_path=tempfile.mkdtemp(prefix="tc-webview-"),
        )
        return 0
    except Exception as exc:
        _show_error(
            "无法启动 Thinking Canvas。\n\n"
            f"{type(exc).__name__}: {exc}\n\n"
            "如果系统缺少 WebView2，请安装 Microsoft Edge WebView2 Runtime。"
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
