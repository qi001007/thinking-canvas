# web/js/ui 目录说明

渲染与交互层。`app.js` 持有项目、UI 状态和命令；`canvas.js` 负责视口、渲染、选择、拖动、连线、指针与就地编辑；`renderers.js` 生成对象 HTML；`timeline.js`、`inspector.js` 是底部时间线和右侧检查器；`boards.js` 是左侧画板栏（搜索/切换/删除）；`panes.js` 管理画板栏、工具栏、检查器栏的拖拽、图标轨道和宽度持久化；`bridge.js` 抽象桌面/浏览器画板与 UI 状态 API；`dom.js`、`icons.js` 是小型工具；`quickadd.js` 是批量输入浮层。UI 不维护第二份数据，只改 `project` 后重渲染。
