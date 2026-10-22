# app 变更记录

- 2026-10-22：建立 pywebview 桌面壳、原生文件 API、会话自动保存与最近文件；提供 `--smoke` 验收入口。
- 2026-10-22：smoke 改为前端回调 Python、结果落 `smoke.json`，避免 windowed 进程无 stdout；补 WebView2 临时 storage 解决正常启动 API 不挂载。
- 2026-10-22：加入 app 图标、windowed 正常启动验证；构建脚本见 `scripts/build_exe.py`。
- 2026-10-22：v0.1.1：fit 不放大超过 100%；版本号更新；窗口版 smoke 与正常窗口复验。
- 2026-10-22：画板统一到应用旁 `boards/`；新增画板 API、`.trash` 删除、旧 session 迁移；版本 0.2.0。
- 2026-10-22：新增 `boards/.ui-state.json` 与 `load_ui_state`/`save_ui_state`；版本 0.3.0；smoke 覆盖分栏与 UI 状态往返。
