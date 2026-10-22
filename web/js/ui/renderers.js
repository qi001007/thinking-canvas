/** HTML renderers for canvas objects. All user text goes through escapeHtml. */
import { cellKey, itemKey, rowKey } from "../core/diff.js";
import { objectBounds } from "../core/geometry.js";
import { MARK_LABELS } from "../core/model.js";
import { escapeHtml } from "./dom.js";

export function renderObjectHTML(app, object, state, diff, editable = true) {
  if (object.kind === "pointer" || object.kind === "connector") return "";
  const bounds = objectBounds(object, app.currentSnapshot);
  const selected = app.ui.selection.has(object.id) ? " selected" : "";
  const changedObject = diff?.objects?.has(object.id) ? " has-diff" : "";
  const left = object.kind === "pen" && bounds ? bounds.x : object.x;
  const top = object.kind === "pen" && bounds ? bounds.y : object.y;
  const style = `left:${left}px;top:${top}px;${bounds ? `width:${bounds.w}px;` : ""}`;
  const wrapper = (inner, extraClass = "") =>
    `<div class="obj${selected}${changedObject}${extraClass}" data-object-id="${object.id}" data-kind="${object.kind}" style="${style}">${inner}</div>`;

  if (object.kind === "array") return wrapper(renderArray(app, object, state, diff, editable));
  if (object.kind === "list") return wrapper(renderList(app, object, state, diff, editable));
  if (object.kind === "dict") return wrapper(renderDict(app, object, state, diff, editable));
  if (object.kind === "set") return wrapper(renderSet(app, object, state, diff, editable));
  if (object.kind === "variable") return wrapper(renderVariable(app, object, state, diff, editable));
  if (object.kind === "node") return wrapper(renderNode(app, object, state, diff, editable), " node-wrapper");
  if (object.kind === "sticky") return wrapper(renderSticky(object, editable));
  if (object.kind === "text") return wrapper(renderText(object, editable));
  if (object.kind === "function") return wrapper(renderFunction(object, editable));
  if (object.kind === "shape") return wrapper(renderShape(object, editable));
  if (object.kind === "pen") return wrapper(renderPen(object, bounds));
  return "";
}

function renderArray(app, object, state, diff, editable) {
  const rows = state.data.length;
  const cols = state.data[0]?.length || 1;
  const diffOn = app.ui.diffEnabled;
  const selection = app.ui.cellSelection;
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    const line = [];
    for (let col = 0; col < cols; col += 1) {
      const value = state.data[row][col];
      const mark = state.marks?.[row]?.[col] || "";
      const changed = diffOn && diff?.cells?.has(cellKey(object.id, row, col));
      const selected = cellRangeState(selection, object.id, row, col);
      const pointerColor = app.pointerTargets?.get(`${object.id}:${row}:${col}`);
      const classes = [
        "cell",
        selected.range ? "range" : "",
        selected.active ? "active" : "",
        changed ? "changed" : "",
        mark ? `mark-${mark}` : "",
        pointerColor ? "pointer-anchor" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const pointerStyle = pointerColor ? ` style="--pointer-color:${escapeHtml(pointerColor)}"` : "";
      line.push(
        `<td class="${classes}"${pointerStyle} data-cell="1" data-object-id="${object.id}" data-row="${row}" data-col="${col}" data-pointer-target="1" title="${escapeHtml(value || "空")}">${escapeHtml(value)}</td>`,
      );
    }
    cells.push(`<tr><th class="rowh">${rows > 1 ? row : ""}</th>${line.join("")}</tr>`);
  }
  const header = Array.from({ length: cols }, (_, col) => `<th>${col}</th>`).join("");
  const pointerRow = `<div class="pointer-row" style="--cols:${cols}" aria-hidden="true"></div>`;
  return `
    <div class="card array-card" data-card="1">
      <div class="card-head" data-drag-handle="1">
        ${titleHTML("array", object, editable)}
        <span class="card-meta">${rows} × ${cols}</span>
        <span class="card-tools">
          <button class="card-tool" data-action="array-pointer" data-object-id="${object.id}" title="在选中的格子加指针">+i</button>
          <button class="card-tool" data-action="array-quick" data-object-id="${object.id}" title="批量输入">⋯</button>
        </span>
      </div>
      <div class="array-scroll">
        <table class="array-table">
          <thead><tr><th class="rowh"></th>${header}</tr></thead>
          <tbody>${cells.join("")}</tbody>
        </table>
        ${pointerRow}
      </div>
    </div>`;
}

function renderList(app, object, state, diff, editable) {
  const items = state.items || [];
  const diffOn = app.ui.diffEnabled;
  const orientation = object.orientation === "horizontal" ? "horizontal" : "vertical";
  const html = items
    .map((item, index) => {
      const mark = state.marks?.[index] || "";
      const changed = diffOn && diff?.items?.has(itemKey(object.id, index));
      const active = app.ui.cellSelection?.objectId === object.id && app.ui.cellSelection?.index === index;
      return `<div class="list-item${changed ? " changed" : ""}${active ? " active" : ""}${mark ? ` mark-${mark}` : ""}" data-list-item="1" data-object-id="${object.id}" data-index="${index}" data-pointer-target="1" data-edit-field="list-item" title="${escapeHtml(item || "空")}">${orientation === "horizontal" ? "" : `<span class="idx">${index}</span>`}${escapeHtml(item || "·")}</div>`;
    })
    .join("");
  return `
    <div class="card list-card" data-card="1">
      <div class="card-head" data-drag-handle="1">
        ${titleHTML("list", object, editable)}
        <span class="card-meta">${orientation === "vertical" ? "纵向" : "横向"}</span>
        <span class="card-tools"><button class="card-tool" data-action="list-add" data-object-id="${object.id}" title="追加一项">＋</button></span>
      </div>
      <div class="card-body"><div class="list-${orientation}">${html || '<span class="array-empty">空列表</span>'}</div></div>
    </div>`;
}

function renderDict(app, object, state, diff, editable) {
  const entries = state.entries || [];
  const diffOn = app.ui.diffEnabled;
  const rows = entries
    .map((entry, index) => {
      const changed = diffOn && diff?.rows?.has(rowKey(object.id, index));
      return `<tr class="${changed ? "changed" : ""}" data-dict-row="1" data-object-id="${object.id}" data-index="${index}" data-pointer-target="1">
        <td class="key" data-edit-field="dict-key" data-object-id="${object.id}" data-index="${index}">${escapeHtml(entry.key)}</td>
        <td data-edit-field="dict-value" data-object-id="${object.id}" data-index="${index}">${escapeHtml(entry.value)}</td>
      </tr>`;
    })
    .join("");
  return `
    <div class="card dict-card" data-card="1">
      <div class="card-head" data-drag-handle="1">
        ${titleHTML("dict", object, editable)}
        <span class="card-meta">${entries.length} 条</span>
        <span class="card-tools">
          <button class="card-tool" data-action="dict-add" data-object-id="${object.id}" title="加一行">＋</button>
          <button class="card-tool" data-action="dict-quick" data-object-id="${object.id}" title="批量输入">⋯</button>
        </span>
      </div>
      <div class="card-body">
        ${entries.length ? `<table class="dict-table"><thead><tr><th>KEY</th><th>VALUE</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="dict-empty">空字典</div>'}
      </div>
    </div>`;
}

function renderSet(app, object, state, diff, editable) {
  const items = state.items || [];
  const diffOn = app.ui.diffEnabled;
  const chips = items
    .map((item, index) => {
      const changed = diffOn && diff?.items?.has(itemKey(object.id, index));
      return `<span class="set-chip${changed ? " changed" : ""}" data-set-item="1" data-object-id="${object.id}" data-index="${index}" data-pointer-target="1" data-edit-field="set-item" data-edit-index="${index}">${escapeHtml(item || "·")}</span>`;
    })
    .join("");
  return `
    <div class="card set-card" data-card="1">
      <div class="card-head" data-drag-handle="1">
        ${titleHTML("set", object, editable)}
        <span class="card-meta">${items.length} 个</span>
        <span class="card-tools">
          <button class="card-tool" data-action="set-add" data-object-id="${object.id}" title="加一项">＋</button>
          <button class="card-tool" data-action="set-quick" data-object-id="${object.id}" title="批量输入">⋯</button>
        </span>
      </div>
      <div class="card-body">${chips ? `<div class="set-chips">${chips}</div>` : '<div class="dict-empty">空集合</div>'}</div>
    </div>`;
}

function renderVariable(app, object, state, diff, editable) {
  const changed = app.ui.diffEnabled && diff?.objects?.has(object.id);
  return `
    <div class="card variable-card" data-card="1">
      <div class="card-head" data-drag-handle="1">${titleHTML("variable", object, editable)}</div>
      <div class="variable-value${changed ? " changed" : ""}" data-edit-field="variable-value" data-object-id="${object.id}" title="双击编辑">${escapeHtml(state.value || "—")}</div>
    </div>`;
}

function renderNode(app, object, state, diff, editable) {
  const changed = app.ui.diffEnabled && diff?.objects?.has(object.id);
  const shape = object.shape === "circle" ? "circle" : "box";
  return `
    <div class="node-card ${shape}${changed ? " changed" : ""}" data-drag-handle="1" data-object-id="${object.id}" data-pointer-target="1">
      <div class="node-value" data-edit-field="node-value" data-object-id="${object.id}" title="双击编辑">${escapeHtml(state.value || "·")}</div>
      <span class="node-port left"></span><span class="node-port right"></span><span class="node-port top"></span><span class="node-port bottom"></span>
    </div>`;
}

function renderSticky(object, editable) {
  const color = ["green", "blue", "pink"].includes(object.color) ? object.color : "yellow";
  return `
    <div class="sticky-card ${color}" data-card="1" data-drag-handle="1" style="width:${object.w}px;min-height:${object.h}px">
      <div class="sticky-text" data-edit-field="sticky-text" data-object-id="${object.id}" title="双击编辑">${escapeHtml(object.text || "写点什么…")}</div>
      <div class="sticky-label">${object.color === "green" ? "INVARIANT" : "NOTE"}</div>
    </div>`;
}

function renderText(object, editable) {
  return `
    <div class="text-card" data-card="1" data-drag-handle="1" style="width:${object.w}px;min-height:${object.h}px">
      <div class="text-content" data-edit-field="text-content" data-object-id="${object.id}" title="双击编辑">${escapeHtml(object.text || "文字")}</div>
    </div>`;
}

function renderFunction(object, editable) {
  const inputs = object.inputs || [];
  const inputRows = inputs
    .map(
      (item, index) => `<div class="function-row"><div class="k" data-edit-field="function-input-k" data-object-id="${object.id}" data-index="${index}">${escapeHtml(item.k || "输入")}</div><div class="v" data-edit-field="function-input-v" data-object-id="${object.id}" data-index="${index}">${escapeHtml(item.v || "—")}</div></div>`,
    )
    .join("");
  return `
    <div class="card function-card" data-card="1">
      <div class="card-head" data-drag-handle="1">
        <span class="card-title">FUNCTION</span>
        <span class="card-meta">${escapeHtml(object.complexity || "复杂度")}</span>
      </div>
      <div class="function-body">
        <div class="function-signature" data-edit-field="function-signature" data-object-id="${object.id}" title="双击编辑">${escapeHtml(object.signature || "solve(input) -> output")}</div>
        <div class="function-rows">
          ${inputRows}
          <div class="function-row"><div class="k">${escapeHtml(object.output?.k || "输出")}</div><div class="v" data-edit-field="function-output" data-object-id="${object.id}">${escapeHtml(object.output?.v || "—")}</div></div>
        </div>
      </div>
    </div>`;
}

function renderShape(object, editable) {
  return `
    <div class="shape-card ${object.shape === "ellipse" ? "ellipse" : "rect"}" data-card="1" data-drag-handle="1" style="width:${object.w}px;height:${object.h}px">
      <div class="shape-text" data-edit-field="shape-text" data-object-id="${object.id}" title="双击编辑">${escapeHtml(object.text || "")}</div>
    </div>`;
}

function renderPen(object, bounds) {
  if (!bounds) return "";
  const points = (object.points || []).map(([x, y]) => `${x - bounds.x},${y - bounds.y}`).join(" ");
  return `<svg class="pen-svg" width="${bounds.w}" height="${bounds.h}" viewBox="0 0 ${bounds.w} ${bounds.h}" data-object-id="${object.id}" data-pen="1"><polyline points="${points}" fill="none" stroke="${escapeHtml(object.color || "#364b60")}" stroke-width="${object.width || 2}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function titleHTML(kind, object, editable) {
  return `<span class="card-title" data-edit-field="name" data-object-id="${object.id}" title="双击改名">${escapeHtml(object.name || kind)}</span>`;
}

function cellRangeState(selection, objectId, row, col) {
  if (!selection || selection.objectId !== objectId) return { range: false, active: false };
  const r1 = Math.min(selection.r1, selection.r2);
  const r2 = Math.max(selection.r1, selection.r2);
  const c1 = Math.min(selection.c1, selection.c2);
  const c2 = Math.max(selection.c1, selection.c2);
  const range = row >= r1 && row <= r2 && col >= c1 && col <= c2;
  return { range, active: row === selection.r1 && col === selection.c1 };
}

export function pointerPillHTML(app, pointer, snapshot, diff) {
  const target = snapshot.pointers?.[pointer.id];
  if (!target) return "";
  const position = pointerPosition(app, pointer, target, snapshot);
  if (!position) return "";
  const changed = app.ui.diffEnabled && diff?.pointers?.has(pointer.id);
  const offset = pointerStackOffset(app, pointer, target, snapshot);
  const transform = position.above ? "translate(-50%, -100%)" : "translate(-50%, -50%)";
  return `<span class="pointer-pill${changed ? " changed" : ""}" data-pointer-id="${pointer.id}" style="left:${position.x + offset}px;top:${position.y}px;transform:${transform};background:${escapeHtml(pointer.color || "#3c6fb0")};color:#fff" title="拖动指针到格子或节点；双击改名">${escapeHtml(pointer.name || "p")}</span>`;
}

function pointerStackOffset(app, pointer, target, snapshot) {
  const peers = app.project.objects.filter(
    (object) => object.kind === "pointer" && sameTarget(snapshot.pointers?.[object.id], target),
  );
  if (peers.length <= 1) return 0;
  const index = peers.findIndex((object) => object.id === pointer.id);
  return (index - (peers.length - 1) / 2) * 22;
}

function sameTarget(a, b) {
  return (
    (a?.targetId || "") === (b?.targetId || "") &&
    (a?.row ?? null) === (b?.row ?? null) &&
    (a?.col ?? null) === (b?.col ?? null) &&
    (a?.index ?? null) === (b?.index ?? null)
  );
}

export function pointerPosition(app, pointer, target, snapshot) {
  const object = app.project.objects.find((item) => item.id === target.targetId);
  if (!object) return null;
  const state = snapshot.states?.[object.id];
  const bounds = objectBounds(object, snapshot);
  if (!bounds) return null;
  let world;
  let above = false;
  if (object.kind === "array" && Number.isInteger(target.row) && Number.isInteger(target.col)) {
    const { arrayCellRect } = app.geometry;
    const cell = arrayCellRect(object, snapshot, target.row, target.col);
    const oneRow = state?.data?.length === 1;
    if (oneRow) {
      world = { x: cell.x + cell.w / 2, y: bounds.y + bounds.h - 8 };
    } else {
      world = { x: cell.x + cell.w / 2, y: cell.y - 3 };
      above = true;
    }
  } else if (object.kind === "list" && Number.isInteger(target.index)) {
    const { listItemRect } = app.geometry;
    const item = listItemRect(object, snapshot, target.index);
    world = { x: item.x + item.w + 4, y: item.y + item.h / 2 };
  } else if (object.kind === "dict" && Number.isInteger(target.index)) {
    const { dictRowRect } = app.geometry;
    const row = dictRowRect(object, snapshot, target.index);
    world = row ? { x: row.x + row.w - 4, y: row.y + row.h / 2 } : { x: bounds.x + bounds.w, y: bounds.y };
  } else {
    world = { x: bounds.x + bounds.w, y: bounds.y };
  }
  const screen = app.geometry.worldToScreen(app.ui.viewport, world.x, world.y);
  return { x: screen.x, y: screen.y, above };
}
