/** Geometry shared by hit-testing, connectors, snapping and viewport fitting. */
export const CELL_W = 62;
export const CELL_H = 34;
export const ARRAY_HEAD = 32;
export const ARRAY_INDEX = 16;
export const ARRAY_PAD_X = 9;
export const ARRAY_PAD_Y_TOP = 8;
export const ARRAY_PAD_Y_BOTTOM = 6;
export const ARRAY_ROW_HEADER = 24;
export const POINTER_ROW = 24;

export function objectBounds(object, snapshot) {
  if (!object) return null;
  if (object.kind === "array") {
    const state = snapshot?.states?.[object.id];
    if (!state?.data?.length) return null;
    const rows = state.data.length;
    const cols = state.data[0]?.length || 1;
    return {
      x: object.x,
      y: object.y,
      w: ARRAY_ROW_HEADER + cols * CELL_W + ARRAY_PAD_X * 2 + 2,
      h: ARRAY_HEAD + ARRAY_PAD_Y_TOP + ARRAY_INDEX + rows * CELL_H + POINTER_ROW + 1 + ARRAY_PAD_Y_BOTTOM + 2,
    };
  }
  if (object.kind === "list") {
    const state = snapshot?.states?.[object.id];
    const count = Math.max(1, state?.items?.length || 1);
    if (object.orientation === "horizontal") {
      return { x: object.x, y: object.y, w: 61 * count + 19, h: 79 };
    }
    return { x: object.x, y: object.y, w: 140, h: 31 * count + 48 };
  }
  if (object.kind === "dict") {
    const state = snapshot?.states?.[object.id];
    const count = Math.max(1, state?.entries?.length || 1);
    return { x: object.x, y: object.y, w: object.width || 220, h: 32 + 8 + 18 + count * 28 + 10 + 2 };
  }
  if (object.kind === "set") {
    const state = snapshot?.states?.[object.id];
    const count = Math.max(1, state?.items?.length || 1);
    return { x: object.x, y: object.y, w: object.width || 210, h: 32 + 8 + Math.ceil(count / 4) * 26 + 9 + 2 };
  }
  if (object.kind === "variable") {
    return { x: object.x, y: object.y, w: 156, h: 89 };
  }
  if (object.kind === "node") {
    return object.shape === "circle"
      ? { x: object.x, y: object.y, w: 68, h: 68 }
      : { x: object.x, y: object.y, w: 132, h: 54 };
  }
  if (object.kind === "sticky" || object.kind === "text" || object.kind === "function" || object.kind === "shape") {
    return { x: object.x, y: object.y, w: object.w || 200, h: object.h || 60 };
  }
  if (object.kind === "pen") {
    const points = object.points || [];
    if (!points.length) return null;
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    const minX = Math.min(...xs) - 4;
    const minY = Math.min(...ys) - 4;
    return { x: minX, y: minY, w: Math.max(...xs) - minX + 4, h: Math.max(...ys) - minY + 4 };
  }
  return null;
}

export function arrayCellRect(object, snapshot, row, col) {
  const state = snapshot?.states?.[object.id];
  const cols = state?.data?.[0]?.length || 1;
  const safeCol = Math.max(0, Math.min(cols - 1, col));
  const rows = state?.data?.length || 1;
  const safeRow = Math.max(0, Math.min(rows - 1, row));
  return {
    x: object.x + 1 + ARRAY_PAD_X + ARRAY_ROW_HEADER + safeCol * CELL_W,
    y: object.y + 1 + ARRAY_HEAD + ARRAY_PAD_Y_TOP + ARRAY_INDEX + safeRow * CELL_H,
    w: CELL_W,
    h: CELL_H,
  };
}

export function arrayCellCenter(object, snapshot, row, col) {
  const rect = arrayCellRect(object, snapshot, row, col);
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

export function listItemRect(object, snapshot, index) {
  const state = snapshot?.states?.[object.id];
  const count = state?.items?.length || 1;
  const safe = Math.max(0, Math.min(count - 1, index));
  const bodyX = object.x + 1 + (object.orientation === "horizontal" ? 10 : 10);
  const bodyY = object.y + 1 + 32 + 8;
  if (object.orientation === "horizontal") {
    return { x: bodyX + safe * 61, y: bodyY, w: 58, h: 28 };
  }
  return { x: bodyX, y: bodyY + safe * 31, w: 118, h: 28 };
}

export function dictRowRect(object, snapshot, index) {
  const rect = objectBounds(object, snapshot);
  if (!rect) return null;
  const safe = Math.max(0, index);
  return {
    x: rect.x + 1,
    y: rect.y + 32 + 8 + 18 + safe * 28,
    w: rect.w - 2,
    h: 28,
  };
}

export function objectCenter(object, snapshot) {
  const bounds = objectBounds(object, snapshot);
  if (!bounds) return null;
  return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
}

export function anchorPoint(objects, snapshot, anchor) {
  if (!anchor) return null;
  if (anchor.objectId) {
    const object = objects.find((item) => item.id === anchor.objectId);
    if (!object) return null;
    if (Number.isInteger(anchor.row) && Number.isInteger(anchor.col) && object.kind === "array") {
      return arrayCellCenter(object, snapshot, anchor.row, anchor.col);
    }
    if (Number.isInteger(anchor.index)) {
      if (object.kind === "list") {
        const rect = listItemRect(object, snapshot, anchor.index);
        return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
      }
      if (object.kind === "dict") {
        const rect = dictRowRect(object, snapshot, anchor.index);
        return rect ? { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 } : objectCenter(object, snapshot);
      }
    }
    const bounds = objectBounds(object, snapshot);
    if (!bounds) return null;
    if (anchor.side === "left") return { x: bounds.x, y: bounds.y + bounds.h / 2 };
    if (anchor.side === "right") return { x: bounds.x + bounds.w, y: bounds.y + bounds.h / 2 };
    if (anchor.side === "top") return { x: bounds.x + bounds.w / 2, y: bounds.y };
    if (anchor.side === "bottom") return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h };
    return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  }
  if (Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) return { x: anchor.x, y: anchor.y };
  return null;
}

export function unionBounds(boundsList) {
  const valid = boundsList.filter(Boolean);
  if (!valid.length) return null;
  const minX = Math.min(...valid.map((bounds) => bounds.x));
  const minY = Math.min(...valid.map((bounds) => bounds.y));
  const maxX = Math.max(...valid.map((bounds) => bounds.x + bounds.w));
  const maxY = Math.max(...valid.map((bounds) => bounds.y + bounds.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function boundsOverlap(a, b, padding = 0) {
  return (
    a.x < b.x + b.w + padding &&
    a.x + a.w + padding > b.x &&
    a.y < b.y + b.h + padding &&
    a.y + a.h + padding > b.y
  );
}

export function pointInBounds(point, bounds) {
  return point.x >= bounds.x && point.x <= bounds.x + bounds.w && point.y >= bounds.y && point.y <= bounds.y + bounds.h;
}

export function rectsIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function findFreeSpot(objects, snapshot, width, height, preferred = { x: 120, y: 110 }) {
  const bounds = objects.map((object) => objectBounds(object, snapshot)).filter(Boolean);
  const attempt = { x: preferred.x, y: preferred.y, w: width, h: height };
  for (let step = 0; step < 40; step += 1) {
    if (!bounds.some((other) => boundsOverlap(attempt, other, 30))) return { x: attempt.x, y: attempt.y };
    attempt.x += 44;
    attempt.y += 34;
    if (step % 6 === 5) {
      attempt.x = preferred.x + (step % 2 ? 0 : 80);
      attempt.y += 40;
    }
  }
  return { x: preferred.x, y: preferred.y };
}

export function snapDelta(bounds, others, threshold = 6) {
  const result = { dx: 0, dy: 0, guides: [] };
  const xCandidates = [];
  const yCandidates = [];
  const movingX = [bounds.x, bounds.x + bounds.w / 2, bounds.x + bounds.w];
  const movingY = [bounds.y, bounds.y + bounds.h / 2, bounds.y + bounds.h];
  for (const other of others) {
    const targetX = [other.x, other.x + other.w / 2, other.x + other.w];
    const targetY = [other.y, other.y + other.h / 2, other.y + other.h];
    for (const from of movingX) {
      for (const to of targetX) {
        const delta = to - from;
        if (Math.abs(delta) <= threshold) xCandidates.push({ delta, line: to });
      }
    }
    for (const from of movingY) {
      for (const to of targetY) {
        const delta = to - from;
        if (Math.abs(delta) <= threshold) yCandidates.push({ delta, line: to });
      }
    }
  }
  const bestX = xCandidates.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0];
  const bestY = yCandidates.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0];
  if (bestX) {
    result.dx = bestX.delta;
    result.guides.push({ axis: "x", pos: bestX.line });
  }
  if (bestY) {
    result.dy = bestY.delta;
    result.guides.push({ axis: "y", pos: bestY.line });
  }
  return result;
}

export function fitBounds(bounds, viewportWidth, viewportHeight, padding = 90) {
  if (!bounds) return { x: 0, y: 0, zoom: 1 };
  const zoom = Math.max(
    0.25,
    Math.min(1.6, Math.min((viewportWidth - padding * 2) / Math.max(1, bounds.w), (viewportHeight - padding * 2) / Math.max(1, bounds.h))),
  );
  return {
    zoom,
    x: (viewportWidth - bounds.w * zoom) / 2 - bounds.x * zoom,
    y: (viewportHeight - bounds.h * zoom) / 2 - bounds.y * zoom,
  };
}

export function screenToWorld(viewport, x, y) {
  return { x: (x - viewport.x) / viewport.zoom, y: (y - viewport.y) / viewport.zoom };
}

export function worldToScreen(viewport, x, y) {
  return { x: x * viewport.zoom + viewport.x, y: y * viewport.zoom + viewport.y };
}

export function clampZoom(value) {
  return Math.max(0.25, Math.min(2.5, value));
}
