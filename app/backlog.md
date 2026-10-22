# app 变更记录

- 桌面壳只负责窗口、文件 API、画板/UI 状态和原子写入，不掺画布逻辑。
- 画板与 `.ui-state.json` 都放在应用旁 `boards/`；所有路径限制在目录内；删除进 `.trash`。
- 示例固定为 `board-sample.tcanvas.json`，只在缺失时创建、不可删除。
- smoke 看门狗 40 秒；本机 WebView2 窗口被遮挡时用 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--disable-gpu` 复测。
- 桌面桥接等待 15 秒，超时显示可重试错误页；正常窗口仍可能受 WebView2 环境抖动影响。