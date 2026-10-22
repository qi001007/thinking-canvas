"""Thinking Canvas desktop entry point (pywebview + local web assets)."""
from __future__ import annotations

import ctypes
import json
import logging
import os
import shutil
import sys
import tempfile
import threading
import time
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
_MUTEX = None

logging.getLogger("pywebview").setLevel(logging.CRITICAL)


def _acquire_normal_instance() -> bool:
    global _MUTEX
    if os.name != "nt":
        return True
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateMutexW.restype = ctypes.c_void_p
    kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
    handle = kernel32.CreateMutexW(None, False, "Local\\ThinkingCanvas.Normal")
    if not handle:
        return True
    if ctypes.get_last_error() == 183:
        kernel32.CloseHandle(handle)
        return False
    _MUTEX = handle
    return True


def _focus_existing_window() -> None:
    if os.name != "nt":
        return
    try:
        user32 = ctypes.windll.user32
        user32.FindWindowW.restype = ctypes.c_void_p
        user32.FindWindowW.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p]
        hwnd = user32.FindWindowW(None, WINDOW_TITLE)
        if hwnd:
            user32.ShowWindow(hwnd, 9)
            user32.SetForegroundWindow(hwnd)
    except Exception:
        pass


def _profile_dir(name: str, fresh: bool = False) -> str:
    folder = Path(tempfile.gettempdir()) / "ThinkingCanvas" / name
    if fresh:
        shutil.rmtree(folder, ignore_errors=True)
    folder.mkdir(parents=True, exist_ok=True)
    return str(folder)


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
    if not smoke and not _acquire_normal_instance():
        _focus_existing_window()
        return 0
    api = FileApi(boards_dir=tempfile.mkdtemp(prefix="tc-smoke-boards-") if smoke else None)
    query = "?desktop=1&smoke=1" if smoke else "?desktop=1"
    url = str(web_dir() / "index.html") + query
    profile = _profile_dir("smoke", fresh=smoke) if smoke else _profile_dir("webview")
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
        on_top=True,
        focus=True,
        confirm_close=False,
    )
    api.attach(window)

    def _drop_on_top() -> None:
        for _ in range(80):
            try:
                if window.evaluate_js("Boolean(window.__TC_READY__)"):
                    break
            except Exception:
                pass
            time.sleep(0.25)
        try:
            window.on_top = False
        except Exception:
            pass

    if not smoke:
        threading.Thread(target=_drop_on_top, daemon=True).start()
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
                storage_path=profile,
            )
            return 0
        webview.start(
            http_server=True,
            debug=debug,
            private_mode=True,
            storage_path=profile,
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
