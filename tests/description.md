# tests 目录说明

`core.test.mjs` 用 Node 内置 test runner 覆盖模型、快照、差异、撤销重做、序列化、几何、吸附和批量输入解析；`test_api.py` 用 pytest 覆盖项目保存/打开/最近文件/会话自动保存/坏输入拒绝。真实窗口验收走 `python app/shell.py --smoke`，不在 pytest 里启动 GUI。
