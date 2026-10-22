import test from "node:test";
import assert from "node:assert/strict";

import {
  addObject,
  createProject,
  duplicateObject,
  getObject,
  POINTER_COLORS,
  removeObject,
  setPointerState,
  validateProject,
} from "../web/js/core/model.js";
import { recordStep, stepForId } from "../web/js/core/steps.js";
import { diffForView, diffSnapshots } from "../web/js/core/diff.js";
import { deserializeProject, serializeProject } from "../web/js/core/serialize.js";
import { History } from "../web/js/core/history.js";
import { arrayCellRect, objectBounds, snapDelta } from "../web/js/core/geometry.js";
import { createSampleProject } from "../web/js/core/sample.js";
import { entriesToText, gridToCode, gridToText, parseEntries, parseGrid, parseSet, setToText } from "../web/js/core/parse.js";

function makeNumbersProject() {
  const project = createProject("测试");
  const array = addObject(project, "array", { x: 100, y: 100, cols: 4 });
  project.live.states[array.id] = {
    data: [["2", "7", "11", "15"]],
    marks: [["", "", "", ""]],
  };
  const pointer = addObject(project, "pointer", {
    name: "i",
    color: POINTER_COLORS[0],
    target: { targetId: array.id, row: 0, col: 0 },
  });
  return { project, array, pointer };
}

test("empty project has no objects, steps, or live states", () => {
  const project = createProject();
  assert.equal(project.objects.length, 0);
  assert.equal(project.steps.length, 0);
  assert.deepEqual(project.live, { states: {}, pointers: {} });
});

test("array state is editable and recording freezes a snapshot", () => {
  const { project, array } = makeNumbersProject();
  const first = recordStep(project, { title: "初始" });
  project.live.states[array.id].data[0][1] = "9";
  const second = recordStep(project, { title: "改 7 为 9" });

  assert.equal(stepForId(project, first.id).states[array.id].data[0][1], "7");
  assert.equal(stepForId(project, second.id).states[array.id].data[0][1], "9");
  assert.notEqual(stepForId(project, first.id).states[array.id], stepForId(project, second.id).states[array.id]);
});

test("diff highlights changed cells and pointer moves", () => {
  const { project, array, pointer } = makeNumbersProject();
  const first = recordStep(project, { title: "初始" });
  project.live.states[array.id].data[0][1] = "9";
  setPointerState(project, pointer.id, { targetId: array.id, row: 0, col: 1 });
  const second = recordStep(project, { title: "下一步" });

  const diff = diffSnapshots(project.steps[0], project.steps[1], project.objects);
  assert.equal(diff.hasChanges, true);
  assert.ok(diff.cells.has(`${array.id}:0:1`));
  assert.ok(diff.pointers.has(pointer.id));
  assert.ok(diff.changes.some((change) => change.text.includes("7 → 9")));
  assert.ok(diff.changes.some((change) => change.text.includes("i:")));

  const firstDiff = diffForView(project, first.id);
  assert.equal(firstDiff.count, 0);
  const liveDiff = diffForView(project, null);
  assert.equal(liveDiff.count, 0, "live equals the last recorded frame");
  assert.equal(diffForView(project, second.id).count, diff.count);
});

test("new, changed and removed dict entries are diffed", () => {
  const project = createProject("字典");
  const dict = addObject(project, "dict", { name: "seen" });
  recordStep(project, { title: "空" });
  project.live.states[dict.id].entries = [
    { key: "2", value: "0" },
    { key: "7", value: "1" },
  ];
  recordStep(project, { title: "写入" });
  const diff = diffSnapshots(project.steps[0], project.steps[1], project.objects);
  assert.ok(diff.changes.some((change) => change.text.includes("新增")));
  assert.ok(diff.rows.size > 0);
});

test("undo and redo restore complete project snapshots", () => {
  const history = new History();
  const { project, array } = makeNumbersProject();
  const before = structuredClone(project);
  history.push(project);
  project.live.states[array.id].data[0][0] = "99";
  const undone = history.undo(project);
  assert.equal(undone.live.states[array.id].data[0][0], "2");
  const redone = history.redo(undone);
  assert.equal(redone.live.states[array.id].data[0][0], "99");
  assert.deepEqual(before.live.states[array.id].data[0][0], "2");
});

test("serialize and deserialize keep states, steps and pointers", () => {
  const { project, pointer } = makeNumbersProject();
  recordStep(project, { title: "初始" });
  const text = serializeProject(project);
  const restored = deserializeProject(text);
  assert.equal(restored.title, project.title);
  assert.equal(restored.steps.length, 1);
  assert.equal(restored.live.pointers[pointer.id].row, 0);
  assert.deepEqual(restored.live.states, project.live.states);
});

test("invalid project and out-of-range pointer are rejected", () => {
  const { project, pointer, array } = makeNumbersProject();
  project.live.pointers[pointer.id] = { targetId: array.id, row: 0, col: 99 };
  assert.throws(() => validateProject(project), /指针|数组/);
  assert.throws(() => deserializeProject("{"), /JSON/);
});

test("removing a data object also removes its pointers and steps entries", () => {
  const { project, array, pointer } = makeNumbersProject();
  recordStep(project, { title: "初始" });
  removeObject(project, array.id);
  assert.equal(getObject(project, array.id), null);
  assert.equal(getObject(project, pointer.id), null);
  assert.equal(project.live.pointers[pointer.id], undefined);
  assert.equal(project.steps[0].states[array.id], undefined);
  assert.equal(project.steps[0].objectIds.includes(array.id), false);
});

test("duplicating an array creates an independent state", () => {
  const { project, array } = makeNumbersProject();
  const copy = duplicateObject(project, array.id);
  project.live.states[copy.id].data[0][0] = "copy";
  assert.equal(project.live.states[array.id].data[0][0], "2");
  assert.notEqual(project.live.states[copy.id], project.live.states[array.id]);
});

test("geometry matches the CSS array card dimensions", () => {
  const { project, array } = makeNumbersProject();
  const bounds = objectBounds(array, project.live);
  assert.equal(bounds.w, 24 + 4 * 62 + 18 + 2);
  const cell = arrayCellRect(array, project.live, 0, 2);
  assert.equal(cell.x, array.x + 34 + 2 * 62);
  assert.equal(cell.w, 62);
});

test("snapDelta aligns edges within the threshold", () => {
  const moving = { x: 101, y: 50, w: 100, h: 40 };
  const other = { x: 100, y: 200, w: 100, h: 40 };
  const result = snapDelta(moving, [other], 6);
  assert.equal(result.dx, -1);
  assert.equal(result.dy, 0);
  assert.ok(result.guides.some((guide) => guide.axis === "x"));
});

test("sample board has four recorded frames with visible diffs", () => {
  const project = createSampleProject();
  assert.equal(project.steps.length, 4);
  assert.equal(project.objects.filter((object) => object.kind === "array").length, 1);
  const diff = diffForView(project, project.steps[1].id);
  assert.ok(diff.hasChanges);
  assert.ok(diff.cells.size >= 2);
  const restored = deserializeProject(serializeProject(project));
  assert.equal(restored.steps.length, 4);
});


test("batch input parsers handle spaces, commas, tabs and key:value lines", () => {
  assert.deepEqual(parseGrid("2 7 11 15"), [["2", "7", "11", "15"]]);
  assert.deepEqual(parseGrid("2, 7, 11"), [["2", "7", "11"]]);
  assert.deepEqual(parseGrid("1\t2\n3\t4"), [["1", "2"], ["3", "4"]]);
  assert.deepEqual(parseGrid("1 2\n3"), [["1", "2"], ["3", ""]]);
  assert.deepEqual(parseEntries("2: 0\n7: 1"), [{ key: "2", value: "0" }, { key: "7", value: "1" }]);
  assert.deepEqual(parseSet("2, 7 11\n15"), ["2", "7", "11", "15"]);
  assert.equal(gridToText([["1", "2"]]), "1\t2");
  assert.equal(entriesToText([{ key: "a", value: "1" }]), "a: 1");
  assert.equal(setToText(["a", "b"]), "a, b");
});

test("code-like arrays support 1D, nested rows, quotes and Excel paste", () => {
  assert.deepEqual(parseGrid("[2, 7, 11, 15]"), [["2", "7", "11", "15"]]);
  assert.deepEqual(parseGrid("[[1, 2], [3, 4]]"), [["1", "2"], ["3", "4"]]);
  assert.deepEqual(parseGrid("[\n [1, 2],\n [3, 4]\n]"), [["1", "2"], ["3", "4"]]);
  assert.deepEqual(parseGrid("[1,2]\n[3,4]"), [["1", "2"], ["3", "4"]]);
  assert.deepEqual(parseGrid('["a b", "c"]'), [["a b", "c"]]);
  assert.deepEqual(parseGrid("1\t2\n3\t4"), [["1", "2"], ["3", "4"]]);
  assert.equal(gridToCode([["1", "4", "2", "5"]]), "[1, 4, 2, 5]");
  assert.equal(gridToCode([["1", "2"], ["3", "4"]]), "[[1, 2], [3, 4]]");
  assert.equal(gridToCode([["a b", "c"]]), '["a b", c]');
  assert.deepEqual(parseSet("{2, 7, 11}"), ["2", "7", "11"]);
});
