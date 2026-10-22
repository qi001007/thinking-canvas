/** Opt-in demo board. It is never loaded automatically. */
import { addObject, createProject, POINTER_COLORS, setPointerState } from "./model.js";
import { recordStep } from "./steps.js";

export function createSampleProject() {
  const project = createProject("冒泡排序 · 第一轮");
  const fn = addObject(project, "function", {
    x: 50,
    y: 40,
    name: "bubbleSort",
    signature: "bubbleSort(nums) -> nums",
    inputs: [{ k: "输入 · nums", v: "[5, 1, 4, 2]" }],
    output: { k: "目标 · output", v: "[1, 2, 4, 5]" },
    complexity: "O(n²) / O(1)",
  });
  const sticky = addObject(project, "sticky", {
    x: 470,
    y: 40,
    w: 310,
    h: 124,
    name: "不变量",
    color: "green",
    text: "每一轮把当前最大的元素推到右端。\nj 扫过的位置右侧已经有序；这一轮正在把 5 往后推。",
  });
  const array = addObject(project, "array", {
    x: 50,
    y: 290,
    name: "nums",
    rows: 1,
    cols: 4,
  });
  const swapped = addObject(project, "variable", {
    x: 470,
    y: 290,
    name: "swapped",
    value: "—",
  });
  const pointer = addObject(project, "pointer", {
    name: "j",
    color: POINTER_COLORS[0],
    target: { targetId: array.id, row: 0, col: 0 },
  });
  addObject(project, "text", {
    x: 50,
    y: 470,
    w: 380,
    h: 38,
    text: "示例只跑第一轮；点底部的 1 / 2 / 3 / 4 回看每一步，变化的格子会自动标黄。",
  });

  const frames = [
    {
      title: "初始",
      note: "j 指向本轮要比较的左元素。此时还没有交换。",
      data: ["5", "1", "4", "2"],
      marks: ["", "", "", ""],
      swapped: "—",
      pointer: 0,
    },
    {
      title: "交换 5 和 1",
      note: "5 > 1，交换两个相邻元素；j 先停在原位置，下一步再右移。",
      data: ["1", "5", "4", "2"],
      marks: ["", "", "", ""],
      swapped: "true",
      pointer: 0,
    },
    {
      title: "交换 5 和 4",
      note: "5 > 4，继续交换；j 右移到下标 1。",
      data: ["1", "4", "5", "2"],
      marks: ["", "", "", ""],
      swapped: "true",
      pointer: 1,
    },
    {
      title: "交换 5 和 2",
      note: "5 > 2，最后一次交换；最大值 5 已经到最右端。",
      data: ["1", "4", "2", "5"],
      marks: ["", "", "green", "green"],
      swapped: "true",
      pointer: 2,
    },
  ];

  for (const frame of frames) {
    project.live.states[array.id] = {
      data: [frame.data.slice()],
      marks: [frame.marks.slice()],
    };
    project.live.states[swapped.id] = { value: frame.swapped };
    setPointerState(project, pointer.id, { targetId: array.id, row: 0, col: frame.pointer });
    recordStep(project, { title: frame.title, note: frame.note });
  }

  // Keep the function and the note visible in every recorded frame.
  for (const step of project.steps) {
    if (!step.objectIds.includes(fn.id)) step.objectIds.push(fn.id);
    if (!step.objectIds.includes(sticky.id)) step.objectIds.push(sticky.id);
  }
  return project;
}
