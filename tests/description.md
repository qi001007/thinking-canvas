# tests 目录说明

`core.test.mjs` 用 Node 内置 test runner 覆盖模型、快照、差异、撤销重做、序列化、几何、吸附和批量输入解析；`test_api.py` 用 pytest 覆盖画板新建/列出/保存/加载/删除/路径安全、旧会话迁移和坏输入拒绝（8 项）。真实窗口验收走 `python app/shell.py --smoke`，不在 pytest 里启动 GUI。
