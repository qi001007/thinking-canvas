# tests 目录说明

`core.test.mjs` 用 Node 内置 test runner 覆盖模型、快照、差异、撤销重做、序列化、几何、吸附和批量输入解析；`test_api.py` 用 pytest 覆盖画板新建/列出/保存/加载/删除/路径安全、旧会话迁移、坏输入拒绝和版本握手；`test_instance.py` 覆盖实例标记清理与心跳新鲜度（pytest 共 13 项）。真实窗口验收走 `python app/shell.py --smoke`，另用进程级脚本验证坏 WebView2 实例的替换；不在 pytest 里启动 GUI。
