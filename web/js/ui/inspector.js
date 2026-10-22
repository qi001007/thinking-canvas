/** Right-side contextual inspector. */
import { diffForView, targetLabel } from "../core/diff.js";
import { MARK_LABELS, POINTER_COLORS, KIND_LABELS, getObject } from "../core/model.js";
import { stepNumber } from "../core/steps.js";
import { escapeHtml } from "./dom.js";

export class Inspector {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById("inspector-content");
    this.root.addEventListener("change", (event) => this.onChange(event));
    this.root.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.matches("input[data-insp-field]")) {
        event.preventDefault();
        event.target.blur();
      }
      event.stopPropagation();
    });
    this.root.addEventListener("click", (event) => this.onClick(event));
  }

  render() {
    const app = this.app;
    if (app.ui.viewStepId) {
      this.root.innerHTML = this.renderStep();
      return;
    }
    if (app.ui.selection.size > 1) {
      this.root.innerHTML = this.renderMulti();
      return;
    }
    if (app.ui.selection.size === 1) {
      const id = Array.from(app.ui.selection)[0];
      const object = getObject(app.project, id);
      if (object) {
        this.root.innerHTML = this.renderObject(object);
        return;
      }
    }
    this.root.innerHTML = this.renderBoard();
  }

  renderBoard() {
    const app = this.app;
    const liveDiff = diffForView(app.project, null);
    return `
      <div class="insp-empty">
        <div class="insp-kicker">BOARD</div>
        <h2 class="insp-title">${escapeHtml(app.project.title || "未命名画板")}</h2>
      </div>
      <div class="insp-section">
        <table class="insp-table">
          <tr><td>对象</td><td>${app.project.objects.filter((o) => o.kind !== "pointer" && o.kind !== "connector").length}</td></tr>
          <tr><td>步骤</td><td>${app.project.steps.length}</td></tr>
          <tr><td>未记录</td><td>${liveDiff.count ? `${liveDiff.count} 处` : "无"}</td></tr>
        </table>
      </div>
      ${liveDiff.count ? `<div class="insp-section"><div class="diff-list">${liveDiff.summary.map((line) => `<div class="diff-line"><span class="diff-dot"></span><span>${escapeHtml(line)}</span></div>`).join("")}</div></div>` : ""}`;
  }

  renderStep() {
    const app = this.app;
    const step = app.project.steps.find((item) => item.id === app.ui.viewStepId);
    if (!step) return this.renderBoard();
    const diff = diffForView(app.project, step.id);
    return `
      <div class="insp-empty">
        <div class="insp-kicker">STEP ${stepNumber(app.project, step.id)} / ${app.project.steps.length}</div>
        <h2 class="insp-title">${escapeHtml(step.title)}</h2>
      </div>
      <div class="insp-section">
        <div class="insp-section-title">标题</div>
        <div class="field"><input data-insp-field="step-title" data-step-id="${step.id}" value="${escapeHtml(step.title)}"></div>
        <div class="insp-section-title">备注</div>
        <div class="field"><textarea data-insp-field="step-note" data-step-id="${step.id}" placeholder="备注">${escapeHtml(step.note || "")}</textarea></div>
      </div>
      <div class="insp-section">
        <div class="insp-section-title">变化</div>
        ${diff.count ? `<div class="diff-list">${diff.summary.map((line) => `<div class="diff-line"><span class="diff-dot"></span><span>${escapeHtml(line)}</span></div>`).join("")}</div>` : '<div class="insp-note">无变化</div>'}
      </div>
      <div class="insp-footer">
        <button class="small-btn primary" data-action="go-live">回到当前</button>
        <button class="small-btn danger" data-action="delete-step" data-step-id="${step.id}">删除这一步</button>
      </div>`;
  }

  renderMulti() {
    const app = this.app;
    const objects = Array.from(app.ui.selection).map((id) => getObject(app.project, id)).filter(Boolean);
    return `
      <div class="insp-empty">
        <div class="insp-kicker">MULTI SELECT</div>
        <h2 class="insp-title">${objects.length} 个对象</h2>
      </div>
      <div class="insp-section">
        <div class="chips">${objects.map((object) => `<span class="chip">${escapeHtml(object.name || KIND_LABELS[object.kind] || object.kind)}</span>`).join("")}</div>
      </div>
      <div class="insp-footer">
        <button class="small-btn" data-action="duplicate">复制</button>
        <button class="small-btn danger" data-action="delete">删除</button>
      </div>`;
  }

  renderObject(object) {
    return `
      ${this.objectHead(object)}
      ${this.objectBody(object)}
      ${this.objectFooter(object)}`;
  }

  objectHead(object) {
    return `
      <div class="insp-empty">
        <div class="insp-kicker">${escapeHtml(KIND_LABELS[object.kind] || object.kind)}</div>
        <div class="field" style="margin-bottom:8px"><input data-insp-field="name" data-object-id="${object.id}" value="${escapeHtml(object.name || "")}" placeholder="名称"></div>
      </div>`;
  }

  objectBody(object) {
    const app = this.app;
    if (object.kind === "array") {
      const state = app.project.live.states[object.id];
      const selection = app.ui.cellSelection?.objectId === object.id ? app.ui.cellSelection : null;
      return `
        <div class="insp-section">
          <div class="insp-section-title">数组 · ${state.data.length} × ${state.data[0].length}</div>
          <div class="btn-row">
            <button class="small-btn" data-action="array-add-row" data-object-id="${object.id}">＋行</button>
            <button class="small-btn" data-action="array-del-row" data-object-id="${object.id}">−行</button>
            <button class="small-btn" data-action="array-add-col" data-object-id="${object.id}">＋列</button>
            <button class="small-btn" data-action="array-del-col" data-object-id="${object.id}">−列</button>
          </div>
          <div class="btn-row" style="margin-top:6px">
            <button class="small-btn" data-action="quick-add" data-object-id="${object.id}">批量输入</button>
            <button class="small-btn" data-action="add-pointer" data-object-id="${object.id}">加指针</button>
          </div>
        </div>
        ${selection ? `<div class="insp-section"><div class="insp-section-title">标记</div>${this.swatches(object.id)}</div>` : ""}`;
    }
    if (object.kind === "list") {
      const state = app.project.live.states[object.id];
      return `
        <div class="insp-section">
          <div class="insp-section-title">列表 · ${state.items.length} 项</div>
          <div class="btn-row">
            <button class="small-btn" data-action="list-add" data-object-id="${object.id}">＋一项</button>
            <button class="small-btn" data-action="list-del" data-object-id="${object.id}">−一项</button>
            <button class="small-btn" data-action="list-orientation" data-object-id="${object.id}">${object.orientation === "horizontal" ? "改纵向" : "改横向"}</button>
          </div>
        </div>
      `;
    }
    if (object.kind === "dict") {
      const state = app.project.live.states[object.id];
      return `
        <div class="insp-section">
          <div class="insp-section-title">字典 · ${state.entries.length} 条</div>
          <div class="btn-row">
            <button class="small-btn" data-action="dict-add" data-object-id="${object.id}">＋一行</button>
            <button class="small-btn" data-action="dict-del" data-object-id="${object.id}">−一行</button>
            <button class="small-btn" data-action="quick-add" data-object-id="${object.id}">批量输入</button>
          </div>
        </div>
      `;
    }
    if (object.kind === "set") {
      const state = app.project.live.states[object.id];
      return `
        <div class="insp-section">
          <div class="insp-section-title">集合 · ${state.items.length} 个</div>
          <div class="btn-row">
            <button class="small-btn" data-action="set-add" data-object-id="${object.id}">＋一项</button>
            <button class="small-btn" data-action="set-del" data-object-id="${object.id}">−一项</button>
            <button class="small-btn" data-action="quick-add" data-object-id="${object.id}">批量输入</button>
          </div>
        </div>`;
    }
    if (object.kind === "variable" || object.kind === "node") {
      const state = app.project.live.states[object.id];
      return `
        <div class="insp-section">
          <div class="insp-section-title">${object.kind === "variable" ? "变量值" : "节点值"}</div>
          <div class="field"><input class="mono" data-insp-field="${object.kind === "variable" ? "variable-value" : "node-value"}" data-object-id="${object.id}" value="${escapeHtml(state.value || "")}" placeholder="值"></div>
        </div>
      `;
    }
    if (object.kind === "sticky" || object.kind === "text") {
      return `
        <div class="insp-section">
          <div class="insp-section-title">内容</div>
          <div class="field"><textarea data-insp-field="${object.kind === "sticky" ? "sticky-text" : "text-content"}" data-object-id="${object.id}" placeholder="写点什么…">${escapeHtml(object.text || "")}</textarea></div>
          ${object.kind === "sticky" ? `<div class="insp-section-title">颜色</div><div class="swatches">${["yellow", "green", "blue", "pink"].map((color) => `<button class="swatch" data-action="sticky-color" data-color="${color}" data-object-id="${object.id}" style="background:${stickyColor(color)}" title="${color}"></button>`).join("")}</div>` : ""}
        </div>`;
    }
    if (object.kind === "function") {
      return `
        <div class="insp-section">
          <div class="insp-section-title">签名</div>
          <div class="field"><input class="mono" data-insp-field="function-signature" data-object-id="${object.id}" value="${escapeHtml(object.signature || "")}"></div>
          <div class="insp-section-title">输入</div>
          ${object.inputs.map((item, index) => `<div class="field"><label>输入 ${index + 1}</label><input data-insp-field="function-input-k" data-object-id="${object.id}" data-index="${index}" value="${escapeHtml(item.k)}"><input data-insp-field="function-input-v" data-object-id="${object.id}" data-index="${index}" value="${escapeHtml(item.v)}" placeholder="值 / 类型" style="margin-top:4px"></div>`).join("")}
          <button class="small-btn" data-action="function-add-input" data-object-id="${object.id}">＋输入</button>
          <div class="insp-section-title" style="margin-top:10px">输出</div>
          <div class="field"><input data-insp-field="function-output" data-object-id="${object.id}" value="${escapeHtml(object.output?.v || "")}" placeholder="输出值 / 类型"></div>
          <div class="insp-section-title">复杂度目标</div>
          <div class="field"><input data-insp-field="function-complexity" data-object-id="${object.id}" value="${escapeHtml(object.complexity || "")}" placeholder="例如 O(n) / O(n)"></div>
        </div>`;
    }
    if (object.kind === "connector") {
      return `
        <div class="insp-section">
          <div class="insp-section-title">连线</div>
          <div class="field"><label>标签</label><input data-insp-field="connector-label" data-object-id="${object.id}" value="${escapeHtml(object.label || "")}" placeholder="例如 target - nums[i]"></div>
          <div class="field"><label>箭头</label><select data-insp-field="connector-arrow" data-object-id="${object.id}"><option value="end" ${object.arrow === "end" ? "selected" : ""}>终点箭头</option><option value="both" ${object.arrow === "both" ? "selected" : ""}>双向</option><option value="none" ${object.arrow === "none" ? "selected" : ""}>无箭头</option></select></div>
          <div class="field"><label>样式</label><select data-insp-field="connector-dashed" data-object-id="${object.id}"><option value="0" ${!object.dashed ? "selected" : ""}>实线</option><option value="1" ${object.dashed ? "selected" : ""}>虚线</option></select></div>
        </div>`;
    }
    if (object.kind === "pointer") {
      const app = this.app;
      const target = app.project.live.pointers[object.id];
      const objectMap = new Map(app.project.objects.map((item) => [item.id, item]));
      const label = target ? targetLabel(object, objectMap, app.project.live, target) : "未绑定";
      return `
        <div class="insp-section">
          <div class="insp-section-title">颜色</div>
          <div class="swatches">${POINTER_COLORS.map((color) => `<button class="swatch" data-action="pointer-color" data-color="${color}" data-object-id="${object.id}" style="background:${color}" title="${color}"></button>`).join("")}</div>
          <div class="insp-note" style="margin-top:8px">指向：<b>${escapeHtml(label)}</b></div>
        </div>`;
    }
    if (object.kind === "shape" || object.kind === "pen") return "";
    return "";
  }

  objectFooter(object) {
    return `
      <div class="insp-footer">
        <button class="small-btn" data-action="duplicate" data-object-id="${object.id}">复制</button>
        <button class="small-btn danger" data-action="delete" data-object-id="${object.id}">删除</button>
      </div>`;
  }

  swatches(objectId) {
    return `<div class="swatches">${["", "yellow", "green", "blue", "pink", "violet"].map((mark) => `<button class="swatch ${mark ? "" : "none"}" data-action="mark" data-mark="${mark}" data-object-id="${objectId}" style="${mark ? `background:${markColor(mark)}` : ""}" title="${MARK_LABELS[mark]}">${mark ? "" : "×"}</button>`).join("")}</div>`;
  }

  onChange(event) {
    const field = event.target.closest("[data-insp-field]");
    if (!field) return;
    const name = field.dataset.inspField;
    const value = field.value;
    const objectId = field.dataset.objectId;
    const index = field.dataset.index !== undefined ? Number(field.dataset.index) : null;
    const stepId = field.dataset.stepId;
    if (name === "step-title" || name === "step-note") {
      const step = this.app.project.steps.find((item) => item.id === stepId);
      if (!step) return;
      if (name === "step-title" && step.title === value) return;
      if (name === "step-note" && step.note === value) return;
      this.app.history.push(this.app.project);
      if (name === "step-title") step.title = value.trim() || step.title;
      else step.note = value;
      this.app.markDirty();
      this.app.scheduleAutosave();
      this.app.timeline.render();
      this.app.syncChrome();
      return;
    }
    const object = getObject(this.app.project, objectId);
    if (!object) return;
    const state = this.app.project.live.states[objectId];
    const same = () => {
      if (name === "name") return object.name === value;
      if (name === "function-input-k") return object.inputs[index].k === value;
      if (name === "function-input-v") return object.inputs[index].v === value;
      if (name === "function-output") return object.output.v === value;
      if (name === "connector-label") return object.label === value;
      if (name === "connector-arrow") return object.arrow === value;
      if (name === "connector-dashed") return Boolean(object.dashed) === (value === "1");
      if (name === "pointer-name") return object.name === value;
      if (name === "variable-value" || name === "node-value") return state?.value === value;
      if (name === "dict-key") return state?.entries?.[index]?.key === value;
      if (name === "dict-value") return state?.entries?.[index]?.value === value;
      if (name === "set-item") return state?.items?.[index] === value;
      if (name === "list-item") return state?.items?.[index] === value;
      if (name === "sticky-text" || name === "text-content") return object.text === value;
      if (name === "function-signature") return object.signature === value;
      if (name === "function-complexity") return object.complexity === value;
      return false;
    };
    if (same()) return;
    this.app.history.push(this.app.project);
    if (name === "name") object.name = value.trim() || object.name;
    else if (name === "function-signature") object.signature = value.trim();
    else if (name === "function-input-k") object.inputs[index].k = value;
    else if (name === "function-input-v") object.inputs[index].v = value;
    else if (name === "function-output") object.output.v = value;
    else if (name === "function-complexity") object.complexity = value;
    else if (name === "connector-label") object.label = value;
    else if (name === "connector-arrow") object.arrow = value;
    else if (name === "connector-dashed") object.dashed = value === "1";
    else if (name === "pointer-name") object.name = value.trim() || object.name;
    else if (name === "variable-value" && state) state.value = value;
    else if (name === "node-value" && state) state.value = value;
    else if (name === "dict-key" && state) state.entries[index].key = value;
    else if (name === "dict-value" && state) state.entries[index].value = value;
    else if (name === "set-item" && state) state.items[index] = value;
    else if (name === "list-item" && state) state.items[index] = value;
    else if (name === "sticky-text" || name === "text-content") object.text = value;
    this.app.markDirty();
    this.app.scheduleAutosave();
    this.app.canvas.render();
    this.app.timeline.render();
    this.app.syncChrome();
  }

  onClick(event) {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    const objectId = event.target.closest("[data-object-id]")?.dataset.objectId;
    const app = this.app;
    if (action === "help") app.openHelp();
    else if (action === "go-live") app.goLive();
    else if (action === "delete-step") app.deleteStep(event.target.closest("[data-step-id]")?.dataset.stepId);
    else if (action === "duplicate") app.duplicateSelection();
    else if (action === "delete") app.deleteSelection();
    else if (action === "quick-add") app.openQuickAdd(objectId);
    else if (action === "add-pointer") app.addPointerAtSelection();
    else if (action === "array-add-row") app.resizeArray(objectId, "add-row");
    else if (action === "array-del-row") app.resizeArray(objectId, "del-row");
    else if (action === "array-add-col") app.resizeArray(objectId, "add-col");
    else if (action === "array-del-col") app.resizeArray(objectId, "del-col");
    else if (action === "list-add") app.addListItem(objectId);
    else if (action === "list-del") app.removeListItem(objectId);
    else if (action === "list-orientation") app.toggleListOrientation(objectId);
    else if (action === "dict-add") app.addDictRow(objectId);
    else if (action === "dict-del") app.removeDictRow(objectId);
    else if (action === "set-add") app.addSetItem(objectId);
    else if (action === "set-del") app.removeSetItem(objectId);
    else if (action === "function-add-input") app.addFunctionInput(objectId);
    else if (action === "mark") app.markSelection(event.target.dataset.mark || "");
    else if (action === "sticky-color") app.setStickyColor(objectId, event.target.dataset.color);
    else if (action === "pointer-color") app.setPointerColor(objectId, event.target.dataset.color);
  }

  focusField(name) {
    const field = this.root.querySelector(`[data-insp-field="${name}"]`);
    if (field) {
      field.focus();
      if (field.select) field.select();
    }
  }
}

function markColor(mark) {
  return {
    yellow: "#fff0b8",
    green: "#dff0e4",
    blue: "#dfeafb",
    pink: "#f8dfe7",
    violet: "#eee2f8",
  }[mark] || "#fff";
}

function stickyColor(color) {
  return {
    yellow: "#fff6bf",
    green: "#eaf4ec",
    blue: "#e8f0fa",
    pink: "#fbe7ee",
  }[color] || "#fff6bf";
}
