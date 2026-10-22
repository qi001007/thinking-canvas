/** Floating batch-input panel for arrays, dicts and sets. */
import { getObject } from "../core/model.js";
import { entriesToText, gridToText, setToText } from "../core/parse.js";
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
      hint = "一行用空格或逗号分隔；多行就是多行数组。可以直接从 Excel 粘贴。";
      value = gridToText(state.data);
      placeholder = "2 7 11 15";
    } else if (object.kind === "dict") {
      title = "批量输入字典";
      hint = "每行一个 key: value；也可以粘贴两列。";
      value = entriesToText(state.entries);
      placeholder = "2: 0\n7: 1";
    } else if (object.kind === "set") {
      title = "批量输入集合";
      hint = "用逗号、空格或换行分隔。";
      value = setToText(state.items);
      placeholder = "2, 7, 11";
    } else {
      return;
    }
    const node = el("div", { class: "quick-add" });
    node.innerHTML = `
      <h4>${escapeHtml(title)}</h4>
      <p>${escapeHtml(hint)}</p>
      <textarea spellcheck="false" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>
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
