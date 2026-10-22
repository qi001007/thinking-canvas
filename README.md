# 思考画布（Thinking Canvas）

思考画布是一张通用的数字格子纸：把数据放进可编辑表格，再用文字、形状、线条和箭头整理任意算法或问题的输入、中间状态与输出。软件不会预设算法，也不会执行用户输入。首次打开是空白画布。

## 启动与使用

双击项目根目录的 [ThinkingCanvas.exe](E:/算法思考工具/ThinkingCanvas.exe) 即可使用，无需安装 Python。当前单文件包大小为 10,418,704 字节。源码运行可双击 `start.cmd` 或使用 `python src/main.py`。`python src/main.py --smoke` 启动 Tk 窗口、检查空白项目和基本操作后退出；此模式不依赖截图库。

打包环境为保留的 `.build-env`。以下 PyInstaller 命令使用 onefile、windowed 模式，将 `src` 加入模块搜索路径，并显式携带 Tcl/Tk 和 OpenSSL DLL：

```powershell
.build-env\Scripts\python.exe -m PyInstaller --noconfirm --clean --onefile --windowed --name ThinkingCanvas --paths src --add-binary "E:/Anaconda/Library/bin/tk86t.dll;." --add-binary "E:/Anaconda/Library/bin/tcl86t.dll;." --add-binary "E:/Anaconda/Library/bin/libcrypto-1_1-x64.dll;." src/main.py
```

顶部可新建、打开、保存、撤销和重做，使用 `Ctrl+S` 保存 JSON 项目。插入表格后双击单元格或选中后按 Enter 编辑；Tab 前进一格。拖动可框选，区域支持着色和 TSV 复制粘贴，也可从 Excel 直接粘贴。表格可独立复制，标题双击改名、拖动标题移动。文字、直线、箭头、矩形、椭圆和画笔通过工具栏直接点击或拖动创建。箭头端点可以吸附到格子，移动表格时跟随。中键拖动画布或使用滚动条浏览。

表格值按纯文本保存，不会自动计算。新建、打开或关闭时，未保存修改会询问是否保存。

## 项目结构

- `src/`：Tkinter 应用和 JSON 模型。
- `tests/`：核心数据操作测试。
- `docs/`：需求、技术、进度、反馈和编码原则。
- `screenshots/`：本轮通用界面截图。
- `.history/`：上一版具体算法/高斯示例方案归档，不是当前设计。
