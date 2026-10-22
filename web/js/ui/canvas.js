/** Canvas: viewport, rendering, selection, dragging, connectors and pointers. */
import { diffForView, emptyDiff } from "../core/diff.js";
import {
  anchorPoint,
  clampZoom,
  fitBounds,
  listItemRect,
  dictRowRect,
  objectBounds,
  rectsIntersect,
  screenToWorld,
  snapDelta,
  unionBounds,
  worldToScreen,
  arrayCellRect,
} from "../core/geometry.js";
import {
  addObject,
  getObject,
  nextPointerColor,
  nextPointerName,
  POINTER_COLORS,
  setPointerState,
  STATE_KINDS,
} from "../core/model.js";
import { stepNumber, viewSnapshot } from "../core/steps.js";
import { clamp, escapeHtml } from "./dom.js";
import { pointerPillHTML, renderObjectHTML } from "./renderers.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export class Canvas {
  constructor(app) {
    this.app = app;
    this.viewportEl = document.getElementById("viewport");
    this.worldEl = document.getElementById("world");
    this.wiresEl = document.getElementById("wires");
    this.pointerLayer = document.getElementById("pointer-layer");
    this.guidesEl = document.getElementById("guides");
    this.marqueeEl = document.getElementById("marquee");
    this.emptyEl = document.getElementById("empty-state");
    this.historyBanner = document.getElementById("history-banner");
    this.historyText = document.getElementById("history-text");
    this.zoomValue = document.getElementById("btn-zoom-reset");
    this.statusZoom = document.getElementById("status-zoom");
    this.statusObjects = document.getElementById("status-objects");
    this.canvasState = {
      objectDrag: null,
      marquee: null,
      cellDrag: null,
      penDraft: null,
      shapeDraft: null,
      connectorDraft: null,
      pointerDrag: null,
      pan: null,
      spaceDown: false,
      cellEdit: null,
      inlineEdit: null,
    };
    this.bindEvents();
  }

  // ------------------------------------------------------------- rendering
  render() {
    const app = this.app;
    const snapshot = viewSnapshot(app.project, app.ui.viewStepId);
    app.currentSnapshot = snapshot;
    const diff = app.ui.diffEnabled ? diffForView(app.project, app.ui.viewStepId) : emptyDiff();
    this.snapshot = snapshot;
    this.diff = diff;
    this.editable = !app.ui.viewStepId;
    this.pointerTargets = new Map();
    for (const pointer of app.project.objects.filter((object) => object.kind === "pointer")) {
      const target = snapshot.pointers?.[pointer.id];
      if (!target?.targetId) continue;
      const key =
        Number.isInteger(target.row) && Number.isInteger(target.col)
          ? `${target.targetId}:${target.row}:${target.col}`
          : Number.isInteger(target.index)
            ? `${target.targetId}:i:${target.index}`
            : `${target.targetId}`;
      if (!this.pointerTargets.has(key)) this.pointerTargets.set(key, pointer.color || "#3c6fb0");
    }
    app.pointerTargets = this.pointerTargets;

    this.applyViewport();
    const visible = new Set(snapshot.objectIds || []);
    const objects = app.project.objects.filter(
      (object) => visible.has(object.id) && object.kind !== "pointer" && object.kind !== "connector",
    );
    this.worldEl.innerHTML = objects
      .map((object) => {
        const state = STATE_KINDS.has(object.kind) ? snapshot.states?.[object.id] : null;
        return renderObjectHTML(app, object, state, diff, this.editable);
      })
      .join("");
    this.worldEl.classList.toggle("readonly", !this.editable);
    this.renderWires();
    this.renderPointers();
    this.renderChrome();
    if (this.canvasState.cellEdit) {
      // A full render destroys the editor; commit before structural renders.
      this.canvasState.cellEdit = null;
    }
  }

  renderChrome() {
    const app = this.app;
    const count = app.project.objects.filter((object) => object.kind !== "pointer" && object.kind !== "connector").length;
    this.statusObjects.textContent = `${count} 个对象`;
    const zoomText = `${Math.round(app.ui.viewport.zoom * 100)}%`;
    if (this.zoomValue) this.zoomValue.textContent = zoomText;
    if (this.statusZoom) this.statusZoom.textContent = zoomText;
    const empty = count === 0;
    this.emptyEl.hidden = !empty;
    if (app.ui.viewStepId) {
      const number = stepNumber(app.project, app.ui.viewStepId);
      this.historyBanner.hidden = false;
      this.historyText.textContent = `正在查看第 ${number} 步 · 只读`;
    } else {
      this.historyBanner.hidden = true;
    }
    this.viewportEl.classList.toggle("readonly", !this.editable);
    this.viewportEl.classList.toggle("hand", app.ui.tool === "hand" || this.canvasState.spaceDown);
  }

  applyViewport() {
    const { x, y, zoom } = this.app.ui.viewport;
    this.worldEl.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    this.viewportEl.style.backgroundSize = `${24 * zoom}px ${24 * zoom}px`;
    this.viewportEl.style.backgroundPosition = `${x}px ${y}px`;
  }

  renderWires() {
    const app = this.app;
    this.wiresEl.replaceChildren();
    const defs = document.createElementNS(SVG_NS, "defs");
    defs.innerHTML = `
      <marker id="tc-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L8,4 L0,8 z" fill="#8c9aa6"></path>
      </marker>
      <marker id="tc-arrow-selected" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L8,4 L0,8 z" fill="#2f5d8a"></path>
      </marker>`;
    this.wiresEl.append(defs);
    const visible = new Set(this.snapshot.objectIds || []);
    for (const connector of app.project.objects.filter((object) => object.kind === "connector" && visible.has(object.id))) {
      const from = anchorPoint(app.project.objects, this.snapshot, connector.from);
      const to = anchorPoint(app.project.objects, this.snapshot, connector.to);
      if (!from || !to) continue;
      const start = worldToScreen(app.ui.viewport, from.x, from.y);
      const end = worldToScreen(app.ui.viewport, to.x, to.y);
      const d = curvePath(start, end);
      const selected = app.ui.selection.has(connector.id);
      const hit = document.createElementNS(SVG_NS, "path");
      hit.setAttribute("d", d);
      hit.setAttribute("class", "wire hit");
      hit.dataset.connectorId = connector.id;
      this.wiresEl.append(hit);
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      path.setAttribute("class", `wire${selected ? " selected" : ""}`);
      if (connector.dashed) path.setAttribute("stroke-dasharray", "4 4");
      if (connector.arrow !== "none") {
        path.setAttribute("marker-end", selected ? "url(#tc-arrow-selected)" : "url(#tc-arrow)");
      }
      if (connector.arrow === "both") {
        path.setAttribute("marker-start", selected ? "url(#tc-arrow-selected)" : "url(#tc-arrow)");
      }
      this.wiresEl.append(path);
      if (connector.label) {
        const text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("x", (start.x + end.x) / 2);
        text.setAttribute("y", (start.y + end.y) / 2 - 7);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("class", "wire-label");
        text.textContent = connector.label;
        this.wiresEl.append(text);
      }
    }
  }

  renderPointers() {
    const app = this.app;
    this.pointerLayer.replaceChildren();
    if (!this.snapshot) return;
    const pointers = app.project.objects.filter((object) => object.kind === "pointer");
    const html = pointers.map((pointer) => pointerPillHTML(app, pointer, this.snapshot, this.diff)).join("");
    this.pointerLayer.innerHTML = html;
  }

  // ------------------------------------------------------------- viewport
  setViewport(next) {
    const { x, y, zoom } = next;
    this.app.ui.viewport = { x, y, zoom: clampZoom(zoom) };
    this.applyViewport();
    this.renderWires();
    this.renderPointers();
    this.renderChrome();
  }

  zoomAt(clientX, clientY, factor) {
    const rect = this.viewportEl.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const viewport = this.app.ui.viewport;
    const before = screenToWorld(viewport, px, py);
    const zoom = clampZoom(viewport.zoom * factor);
    this.setViewport({
      x: px - before.x * zoom,
      y: py - before.y * zoom,
      zoom,
    });
  }

  zoomBy(factor) {
    const rect = this.viewportEl.getBoundingClientRect();
    this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  resetZoom() {
    this.zoomAtRectCenter(1);
  }

  zoomAtRectCenter(zoom) {
    const rect = this.viewportEl.getBoundingClientRect();
    const viewport = this.app.ui.viewport;
    const center = screenToWorld(viewport, rect.width / 2, rect.height / 2);
    this.setViewport({ x: rect.width / 2 - center.x * zoom, y: rect.height / 2 - center.y * zoom, zoom });
  }

  fit() {
    const app = this.app;
    const visible = new Set(this.snapshot?.objectIds || app.project.objects.map((object) => object.id));
    const bounds = unionBounds(
      app.project.objects
        .filter((object) => visible.has(object.id) && object.kind !== "pointer" && object.kind !== "connector")
        .map((object) => objectBounds(object, this.snapshot)),
    );
    if (!bounds) {
      this.setViewport({ x: 80, y: 60, zoom: 1 });
      return;
    }
    const rect = this.viewportEl.getBoundingClientRect();
    const width = rect.width || 1000;
    const height = rect.height || 700;
    const padding = Math.max(56, Math.min(90, Math.round(Math.min(width, height) * 0.09)));
    const next = fitBounds(bounds, width, height, padding);
    this.setViewport(next);
  }

  ensureVisible(bounds, margin = 28) {
    if (!bounds) return;
    const rect = this.viewportEl.getBoundingClientRect();
    const view = this.app.ui.viewport;
    const left = bounds.x * view.zoom + view.x;
    const top = bounds.y * view.zoom + view.y;
    const right = (bounds.x + bounds.w) * view.zoom + view.x;
    const bottom = (bounds.y + bounds.h) * view.zoom + view.y;
    let dx = 0;
    let dy = 0;
    if (left < margin) dx = margin - left;
    else if (right > rect.width - margin) dx = rect.width - margin - right;
    if (top < margin) dy = margin - top;
    else if (bottom > rect.height - margin) dy = rect.height - margin - bottom;
    if (dx || dy) this.setViewport({ x: view.x + dx, y: view.y + dy, zoom: view.zoom });
  }

  // ------------------------------------------------------------- hit testing
  eventPoint(event) {
    const rect = this.viewportEl.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  worldPoint(event) {
    const point = this.eventPoint(event);
    return screenToWorld(this.app.ui.viewport, point.x, point.y);
  }

  elementAt(clientX, clientY) {
    return document.elementFromPoint(clientX, clientY);
  }

  readPointerTarget(element) {
    if (!element) return null;
    const cell = element.closest("[data-cell]");
    if (cell) {
      return {
        targetId: cell.dataset.objectId,
        row: Number(cell.dataset.row),
        col: Number(cell.dataset.col),
      };
    }
    const listItem = element.closest("[data-list-item]");
    if (listItem) return { targetId: listItem.dataset.objectId, index: Number(listItem.dataset.index) };
    const dictRow = element.closest("[data-dict-row]");
    if (dictRow) return { targetId: dictRow.dataset.objectId, index: Number(dictRow.dataset.index) };
    const target = element.closest("[data-pointer-target][data-object-id]");
    if (target) return { targetId: target.dataset.objectId };
    const card = element.closest(".obj[data-object-id]");
    if (card) return { targetId: card.dataset.objectId };
    return null;
  }

  readAnchor(clientX, clientY) {
    const element = this.elementAt(clientX, clientY);
    const target = this.readPointerTarget(element);
    if (target) return { objectId: target.targetId, row: target.row, col: target.col, index: target.index };
    return null;
  }

  // ------------------------------------------------------------- events
  bindEvents() {
    const viewport = this.viewportEl;
    viewport.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    window.addEventListener("pointermove", (event) => this.onPointerMove(event));
    window.addEventListener("pointerup", (event) => this.onPointerUp(event));
    viewport.addEventListener("wheel", (event) => this.onWheel(event), { passive: false });
    viewport.addEventListener("contextmenu", (event) => this.onContextMenu(event));
    viewport.addEventListener("dblclick", (event) => this.onDoubleClick(event));
    this.wiresEl.addEventListener("click", (event) => this.onWireClick(event));
    this.pointerLayer.addEventListener("pointerdown", (event) => this.onPointerPillDown(event));
    this.pointerLayer.addEventListener("dblclick", (event) => this.onPointerPillDoubleClick(event));
    document.getElementById("btn-live").addEventListener("click", () => this.app.goLive());
    window.addEventListener("keydown", (event) => {
      if (event.code === "Space" && !isEditableTarget(event.target)) {
        this.canvasState.spaceDown = true;
        viewport.classList.add("hand");
        if (event.target === document.body) event.preventDefault();
      }
      if (event.code === "Escape" && this.canvasState.pointerDrag) {
        this.cancelPointerDrag();
      }
    });
    window.addEventListener("keyup", (event) => {
      if (event.code === "Space") {
        this.canvasState.spaceDown = false;
        viewport.classList.remove("hand");
        viewport.classList.toggle("hand", this.app.ui.tool === "hand");
      }
    });
  }

  onWheel(event) {
    event.preventDefault();
    if (event.shiftKey) {
      const viewport = this.app.ui.viewport;
      this.setViewport({ ...viewport, x: viewport.x - event.deltaY });
      return;
    }
    const factor = Math.exp(-event.deltaY * 0.0014);
    this.zoomAt(event.clientX, event.clientY, factor);
  }

  onPointerDown(event) {
    if (event.button === 1 || this.canvasState.spaceDown || this.app.ui.tool === "hand") {
      this.startPan(event);
      return;
    }
    if (event.button !== 0) return;
    const target = event.target;
    if (
      target.closest(
        "[contenteditable='true'], input, textarea, .card-tool, .pointer-pill, .status-float, .zoom-controls, .history-banner, .empty-state",
      )
    ) {
      return;
    }
    if (event.target.closest(".wire.hit")) return;

    const tool = this.app.ui.tool;
    if (!this.editable && ["pen", "rect", "connector"].includes(tool)) {
      this.app.toast("只读");
      return;
    }
    if (tool === "pen") {
      this.startPen(event);
      return;
    }
    if (tool === "rect") {
      this.startShape(event);
      return;
    }
    if (tool === "connector") {
      this.startConnector(event);
      return;
    }

    const cell = target.closest("[data-cell]");
    if (cell) {
      this.startCellSelection(event, cell);
      return;
    }
    const objectEl = target.closest(".obj[data-object-id]");
    if (objectEl) {
      const object = getObject(this.app.project, objectEl.dataset.objectId);
      if (object?.kind === "connector") return;
      this.startObjectDrag(event, object, objectEl);
      return;
    }
    this.startMarquee(event);
  }

  onPointerMove(event) {
    const state = this.canvasState;
    if (state.pan) {
      const dx = event.clientX - state.pan.startX;
      const dy = event.clientY - state.pan.startY;
      this.setViewport({ x: state.pan.origin.x + dx, y: state.pan.origin.y + dy, zoom: this.app.ui.viewport.zoom });
      return;
    }
    if (state.objectDrag) {
      this.moveObjectDrag(event);
      return;
    }
    if (state.marquee) {
      this.moveMarquee(event);
      return;
    }
    if (state.cellDrag) {
      this.moveCellSelection(event);
      return;
    }
    if (state.pointerDrag) {
      this.movePointerDrag(event);
      return;
    }
    if (state.connectorDraft) {
      this.moveConnector(event);
      return;
    }
    if (state.penDraft) {
      this.movePen(event);
      return;
    }
    if (state.shapeDraft) {
      this.moveShape(event);
      return;
    }
  }

  onPointerUp(event) {
    const state = this.canvasState;
    if (state.pan) {
      state.pan = null;
      this.viewportEl.classList.remove("panning");
    }
    if (state.objectDrag) this.finishObjectDrag(event);
    if (state.marquee) this.finishMarquee(event);
    if (state.cellDrag) this.finishCellSelection(event);
    if (state.pointerDrag) this.finishPointerDrag(event);
    if (state.connectorDraft) this.finishConnector(event);
    if (state.penDraft) this.finishPen(event);
    if (state.shapeDraft) this.finishShape(event);
  }

  // ------------------------------------------------------------- pan / zoom
  startPan(event) {
    this.canvasState.pan = {
      startX: event.clientX,
      startY: event.clientY,
      origin: { ...this.app.ui.viewport },
    };
    this.viewportEl.classList.add("panning");
    event.preventDefault();
  }

  // ------------------------------------------------------------- marquee
  startMarquee(event) {
    const point = this.eventPoint(event);
    this.canvasState.marquee = { x1: point.x, y1: point.y, x2: point.x, y2: point.y, additive: event.shiftKey };
    this.marqueeEl.hidden = false;
    this.marqueeEl.style.left = `${point.x}px`;
    this.marqueeEl.style.top = `${point.y}px`;
    this.marqueeEl.style.width = "0px";
    this.marqueeEl.style.height = "0px";
    if (!event.shiftKey) {
      this.app.ui.selection.clear();
      this.app.ui.cellSelection = null;
    }
  }

  moveMarquee(event) {
    const marquee = this.canvasState.marquee;
    const point = this.eventPoint(event);
    marquee.x2 = point.x;
    marquee.y2 = point.y;
    const left = Math.min(marquee.x1, marquee.x2);
    const top = Math.min(marquee.y1, marquee.y2);
    this.marqueeEl.style.left = `${left}px`;
    this.marqueeEl.style.top = `${top}px`;
    this.marqueeEl.style.width = `${Math.abs(marquee.x2 - marquee.x1)}px`;
    this.marqueeEl.style.height = `${Math.abs(marquee.y2 - marquee.y1)}px`;
  }

  finishMarquee(event) {
    const marquee = this.canvasState.marquee;
    this.canvasState.marquee = null;
    this.marqueeEl.hidden = true;
    if (!marquee) return;
    const rect = { x: Math.min(marquee.x1, marquee.x2), y: Math.min(marquee.y1, marquee.y2), w: Math.abs(marquee.x2 - marquee.x1), h: Math.abs(marquee.y2 - marquee.y1) };
    if (rect.w < 4 && rect.h < 4) {
      this.app.selectObject(null);
      return;
    }
    const viewport = this.app.ui.viewport;
    const world = {
      x: (rect.x - viewport.x) / viewport.zoom,
      y: (rect.y - viewport.y) / viewport.zoom,
      w: rect.w / viewport.zoom,
      h: rect.h / viewport.zoom,
    };
    if (!marquee.additive) this.app.ui.selection.clear();
    for (const object of this.app.project.objects) {
      if (object.kind === "pointer" || object.kind === "connector") continue;
      if (!this.snapshot.objectIds.includes(object.id)) continue;
      const bounds = objectBounds(object, this.snapshot);
      if (bounds && rectsIntersect(bounds, world)) this.app.ui.selection.add(object.id);
    }
    this.app.selectionChanged();
  }

  // ------------------------------------------------------------- object drag
  startObjectDrag(event, object, element) {
    if (!object) return;
    if (!this.editable) {
      this.app.toast("只读");
      return;
    }
    const app = this.app;
    const additive = event.shiftKey;
    if (!app.ui.selection.has(object.id)) {
      if (!additive) app.ui.selection.clear();
      app.ui.selection.add(object.id);
    } else if (additive) {
      app.ui.selection.delete(object.id);
    }
    app.ui.cellSelection = null;
    app.selectionChanged(false);
    if (!app.ui.selection.has(object.id)) return;

    const point = this.eventPoint(event);
    const ids = Array.from(app.ui.selection).filter((id) => {
      const item = getObject(app.project, id);
      return item && item.kind !== "pointer" && item.kind !== "connector";
    });
    const origins = new Map();
    for (const id of ids) {
      const item = getObject(app.project, id);
      if (item) {
        origins.set(id, {
          x: item.x,
          y: item.y,
          points: item.kind === "pen" ? item.points.map((point) => [...point]) : null,
        });
      }
    }
    const bounds = unionBounds(ids.map((id) => objectBounds(getObject(app.project, id), this.snapshot)));
    this.canvasState.objectDrag = {
      startX: point.x,
      startY: point.y,
      lastX: point.x,
      lastY: point.y,
      moved: false,
      historyPushed: false,
      ids,
      origins,
      groupBounds: bounds,
      element,
    };
  }

  moveObjectDrag(event) {
    const drag = this.canvasState.objectDrag;
    const point = this.eventPoint(event);
    const zoom = this.app.ui.viewport.zoom;
    const dx = (point.x - drag.startX) / zoom;
    const dy = (point.y - drag.startY) / zoom;
    if (!drag.moved && Math.abs(point.x - drag.startX) + Math.abs(point.y - drag.startY) < 3) return;
    drag.moved = true;
    if (!drag.historyPushed) {
      this.app.history.push(this.app.project);
      drag.historyPushed = true;
    }
    let finalDx = dx;
    let finalDy = dy;
    const others = this.app.project.objects
      .filter((object) => object.kind !== "pointer" && object.kind !== "connector" && !drag.ids.includes(object.id))
      .map((object) => objectBounds(object, this.snapshot))
      .filter(Boolean);
    if (drag.groupBounds) {
      const moving = {
        x: drag.groupBounds.x + dx,
        y: drag.groupBounds.y + dy,
        w: drag.groupBounds.w,
        h: drag.groupBounds.h,
      };
      const snap = snapDelta(moving, others, 6 / zoom);
      finalDx += snap.dx;
      finalDy += snap.dy;
      this.renderGuides(snap.guides);
    }
    for (const id of drag.ids) {
      const object = getObject(this.app.project, id);
      const origin = drag.origins.get(id);
      if (!object || !origin) continue;
      const element = this.worldEl.querySelector(`.obj[data-object-id="${id}"]`);
      if (object.kind === "pen" && origin.points) {
        object.points = origin.points.map(([x, y]) => [x + finalDx, y + finalDy]);
        const bounds = objectBounds(object, this.snapshot);
        if (element && bounds) {
          element.style.left = `${bounds.x}px`;
          element.style.top = `${bounds.y}px`;
        }
      } else {
        object.x = origin.x + finalDx;
        object.y = origin.y + finalDy;
        if (element) {
          element.style.left = `${object.x}px`;
          element.style.top = `${object.y}px`;
        }
      }
    }
    this.renderWires();
    this.renderPointers();
    this.app.markDirty();
  }

  finishObjectDrag() {
    const drag = this.canvasState.objectDrag;
    this.canvasState.objectDrag = null;
    this.clearGuides();
    if (!drag) return;
    if (drag.moved) {
      this.app.markDirty();
      this.app.scheduleAutosave();
      this.app.renderAll({ inspector: false });
    }
  }

  // ------------------------------------------------------------- cell selection
  startCellSelection(event, cell) {
    if (!this.editable) {
      this.app.toast("只读");
      return;
    }
    const objectId = cell.dataset.objectId;
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    this.app.ui.selection.clear();
    this.app.ui.selection.add(objectId);
    this.app.ui.cellSelection = { objectId, r1: row, c1: col, r2: row, c2: col };
    this.canvasState.cellDrag = { objectId, anchorRow: row, anchorCol: col, moved: false };
    this.app.selectionChanged(false);
    this.app.canvas.paintCellSelection();
    this.app.showStatus("格子里输入 · Esc 退出", 2600);
    event.stopPropagation();
  }

  moveCellSelection(event) {
    const drag = this.canvasState.cellDrag;
    if (!drag) return;
    const element = this.elementAt(event.clientX, event.clientY)?.closest("[data-cell]");
    if (!element || element.dataset.objectId !== drag.objectId) return;
    const row = Number(element.dataset.row);
    const col = Number(element.dataset.col);
    if (row === this.app.ui.cellSelection.r2 && col === this.app.ui.cellSelection.c2) return;
    this.app.ui.cellSelection.r2 = row;
    this.app.ui.cellSelection.c2 = col;
    drag.moved = true;
    this.paintCellSelection();
  }

  finishCellSelection() {
    this.canvasState.cellDrag = null;
    this.app.refreshInspector();
  }

  paintCellSelection() {
    const selection = this.app.ui.cellSelection;
    this.worldEl.querySelectorAll("td[data-cell]").forEach((cell) => {
      cell.classList.remove("range", "active");
      if (!selection || cell.dataset.objectId !== selection.objectId) return;
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      const r1 = Math.min(selection.r1, selection.r2);
      const r2 = Math.max(selection.r1, selection.r2);
      const c1 = Math.min(selection.c1, selection.c2);
      const c2 = Math.max(selection.c1, selection.c2);
      if (row >= r1 && row <= r2 && col >= c1 && col <= c2) cell.classList.add("range");
      if (row === selection.r1 && col === selection.c1) cell.classList.add("active");
    });
  }

  // ------------------------------------------------------------- cell editing
  beginCellEdit(objectId, row, col, initial = null) {
    if (!this.editable) {
      this.app.toast("只读");
      return;
    }
    this.finishCellEdit(true);
    const cell = this.worldEl.querySelector(`td[data-object-id="${objectId}"][data-row="${row}"][data-col="${col}"]`);
    if (!cell) return;
    const object = getObject(this.app.project, objectId);
    const state = this.app.project.live.states[objectId];
    if (!object || !state) return;
    const input = document.createElement("input");
    input.className = "cell-input";
    input.value = initial !== null ? initial : state.data[row][col];
    input.spellcheck = false;
    cell.append(input);
    this.canvasState.cellEdit = { input, objectId, row, col, old: state.data[row][col] };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.finishCellEdit(true, "down");
      } else if (event.key === "Tab") {
        event.preventDefault();
        this.finishCellEdit(true, event.shiftKey ? "left" : "right");
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.finishCellEdit(false);
      }
      event.stopPropagation();
    });
    input.addEventListener("blur", () => this.finishCellEdit(true));
    input.focus();
    if (initial === null) input.select();
    else input.setSelectionRange(1, 1);
  }

  finishCellEdit(commit, move = null) {
    const edit = this.canvasState.cellEdit;
    if (!edit) return;
    this.canvasState.cellEdit = null;
    const value = edit.input.value;
    edit.input.remove();
    if (commit && value !== edit.old && this.editable) {
      this.app.history.push(this.app.project);
      const state = this.app.project.live.states[edit.objectId];
      if (state?.data?.[edit.row]) {
        state.data[edit.row][edit.col] = value;
        this.app.markDirty();
        this.app.scheduleAutosave();
        this.app.renderAll({ inspector: false });
      }
    }
    if (move) {
      const object = getObject(this.app.project, edit.objectId);
      const state = this.app.project.live.states[edit.objectId];
      if (object && state) {
        let row = edit.row;
        let col = edit.col;
        if (move === "right") {
          col += 1;
          if (col >= state.data[0].length) {
            col = 0;
            row = Math.min(state.data.length - 1, row + 1);
          }
        } else if (move === "left") {
          col -= 1;
          if (col < 0) {
            col = state.data[0].length - 1;
            row = Math.max(0, row - 1);
          }
        } else if (move === "down") {
          row = Math.min(state.data.length - 1, row + 1);
        }
        this.app.ui.cellSelection = { objectId: edit.objectId, r1: row, c1: col, r2: row, c2: col };
        this.paintCellSelection();
        this.beginCellEdit(edit.objectId, row, col);
      }
    }
  }

  // ------------------------------------------------------------- inline fields
  onDoubleClick(event) {
    const editable = event.target.closest("[data-edit-field]");
    if (editable) {
      if (!this.editable) {
        this.app.toast("只读");
        return;
      }
      this.beginInlineEdit(editable);
      event.stopPropagation();
      return;
    }
    const cell = event.target.closest("[data-cell]");
    if (cell) {
      this.beginCellEdit(cell.dataset.objectId, Number(cell.dataset.row), Number(cell.dataset.col));
      event.stopPropagation();
    }
  }

  beginInlineEdit(element) {
    if (this.canvasState.inlineEdit) this.finishInlineEdit(true);
    const field = element.dataset.editField;
    const objectId = element.dataset.objectId;
    const index = element.dataset.index !== undefined ? Number(element.dataset.index) : null;
    const old = element.textContent;
    element.setAttribute("contenteditable", "true");
    element.classList.add("inline-editing");
    element.textContent = old === "—" || old === "·" ? "" : old;
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const state = { element, field, objectId, index, old, done: false };
    this.canvasState.inlineEdit = state;
    element.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.finishInlineEdit(false);
      } else if (event.key === "Enter" && !event.shiftKey && !["sticky-text", "text-content", "function-input-v"].includes(field)) {
        event.preventDefault();
        this.finishInlineEdit(true);
      }
      event.stopPropagation();
    });
    element.addEventListener("blur", () => this.finishInlineEdit(true), { once: true });
  }

  finishInlineEdit(commit) {
    const edit = this.canvasState.inlineEdit;
    if (!edit || edit.done) return;
    edit.done = true;
    this.canvasState.inlineEdit = null;
    const { element, field, objectId, index, old } = edit;
    let value = element.textContent.trim();
    element.removeAttribute("contenteditable");
    element.classList.remove("inline-editing");
    if (!commit || !this.editable) {
      element.textContent = old;
      return;
    }
    if (value === old) return;
    const app = this.app;
    const object = getObject(app.project, objectId);
    const state = app.project.live.states[objectId];
    let changed = false;
    const apply = (fn) => {
      app.history.push(app.project);
      fn();
      changed = true;
    };
    if (field === "name" && object) apply(() => (object.name = value || object.name));
    else if (field === "sticky-text" && object) apply(() => (object.text = value));
    else if (field === "text-content" && object) apply(() => (object.text = value));
    else if (field === "shape-text" && object) apply(() => (object.text = value));
    else if (field === "function-signature" && object) apply(() => (object.signature = value));
    else if (field === "function-input-k" && object) apply(() => (object.inputs[index].k = value));
    else if (field === "function-input-v" && object) apply(() => (object.inputs[index].v = value));
    else if (field === "function-output" && object) apply(() => (object.output.v = value));
    else if (field === "variable-value" && state) apply(() => (state.value = value));
    else if (field === "node-value" && state) apply(() => (state.value = value));
    else if (field === "dict-key" && state) apply(() => (state.entries[index].key = value));
    else if (field === "dict-value" && state) apply(() => (state.entries[index].value = value));
    else if (field === "set-item" && state) apply(() => (state.items[index] = value));
    else if (field === "list-item" && state) apply(() => (state.items[index] = value));
    else element.textContent = old;
    if (changed) {
      app.markDirty();
      app.scheduleAutosave();
      app.renderAll();
    } else {
      element.textContent = old;
    }
  }

  // ------------------------------------------------------------- pointer pills
  onPointerPillDown(event) {
    const pill = event.target.closest(".pointer-pill");
    if (!pill) return;
    event.stopPropagation();
    if (!this.editable) {
      this.app.toast("只读");
      return;
    }
    const pointerId = pill.dataset.pointerId;
    const pointer = getObject(this.app.project, pointerId);
    if (!pointer) return;
    const clone = pill.cloneNode(true);
    clone.classList.add("dragging");
    clone.style.left = `${event.clientX}px`;
    clone.style.top = `${event.clientY}px`;
    document.body.append(clone);
    pill.style.opacity = "0.3";
    this.canvasState.pointerDrag = { pointerId, pill, clone, target: null };
  }

  movePointerDrag(event) {
    const drag = this.canvasState.pointerDrag;
    if (!drag) return;
    drag.clone.style.left = `${event.clientX}px`;
    drag.clone.style.top = `${event.clientY}px`;
    this.worldEl.querySelectorAll(".pointer-drop").forEach((node) => node.classList.remove("pointer-drop"));
    const element = this.elementAt(event.clientX, event.clientY);
    const target = element?.closest("[data-pointer-target]");
    if (target) {
      target.classList.add("pointer-drop");
      drag.target = this.readPointerTarget(target);
    } else {
      drag.target = null;
    }
  }

  finishPointerDrag(event) {
    const drag = this.canvasState.pointerDrag;
    if (!drag) return;
    this.canvasState.pointerDrag = null;
    drag.clone.remove();
    drag.pill.style.opacity = "";
    this.worldEl.querySelectorAll(".pointer-drop").forEach((node) => node.classList.remove("pointer-drop"));
    if (!drag.target) {
      this.app.toast("放到格子上");
      return;
    }
    this.app.history.push(this.app.project);
    setPointerState(this.app.project, drag.pointerId, drag.target);
    this.app.markDirty();
    this.app.scheduleAutosave();
    this.app.renderAll();
  }

  cancelPointerDrag() {
    const drag = this.canvasState.pointerDrag;
    if (!drag) return;
    drag.clone.remove();
    drag.pill.style.opacity = "";
    this.worldEl.querySelectorAll(".pointer-drop").forEach((node) => node.classList.remove("pointer-drop"));
    this.canvasState.pointerDrag = null;
  }

  onPointerPillDoubleClick(event) {
    const pill = event.target.closest(".pointer-pill");
    if (!pill) return;
    const pointer = getObject(this.app.project, pill.dataset.pointerId);
    if (!pointer) return;
    this.app.ui.selection.clear();
    this.app.ui.selection.add(pointer.id);
    this.app.ui.cellSelection = null;
    this.app.selectionChanged();
    this.app.inspector.focusField("pointer-name");
  }

  // ------------------------------------------------------------- connectors
  startConnector(event) {
    const anchor = this.readAnchor(event.clientX, event.clientY);
    const world = this.worldPoint(event);
    this.canvasState.connectorDraft = {
      from: anchor || { x: world.x, y: world.y },
      start: this.eventPoint(event),
      end: this.eventPoint(event),
    };
  }

  moveConnector(event) {
    const draft = this.canvasState.connectorDraft;
    if (!draft) return;
    draft.end = this.eventPoint(event);
    this.drawDraftLine(draft.start, draft.end);
  }

  finishConnector(event) {
    const draft = this.canvasState.connectorDraft;
    this.canvasState.connectorDraft = null;
    this.clearDrafts();
    if (!draft) return;
    const anchor = this.readAnchor(event.clientX, event.clientY);
    const world = this.worldPoint(event);
    const to = anchor || { x: world.x, y: world.y };
    if (sameAnchor(draft.from, to)) {
      this.app.toast("起点和终点相同，没有创建连线。");
      return;
    }
    this.app.history.push(this.app.project);
    const fromAnchor = toAnchor(draft.from);
    const toEnd = toAnchor(to);
    const from = withFacingSide(fromAnchor, toEnd, this.app.project.objects, this.snapshot);
    const end = withFacingSide(toEnd, from, this.app.project.objects, this.snapshot);
    const connector = addObject(this.app.project, "connector", {
      from,
      to: end,
      x: 0,
      y: 0,
    });
    this.app.ui.selection.clear();
    this.app.ui.selection.add(connector.id);
    this.app.setTool("select", false);
    this.app.markDirty();
    this.app.scheduleAutosave();
    this.app.renderAll();
  }

  drawDraftLine(start, end) {
    this.clearDrafts();
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", curvePath(start, end));
    path.setAttribute("stroke", "#2f5d8a");
    path.setAttribute("stroke-width", "1.6");
    path.setAttribute("stroke-dasharray", "4 4");
    path.setAttribute("fill", "none");
    path.dataset.draft = "1";
    this.wiresEl.append(path);
  }

  clearDrafts() {
    this.wiresEl.querySelectorAll("[data-draft]").forEach((node) => node.remove());
  }

  onWireClick(event) {
    const hit = event.target.closest(".wire.hit");
    if (!hit) return;
    const id = hit.dataset.connectorId;
    if (!id) return;
    this.app.ui.selection.clear();
    this.app.ui.selection.add(id);
    this.app.ui.cellSelection = null;
    this.app.selectionChanged();
  }

  // ------------------------------------------------------------- pen / shape
  startPen(event) {
    const point = this.worldPoint(event);
    this.canvasState.penDraft = { points: [[point.x, point.y]], last: this.eventPoint(event) };
  }

  movePen(event) {
    const draft = this.canvasState.penDraft;
    if (!draft) return;
    const point = this.worldPoint(event);
    const last = draft.points[draft.points.length - 1];
    if (Math.hypot(point.x - last[0], point.y - last[1]) < 1.5) return;
    draft.points.push([point.x, point.y]);
    this.clearDrafts();
    const screen = draft.points.map(([x, y]) => worldToScreen(this.app.ui.viewport, x, y));
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", screen.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" "));
    path.setAttribute("stroke", "#364b60");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-linecap", "round");
    path.dataset.draft = "1";
    this.wiresEl.append(path);
  }

  finishPen() {
    const draft = this.canvasState.penDraft;
    this.canvasState.penDraft = null;
    this.clearDrafts();
    if (!draft || draft.points.length < 2) return;
    this.app.history.push(this.app.project);
    const pen = addObject(this.app.project, "pen", { points: draft.points });
    this.app.ui.selection.clear();
    this.app.ui.selection.add(pen.id);
    this.app.ui.cellSelection = null;
    this.app.markDirty();
    this.app.scheduleAutosave();
    this.app.renderAll();
  }

  startShape(event) {
    const point = this.worldPoint(event);
    this.canvasState.shapeDraft = { start: point, current: point };
  }

  moveShape(event) {
    const draft = this.canvasState.shapeDraft;
    if (!draft) return;
    draft.current = this.worldPoint(event);
    this.clearDrafts();
    const a = worldToScreen(this.app.ui.viewport, draft.start.x, draft.start.y);
    const b = worldToScreen(this.app.ui.viewport, draft.current.x, draft.current.y);
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", Math.min(a.x, b.x));
    rect.setAttribute("y", Math.min(a.y, b.y));
    rect.setAttribute("width", Math.abs(b.x - a.x));
    rect.setAttribute("height", Math.abs(b.y - a.y));
    rect.setAttribute("rx", "4");
    rect.setAttribute("stroke", "#2f5d8a");
    rect.setAttribute("stroke-width", "1.4");
    rect.setAttribute("stroke-dasharray", "4 4");
    rect.setAttribute("fill", "none");
    rect.dataset.draft = "1";
    this.wiresEl.append(rect);
  }

  finishShape() {
    const draft = this.canvasState.shapeDraft;
    this.canvasState.shapeDraft = null;
    this.clearDrafts();
    if (!draft) return;
    const x = Math.min(draft.start.x, draft.current.x);
    const y = Math.min(draft.start.y, draft.current.y);
    const w = Math.abs(draft.current.x - draft.start.x);
    const h = Math.abs(draft.current.y - draft.start.y);
    if (w < 12 || h < 12) return;
    this.app.history.push(this.app.project);
    const shape = addObject(this.app.project, "shape", { shape: "rect", x, y, w, h });
    this.app.ui.selection.clear();
    this.app.ui.selection.add(shape.id);
    this.app.ui.cellSelection = null;
    this.app.setTool("select", false);
    this.app.markDirty();
    this.app.scheduleAutosave();
    this.app.renderAll();
  }

  // ------------------------------------------------------------- guides
  renderGuides(guides) {
    this.clearGuides();
    for (const guide of guides || []) {
      const line = document.createElement("div");
      line.className = `guide-line ${guide.axis === "x" ? "v" : "h"}`;
      if (guide.axis === "x") {
        const screen = worldToScreen(this.app.ui.viewport, guide.pos, 0);
        line.style.left = `${screen.x}px`;
      } else {
        const screen = worldToScreen(this.app.ui.viewport, 0, guide.pos);
        line.style.top = `${screen.y}px`;
      }
      this.guidesEl.append(line);
    }
  }

  clearGuides() {
    this.guidesEl.replaceChildren();
  }

  // ------------------------------------------------------------- keyboard
  onCanvasKeyDown(event) {
    if (isEditableTarget(event.target)) return;
    const selection = this.app.ui.cellSelection;
    if (!selection) return;
    const state = this.app.project.live.states[selection.objectId];
    if (!state) return;
    const rows = state.data.length;
    const cols = state.data[0].length;
    const activeRow = selection.r2;
    const activeCol = selection.c2;
    const move = (dr, dc) => {
      event.preventDefault();
      const row = clamp(activeRow + dr, 0, rows - 1);
      const col = clamp(activeCol + dc, 0, cols - 1);
      this.app.ui.cellSelection = { objectId: selection.objectId, r1: row, c1: col, r2: row, c2: col };
      this.paintCellSelection();
      this.app.refreshInspector();
    };
    if (event.key === "ArrowUp") move(-1, 0);
    else if (event.key === "ArrowDown") move(1, 0);
    else if (event.key === "ArrowLeft") move(0, -1);
    else if (event.key === "ArrowRight") move(0, 1);
    else if (event.key === "Tab") move(0, event.shiftKey ? -1 : 1);
    else if (event.key === "Enter") {
      event.preventDefault();
      this.beginCellEdit(selection.objectId, selection.r2, selection.c2);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.clearSelectedCells();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      this.beginCellEdit(selection.objectId, selection.r2, selection.c2, event.key);
    } else if (event.key === "Escape") {
      this.app.ui.cellSelection = null;
      this.paintCellSelection();
      this.app.refreshInspector();
    }
  }

  clearSelectedCells() {
    const selection = this.app.ui.cellSelection;
    if (!selection || !this.editable) return;
    const state = this.app.project.live.states[selection.objectId];
    if (!state) return;
    const r1 = Math.min(selection.r1, selection.r2);
    const r2 = Math.max(selection.r1, selection.r2);
    const c1 = Math.min(selection.c1, selection.c2);
    const c2 = Math.max(selection.c1, selection.c2);
    this.app.history.push(this.app.project);
    for (let row = r1; row <= r2; row += 1) {
      for (let col = c1; col <= c2; col += 1) {
        state.data[row][col] = "";
        if (state.marks?.[row]) state.marks[row][col] = "";
      }
    }
    this.app.markDirty();
    this.app.scheduleAutosave();
    this.app.renderAll();
  }

  // ------------------------------------------------------------- context menu
  onContextMenu(event) {
    event.preventDefault();
    const cell = event.target.closest("[data-cell]");
    if (cell) {
      const objectId = cell.dataset.objectId;
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      this.app.ui.selection.clear();
      this.app.ui.selection.add(objectId);
      this.app.ui.cellSelection = { objectId, r1: row, c1: col, r2: row, c2: col };
      this.canvasState.cellDrag = null;
      this.app.selectionChanged(false);
      this.paintCellSelection();
      this.app.showContextMenu(event.clientX, event.clientY, [
        { label: "在这一格加指针", action: () => this.app.addPointerAtSelection() },
        { label: "批量输入这个数组", action: () => this.app.openQuickAdd(cell.dataset.objectId) },
        { label: "复制选区", action: () => this.app.copySelectedCells() },
        { label: "粘贴", action: () => this.app.pasteIntoSelection() },
        { label: "清空内容", action: () => this.clearSelectedCells() },
      ]);
      return;
    }
    const objectEl = event.target.closest(".obj[data-object-id]");
    if (objectEl) {
      const id = objectEl.dataset.objectId;
      if (!this.app.ui.selection.has(id)) {
        this.app.ui.selection.clear();
        this.app.ui.selection.add(id);
        this.app.ui.cellSelection = null;
        this.app.selectionChanged(false);
      }
      const object = getObject(this.app.project, id);
      const items = [
        { label: "复制", action: () => this.app.duplicateSelection() },
        { label: "移到最前", action: () => this.app.bringToFront(id) },
        { label: "移到最后", action: () => this.app.sendToBack(id) },
      ];
      if (object?.kind === "array") items.unshift({ label: "批量输入", action: () => this.app.openQuickAdd(id) });
      if (object?.kind === "array" || object?.kind === "list") items.unshift({ label: "加指针", action: () => this.app.addPointerAtSelection() });
      items.push({ label: "删除", danger: true, action: () => this.app.deleteSelection() });
      this.app.showContextMenu(event.clientX, event.clientY, items);
      return;
    }
    this.app.showContextMenu(event.clientX, event.clientY, [
      { label: "适应画布", action: () => this.fit() },
      { label: "记录一步", action: () => this.app.recordStep() },
      { label: "打开示例", action: () => this.app.loadSample() },
    ]);
  }
}

function isEditableTarget(target) {
  return target instanceof Element && Boolean(target.closest("input, textarea, [contenteditable='true']"));
}

function curvePath(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const amount = Math.max(24, Math.min(110, (horizontal ? Math.abs(dx) : Math.abs(dy)) * 0.5));
  if (horizontal) {
    const sign = Math.sign(dx) || 1;
    return `M ${start.x} ${start.y} C ${start.x + sign * amount} ${start.y}, ${end.x - sign * amount} ${end.y}, ${end.x} ${end.y}`;
  }
  const sign = Math.sign(dy) || 1;
  return `M ${start.x} ${start.y} C ${start.x} ${start.y + sign * amount}, ${end.x} ${end.y - sign * amount}, ${end.x} ${end.y}`;
}

function sameAnchor(a, b) {
  if (!a || !b) return false;
  if (a.objectId || b.objectId) {
    return a.objectId === b.objectId && a.row === b.row && a.col === b.col && a.index === b.index;
  }
  return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0)) < 8;
}

function toAnchor(anchor) {
  if (!anchor) return { x: 0, y: 0 };
  if (anchor.objectId) {
    const next = { objectId: anchor.objectId };
    if (Number.isInteger(anchor.row)) next.row = anchor.row;
    if (Number.isInteger(anchor.col)) next.col = anchor.col;
    if (Number.isInteger(anchor.index)) next.index = anchor.index;
    if (anchor.side) next.side = anchor.side;
    return next;
  }
  return { x: anchor.x, y: anchor.y };
}

function withFacingSide(anchor, other, objects, snapshot) {
  if (!anchor.objectId || anchor.row !== undefined || anchor.col !== undefined || anchor.index !== undefined || anchor.side) {
    return anchor;
  }
  const object = objects.find((item) => item.id === anchor.objectId);
  const bounds = objectBounds(object, snapshot);
  if (!bounds) return anchor;
  const center = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  const target = anchorPoint(objects, snapshot, other) || { x: other.x || center.x, y: other.y || center.y };
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const side = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "bottom" : "top";
  return { ...anchor, side };
}
