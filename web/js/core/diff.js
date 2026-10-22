/** Human-readable state differences between two snapshots. */
import { lastStep, liveSnapshot, stepIndex } from "./steps.js";

export function emptyDiff() {
  return {
    cells: new Set(),
    items: new Set(),
    rows: new Set(),
    objects: new Set(),
    pointers: new Set(),
    changes: [],
    summary: [],
    count: 0,
    hasChanges: false,
  };
}

export function cellKey(objectId, row, col) {
  return `${objectId}:${row}:${col}`;
}

export function itemKey(objectId, index) {
  return `${objectId}:${index}`;
}

export function rowKey(objectId, index) {
  return `${objectId}:${index}`;
}

export function diffSnapshots(prev, curr, objects) {
  const diff = emptyDiff();
  if (!prev || !curr) return diff;
  const objectMap = new Map((objects || []).map((object) => [object.id, object]));
  const prevIds = new Set(prev.objectIds || []);
  const currIds = new Set(curr.objectIds || []);

  for (const objectId of currIds) {
    const object = objectMap.get(objectId);
    if (!object) continue;
    if (!["array", "list", "dict", "set", "variable", "node"].includes(object.kind)) continue;
    const before = prev.states?.[objectId];
    const after = curr.states?.[objectId];
    if (!after) continue;
    if (!before) {
      diff.objects.add(objectId);
      addChange(diff, {
        type: "object",
        objectId,
        text: `新增 ${labelOf(object)}`,
      });
      continue;
    }
    compareObject(diff, object, before, after);
  }

  for (const objectId of prevIds) {
    if (currIds.has(objectId)) continue;
    const object = objectMap.get(objectId);
    if (object) {
      addChange(diff, { type: "removed", objectId, text: `移除 ${labelOf(object)}` });
    }
  }

  const pointerIds = new Set([...Object.keys(prev.pointers || {}), ...Object.keys(curr.pointers || {})]);
  for (const pointerId of pointerIds) {
    const pointer = objectMap.get(pointerId);
    if (!pointer || pointer.kind !== "pointer") continue;
    const before = prev.pointers?.[pointerId] || null;
    const after = curr.pointers?.[pointerId] || null;
    if (sameTarget(before, after)) continue;
    diff.pointers.add(pointerId);
    addChange(diff, {
      type: "pointer",
      objectId: pointerId,
      text: `${pointer.name || "指针"}: ${targetLabel(pointer, objectMap, prev, before)} → ${targetLabel(pointer, objectMap, curr, after)}`,
    });
  }

  diff.summary = diff.changes.map((change) => change.text).slice(0, 12);
  diff.count = diff.changes.length;
  diff.hasChanges = diff.count > 0;
  return diff;
}

export function diffForView(project, viewStepId) {
  if (!viewStepId) {
    const prev = lastStep(project);
    if (!prev) return emptyDiff();
    return diffSnapshots(prev, liveSnapshot(project), project.objects);
  }
  const index = stepIndex(project, viewStepId);
  if (index <= 0) return emptyDiff();
  return diffSnapshots(project.steps[index - 1], project.steps[index], project.objects);
}

function compareObject(diff, object, before, after) {
  if (object.kind === "array") compareArray(diff, object, before, after);
  else if (object.kind === "list") compareList(diff, object, before, after);
  else if (object.kind === "dict") compareDict(diff, object, before, after);
  else if (object.kind === "set") compareSet(diff, object, before, after);
  else if (object.kind === "variable" || object.kind === "node") {
    if (before.value !== after.value) {
      diff.objects.add(object.id);
      addChange(diff, {
        type: "value",
        objectId: object.id,
        text: `${labelOf(object)} ${short(before.value) || "∅"} → ${short(after.value) || "∅"}`,
      });
    }
  }
}

function compareArray(diff, object, before, after) {
  const beforeRows = before.data.length;
  const beforeCols = before.data[0]?.length || 0;
  const afterRows = after.data.length;
  const afterCols = after.data[0]?.length || 0;
  if (beforeRows !== afterRows || beforeCols !== afterCols) {
    diff.objects.add(object.id);
    addChange(diff, {
      type: "size",
      objectId: object.id,
      text: `${labelOf(object)} 尺寸 ${beforeRows}×${beforeCols} → ${afterRows}×${afterCols}`,
    });
  }
  const rows = Math.max(beforeRows, afterRows);
  const cols = Math.max(beforeCols, afterCols);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const from = before.data[row]?.[col];
      const to = after.data[row]?.[col];
      if (from !== to) {
        diff.cells.add(cellKey(object.id, row, col));
        diff.objects.add(object.id);
        addChange(diff, {
          type: "cell",
          objectId: object.id,
          row,
          col,
          text: `${arrayCellLabel(object, afterRows, row, col)} ${short(from) || "∅"} → ${short(to) || "∅"}`,
        });
      } else if (before.marks?.[row]?.[col] !== after.marks?.[row]?.[col]) {
        diff.cells.add(cellKey(object.id, row, col));
        diff.objects.add(object.id);
        addChange(diff, {
          type: "mark",
          objectId: object.id,
          row,
          col,
          text: `${arrayCellLabel(object, afterRows, row, col)} 标记变化`,
        });
      }
    }
  }
}

function compareList(diff, object, before, after) {
  const beforeItems = before.items || [];
  const afterItems = after.items || [];
  if (beforeItems.length !== afterItems.length) {
    diff.objects.add(object.id);
    addChange(diff, {
      type: "size",
      objectId: object.id,
      text: `${labelOf(object)} 长度 ${beforeItems.length} → ${afterItems.length}`,
    });
  }
  const length = Math.max(beforeItems.length, afterItems.length);
  for (let index = 0; index < length; index += 1) {
    const from = beforeItems[index];
    const to = afterItems[index];
    if (from !== to) {
      diff.items.add(itemKey(object.id, index));
      diff.objects.add(object.id);
      addChange(diff, {
        type: "item",
        objectId: object.id,
        index,
        text: `${labelOf(object)}[${index}] ${short(from) || "∅"} → ${short(to) || "∅"}`,
      });
    } else if (before.marks?.[index] !== after.marks?.[index]) {
      diff.items.add(itemKey(object.id, index));
      diff.objects.add(object.id);
      addChange(diff, {
        type: "mark",
        objectId: object.id,
        index,
        text: `${labelOf(object)}[${index}] 标记变化`,
      });
    }
  }
}

function compareDict(diff, object, before, after) {
  const beforeEntries = before.entries || [];
  const afterEntries = after.entries || [];
  const beforeMap = keyMap(beforeEntries);
  const afterMap = keyMap(afterEntries);
  for (const [key, entry] of afterMap) {
    const previous = beforeMap.get(key);
    const index = afterEntries.indexOf(entry);
    if (!previous) {
      diff.rows.add(rowKey(object.id, index));
      diff.objects.add(object.id);
      addChange(diff, {
        type: "entry",
        objectId: object.id,
        index,
        text: `${labelOf(object)}['${short(key)}'] 新增 → ${short(entry.value) || "∅"}`,
      });
    } else if (previous.value !== entry.value) {
      diff.rows.add(rowKey(object.id, index));
      diff.objects.add(object.id);
      addChange(diff, {
        type: "entry",
        objectId: object.id,
        index,
        text: `${labelOf(object)}['${short(key)}'] ${short(previous.value) || "∅"} → ${short(entry.value) || "∅"}`,
      });
    }
  }
  for (const [key] of beforeMap) {
    if (!afterMap.has(key)) {
      diff.objects.add(object.id);
      addChange(diff, {
        type: "entry",
        objectId: object.id,
        text: `${labelOf(object)}['${short(key)}'] 删除`,
      });
    }
  }
}

function compareSet(diff, object, before, after) {
  const beforeSet = new Set(before.items || []);
  const afterSet = new Set(after.items || []);
  for (let index = 0; index < after.items.length; index += 1) {
    const value = after.items[index];
    if (!beforeSet.has(value)) {
      diff.items.add(itemKey(object.id, index));
      diff.objects.add(object.id);
      addChange(diff, {
        type: "set-add",
        objectId: object.id,
        index,
        text: `${labelOf(object)} 新增 ${short(value)}`,
      });
    }
  }
  for (const value of beforeSet) {
    if (!afterSet.has(value)) {
      diff.objects.add(object.id);
      addChange(diff, {
        type: "set-remove",
        objectId: object.id,
        text: `${labelOf(object)} 删除 ${short(value)}`,
      });
    }
  }
}

function keyMap(entries) {
  const map = new Map();
  const seen = new Map();
  for (const entry of entries) {
    const base = entry.key;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    map.set(count === 1 ? base : `${base}#${count}`, entry);
  }
  return map;
}

function addChange(diff, change) {
  diff.changes.push(change);
}

function sameTarget(a, b) {
  return (
    (a?.targetId || "") === (b?.targetId || "") &&
    (a?.row ?? null) === (b?.row ?? null) &&
    (a?.col ?? null) === (b?.col ?? null) &&
    (a?.index ?? null) === (b?.index ?? null)
  );
}

export function targetLabel(pointer, objectMap, snapshot, target) {
  if (!target || !target.targetId) return "未绑定";
  const object = objectMap?.get?.(target.targetId);
  const label = object?.name || "对象";
  const state = snapshot?.states?.[target.targetId];
  if (Number.isInteger(target.row) && Number.isInteger(target.col)) {
    const oneRow = object?.kind === "array" && state?.data?.length === 1;
    return oneRow ? `${label}[${target.col}]` : `${label}[${target.row},${target.col}]`;
  }
  if (Number.isInteger(target.index)) return `${label}[${target.index}]`;
  return label;
}

function arrayCellLabel(object, rows, row, col) {
  return rows === 1 ? `${labelOf(object)}[${col}]` : `${labelOf(object)}[${row},${col}]`;
}

function labelOf(object) {
  return object?.name || object?.kind || "对象";
}

function short(value) {
  const text = String(value ?? "");
  return text.length > 14 ? `${text.slice(0, 13)}…` : text;
}
