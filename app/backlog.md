# app 变更记录

- 桌面壳只负责窗口、文件 API、画板/UI 状态和原子写入，不掺画布逻辑。
- 画板与 `.ui-state.json` 都放在应用旁 `boards/`；所有路径限制在目录内；删除进 `.trash`。
- 示例固定为 `board-sample.tcanvas.json`，只在缺失时创建、不可删除。
- smoke 看门狗 40 秒；本机 WebView2 窗口被遮挡时用 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--disable-gpu` 复测。
- 桌面桥接等待 15 秒，超时显示可重试错误页；正常窗口单实例，WebView2 使用固定 profile。
- 启动错误层必须保留 `[hidden] { display:none }`；否则会变成全屏空白遮罩。
- 窗口保持不透明 `background_color`；删掉它会走透明 WebView2 合成，显卡上可能明显变慢。
- 正常窗口启动时短暂置顶，`__TC_READY__` 后取消置顶；否则打包版的 WebView2 API 注入会被未激活窗口拖慢。
- 2026-10-23：版本号升到 0.3.7。
- `FileApi` 的非方法状态必须以下划线开头；pywebview 会递归枚举公开属性，公开 `window` 会让它走进 WebView2 原生图并卡住 API 注入。