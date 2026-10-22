"""Minimal Win32 process/window helpers for the single-instance entry."""
from __future__ import annotations

import ctypes
import os
from ctypes import wintypes
from pathlib import Path

IS_WINDOWS = os.name == "nt"
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
PROCESS_TERMINATE = 0x0001
SYNCHRONIZE = 0x00100000
TH32CS_SNAPPROCESS = 0x00000002
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value
SW_RESTORE = 9
WAIT_TIMEOUT = 0x102

if IS_WINDOWS:
    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _user32 = ctypes.windll.user32
    _kernel32.OpenProcess.restype = ctypes.c_void_p
    _kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    _kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
    _kernel32.QueryFullProcessImageNameW.argtypes = [
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.c_wchar_p,
        ctypes.POINTER(wintypes.DWORD),
    ]
    _kernel32.TerminateProcess.argtypes = [ctypes.c_void_p, wintypes.UINT]
    _kernel32.WaitForSingleObject.argtypes = [ctypes.c_void_p, wintypes.DWORD]
    _kernel32.CreateToolhelp32Snapshot.restype = ctypes.c_void_p
    _kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    _kernel32.Process32FirstW.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    _kernel32.Process32NextW.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    _user32.FindWindowW.restype = ctypes.c_void_p
    _user32.FindWindowW.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p]
    _user32.GetWindowThreadProcessId.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.DWORD)]
    _user32.GetWindowTextW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_int]
    _user32.GetWindowTextLengthW.argtypes = [ctypes.c_void_p]
    _user32.IsWindow.argtypes = [ctypes.c_void_p]
    _user32.IsWindowVisible.argtypes = [ctypes.c_void_p]
    _user32.ShowWindow.argtypes = [ctypes.c_void_p, ctypes.c_int]
    _user32.BringWindowToTop.argtypes = [ctypes.c_void_p]
    _user32.SetForegroundWindow.argtypes = [ctypes.c_void_p]
    _user32.EnumWindows.argtypes = [ctypes.c_void_p, ctypes.c_void_p]


class _ProcessEntry32W(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("cntUsage", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD),
        ("th32DefaultHeapID", ctypes.c_size_t),
        ("th32ModuleID", wintypes.DWORD),
        ("cntThreads", wintypes.DWORD),
        ("th32ParentProcessID", wintypes.DWORD),
        ("pcPriClassBase", wintypes.LONG),
        ("dwFlags", wintypes.DWORD),
        ("szExeFile", ctypes.c_wchar * 260),
    ]


def process_image(pid: int) -> Path | None:
    if not IS_WINDOWS or not pid:
        return None
    handle = _kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return None
    try:
        size = wintypes.DWORD(32768)
        buffer = ctypes.create_unicode_buffer(size.value)
        if not _kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
            return None
        return Path(buffer.value)
    finally:
        _kernel32.CloseHandle(handle)


def pid_alive(pid: int) -> bool:
    if not IS_WINDOWS or not pid:
        return False
    handle = _kernel32.OpenProcess(SYNCHRONIZE, False, pid)
    if not handle:
        return False
    try:
        return _kernel32.WaitForSingleObject(handle, 0) == WAIT_TIMEOUT
    finally:
        _kernel32.CloseHandle(handle)


def terminate_process(pid: int, wait_ms: int = 3000) -> bool:
    if not IS_WINDOWS or not pid:
        return False
    handle = _kernel32.OpenProcess(PROCESS_TERMINATE | SYNCHRONIZE, False, pid)
    if not handle:
        return False
    try:
        ok = bool(_kernel32.TerminateProcess(handle, 1))
        _kernel32.WaitForSingleObject(handle, wait_ms)
        return ok
    finally:
        _kernel32.CloseHandle(handle)


def child_pids(parent_pid: int, name_contains: str | None = None) -> list[int]:
    if not IS_WINDOWS or not parent_pid:
        return []
    snapshot = _kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if not snapshot or snapshot == INVALID_HANDLE_VALUE:
        return []
    result: list[int] = []
    try:
        entry = _ProcessEntry32W()
        entry.dwSize = ctypes.sizeof(_ProcessEntry32W)
        ok = _kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
        while ok:
            if entry.th32ParentProcessID == parent_pid:
                name = entry.szExeFile or ""
                if not name_contains or name_contains.lower() in name.lower():
                    result.append(int(entry.th32ProcessID))
            ok = _kernel32.Process32NextW(snapshot, ctypes.byref(entry))
    finally:
        _kernel32.CloseHandle(snapshot)
    return result


def window_pid(hwnd: int) -> int:
    if not IS_WINDOWS or not hwnd:
        return 0
    pid = wintypes.DWORD()
    _user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return int(pid.value)


def window_title(hwnd: int) -> str:
    if not IS_WINDOWS or not hwnd:
        return ""
    length = _user32.GetWindowTextLengthW(hwnd)
    buffer = ctypes.create_unicode_buffer(length + 1)
    _user32.GetWindowTextW(hwnd, buffer, length + 1)
    return buffer.value


def find_window(pid: int = 0, title: str | None = None) -> int:
    if not IS_WINDOWS:
        return 0
    if title:
        hwnd = _user32.FindWindowW(None, title)
        if hwnd and (not pid or window_pid(hwnd) == pid):
            return int(hwnd)
    if not pid and not title:
        return 0
    found: list[int] = []
    callback_type = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

    def visit(hwnd, _lparam):
        if _user32.IsWindowVisible(hwnd) and (not pid or window_pid(hwnd) == pid):
            if not title or window_title(hwnd) == title:
                found.append(int(hwnd))
                return False
        return True

    callback = callback_type(visit)
    _user32.EnumWindows(callback, 0)
    return found[0] if found else 0


def focus_window(hwnd: int) -> bool:
    if not IS_WINDOWS or not hwnd or not _user32.IsWindow(hwnd):
        return False
    _user32.ShowWindow(hwnd, SW_RESTORE)
    _user32.BringWindowToTop(hwnd)
    _user32.SetForegroundWindow(hwnd)
    return True
