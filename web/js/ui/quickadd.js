/** Floating batch-input panel for arrays, dicts and sets. */
import { getObject } from "../core/model.js";
import { entriesToText, gridToCode, parseEntries, parseGrid, parseSet, setToText } from "../core/parse.js";
import { el, escapeHtml } from "./dom.js";

export class QuickAdd {
  constructor(app) {
    this.app = app;
    this.node = null;
    this.objectId = null;
    this.onOutside = (event) => {
      if (this.node && !this.node.contains(event.target)) this.close();
    };
    this.onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
      }
    };
  }

  open(objectId) {
    const app = this.app;
    const object = getObject(app.project, objectId);
    if (!object) return;
    if (app.ui.viewStepId) {
      app.toast("只读");
      return;
    }
    this.close();
    this.objectId = objectId;
    const state = app.project.live.states[objectId];
    let title = "";
    let hint = "";
    let value = "";
    let placeholder = "";
    if (object.kind === "array") {
      title = "批量输入数组";
      hint = "粘贴代码数组或 Excel；支持 [2, 7, 11] 和 [[1, 2], [3, 4]]。";
      value = gridToCode(state.data);
      placeholder = "[2, 7, 11, 15]";
    } else if (object.kind === "dict") {
      title = "批量输入字典";
      hint = "每行一个 key: value；也可以粘贴两列。";
      value = entriesToText(state.entries);
      placeholder = "2: 0\n7: 1";
    } else if (object.kind === "set") {
      title = "批量输入集合";
      hint = "支持 {2, 7, 11}，也可用逗号、空格或换行分隔。";
      value = setToText(state.items);
      placeholder = "{2, 7, 11}";
    } else {
      return;
    }
    const node = el("div", { class: "quick-add" });
    node.innerHTML = `
      <h4>${escapeHtml(title)}</h4>
      <p>${escapeHtml(hint)}</p>
      <textarea spellcheck="false" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>
      <div class="quick-add-preview"><span data-preview></span></div>
      <div class="quick-add-actions">
        <button class="small-btn" data-cancel="1">取消</button>
        <button class="small-btn primary" data-apply="1">填入</button>
      </div>`;
    document.body.append(node);
    this.node = node;
    const rect = node.getBoundingClientRect();
    node.style.left = `${Math.max(16, Math.min(window.innerWidth - rect.width - 16, window.innerWidth / 2 - rect.width / 2))}px`;
    node.style.top = `${Math.max(70, Math.min(window.innerHeight - rect.height - 20, 120))}px`;
    const textarea = node.querySelector("textarea");
    const preview = node.querySelector("[data-preview]");
    const updatePreview = () => {
      const text = textarea.value.trim();
      if (!text) {
        preview.textContent = "空";
        preview.classList.remove("warn");
        return;
      }
      if (object.kind === "array") {
        const grid = parseGrid(text);
        const rows = grid.length;
        const cols = grid[0]?.length || 1;
        preview.textContent = `${rows} 行 × ${cols} 列`;
        preview.classList.toggle("warn", rows > 100 || cols > 60);
      } else if (object.kind === "dict") {
        const count = parseEntries(text).length;
        preview.textContent = `${count} 条`;
        preview.classList.toggle("warn", count > 300);
      } else {
        const count = parseSet(text).length;
        preview.textContent = `${count} 项`;
        preview.classList.toggle("warn", count > 300);
      }
    };
    textarea.addEventListener("input", updatePreview);
    textarea.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        this.apply();
      }
    });
    updatePreview();
    textarea.focus();
    textarea.select();
    node.querySelector("[data-cancel]").addEventListener("click", () => this.close());
    node.querySelector("[data-apply]").addEventListener("click", () => this.apply());
    setTimeout(() => {
      document.addEventListener("pointerdown", this.onOutside);
      document.addEventListener("keydown", this.onKey);
    }, 0);
  }

  apply() {
    if (!this.node) return;
    const textarea = this.node.querySelector("textarea");
    this.app.applyQuickInput(this.objectId, textarea.value);
    this.close();
  }

  close() {
    if (this.node) this.node.remove();
    this.node = null;
    this.objectId = null;
    document.removeEventListener("pointerdown", this.onOutside);
    document.removeEventListener("keydown", this.onKey);
  }
}