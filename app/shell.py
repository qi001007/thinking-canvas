"""Thinking Canvas desktop entry point (pywebview + local web assets)."""
from __future__ import annotations

import atexit
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
    from app.instance import clear_state, read_state, write_state
    from app.paths import app_data_dir, resource_dir, web_dir
    from app.win32 import child_pids, find_window, focus_window, pid_alive, process_image, terminate_process, window_pid
else:
    from .api import FileApi
    from .instance import clear_state, read_state, write_state
    from .paths import app_data_dir, resource_dir, web_dir
    from .win32 import child_pids, find_window, focus_window, pid_alive, process_image, terminate_process, window_pid

WINDOW_TITLE = "Thinking Canvas"
_MUTEX = None
_INSTANCE_LOCK = threading.Lock()

logging.getLogger("pywebview").setLevel(logging.CRITICAL)


def _startup_log(message: str) -> None:
    try:
        folder = app_data_dir()
        path = folder / "startup.log"
        if path.exists() and path.stat().st_size > 256 * 1024:
            path.replace(folder / "startup.log.1")
        with path.open("a", encoding="utf-8") as stream:
            stream.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} pid={os.getpid()} {message}\n")
    except Exception:
        pass


def _set_app_user_model_id() -> None:
    if os.name != "nt":
        return
    try:
        shell32 = ctypes.windll.shell32
        shell32.SetCurrentProcessExplicitAppUserModelID.argtypes = [ctypes.c_wchar_p]
        shell32.SetCurrentProcessExplicitAppUserModelID("ThinkingCanvas.ThinkingCanvas")
    except Exception:
        pass


def _instance_update(**fields) -> dict:
    with _INSTANCE_LOCK:
        state = read_state()
        if state.get("pid") not in (None, os.getpid()):
            return state
        state.update(fields)
        state["pid"] = os.getpid()
        state["exe"] = sys.executable
        state["updated_at"] = time.time()
        try:
            write_state(state)
        except OSError as exc:
            _startup_log(f"instance write failed: {exc}")
        return state


def _same_image(pid: int, expected: str | None) -> bool:
    if not pid or not expected:
        return False
    image = process_image(pid)
    if image is None:
        return False
    return os.path.normcase(str(image)) == os.path.normcase(str(expected))


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


def _focus_existing_window(pid: int | None = None) -> bool:
    if os.name != "nt":
        return False
    hwnd = find_window(pid or 0, WINDOW_TITLE)
    if not hwnd:
        return False
    return focus_window(hwnd)


def _profile_dir(name: str, fresh: bool = False) -> str:
    folder = Path(tempfile.gettempdir()) / "ThinkingCanvas" / name
    if fresh:
        shutil.rmtree(folder, ignore_errors=True)
    folder.mkdir(parents=True, exist_ok=True)
    return str(folder)


def _number(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _webview_children(pid: int) -> list[int]:
    return child_pids(pid, "msedgewebview2")


def _terminate_pid_tree(pid: int) -> bool:
    children = _webview_children(pid)
    ok = terminate_process(pid)
    for child in children:
        terminate_process(child)
    return ok


def _wait_for_existing(state: dict) -> str:
    pid = state.get("pid")
    if not isinstance(pid, int) or pid <= 0:
        return "unknown"
    if not _same_image(pid, state.get("exe")):
        return "gone"
    baseline = _number(state.get("heartbeat_at"))
    timeout = 12.0 if state.get("state") == "starting" else 6.0
    deadline = time.time() + timeout
    focused = False
    while time.time() < deadline:
        if not pid_alive(pid):
            return "gone"
        current = read_state()
        if not current:
            time.sleep(0.2)
            continue
        if current.get("pid") != pid:
            return "replaced"
        hwnd = find_window(pid, WINDOW_TITLE)
        if hwnd and not focused:
            focus_window(hwnd)
            focused = True
        heartbeat = _number(current.get("heartbeat_at"))
        if current.get("state") == "ready" and hwnd and heartbeat > baseline + 0.25:
            return "healthy"
        time.sleep(0.2)
    return "stale"


def _terminate_stale_instance(state: dict) -> bool:
    pid = state.get("pid")
    if not isinstance(pid, int) or pid <= 0:
        return False
    if not pid_alive(pid):
        return True
    if not _same_image(pid, state.get("exe")):
        _startup_log(f"refuse stale termination: pid={pid} image mismatch")
        return False
    _startup_log(f"terminating stale instance pid={pid}")
    _terminate_pid_tree(pid)
    for _ in range(60):
        if not pid_alive(pid):
            _startup_log(f"stale instance pid={pid} exited")
            return True
        time.sleep(0.1)
    return False


def _acquire_with_retry(timeout: float) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _acquire_normal_instance():
            return True
        time.sleep(0.2)
    return False


def _legacy_instance_recovery() -> bool:
    """Replace a window that predates the heartbeat marker.

    A fresh instance writes its marker before creating the window, so an
    existing window without a marker is either an older build or a failed
    start. Give a concurrently appearing marker a short grace period, then
    replace the old window so an upgrade cannot get stuck on a black window.
    """
    hwnd = find_window(0, WINDOW_TITLE)
    deadline = time.time() + 8
    while not hwnd and time.time() < deadline:
        time.sleep(0.2)
        hwnd = find_window(0, WINDOW_TITLE)
    if not hwnd:
        return False
    pid = window_pid(hwnd)
    _focus_existing_window(pid)
    if not pid:
        return False
    image = process_image(pid)
    if image is None or image.name.lower() not in {"thinkingcanvas.exe", "python.exe", "pythonw.exe"}:
        _startup_log(f"legacy instance pid={pid} image not ours: {image}")
        return False
    deadline = time.time() + 3
    while time.time() < deadline:
        current = read_state()
        if current.get("pid") == pid:
            outcome = _wait_for_existing(current)
            _startup_log(f"legacy window gained a marker; outcome={outcome}")
            return outcome == "healthy"
        time.sleep(0.2)
    _startup_log(f"legacy instance pid={pid} has no heartbeat; replacing")
    if _terminate_pid_tree(pid):
        return _acquire_with_retry(8)
    return False


def _ensure_single_instance() -> tuple[bool, bool]:
    if os.name != "nt":
        return True, False
    if _acquire_normal_instance():
        _startup_log("mutex acquired")
        return True, False
    _startup_log("mutex busy; inspecting existing instance")
    state = read_state()
    if state:
        outcome = _wait_for_existing(state)
        _startup_log(f"existing instance outcome={outcome}")
        if outcome == "healthy":
            _focus_existing_window(state.get("pid"))
            return False, False
        if outcome in ("gone", "replaced"):
            if _acquire_with_retry(5):
                _startup_log("existing instance exited; taking over")
                return True, False
            if _focus_existing_window():
                return False, False
        if outcome == "stale":
            if _terminate_stale_instance(state):
                if _acquire_with_retry(8):
                    _startup_log("stale instance replaced")
                    return True, True
    else:
        if _legacy_instance_recovery():
            _startup_log("legacy stale instance replaced")
            return True, True
        if _acquire_with_retry(2):
            return True, False
        if _focus_existing_window():
            return False, False
    _show_error(
        "Thinking Canvas 的旧窗口没有响应，且无法自动替换。\n\n"
        "请先关闭旧的 Thinking Canvas 窗口；如果关不掉，"
        "请在任务管理器结束 ThinkingCanvas.exe，然后重新打开。\n\n"
        f"启动日志：{app_data_dir() / 'startup.log'}"
    )
    return False, False


def _startup_watchdog(ready_event: threading.Event) -> None:
    if ready_event.wait(25):
        return
    _startup_log("watchdog: frontend not ready after 25s")
    _instance_update(state="error", error="frontend not ready within 25s")
    _show_error(
        "Thinking Canvas 启动超时：界面在 25 秒内没有就绪。\n\n"
        f"日志：{app_data_dir() / 'startup.log'}\n\n"
        "关闭此提示后重新打开应用。"
    )
    clear_state(os.getpid())
    os._exit(3)


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
    _startup_log(f"main start argv={argv} frozen={getattr(sys, 'frozen', False)}")
    _set_app_user_model_id()
    recovered = False
    if not smoke:
        start, recovered = _ensure_single_instance()
        if not start:
            return 0
        now = time.time()
        try:
            write_state(
                {
                    "pid": os.getpid(),
                    "exe": sys.executable,
                    "state": "starting",
                    "started_at": now,
                    "updated_at": now,
                }
            )
        except OSError as exc:
            _startup_log(f"instance marker write failed: {exc}")
        atexit.register(lambda: clear_state(os.getpid()))
        _startup_log("new instance starting")

    ready_event = threading.Event()

    def _on_ready() -> None:
        now = time.time()
        _instance_update(state="ready", ready_at=now, heartbeat_at=now)
        ready_event.set()
        _startup_log("frontend ready")

    def _on_heartbeat() -> None:
        current = read_state()
        if current.get("pid") == os.getpid():
            now = time.time()
            if current.get("state") != "ready":
                _instance_update(state="ready", ready_at=now, heartbeat_at=now)
                ready_event.set()
                _startup_log("frontend heartbeat ready")
            else:
                _instance_update(heartbeat_at=now)

    def _on_log(stage) -> None:
        _startup_log(f"frontend: {stage}")

    api = FileApi(
        boards_dir=tempfile.mkdtemp(prefix="tc-smoke-boards-") if smoke else None,
        ready_callback=None if smoke else _on_ready,
        heartbeat_callback=None if smoke else _on_heartbeat,
        log_callback=None if smoke else _on_log,
    )
    query = "?desktop=1&smoke=1" if smoke else "?desktop=1"
    url = str(web_dir() / "index.html") + query
    if smoke:
        profile = _profile_dir("smoke", fresh=True)
    elif recovered:
        profile = _profile_dir("webview-recovery", fresh=True)
    else:
        profile = _profile_dir("webview")
    icon_file = resource_dir() / "app" / "app.ico"
    icon = str(icon_file) if icon_file.exists() else None
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

    if not smoke:

        def _on_shown() -> None:
            hwnd = find_window(os.getpid(), WINDOW_TITLE)
            _instance_update(hwnd=int(hwnd or 0))
            _startup_log(f"window shown hwnd={hwnd}")

        def _on_closed() -> None:
            clear_state(os.getpid())
            _startup_log("window closed")

        window.events.shown += _on_shown
        window.events.loaded += lambda: _startup_log("pywebview loaded")
        window.events.closed += _on_closed

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
        threading.Thread(target=_startup_watchdog, args=(ready_event,), daemon=True).start()
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
                icon=icon,
            )
            return 0
        webview.start(
            http_server=True,
            debug=debug,
            private_mode=True,
            storage_path=profile,
            icon=icon,
        )
        clear_state(os.getpid())
        _startup_log("webview.start returned")
        return 0
    except Exception as exc:
        _startup_log(f"webview.start failed: {type(exc).__name__}: {exc}")
        _instance_update(state="error", error=str(exc))
        _show_error(
            "无法启动 Thinking Canvas。\n\n"
            f"{type(exc).__name__}: {exc}\n\n"
            "如果系统缺少 WebView2，请安装 Microsoft Edge WebView2 Runtime。"
        )
        clear_state(os.getpid())
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
