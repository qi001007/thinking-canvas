/** Bottom step timeline. */
import { diffForView } from "../core/diff.js";
import { stepIndex } from "../core/steps.js";
import { escapeHtml } from "./dom.js";

export class Timeline {
  constructor(app) {
    this.app = app;
    this.list = document.getElementById("step-list");
    this.liveStep = document.getElementById("live-step");
    this.prev = document.getElementById("btn-prev-step");
    this.next = document.getElementById("btn-next-step");
    this.diffToggle = document.getElementById("toggle-diff");
    this.recordButton = document.getElementById("btn-timeline-record");
    this.list.addEventListener("click", (event) => this.onClick(event));
    this.list.addEventListener("keydown", (event) => this.onKeyDown(event));
    this.liveStep.addEventListener("click", () => this.app.goLive());
    this.recordButton.addEventListener("click", () => this.app.recordStep());
    this.prev.addEventListener("click", () => this.app.goPrevious());
    this.next.addEventListener("click", () => this.app.goNext());
    this.diffToggle.addEventListener("change", () => {
      this.app.ui.diffEnabled = this.diffToggle.checked;
      this.app.canvas.render();
    });
  }

  render() {
    const app = this.app;
    const steps = app.project.steps;
    const parts = [];
    steps.forEach((step, index) => {
      const diff = diffForView(app.project, step.id);
      const active = app.ui.viewStepId === step.id;
      const count = diff.count;
      parts.push(`
        <div class="step-chip${active ? " active" : ""}" data-step-id="${step.id}" role="button" tabindex="0" title="${escapeHtml(step.note || step.title)}">
          <span class="step-num">${index + 1}</span>
          <span class="step-name">${escapeHtml(step.title)}</span>
          ${count ? `<span class="step-change">${count} 变化</span>` : ""}
          <button class="step-del" data-delete-step="${step.id}" title="删除这一步" aria-label="删除这一步">×</button>
        </div>`);
    });
    const liveDiff = diffForView(app.project, null);
    this.liveStep.innerHTML = `
      <div class="step-chip live${app.ui.viewStepId ? "" : " active"}" title="当前">
        <span class="step-name">当前</span>
        ${liveDiff.count ? `<span class="step-change">${liveDiff.count}</span>` : ""}
      </div>`;
    this.list.innerHTML = parts.join("");
    this.recordButton.disabled = Boolean(app.ui.viewStepId);
    this.recordButton.title = app.ui.viewStepId ? "回到当前后才能记录" : "记录当前状态 (Ctrl+Enter)";
    this.prev.disabled = app.ui.viewStepId ? stepIndex(app.project, app.ui.viewStepId) <= 0 : steps.length === 0;
    this.next.disabled = !app.ui.viewStepId;
    this.diffToggle.checked = app.ui.diffEnabled;
    const active = this.list.querySelector(".step-chip.active");
    if (active) active.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  onClick(event) {
    const deleteButton = event.target.closest("[data-delete-step]");
    if (deleteButton) {
      event.stopPropagation();
      this.app.deleteStep(deleteButton.dataset.deleteStep);
      return;
    }
    const chip = event.target.closest("[data-step-id]");
    if (chip) {
      const id = chip.dataset.stepId || null;
      if (id) this.app.goToStep(id);
      else this.app.goLive();
    }
  }

  onKeyDown(event) {
    const chip = event.target.closest("[data-step-id]");
    if (!chip || event.target.closest("[data-delete-step]")) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    const id = chip.dataset.stepId || null;
    if (id) this.app.goToStep(id);
    else this.app.goLive();
  }
}

export function stepPosition(project, stepId) {
  if (!stepId) return project.steps.length;
  return stepIndex(project, stepId);
}
