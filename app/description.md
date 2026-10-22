# app 目录说明

桌面外壳，只负责窗口、文件读写、画板/UI 状态和自动保存，不掺画布逻辑。

- `shell.py`：启动 pywebview、加载 `web/`、单实例健康检查、启动看门狗，以及 smoke/windowed 流重定向。
- `api.py`：把 JS 的文件请求转成原子写入和原生对话框，并提供 `boot_ready` / `heartbeat` 启动握手。
- `instance.py`：运行时实例标记与心跳状态（`%TEMP%/ThinkingCanvas/instance.json`），供二次启动判断旧窗口是否还健康。
- `win32.py`：进程/窗口枚举、响应检查、焦点恢复和过期实例清理的 Win32 封装。
- `paths.py`：统一资源目录与 `boards/` 的位置。
- `app.ico`：窗口/exe 图标。
