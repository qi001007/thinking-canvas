/** Resizable workspace panes: widths, rails, keyboard and persistence. */
export const PANE_SPECS = Object.freeze({
  boards: { expand: 212, min: 160, max: 360, rail: 44, railAt: 120 },
  tools: { expand: 168, min: 104, max: 220, rail: 46, railAt: 104 },
  inspector: { expand: 292, min: 220, max: 420 },
});

const DEFAULTS = Object.freeze({
  boards: PANE_SPECS.boards.expand,
  tools: PANE_SPECS.tools.expand,
  inspector: PANE_SPECS.inspector.expand,
});
const SPLIT = 5;
const MIN_STAGE = 360;

export function normalizePaneWidth(key, width) {
  const value = Number(width);
  if (!Number.isFinite(value)) return null;
  const spec = PANE_SPECS[key];
  if (!spec) return null;
  if (key === "boards") return value < 128 ? spec.rail : Math.max(spec.min, Math.min(spec.max, value));
  if (key === "tools") return value < 100 ? spec.rail : Math.max(spec.min, Math.min(spec.max, value));
  return Math.max(spec.min, Math.min(spec.max, value));
}

export function fitPaneWidths(pref, viewportWidth) {
  const out = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    const value = normalizePaneWidth(key, pref?.[key]);
    if (value !== null) out[key] = value;
  }
  let excess = out.boards + out.tools + out.inspector + SPLIT * 3 + MIN_STAGE - viewportWidth;
  if (excess <= 0) return out;
  const take = (key, floor) => {
    const delta = Math.min(excess, out[key] - floor);
    out[key] -= delta;
    excess -= delta;
  };
  const collapse = (key) => {
    if (excess <= 0 || out[key] <= PANE_SPECS[key].rail) return;
    excess -= out[key] - PANE_SPECS[key].rail;
    out[key] = PANE_SPECS[key].rail;
  };
  take("inspector", PANE_SPECS.inspector.min);
  take("boards", PANE_SPECS.boards.min);
  take("tools", PANE_SPECS.tools.min);
  collapse("boards");
  collapse("tools");
  return out;
}

export class Panes {
  constructor(bridge) {
    this.bridge = bridge;
    this.workspace = document.getElementById("workspace");
    this.boardPane = document.getElementById("board-pane");
    this.toolsPane = document.getElementById("tools-pane");
    this.splitters = {
      boards: document.getElementById("split-boards"),
      tools: document.getElementById("split-tools"),
      inspector: document.getElementById("split-inspector"),
    };
    this.pref = { ...DEFAULTS };
    this.view = { ...DEFAULTS };
    this.lastBoardsWide = DEFAULTS.boards;
    this.drag = null;
    this.saveTimer = null;
    this.bind();
    this.apply();
  }

  async hydrate() {
    try {
      const request = Promise.resolve(this.bridge?.loadUiState?.());
      const result = await Promise.race([
        request,
        new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
      ]);
      const saved = result?.ok ? result.state?.panes : null;
      if (saved) {
        for (const key of Object.keys(DEFAULTS)) {
          const value = normalizePaneWidth(key, saved[key]);
          if (value !== null) this.pref[key] = value;
        }
        if (this.pref.boards >= PANE_SPECS.boards.min) this.lastBoardsWide = this.pref.boards;
      }
    } catch {
      // UI preferences are optional; defaults stay usable.
    }
    this.apply();
  }

  apply() {
    this.view = fitPaneWidths(this.pref, window.innerWidth);
    this.workspace.style.setProperty("--boards-w", `${this.view.boards}px`);
    this.workspace.style.setProperty("--tools-w", `${this.view.tools}px`);
    this.workspace.style.setProperty("--inspector-w", `${this.view.inspector}px`);
    this.boardPane.classList.toggle("rail", this.view.boards <= PANE_SPECS.boards.railAt);
    this.toolsPane.classList.toggle("rail", this.view.tools < PANE_SPECS.tools.railAt);
    this.toolsPane.classList.toggle("compact", this.view.tools < 150);
    this.syncAria();
  }

  syncAria() {
    const set = (key, min, max) => {
      const node = this.splitters[key];
      if (!node) return;
      node.setAttribute("aria-valuemin", String(min));
      node.setAttribute("aria-valuemax", String(max));
      node.setAttribute("aria-valuenow", String(Math.round(this.view[key])));
    };
    set("boards", PANE_SPECS.boards.rail, PANE_SPECS.boards.max);
    set("tools", PANE_SPECS.tools.rail, PANE_SPECS.tools.max);
    set("inspector", PANE_SPECS.inspector.min, PANE_SPECS.inspector.max);
  }

  setWidth(key, width, save = false) {
    const value = normalizePaneWidth(key, width);
    if (value === null) return;
    this.pref[key] = value;
    if (key === "boards" && value >= PANE_SPECS.boards.min) this.lastBoardsWide = value;
    this.apply();
    if (save) this.persist();
  }

  setLiveWidth(key, width) {
    const spec = PANE_SPECS[key];
    if (key === "boards") this.pref.boards = width <= spec.rail ? spec.rail : Math.max(spec.rail, Math.min(spec.max, width));
    else if (key === "tools") this.pref.tools = width <= spec.rail + 8 ? spec.rail : Math.max(spec.rail, Math.min(spec.max, width));
    else this.pref[key] = Math.max(spec.min, Math.min(spec.max, width));
    this.apply();
  }

  expandBoards() {
    if (this.view.boards > PANE_SPECS.boards.railAt) return;
    this.setWidth("boards", Math.max(PANE_SPECS.boards.min, this.lastBoardsWide || DEFAULTS.boards), true);
  }

  collapseBoards() {
    if (this.pref.boards > PANE_SPECS.boards.railAt) this.lastBoardsWide = this.pref.boards;
    this.setWidth("boards", PANE_SPECS.boards.rail, true);
  }

  reset(key) {
    this.setWidth(key, DEFAULTS[key], true);
  }

  persist() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        Promise.resolve(this.bridge?.saveUiState?.({ panes: { ...this.pref } })).catch(() => {});
      } catch {
        // preferences are best-effort
      }
    }, 120);
  }

  bind() {
    for (const [key, node] of Object.entries(this.splitters)) {
      node.addEventListener("pointerdown", (event) => this.startDrag(key, event));
      node.addEventListener("dblclick", () => this.reset(key));
      node.addEventListener("keydown", (event) => this.onSplitterKey(key, event));
    }
    document.getElementById("btn-collapse-boards").addEventListener("click", () => this.collapseBoards());
    document.getElementById("btn-board-rail").addEventListener("click", () => this.expandBoards());
    window.addEventListener("pointermove", (event) => this.onPointerMove(event));
    window.addEventListener("pointerup", () => this.endDrag());
    window.addEventListener("pointercancel", () => this.endDrag());
    window.addEventListener("resize", () => this.apply());
  }

  startDrag(key, event) {
    if (event.button !== 0) return;
    event.preventDefault();
    this.drag = {
      key,
      startX: event.clientX,
      startView: this.view[key],
      pointerId: event.pointerId,
    };
    this.splitters[key].setPointerCapture?.(event.pointerId);
    this.splitters[key].classList.add("active");
    document.body.classList.add("pane-dragging");
  }

  onPointerMove(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const dx = event.clientX - this.drag.startX;
    const width = this.drag.key === "inspector" ? this.drag.startView - dx : this.drag.startView + dx;
    this.setLiveWidth(this.drag.key, width);
  }

  endDrag() {
    if (!this.drag) return;
    const key = this.drag.key;
    this.splitters[key].classList.remove("active");
    document.body.classList.remove("pane-dragging");
    this.drag = null;
    this.setWidth(key, this.pref[key], true);
  }

  onSplitterKey(key, event) {
    const step = event.shiftKey ? 24 : 8;
    const right = event.key === "ArrowRight";
    const left = event.key === "ArrowLeft";
    if (!right && !left && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    if (event.key === "Home") {
      this.setWidth(key, key === "inspector" ? PANE_SPECS.inspector.min : PANE_SPECS[key].rail, true);
      return;
    }
    if (event.key === "End") {
      this.setWidth(key, PANE_SPECS[key].max, true);
      return;
    }
    const dir = right ? 1 : -1;
    const current = this.view[key];
    if (key === "boards" && current <= PANE_SPECS.boards.railAt && dir > 0) {
      this.setWidth(key, PANE_SPECS.boards.min, true);
      return;
    }
    if (key === "tools" && current <= PANE_SPECS.tools.railAt && dir > 0) {
      this.setWidth(key, PANE_SPECS.tools.min, true);
      return;
    }
    const delta = key === "inspector" ? -dir : dir;
    this.setWidth(key, current + delta * step, true);
  }
}
