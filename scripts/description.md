# scripts 目录说明

开发与构建辅助，不是运行期依赖。`serve.py` 是禁用缓存的本地静态服务器（`python scripts/serve.py`，默认 8765）；`build_exe.py` 用当前 Python 前缀自动带上 Anaconda 的 OpenSSL/libffi DLL，调用 PyInstaller 生成窗口版 exe。
