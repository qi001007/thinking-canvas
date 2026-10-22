import test from "node:test";
import assert from "node:assert/strict";

import { fitPaneWidths, normalizePaneWidth, PANE_SPECS } from "../web/js/ui/panes.js";

test("pane widths snap to rails and stay inside their limits", () => {
  assert.equal(normalizePaneWidth("boards", 10), PANE_SPECS.boards.rail);
  assert.equal(normalizePaneWidth("boards", 130), PANE_SPECS.boards.min);
  assert.equal(normalizePaneWidth("boards", 212), 212);
  assert.equal(normalizePaneWidth("boards", 999), PANE_SPECS.boards.max);
  assert.equal(normalizePaneWidth("tools", 80), PANE_SPECS.tools.rail);
  assert.equal(normalizePaneWidth("tools", 110), 110);
  assert.equal(normalizePaneWidth("tools", 999), PANE_SPECS.tools.max);
  assert.equal(normalizePaneWidth("inspector", 100), PANE_SPECS.inspector.min);
  assert.equal(normalizePaneWidth("inspector", 999), PANE_SPECS.inspector.max);
  assert.equal(normalizePaneWidth("missing", 100), null);
  assert.equal(normalizePaneWidth("boards", "abc"), null);
});

test("wide windows keep the default pane widths", () => {
  assert.deepEqual(fitPaneWidths({}, 1450), { boards: 212, tools: 168, inspector: 292 });
  assert.deepEqual(fitPaneWidths({}, 1100), { boards: 212, tools: 168, inspector: 292 });
});

test("narrow windows shrink the inspector first, then side panes", () => {
  const at1000 = fitPaneWidths({}, 1000);
  assert.equal(at1000.inspector, 245);
  assert.equal(at1000.boards, 212);
  assert.equal(at1000.tools, 168);

  const at900 = fitPaneWidths({}, 900);
  assert.equal(at900.inspector, 220);
  assert.equal(at900.boards, 160);
  assert.equal(at900.tools, 145);

  const at800 = fitPaneWidths({}, 800);
  assert.equal(at800.inspector, 220);
  assert.equal(at800.boards, PANE_SPECS.boards.rail);
  assert.equal(at800.tools, 104);
});

test("collapsed panes stay collapsed and malformed values fall back", () => {
  assert.equal(fitPaneWidths({ boards: 44 }, 1450).boards, 44);
  assert.equal(fitPaneWidths({ boards: 999, tools: 999, inspector: 999 }, 1450).boards, PANE_SPECS.boards.max);
  assert.equal(fitPaneWidths({ boards: "abc" }, 1450).boards, 212);
});
