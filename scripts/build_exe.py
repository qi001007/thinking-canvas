"""Build the Windows one-file app with PyInstaller.

Run with the build environment's Python, e.g.:
    .build-env\\Scripts\\python.exe scripts\\build_exe.py
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def optional_binary(path: Path) -> list[str]:
    return ["--add-binary", f"{path};."] if path.exists() else []


def main() -> int:
    base = Path(sys.base_prefix)
    bin_dir = base / "Library" / "bin"
    args = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--windowed",
        "--name",
        "ThinkingCanvas",
        "--icon",
        str(ROOT / "app" / "app.ico"),
        "--add-data",
        f"{ROOT / 'web'};web",
        *optional_binary(bin_dir / "libcrypto-1_1-x64.dll"),
        *optional_binary(bin_dir / "libssl-1_1-x64.dll"),
        *optional_binary(bin_dir / "ffi.dll"),
        str(ROOT / "app" / "shell.py"),
    ]
    print(" ".join(args))
    return subprocess.call(args, cwd=ROOT)


if __name__ == "__main__":
    raise SystemExit(main())
