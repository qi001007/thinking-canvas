# app 目录说明

桌面外壳，只负责窗口、文件对话框、项目读写和自动保存，不掺画布逻辑。`shell.py` 启动 pywebview、加载 `web/`、处理 smoke 与 windowed 进程的流重定向；`api.py` 把 JS 的文件请求转成原子写入和原生对话框；`paths.py` 统一资源目录与 `%APPDATA%/ThinkingCanvas`；`app.ico` 是窗口/exe 图标。
