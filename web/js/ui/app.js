/** Application state, commands and UI wiring. */
import { diffForView } from "../core/diff.js";
import { History } from "../core/history.js";
import {
  addObject,
  createProject,
  duplicateObject,
  getObject,
  nextObjectName,
  nextPointerColor,
  nextPointerName,
  removeObject,
  setPointerState,
} from "../core/model.js";
import { parseEntries, parseGrid, parseSet } from "../core/parse.js";
import { createSampleProject } from "../core/sample.js";
import { deserializeProject, serializeProject } from "../core/serialize.js";
import { recordStep as captureStep, deleteStep as removeStep, stepForId, stepIndex } from "../core/steps.js";
import * as Geometry from "../core/geometry.js";
import { Canvas } from "./canvas.js";
import { Timeline } from "./timeline.js";
import { Inspector } from "./inspector.js";
import { QuickAdd } from "./quickadd.js";
import { BoardsPanel } from "./boards.js";
import { Panes } from "./panes.js";
import { debounce, el, isTypingTarget } from "./dom.js";
import { hydrateIcons, icon } from "./icons.js";

const TOOL_HINTS = {
  select: "拖动移动 · 双击编辑 · 拖空白处框选",
  hand: "拖动平移",
  connector: "从格子或卡片拖到另一处",
  pen: "拖动绘制",
  rect: "拖动绘制",
  eraser: "点击或拖过笔迹/连线擦除",
};

export class App {
  constructor(project, path, bridge) {
    this.project = project || createProject();
    this.path = path || "";
    this.bridge = bridge;
    this.history = new History();
    this.geometry = Geometry;
    this.ui = {
      viewStepId: null,
      selection: new Set(),
      cellSelection: null,
      tool: "select",
      viewport: { x: 80, y: 60, zoom: 1 },
      diffEnabled: true,
    };
    this.currentSnapshot = null;
    this.dirty = false;
    this.saveError = null;
    this.changeSeq = 0;
    this.autosave = debounce(() => this.runAutosave(), 500);
    this.contextMenu = null;
    this.menuOutside = null;
    this.boards = [];
    this.boardsDir = "";
    this.root = document.getElementById("app");
    this.titleInput = document.getElementById("doc-title");
    this.saveStateEl = document.getElementById("save-state");
    this.undoBtn = document.getElementById("btn-undo");
    this.redoBtn = document.getElementById("btn-redo");
    this.recordBtn = document.getElementById("btn-record");
    this.statusHint = document.getElementById("status-hint");
    this.statusFloat = document.getElementById("status-float");
    this.statusClose = document.getElementById("status-close");
    this.statusTimer = null;
    this.helpModal = document.getElementById("help-modal");
    this.canvas = new Canvas(this);
    this.timeline = new Timeline(this);
    this.inspector = new Inspector(this);
    this.quickAdd = new QuickAdd(this);
    this.boardsPanel = new BoardsPanel(this);
    this.panes = new Panes(bridge);
    this.bindUI();
    this.bindStatus();
    this.bindShortcuts();
  }

  async start() {
    hydrateIcons();
    this.undoBtn.innerHTML = icon("undo");
    this.redoBtn.innerHTML = icon("redo");
    await this.panes.hydrate();
    await this.loadBoardsAndOpen();
    this.renderAll();
    this.canvas.fit();
    this.syncChrome();
    this.showStatus(null, 6500);
    window.__TC_READY__ = true;
    window.__TC__ = this;
  }

  async loadBoardsAndOpen() {
    const info = await this.bridge.boardsInfo();
    this.boardsDir = info?.dir || "";
    await this.refreshBoards();
    const target = this.boards.find((board) => !board.sample);
    if (!target) {
      await this.createBoard({ silent: true });
      return;
    }
    const result = await this.bridge.loadBoard(target.path);
    if (!result?.ok) {
      await this.createBoard({ silent: true });
      return;
    }
    try {
      this.loadProject(deserializeProject(result.content), target.path, { fit: true, autosave: false });
    } catch {
      await this.createBoard({ silent: true });
    }
  }

  async refreshBoards() {
    const result = await this.bridge.listBoards();
    this.boards = result?.items || [];
    if (result?.dir) this.boardsDir = result.dir;
    this.boardsPanel.render(this.boards, this.path, this.boardsDir);
  }

  // ------------------------------------------------------------- rendering
  renderAll(options = {}) {
    this.canvas.render();
    this.timeline.render();
    if (options.inspector !== false) this.inspector.render();
    this.syncChrome();
  }

  syncChrome() {
    if (document.activeElement !== this.titleInput) this.titleInput.value = this.project.title || "未命名画板";
    document.title = `${this.project.title || "未命名画板"} · Thinking Canvas`;
    this.undoBtn.disabled = !this.history.canUndo();
    this.redoBtn.disabled = !this.history.canRedo();
    this.recordBtn.disabled = Boolean(this.ui.viewStepId);
    this.saveStateEl.classList.toggle("dirty", this.dirty && !this.saveError);
    this.saveStateEl.classList.toggle("error", Boolean(this.saveError));
    if (this.saveError) this.saveStateEl.textContent = "自动保存失败";
    else if (this.dirty) this.saveStateEl.textContent = "未保存";
    else this.saveStateEl.textContent = "已自动保存";
    document.getElementById("toggle-diff").checked = this.ui.diffEnabled;
    this.syncSidebar();
  }

  syncSidebar() {
    document.querySelectorAll(".tool[data-tool]").forEach((button) => {
      button.classList.toggle("active", button.dataset.tool === this.ui.tool);
    });
  }

  selectionChanged() {
    this.canvas.render();
    this.inspector.render();
    this.syncChrome();
  }

  selectObject(id, additive = false) {
    if (!id) {
      this.ui.selection.clear();
    } else if (additive) {
      if (this.ui.selection.has(id)) this.ui.selection.delete(id);
      else this.ui.selection.add(id);
    } else {
      this.ui.selection.clear();
      this.ui.selection.add(id);
    }
    this.ui.cellSelection = null;
    this.selectionChanged();
  }

  refreshInspector() {
    this.inspector.render();
  }

  // ------------------------------------------------------------- dirty / save
  markDirty() {
    this.project.updatedAt = new Date().toISOString();
    this.dirty = true;
    this.changeSeq += 1;
    this.saveError = null;
    this.syncChrome();
    this.autosave();
  }

  scheduleAutosave() {
    this.autosave();
  }

  async runAutosave() {
    const seq = this.changeSeq;
    const boardPath = this.path;
    let content;
    try {
      content = serializeProject(this.project);
    } catch (error) {
      this.saveError = error.message;
      this.syncChrome();
      return;
    }
    const result = boardPath
      ? await this.bridge.saveBoard(boardPath, content)
      : await this.bridge.createBoard(content, this.project.title);
    if (result?.ok) {
      if (this.path === boardPath || !boardPath) {
        this.path = result.path;
        const item = result.item;
        const existing = this.boards.find((board) => board.path === this.path);
        if (item && existing) Object.assign(existing, item);
        else if (item) this.boards.unshift(item);
        this.boardsPanel.render(this.boards, this.path, this.boardsDir);
      }
      if (seq === this.changeSeq) this.dirty = false;
      this.saveError = null;
    } else {
      this.saveError = result?.error || "未知错误";
    }
    this.syncChrome();
  }

  async saveCurrent(notify = false) {
    this.changeSeq += 1;
    await this.runAutosave();
    if (notify && !this.saveError) this.toast("已保存");
  }

  uniqueBoardTitle() {
    const base = "新画板";
    const used = new Set(this.boards.map((board) => board.title));
    let index = 1;
    while (used.has(`${base} ${index}`)) index += 1;
    return `${base} ${index}`;
  }

  async createBoard(options = {}) {
    this.autosave.cancel();
    this.boardsPanel.setQuery("");
    const project = createProject(this.uniqueBoardTitle());
    const content = serializeProject(project);
    const result = await this.bridge.createBoard(content, project.title);
    if (!result?.ok) {
      this.toast(result?.error || "新建画板失败");
      return false;
    }
    this.loadProject(project, result.path, { fit: true, autosave: false });
    await this.refreshBoards();
    this.renderAll();
    this.canvas.fit();
    if (!options.silent) this.titleInput.select();
    return true;
  }

  async newBoard() {
    await this.runAutosave();
    await this.createBoard();
  }

  async loadBoard(path) {
    if (!path || path === this.path) return true;
    this.autosave.cancel();
    await this.runAutosave();
    const result = await this.bridge.loadBoard(path);
    if (!result?.ok) {
      this.toast(result?.error || "打开画板失败");
      return false;
    }
    try {
      this.loadProject(deserializeProject(result.content), path, { fit: true, autosave: false });
      await this.refreshBoards();
      return true;
    } catch (error) {
      this.toast(error.message || "画板内容损坏");
      return false;
    }
  }

  async deleteBoard(path) {
    const board = this.boards.find((item) => item.path === path);
    if (!board) return;
    if (board.sample) {
      this.toast("示例画板不能删除");
      return;
    }
    if (!window.confirm(`删除「${board.title}」？\n文件会移到 boards/.trash。`)) return;
    this.autosave.cancel();
    const wasActive = path === this.path;
    if (wasActive) await this.runAutosave();
    const result = await this.bridge.deleteBoard(path);
    if (!result?.ok) {
      this.toast(result?.error || "删除失败");
      return;
    }
    if (wasActive) this.boardsPanel.setQuery("");
    if (path === this.path) {
      const next = this.boards.find((item) => item.path !== path && !item.sample);
      if (next) {
        const loaded = await this.bridge.loadBoard(next.path);
        if (loaded?.ok) {
          this.loadProject(deserializeProject(loaded.content), next.path, { fit: true, autosave: false });
        } else {
          await this.createBoard({ silent: true });
        }
      } else {
        await this.createBoard({ silent: true });
      }
    }
    await this.refreshBoards();
    this.renderAll();
    this.toast("已移到 .trash");
  }

  async openBoardsFolder() {
    const result = await this.bridge.openBoardsFolder();
    if (!result?.ok) this.toast(result?.error || "无法打开画板文件夹");
  }

  loadProject(project, path = "", options = {}) {
    this.autosave.cancel();
    this.project = project;
    this.path = path || "";
    this.history.reset();
    this.ui.viewStepId = null;
    this.ui.selection.clear();
    this.ui.cellSelection = null;
    this.ui.tool = "select";
    this.dirty = false;
    this.saveError = null;
    this.renderAll();
    if (options.fit !== false) this.canvas.fit();
    else this.canvas.setViewport({ x: 80, y: 60, zoom: 1 });
    this.syncChrome();
    this.boardsPanel.render(this.boards, this.path, this.boardsDir);
  }

  async openSample() {
    this.autosave.cancel();
    if (this.path) await this.runAutosave();
    const existing = this.boards.find((board) => board.sample);
    if (existing) {
      if (existing.path === this.path) {
        this.setTool("select", false);
        this.canvas.fit();
        return;
      }
      if (await this.loadBoard(existing.path)) {
        this.setTool("select", false);
        return;
      }
    }
    const sample = createSampleProject();
    const result = await this.bridge.ensureSampleBoard(serializeProject(sample), sample.title);
    if (!result?.ok) {
      this.toast(result?.error || "示例打开失败");
      return;
    }
    const loaded = await this.bridge.loadBoard(result.path);
    if (!loaded?.ok) {
      this.toast(loaded?.error || "示例打开失败");
      return;
    }
    try {
      this.loadProject(deserializeProject(loaded.content), result.path, { fit: true, autosave: false });
      await this.refreshBoards();
      this.setTool("select", false);
    } catch (error) {
      this.toast(error.message || "示例内容损坏");
    }
  }

  // ------------------------------------------------------------- steps
  recordStep() {
    if (this.ui.viewStepId) {
      this.toast("只读");
      return;
    }
    if (!this.project.objects.length) {
      this.toast("先放数据");
      return;
    }
    this.history.push(this.project);
    captureStep(this.project, {});
    this.ui.cellSelection = null;
    this.markDirty();
    this.renderAll();
    this.toast(`已记录第 ${this.project.steps.length} 步`);
  }

  goToStep(stepId) {
    if (!stepForId(this.project, stepId)) return;
    this.ui.viewStepId = stepId;
    this.ui.selection.clear();
    this.ui.cellSelection = null;
    this.renderAll();
  }

  goLive() {
    this.ui.viewStepId = null;
    this.ui.selection.clear();
    this.ui.cellSelection = null;
    this.renderAll();
  }

  goPrevious() {
    if (!this.ui.viewStepId) {
      const last = this.project.steps[this.project.steps.length - 1];
      if (last) this.goToStep(last.id);
      return;
    }
    const index = stepIndex(this.project, this.ui.viewStepId);
    if (index > 0) this.goToStep(this.project.steps[index - 1].id);
  }

  goNext() {
    if (!this.ui.viewStepId) return;
    const index = stepIndex(this.project, this.ui.viewStepId);
    if (index + 1 < this.project.steps.length) this.goToStep(this.project.steps[index + 1].id);
    else this.goLive();
  }

  deleteStep(stepId) {
    const step = stepForId(this.project, stepId);
    if (!step) return;
    if (!window.confirm(`删除「${step.title}」？`)) return;
    this.history.push(this.project);
    removeStep(this.project, stepId);
    if (this.ui.viewStepId === stepId) this.ui.viewStepId = null;
    this.markDirty();
    this.renderAll();
    this.toast("已删除 · Ctrl+Z 撤销");
  }

  // ------------------------------------------------------------- tools / objects
  setTool(tool, announce = true) {
    this.ui.tool = tool;
    if (tool !== "select") this.ui.cellSelection = null;
    this.canvas.renderChrome();
    this.syncSidebar();
    this.showStatus(TOOL_HINTS[tool] || TOOL_HINTS.select);
    if (announce && tool !== "select") this.canvas.viewportEl.focus();
  }

  bindStatus() {
    this.statusFloat.addEventListener("mouseenter", () => clearTimeout(this.statusTimer));
    this.statusFloat.addEventListener("mouseleave", () => {
      if (!this.statusFloat.classList.contains("is-hidden")) this.showStatus(null, 1600);
    });
    this.statusClose.addEventListener("click", () => this.hideStatus());
  }

  showStatus(text, duration = 3200) {
    if (text != null) this.statusHint.textContent = text;
    clearTimeout(this.statusTimer);
    this.statusFloat.inert = false;
    this.statusFloat.classList.remove("is-hidden");
    this.statusTimer = setTimeout(() => this.hideStatus(), duration);
  }

  hideStatus() {
    clearTimeout(this.statusTimer);
    this.statusFloat.inert = true;
    this.statusFloat.classList.add("is-hidden");
  }

  addObject(kind) {
    if (this.ui.viewStepId) {
      this.toast("只读");
      return;
    }
    const app = this;
    const nameKind = kind === "matrix" ? "array" : kind === "invariant" ? "sticky" : kind;
    const viewportRect = this.canvas.viewportEl.getBoundingClientRect();
    const center = Geometry.screenToWorld(this.ui.viewport, viewportRect.width / 2, viewportRect.height / 2);
    let rows = 1;
    let cols = 5;
    let width = 24 + cols * 62 + 18 + 2;
    let height = rows * 34 + 89;
    const options = { name: nextObjectName(this.project, nameKind) };
    if (kind === "array" || kind === "matrix") {
      rows = kind === "matrix" ? 3 : 1;
      cols = kind === "matrix" ? 4 : 5;
      width = 24 + cols * 62 + 18 + 2;
      height = rows * 34 + 89;
      options.rows = rows;
      options.cols = cols;
      if (kind === "matrix") kind = "array";
    } else if (kind === "list") {
      options.items = [""];
      width = 140;
      height = 79;
    } else if (kind === "dict") {
      options.entries = [{ key: "", value: "" }];
      width = 220;
      height = 98;
    } else if (kind === "set") {
      options.items = [];
      width = 210;
      height = 77;
    } else if (kind === "variable") {
      options.value = "—";
      width = 156;
      height = 89;
    } else if (kind === "node") {
      options.value = "1";
      width = 132;
      height = 54;
    } else if (kind === "sticky") {
      options.text = "写点什么…";
      options.color = "yellow";
      width = 220;
      height = 104;
    } else if (kind === "invariant") {
      options.text = "不变量：每次循环开始时，……";
      options.color = "green";
      width = 280;
      height = 104;
      kind = "sticky";
      options.name = "不变量";
    } else if (kind === "text") {
      options.text = "";
      width = 220;
      height = 40;
    } else if (kind === "function") {
      options.signature = "solve(input) -> output";
      options.inputs = [{ k: "输入", v: "" }];
      options.output = { k: "输出", v: "" };
      options.complexity = "";
      width = 340;
      height = 184;
    } else {
      return;
    }
    const preferred = { x: center.x - width / 2, y: center.y - height / 2 };
    const spot = Geometry.findFreeSpot(this.project.objects, this.currentSnapshot, width, height, preferred);
    options.x = spot.x;
    options.y = spot.y;
    this.history.push(this.project);
    const object = addObject(this.project, kind, options);
    this.ui.selection.clear();
    this.ui.selection.add(object.id);
    this.ui.cellSelection = kind === "array" ? { objectId: object.id, r1: 0, c1: 0, r2: 0, c2: 0 } : null;
    this.markDirty();
    this.renderAll();
    this.canvas.ensureVisible(Geometry.objectBounds(object, this.project.live));
  }

  pointerTargetFromSelection() {
    const cell = this.ui.cellSelection;
    if (cell) return { targetId: cell.objectId, row: cell.r1, col: cell.c1 };
    const id = Array.from(this.ui.selection)[0];
    const object = getObject(this.project, id);
    if (!object) return null;
    if (object.kind === "array") return { targetId: object.id, row: 0, col: 0 };
    if (object.kind === "list" || object.kind === "dict") return { targetId: object.id, index: 0 };
    if (object.kind === "node" || object.kind === "variable") return { targetId: object.id };
    return null;
  }

  addPointerAtSelection() {
    if (this.ui.viewStepId) {
      this.toast("只读");
      return;
    }
    const target = this.pointerTargetFromSelection();
    if (!target) {
      this.toast("先选一个位置");
      return;
    }
    const app = this;
    this.history.push(this.project);
    const pointer = addObject(this.project, "pointer", {
      name: nextPointerName(this.project),
      color: nextPointerColor(this.project),
      target,
    });
    this.ui.selection.clear();
    this.ui.selection.add(pointer.id);
    this.markDirty();
    this.renderAll();
  }

  openQuickAdd(objectId) {
    this.quickAdd.open(objectId);
  }

  applyQuickInput(objectId, text) {
    const object = getObject(this.project, objectId);
    if (!object) return;
    const state = this.project.live.states[objectId];
    if (!state) return;
    let parsedGrid = null;
    if (object.kind === "array") {
      parsedGrid = parseGrid(text);
      if (parsedGrid.length > 100 || parsedGrid[0].length > 60) {
        this.toast("最多 100 行、60 列。");
        return;
      }
    }
    this.history.push(this.project);
    if (object.kind === "array") {
      state.data = parsedGrid;
      state.marks = parsedGrid.map((row) => row.map(() => ""));
      this.ui.cellSelection = { objectId, r1: 0, c1: 0, r2: 0, c2: 0 };
    } else if (object.kind === "dict") {
      state.entries = parseEntries(text).slice(0, 300);
    } else if (object.kind === "set") {
      state.items = parseSet(text).slice(0, 300);
    }
    this.clampLivePointers();
    this.markDirty();
    this.renderAll();
  }

  // ------------------------------------------------------------- array ops
  clampLivePointers() {
    for (const pointer of this.project.objects.filter((object) => object.kind === "pointer")) {
      const target = this.project.live.pointers[pointer.id];
      if (!target) continue;
      const object = getObject(this.project, target.targetId);
      if (!object) {
        this.project.live.pointers[pointer.id] = null;
        continue;
      }
      const state = this.project.live.states[object.id];
      if (object.kind === "array" && state) {
        target.row = Math.max(0, Math.min(target.row ?? 0, state.data.length - 1));
        target.col = Math.max(0, Math.min(target.col ?? 0, state.data[0].length - 1));
      } else if ((object.kind === "list" || object.kind === "dict") && state) {
        const length = object.kind === "list" ? state.items.length : state.entries.length;
        if (length <= 0) this.project.live.pointers[pointer.id] = null;
        else target.index = Math.min(target.index || 0, length - 1);
      }
    }
  }

  resizeArray(objectId, action) {
    if (this.ui.viewStepId) {
      this.toast("只读");
      return;
    }
    const state = this.project.live.states[objectId];
    if (!state) return;
    const rows = state.data.length;
    const cols = state.data[0].length;
    if ((action === "add-row" && rows >= 100) || (action === "add-col" && cols >= 60)) return;
    if ((action === "del-row" && rows <= 1) || (action === "del-col" && cols <= 1)) return;
    this.history.push(this.project);
    if (action === "add-row") {
      state.data.push(Array(cols).fill(""));
      state.marks.push(Array(cols).fill(""));
    } else if (action === "del-row") {
      state.data.pop();
      state.marks.pop();
    } else if (action === "add-col") {
      state.data.forEach((row) => row.push(""));
      state.marks.forEach((row) => row.push(""));
    } else if (action === "del-col") {
      state.data.forEach((row) => row.pop());
      state.marks.forEach((row) => row.pop());
    }
    this.clampLivePointers();
    this.markDirty();
    this.renderAll();
  }

  markSelection(mark) {
    const selection = this.ui.cellSelection;
    if (!selection) {
      this.toast("先选格子");
      return;
    }
    const state = this.project.live.states[selection.objectId];
    if (!state) return;
    this.history.push(this.project);
    const r1 = Math.min(selection.r1, selection.r2);
    const r2 = Math.max(selection.r1, selection.r2);
    const c1 = Math.min(selection.c1, selection.c2);
    const c2 = Math.max(selection.c1, selection.c2);
    for (let row = r1; row <= r2; row += 1) {
      for (let col = c1; col <= c2; col += 1) state.marks[row][col] = mark;
    }
    this.markDirty();
    this.renderAll();
  }

  copySelectedCells() {
    const selection = this.ui.cellSelection;
    if (!selection) return;
    const state = this.project.live.states[selection.objectId];
    if (!state) return;
    const r1 = Math.min(selection.r1, selection.r2);
    const r2 = Math.max(selection.r1, selection.r2);
    const c1 = Math.min(selection.c1, selection.c2);
    const c2 = Math.max(selection.c1, selection.c2);
    const text = state.data
      .slice(r1, r2 + 1)
      .map((row) => row.slice(c1, c2 + 1).join("\t"))
      .join("\n");
    if (!navigator.clipboard?.writeText) {
      this.toast("当前环境不支持写剪贴板。");
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => this.toast("已复制"))
      .catch(() => this.toast("浏览器不允许写剪贴板"));
  }

  async pasteIntoSelection() {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      this.toast("浏览器不允许读剪贴板。");
      return;
    }
    if (!text.trim()) return;
    const grid = parseGrid(text);
    const selection = this.ui.cellSelection;
    if (!selection) {
      this.createArrayFromGrid(grid);
      return;
    }
    const state = this.project.live.states[selection.objectId];
    if (!state) return;
    const startRow = Math.min(selection.r1, selection.r2);
    const startCol = Math.min(selection.c1, selection.c2);
    const rows = Math.max(state.data.length, startRow + grid.length);
    const cols = Math.max(state.data[0].length, startCol + grid[0].length);
    if (rows > 100 || cols > 60) {
      this.toast("粘贴范围超过 100 行 / 60 列。");
      return;
    }
    this.history.push(this.project);
    while (state.data.length < rows) {
      state.data.push(Array(cols).fill(""));
      state.marks.push(Array(cols).fill(""));
    }
    for (const row of state.data) while (row.length < cols) row.push("");
    for (const row of state.marks) while (row.length < cols) row.push("");
    grid.forEach((row, r) => row.forEach((value, c) => (state.data[startRow + r][startCol + c] = value)));
    this.ui.cellSelection = {
      objectId: selection.objectId,
      r1: startRow,
      c1: startCol,
      r2: startRow + grid.length - 1,
      c2: startCol + grid[0].length - 1,
    };
    this.clampLivePointers();
    this.markDirty();
    this.renderAll();
    this.toast("已粘贴");
  }

  createArrayFromGrid(grid) {
    this.history.push(this.project);
    const object = addObject(this.project, "array", {
      name: nextObjectName(this.project, "array"),
      rows: grid.length,
      cols: grid[0].length,
      data: grid,
      x: 120,
      y: 120,
    });
    this.ui.selection.clear();
    this.ui.selection.add(object.id);
    this.ui.cellSelection = { objectId: object.id, r1: 0, c1: 0, r2: 0, c2: 0 };
    this.markDirty();
    this.renderAll();
    this.canvas.ensureVisible(Geometry.objectBounds(object, this.project.live));
  }

  // ------------------------------------------------------------- list / dict / set
  addListItem(objectId) {
    const state = this.project.live.states[objectId];
    if (!state) return;
    this.history.push(this.project);
    state.items.push("");
    state.marks.push("");
    this.markDirty();
    this.renderAll();
  }

  removeListItem(objectId) {
    const state = this.project.live.states[objectId];
    if (!state || state.items.length <= 0) return;
    this.history.push(this.project);
    state.items.pop();
    state.marks.pop();
    this.clampLivePointers();
    this.markDirty();
    this.renderAll();
  }

  toggleListOrientation(objectId) {
    const object = getObject(this.project, objectId);
    if (!object) return;
    this.history.push(this.project);
    object.orientation = object.orientation === "horizontal" ? "vertical" : "horizontal";
    this.markDirty();
    this.renderAll();
  }

  addDictRow(objectId) {
    const state = this.project.live.states[objectId];
    if (!state) return;
    this.history.push(this.project);
    state.entries.push({ key: "", value: "" });
    this.markDirty();
    this.renderAll();
  }

  removeDictRow(objectId) {
    const state = this.project.live.states[objectId];
    if (!state || state.entries.length <= 0) return;
    this.history.push(this.project);
    state.entries.pop();
    this.clampLivePointers();
    this.markDirty();
    this.renderAll();
  }

  addSetItem(objectId) {
    const state = this.project.live.states[objectId];
    if (!state) return;
    this.history.push(this.project);
    state.items.push("");
    this.markDirty();
    this.renderAll();
  }

  removeSetItem(objectId) {
    const state = this.project.live.states[objectId];
    if (!state || state.items.length <= 0) return;
    this.history.push(this.project);
    state.items.pop();
    this.markDirty();
    this.renderAll();
  }

  addFunctionInput(objectId) {
    const object = getObject(this.project, objectId);
    if (!object || object.kind !== "function") return;
    this.history.push(this.project);
    object.inputs.push({ k: "输入", v: "" });
    this.markDirty();
    this.renderAll();
  }

  setStickyColor(objectId, color) {
    const object = getObject(this.project, objectId);
    if (!object || object.kind !== "sticky") return;
    this.history.push(this.project);
    object.color = color;
    this.markDirty();
    this.renderAll();
  }

  setPointerColor(objectId, color) {
    const object = getObject(this.project, objectId);
    if (!object || object.kind !== "pointer") return;
    this.history.push(this.project);
    object.color = color;
    this.markDirty();
    this.renderAll();
  }

  setPenColor(objectId, color) {
    const object = getObject(this.project, objectId);
    if (!object || object.kind !== "pen" || object.color === color) return;
    this.history.push(this.project);
    object.color = color;
    this.markDirty();
    this.renderAll();
  }

  // ------------------------------------------------------------- selection ops
  duplicateSelection() {
    if (this.ui.viewStepId) {
      this.toast("只读");
      return;
    }
    const ids = Array.from(this.ui.selection).filter((id) => {
      const object = getObject(this.project, id);
      return object && object.kind !== "connector";
    });
    if (!ids.length) return;
    this.history.push(this.project);
    const copies = [];
    for (const id of ids) {
      const copy = duplicateObject(this.project, id);
      if (copy) copies.push(copy.id);
    }
    this.ui.selection.clear();
    copies.forEach((id) => this.ui.selection.add(id));
    this.markDirty();
    this.renderAll();
    const first = copies.length ? Geometry.objectBounds(getObject(this.project, copies[0]), this.project.live) : null;
    this.canvas.ensureVisible(first);
  }

  bringToFront(id) {
    const index = this.project.objects.findIndex((object) => object.id === id);
    if (index < 0) return;
    const [object] = this.project.objects.splice(index, 1);
    this.project.objects.push(object);
    this.markDirty();
    this.renderAll();
  }

  sendToBack(id) {
    const index = this.project.objects.findIndex((object) => object.id === id);
    if (index < 0) return;
    const [object] = this.project.objects.splice(index, 1);
    this.project.objects.unshift(object);
    this.markDirty();
    this.renderAll();
  }

  deleteSelection() {
    if (this.ui.viewStepId) {
      this.toast("只读");
      return;
    }
    if (this.ui.cellSelection) {
      this.canvas.clearSelectedCells();
      return;
    }
    const ids = Array.from(this.ui.selection);
    if (!ids.length) return;
    this.history.push(this.project);
    for (const id of ids) removeObject(this.project, id);
    this.ui.selection.clear();
    this.ui.cellSelection = null;
    this.markDirty();
    this.renderAll();
    this.toast("已删除");
  }

  // ------------------------------------------------------------- undo / redo
  undo() {
    const previous = this.history.undo(this.project);
    if (!previous) return;
    this.project = previous;
    this.ui.viewStepId = null;
    this.ui.selection.clear();
    this.ui.cellSelection = null;
    this.dirty = true;
    this.renderAll();
    this.markDirty();
  }

  redo() {
    const next = this.history.redo(this.project);
    if (!next) return;
    this.project = next;
    this.ui.viewStepId = null;
    this.ui.selection.clear();
    this.ui.cellSelection = null;
    this.dirty = true;
    this.renderAll();
    this.markDirty();
  }

  // ------------------------------------------------------------- menus / toast
  showContextMenu(clientX, clientY, items) {
    this.closeContextMenu();
    const menu = el("div", { class: "context-menu" });
    for (const item of items) {
      const button = el("button", { class: `menu-item${item.danger ? " danger" : ""}` }, item.label);
      button.addEventListener("click", () => {
        this.closeContextMenu();
        item.action();
      });
      menu.append(button);
    }
    document.body.append(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(clientX, window.innerWidth - rect.width - 8)}px`;
    menu.style.top = `${Math.min(clientY, window.innerHeight - rect.height - 8)}px`;
    this.contextMenu = menu;
    setTimeout(() => {
      this.menuOutside = (event) => {
        if (!menu.contains(event.target)) this.closeContextMenu();
      };
      document.addEventListener("pointerdown", this.menuOutside);
    }, 0);
  }

  closeContextMenu() {
    if (this.contextMenu) this.contextMenu.remove();
    this.contextMenu = null;
    document.removeEventListener("pointerdown", this.menuOutside);
    this.menuOutside = null;
  }

  toast(message) {
    const stack = document.getElementById("toast-stack");
    const node = el("div", { class: "toast" }, message);
    stack.append(node);
    while (stack.children.length > 1) stack.firstElementChild.remove();
    setTimeout(() => {
      node.classList.add("out");
      setTimeout(() => node.remove(), 180);
    }, 1600);
  }

  // ------------------------------------------------------------- UI binding
  bindUI() {
    this.undoBtn.addEventListener("click", () => this.undo());
    this.redoBtn.addEventListener("click", () => this.redo());
    document.getElementById("btn-record").addEventListener("click", () => this.recordStep());
    document.getElementById("btn-help").addEventListener("click", () => this.openHelp());
    document.getElementById("help-close").addEventListener("click", () => this.closeHelp());
    this.helpModal.addEventListener("pointerdown", (event) => {
      if (event.target === this.helpModal) this.closeHelp();
    });
    this.titleInput.addEventListener("input", () => {
      this.project.title = this.titleInput.value || "未命名画板";
      this.markDirty();
      this.syncChrome();
    });
    this.titleInput.addEventListener("blur", () => this.syncChrome());
    document.getElementById("tools-pane").addEventListener("click", (event) => {
      const tool = event.target.closest("[data-tool]")?.dataset.tool;
      if (tool) {
        this.setTool(tool);
        return;
      }
      const add = event.target.closest("[data-add]")?.dataset.add;
      if (add) this.addObject(add);
    });
    document.querySelectorAll("#empty-state [data-add]").forEach((button) => {
      button.addEventListener("click", () => this.addObject(button.dataset.add));
    });
    document.getElementById("btn-zoom-in").addEventListener("click", () => this.canvas.zoomBy(1.2));
    document.getElementById("btn-zoom-out").addEventListener("click", () => this.canvas.zoomBy(1 / 1.2));
    document.getElementById("btn-zoom-reset").addEventListener("click", () => this.canvas.resetZoom());
    document.getElementById("btn-fit").addEventListener("click", () => this.canvas.fit());
  }

  openHelp() {
    this.helpModal.hidden = false;
  }

  closeHelp() {
    this.helpModal.hidden = true;
  }

  // ------------------------------------------------------------- keyboard
  bindShortcuts() {
    window.addEventListener("keydown", (event) => {
      const typing = isTypingTarget(event.target);
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        this.saveCurrent(true);
        return;
      }
      if (mod && event.key === "Enter") {
        event.preventDefault();
        this.recordStep();
        return;
      }
      if (mod && event.key.toLowerCase() === "n") {
        event.preventDefault();
        this.newBoard();
        return;
      }
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        this.panes.expandBoards();
        this.boardsPanel.focusSearch();
        return;
      }
      if (typing) {
        if (event.key === "Escape") event.target.blur();
        return;
      }
      if (event.code === "Space") return;
      if (event.key === "?" || (event.shiftKey && event.key === "/")) {
        event.preventDefault();
        this.openHelp();
        return;
      }
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        this.undo();
        return;
      }
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        this.redo();
        return;
      }
      if (mod && event.key.toLowerCase() === "d") {
        event.preventDefault();
        this.duplicateSelection();
        return;
      }
      if (mod && event.key === "ArrowLeft") {
        event.preventDefault();
        this.goPrevious();
        return;
      }
      if (mod && event.key === "ArrowRight") {
        event.preventDefault();
        this.goNext();
        return;
      }
      if (mod && event.key === "0") {
        event.preventDefault();
        this.canvas.fit();
        return;
      }
      if (this.ui.cellSelection) {
        const before = event.defaultPrevented;
        this.canvas.onCanvasKeyDown(event);
        if (event.defaultPrevented || before) return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        if (this.ui.cellSelection) this.canvas.clearSelectedCells();
        else if (this.ui.viewStepId) this.deleteStep(this.ui.viewStepId);
        else this.deleteSelection();
        return;
      }
      if (event.key === "Escape") {
        if (this.ui.cellSelection) {
          this.ui.cellSelection = null;
          this.canvas.paintCellSelection();
          this.refreshInspector();
        } else if (this.ui.viewStepId) {
          this.goLive();
        } else {
          this.selectObject(null);
        }
        return;
      }
      const key = event.key.toLowerCase();
      const tools = { v: "select", h: "hand", c: "connector", p: "pen", r: "rect", e: "eraser" };
      if (tools[key]) {
        event.preventDefault();
        this.setTool(tools[key]);
        return;
      }
      const adds = { a: "array", m: "matrix", l: "list", d: "dict", s: "set", n: "node", f: "function" };
      if (adds[key]) {
        event.preventDefault();
        this.addObject(adds[key]);
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        this.canvas.zoomBy(1.2);
      } else if (event.key === "-") {
        event.preventDefault();
        this.canvas.zoomBy(1 / 1.2);
      }
    });
  }
}
