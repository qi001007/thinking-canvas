/**
 * Pure project model. No DOM, no persistence side effects.
 *
 * A project has persistent objects (positions, cards, annotations) and two
 * kinds of dynamic data:
 *   - live.states / live.pointers: the editable current attempt
 *   - steps[]: recorded snapshots, each with its own states and pointers
 *
 * Keeping live and recorded steps separate is what lets "当前" stay editable
 * while history stays read-only.
 */

export const SCHEMA_VERSION = 1;
export const MAX_ROWS = 100;
export const MAX_COLS = 60;
export const MAX_ITEMS = 300;

export const STATE_KINDS = new Set(["array", "list", "dict", "set", "variable", "node"]);
export const OBJECT_KINDS = new Set([
  ...STATE_KINDS,
  "pointer",
  "sticky",
  "text",
  "function",
  "connector",
  "pen",
  "shape",
]);

export const MARK_VALUES = new Set(["", "yellow", "green", "blue", "pink", "violet"]);
export const POINTER_COLORS = ["#3c6fb0", "#a0576f", "#3d7a58", "#76558f", "#b07a2f"];
export const MARK_LABELS = {
  "": "无",
  yellow: "黄",
  green: "绿",
  blue: "蓝",
  pink: "粉",
  violet: "紫",
};

export const KIND_LABELS = {
  array: "数组",
  list: "列表",
  dict: "字典",
  set: "集合",
  variable: "变量",
  node: "节点",
  pointer: "指针",
  sticky: "便签",
  text: "文字",
  function: "函数卡",
  connector: "连线",
  pen: "画笔",
  shape: "形状",
};

const DEFAULT_NAMES = {
  array: "nums",
  list: "list",
  dict: "seen",
  set: "seen",
  variable: "变量",
  node: "节点",
  pointer: "i",
  sticky: "便签",
  text: "文字",
  function: "函数",
  connector: "",
  pen: "",
  shape: "",
};

export function newId(prefix = "o") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function clone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function asString(value) {
  return value === null || value === undefined ? "" : String(value);
}

function asCoord(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function createProject(title = "未命名画板") {
  const stamp = nowIso();
  return {
    schemaVersion: SCHEMA_VERSION,
    title: title || "未命名画板",
    createdAt: stamp,
    updatedAt: stamp,
    objects: [],
    live: { states: {}, pointers: {} },
    steps: [],
  };
}

export function touch(project) {
  project.updatedAt = nowIso();
  return project;
}

/** Create an object plus its initial live state. */
export function createObject(kind, options = {}) {
  assert(OBJECT_KINDS.has(kind), `不支持的对象类型：${kind}`);
  const object = {
    id: options.id || newId(kind.slice(0, 1)),
    kind,
    name: options.name ?? DEFAULT_NAMES[kind] ?? "",
    x: asCoord(options.x, 80),
    y: asCoord(options.y, 80),
    createdAt: nowIso(),
  };
  let state = null;

  if (kind === "array") {
    const rows = clampInt(options.rows ?? 1, 1, MAX_ROWS);
    const cols = clampInt(options.cols ?? 5, 1, MAX_COLS);
    state = makeArrayState(rows, cols, options.data);
  } else if (kind === "list") {
    object.orientation = options.orientation === "horizontal" ? "horizontal" : "vertical";
    state = { items: normalizeStringArray(options.items ?? [""], MAX_ITEMS), marks: [] };
    state.marks = state.items.map(() => "");
  } else if (kind === "dict") {
    object.width = 220;
    state = { entries: normalizeEntries(options.entries ?? [{ key: "", value: "" }]) };
  } else if (kind === "set") {
    object.width = 210;
    state = { items: normalizeStringArray(options.items ?? [], MAX_ITEMS) };
  } else if (kind === "variable") {
    state = { value: asString(options.value ?? "") };
  } else if (kind === "node") {
    object.shape = options.shape === "circle" ? "circle" : "box";
    state = { value: asString(options.value ?? "") };
  } else if (kind === "pointer") {
    object.color = options.color || POINTER_COLORS[0];
    object.name = options.name ?? "i";
  } else if (kind === "sticky") {
    object.text = asString(options.text ?? "");
    object.color = ["yellow", "green", "blue", "pink"].includes(options.color) ? options.color : "yellow";
    object.w = asCoord(options.w, 220);
    object.h = asCoord(options.h, 104);
  } else if (kind === "text") {
    object.text = asString(options.text ?? "");
    object.w = asCoord(options.w, 220);
    object.h = asCoord(options.h, 40);
  } else if (kind === "function") {
    object.signature = asString(options.signature ?? "solve(input) -> output");
    object.inputs = Array.isArray(options.inputs)
      ? options.inputs.map((item) => ({ k: asString(item.k), v: asString(item.v) }))
      : [{ k: "输入", v: "" }];
    object.output = { k: asString(options.output?.k ?? "输出"), v: asString(options.output?.v ?? "") };
    object.complexity = asString(options.complexity ?? "");
    object.w = asCoord(options.w, 340);
    object.h = asCoord(options.h, 184);
  } else if (kind === "connector") {
    object.from = normalizeAnchor(options.from) || { x: 0, y: 0 };
    object.to = normalizeAnchor(options.to) || { x: 100, y: 100 };
    object.label = asString(options.label ?? "");
    object.arrow = options.arrow === "both" ? "both" : options.arrow === "none" ? "none" : "end";
    object.dashed = Boolean(options.dashed);
  } else if (kind === "pen") {
    object.points = Array.isArray(options.points) ? options.points.map((p) => [asCoord(p[0]), asCoord(p[1])]) : [];
    object.color = options.color || "#364b60";
    object.width = asCoord(options.width, 2);
  } else if (kind === "shape") {
    object.shape = options.shape === "ellipse" ? "ellipse" : "rect";
    object.w = asCoord(options.w, 140);
    object.h = asCoord(options.h, 80);
    object.text = asString(options.text ?? "");
    object.x = asCoord(options.x, 80);
    object.y = asCoord(options.y, 80);
  }

  if (kind === "pointer") {
    object.target = normalizePointerTarget(options.target);
  }
  return { object, state };
}

export function makeArrayState(rows, cols, data) {
  const safeRows = clampInt(rows, 1, MAX_ROWS);
  const safeCols = clampInt(cols, 1, MAX_COLS);
  const grid = Array.from({ length: safeRows }, (_, r) =>
    Array.from({ length: safeCols }, (_, c) => asString(data?.[r]?.[c] ?? "")),
  );
  return {
    data: grid,
    marks: grid.map((row) => row.map(() => "")),
  };
}

export function normalizePointerTarget(target) {
  if (!target || typeof target !== "object") return null;
  const targetId = asString(target.targetId || target.objectId || "");
  if (!targetId) return null;
  const normalized = { targetId };
  if (Number.isInteger(target.row)) normalized.row = target.row;
  if (Number.isInteger(target.col)) normalized.col = target.col;
  if (Number.isInteger(target.index)) normalized.index = target.index;
  return normalized;
}

export function normalizeAnchor(anchor) {
  if (!anchor || typeof anchor !== "object") return null;
  if (anchor.objectId) {
    const normalized = { objectId: asString(anchor.objectId) };
    if (Number.isInteger(anchor.row)) normalized.row = anchor.row;
    if (Number.isInteger(anchor.col)) normalized.col = anchor.col;
    if (Number.isInteger(anchor.index)) normalized.index = anchor.index;
    if (["left", "right", "top", "bottom", "center"].includes(anchor.side)) {
      normalized.side = anchor.side;
    }
    return normalized;
  }
  if (Number.isFinite(Number(anchor.x)) && Number.isFinite(Number(anchor.y))) {
    return { x: Number(anchor.x), y: Number(anchor.y) };
  }
  return null;
}

export function addObject(project, kind, options = {}) {
  const { object, state } = createObject(kind, options);
  project.objects.push(object);
  if (state !== null) {
    project.live.states[object.id] = state;
  }
  if (kind === "pointer") {
    project.live.pointers[object.id] = object.target;
    delete object.target;
  }
  touch(project);
  return object;
}

export function removeObject(project, objectId) {
  const removed = new Set([objectId]);
  for (const object of project.objects) {
    if (object.kind === "pointer") {
      const target = project.live.pointers[object.id];
      if (target?.targetId === objectId) removed.add(object.id);
    }
  }
  // Pointers that target a removed pointer cannot happen in the UI, but guard it.
  let changed = true;
  while (changed) {
    changed = false;
    for (const object of project.objects) {
      if (object.kind !== "pointer" || removed.has(object.id)) continue;
      const target = project.live.pointers[object.id];
      if (target && removed.has(target.targetId)) {
        removed.add(object.id);
        changed = true;
      }
    }
  }

  project.objects = project.objects.filter((object) => {
    if (removed.has(object.id)) return false;
    if (object.kind === "connector") {
      if (endpointReferences(object.from, removed) || endpointReferences(object.to, removed)) return false;
    }
    return true;
  });

  for (const id of removed) {
    delete project.live.states[id];
    delete project.live.pointers[id];
  }
  for (const step of project.steps) {
    step.objectIds = step.objectIds.filter((id) => !removed.has(id));
    for (const id of removed) {
      delete step.states[id];
      delete step.pointers[id];
    }
  }
  touch(project);
  return removed;
}

function endpointReferences(anchor, ids) {
  return Boolean(anchor && anchor.objectId && ids.has(anchor.objectId));
}

export function duplicateObject(project, objectId, offset = { x: 32, y: 32 }) {
  const source = getObject(project, objectId);
  if (!source) return null;
  const copy = clone(source);
  copy.id = newId(copy.kind.slice(0, 1));
  copy.createdAt = nowIso();
  copy.x = asCoord(copy.x) + offset.x;
  copy.y = asCoord(copy.y) + offset.y;
  if (copy.kind === "pointer") {
    const target = project.live.pointers[objectId] || null;
    const nextTarget = target ? { ...target } : null;
    if (nextTarget && nextTarget.targetId === objectId) nextTarget.targetId = copy.id;
    project.live.pointers[copy.id] = nextTarget;
  } else if (STATE_KINDS.has(copy.kind)) {
    const state = project.live.states[objectId];
    if (state) project.live.states[copy.id] = clone(state);
  }
  project.objects.push(copy);
  touch(project);
  return copy;
}

export function getObject(project, objectId) {
  return project.objects.find((object) => object.id === objectId) || null;
}

export function statefulObjects(project) {
  return project.objects.filter((object) => STATE_KINDS.has(object.kind));
}

export function pointerObjects(project) {
  return project.objects.filter((object) => object.kind === "pointer");
}

export function getObjectState(project, objectId) {
  return project.live.states[objectId] || null;
}

export function setObjectState(project, objectId, state) {
  project.live.states[objectId] = state;
  touch(project);
}

export function getPointerState(project, pointerId) {
  return project.live.pointers[pointerId] || null;
}

export function setPointerState(project, pointerId, target) {
  project.live.pointers[pointerId] = normalizePointerTarget(target);
  touch(project);
}

export function nextPointerName(project) {
  const used = new Set(pointerObjects(project).map((pointer) => pointer.name));
  const candidates = ["i", "j", "k", "left", "right", "mid", "lo", "hi", "slow", "fast"];
  return candidates.find((name) => !used.has(name)) || `p${used.size + 1}`;
}

export function nextPointerColor(project) {
  const used = pointerObjects(project).map((pointer) => pointer.color);
  return POINTER_COLORS.find((color) => !used.includes(color)) || POINTER_COLORS[used.length % POINTER_COLORS.length];
}

export function nextObjectName(project, kind) {
  const base = DEFAULT_NAMES[kind] || KIND_LABELS[kind] || kind;
  const names = new Set(project.objects.map((object) => object.name));
  if (!names.has(base)) return base;
  let index = 2;
  while (names.has(`${base}${index}`)) index += 1;
  return `${base}${index}`;
}

export function clampInt(value, min, max) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function normalizeStringArray(values, max) {
  const list = Array.isArray(values) ? values.map(asString) : [];
  return list.slice(0, max);
}

function normalizeEntries(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return list
    .map((entry) => ({ key: asString(entry?.key), value: asString(entry?.value) }))
    .slice(0, MAX_ITEMS);
}

// ---------------------------------------------------------------- validation

export function normalizeState(kind, state) {
  assert(STATE_KINDS.has(kind), `不是有状态对象：${kind}`);
  if (!state || typeof state !== "object") {
    throw new Error("对象状态缺失。");
  }
  if (kind === "array") {
    const data = state.data;
    assert(Array.isArray(data) && data.length >= 1, "数组数据必须是非空矩阵。");
    assert(data.length <= MAX_ROWS, `数组最多 ${MAX_ROWS} 行。`);
    const width = data[0]?.length;
    assert(Number.isInteger(width) && width >= 1 && width <= MAX_COLS, `数组最多 ${MAX_COLS} 列。`);
    const grid = data.map((row, r) => {
      assert(Array.isArray(row) && row.length === width, `数组第 ${r} 行长度不一致。`);
      return row.map(asString);
    });
    const marks = Array.isArray(state.marks) ? state.marks : [];
    const markGrid = grid.map((row, r) =>
      row.map((_, c) => {
        const mark = marks[r]?.[c] ?? "";
        return MARK_VALUES.has(mark) ? mark : "";
      }),
    );
    return { data: grid, marks: markGrid };
  }
  if (kind === "list") {
    assert(Array.isArray(state.items), "列表数据缺失。");
    const items = state.items.map(asString).slice(0, MAX_ITEMS);
    const marks = Array.isArray(state.marks) ? state.marks : [];
    return {
      items,
      marks: items.map((_, index) => {
        const mark = marks[index] ?? "";
        return MARK_VALUES.has(mark) ? mark : "";
      }),
    };
  }
  if (kind === "dict") {
    assert(Array.isArray(state.entries), "字典数据缺失。");
    return { entries: normalizeEntries(state.entries) };
  }
  if (kind === "set") {
    assert(Array.isArray(state.items), "集合数据缺失。");
    return { items: state.items.map(asString).slice(0, MAX_ITEMS) };
  }
  if (kind === "variable" || kind === "node") {
    return { value: asString(state.value) };
  }
  throw new Error(`不支持的状态类型：${kind}`);
}

export function validateProject(raw) {
  assert(raw && typeof raw === "object", "项目必须是对象。");
  assert(raw.schemaVersion === SCHEMA_VERSION, "项目版本不受支持。");
  assert(typeof raw.title === "string", "项目标题格式错误。");
  assert(Array.isArray(raw.objects), "对象列表缺失。");
  assert(raw.live && typeof raw.live === "object", "当前状态缺失。");
  assert(Array.isArray(raw.steps), "步骤列表缺失。");

  const project = {
    schemaVersion: SCHEMA_VERSION,
    title: raw.title || "未命名画板",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : nowIso(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : nowIso(),
    objects: [],
    live: { states: {}, pointers: {} },
    steps: [],
  };

  const ids = new Set();
  for (const rawObject of raw.objects) {
    assert(rawObject && typeof rawObject === "object", "对象数据错误。");
    assert(typeof rawObject.id === "string" && rawObject.id, "对象 ID 缺失。");
    assert(!ids.has(rawObject.id), `对象 ID 重复：${rawObject.id}`);
    ids.add(rawObject.id);
    assert(OBJECT_KINDS.has(rawObject.kind), `不支持的对象类型：${rawObject.kind}`);
    const object = clone(rawObject);
    object.name = asString(object.name);
    object.x = asCoord(object.x);
    object.y = asCoord(object.y);
    object.createdAt = typeof object.createdAt === "string" ? object.createdAt : nowIso();
    if (object.kind === "pointer") {
      object.color = asString(object.color) || POINTER_COLORS[0];
      delete object.target;
    }
    if (object.kind === "connector") {
      object.from = normalizeAnchor(object.from) || { x: 0, y: 0 };
      object.to = normalizeAnchor(object.to) || { x: 100, y: 100 };
      object.label = asString(object.label);
      object.arrow = object.arrow === "both" ? "both" : object.arrow === "none" ? "none" : "end";
      object.dashed = Boolean(object.dashed);
    }
    if (object.kind === "pen") {
      object.points = Array.isArray(object.points)
        ? object.points.map((point) => [asCoord(point?.[0]), asCoord(point?.[1])])
        : [];
      assert(object.points.length >= 2, "画笔路径至少需要两个点。");
    }
    if (object.kind === "shape") {
      object.shape = object.shape === "ellipse" ? "ellipse" : "rect";
      object.w = asCoord(object.w, 140);
      object.h = asCoord(object.h, 80);
      object.text = asString(object.text);
    }
    if (object.kind === "sticky" || object.kind === "text") {
      object.text = asString(object.text);
      object.w = asCoord(object.w, object.kind === "sticky" ? 220 : 220);
      object.h = asCoord(object.h, object.kind === "sticky" ? 104 : 40);
    }
    if (object.kind === "sticky") {
      object.color = ["yellow", "green", "blue", "pink"].includes(object.color) ? object.color : "yellow";
    }
    if (object.kind === "function") {
      object.signature = asString(object.signature);
      object.inputs = Array.isArray(object.inputs)
        ? object.inputs.map((item) => ({ k: asString(item?.k), v: asString(item?.v) }))
        : [];
      object.output = { k: asString(object.output?.k), v: asString(object.output?.v) };
      object.complexity = asString(object.complexity);
      object.w = asCoord(object.w, 340);
      object.h = asCoord(object.h, 184);
    }
    if (object.kind === "list") {
      object.orientation = object.orientation === "horizontal" ? "horizontal" : "vertical";
    }
    if (object.kind === "node") {
      object.shape = object.shape === "circle" ? "circle" : "box";
    }
    project.objects.push(object);
  }

  const objectMap = new Map(project.objects.map((object) => [object.id, object]));
  const stateIds = new Set(Object.keys(raw.live.states || {}));
  for (const id of stateIds) {
    assert(objectMap.has(id), `当前状态引用了不存在的对象：${id}`);
    const object = objectMap.get(id);
    assert(STATE_KINDS.has(object.kind), `非状态对象不应有状态：${id}`);
    project.live.states[id] = normalizeState(object.kind, raw.live.states[id]);
  }
  for (const object of project.objects) {
    if (STATE_KINDS.has(object.kind)) {
      assert(project.live.states[object.id], `对象 ${object.name || object.id} 缺少当前状态。`);
    }
  }

  for (const [pointerId, target] of Object.entries(raw.live.pointers || {})) {
    const pointer = objectMap.get(pointerId);
    assert(pointer && pointer.kind === "pointer", `指针状态引用了不存在的指针：${pointerId}`);
    const normalized = normalizePointerTarget(target);
    if (normalized) {
      assertPointerTarget(objectMap, project.live.states, normalized, pointerId);
    }
    project.live.pointers[pointerId] = normalized;
  }
  for (const pointer of pointerObjects(project)) {
    if (!(pointer.id in project.live.pointers)) project.live.pointers[pointer.id] = null;
  }

  const stepIds = new Set();
  for (const rawStep of raw.steps) {
    assert(rawStep && typeof rawStep === "object", "步骤数据错误。");
    assert(typeof rawStep.id === "string" && rawStep.id, "步骤 ID 缺失。");
    assert(!stepIds.has(rawStep.id), `步骤 ID 重复：${rawStep.id}`);
    stepIds.add(rawStep.id);
    const step = {
      id: rawStep.id,
      title: asString(rawStep.title) || `第 ${project.steps.length + 1} 步`,
      note: asString(rawStep.note),
      createdAt: typeof rawStep.createdAt === "string" ? rawStep.createdAt : nowIso(),
      objectIds: Array.isArray(rawStep.objectIds) ? rawStep.objectIds.filter((id) => objectMap.has(id)) : [],
      states: {},
      pointers: {},
    };
    for (const [id, state] of Object.entries(rawStep.states || {})) {
      const object = objectMap.get(id);
      if (!object) continue;
      assert(STATE_KINDS.has(object.kind), `步骤中的非状态对象：${id}`);
      step.states[id] = normalizeState(object.kind, state);
      if (!step.objectIds.includes(id)) step.objectIds.push(id);
    }
    for (const object of project.objects) {
      if (STATE_KINDS.has(object.kind) && step.objectIds.includes(object.id)) {
        assert(step.states[object.id], `步骤缺少对象状态：${object.id}`);
      }
    }
    for (const [pointerId, target] of Object.entries(rawStep.pointers || {})) {
      const pointer = objectMap.get(pointerId);
      if (!pointer || pointer.kind !== "pointer") continue;
      const normalized = normalizePointerTarget(target);
      if (normalized) assertPointerTarget(objectMap, step.states, normalized, pointerId);
      step.pointers[pointerId] = normalized;
    }
    project.steps.push(step);
  }
  return project;
}

function assertPointerTarget(objectMap, states, target, label) {
  const object = objectMap.get(target.targetId);
  assert(object, `指针 ${label} 指向了不存在的对象。`);
  if (object.kind === "array") {
    const state = states[target.targetId];
    assert(state, `指针 ${label} 指向的数组没有状态。`);
    const rows = state.data.length;
    const cols = state.data[0].length;
    assert(
      Number.isInteger(target.row) &&
        Number.isInteger(target.col) &&
        target.row >= 0 &&
        target.row < rows &&
        target.col >= 0 &&
        target.col < cols,
      `指针 ${label} 指向了数组外的格子。`,
    );
  } else if (object.kind === "list") {
    const state = states[target.targetId];
    assert(state, `指针 ${label} 指向的列表没有状态。`);
    assert(Number.isInteger(target.index) && target.index >= 0 && target.index < state.items.length, `指针 ${label} 指向了列表外。`);
  } else if (object.kind === "dict") {
    const state = states[target.targetId];
    assert(state, `指针 ${label} 指向的字典没有状态。`);
    assert(Number.isInteger(target.index) && target.index >= 0 && target.index < state.entries.length, `指针 ${label} 指向了字典外。`);
  }
}

export function projectSizeInObjects(project) {
  return project.objects.length;
}
