import { diffForView } from "./core/diff.js";
import { addObject, createProject } from "./core/model.js";
import { createSampleProject } from "./core/sample.js";
import { deserializeProject, serializeProject } from "./core/serialize.js";
import { recordStep } from "./core/steps.js";
import { App } from "./ui/app.js";
import { createBridge } from "./ui/bridge.js";

window.__TC_SMOKE__ = async () => {
  try {
    const app = window.__TC__;
    const sample = createSampleProject();
    const restored = deserializeProject(serializeProject(sample));
    const sampleDiff = diffForView(restored, restored.steps[1].id);

    const project = createProject("smoke");
    const array = addObject(project, "array", { rows: 1, cols: 4 });
    project.live.states[array.id].data = [["2", "7", "11", "15"]];
    recordStep(project, { title: "初始" });
    project.live.states[array.id].data[0][1] = "9";
    recordStep(project, { title: "修改" });
    const diff = diffForView(project, project.steps[1].id);
    const boardPane = document.getElementById("board-pane");
    const toolsPane = document.getElementById("tools-pane");
    const boardWidth = boardPane.getBoundingClientRect().width;
    window.__TC__?.panes.setWidth("boards", 300);
    const wideBoardWidth = boardPane.getBoundingClientRect().width;
    window.__TC__?.panes.setWidth("boards", 212);
    const panesOk =
      boardPane !== toolsPane &&
      document.querySelectorAll(".pane-split").length === 3 &&
      wideBoardWidth > boardWidth + 10;
    const bridge = window.__TC__?.bridge;
    const uiBefore = await bridge?.loadUiState?.();
    const uiSaved = await bridge?.saveUiState?.({ panes: { boards: 224, tools: 112, inspector: 300 } });
    const uiAfter = await bridge?.loadUiState?.();
    const uiOk = Boolean(uiBefore?.ok && uiSaved?.ok && uiAfter?.state?.panes?.boards === 224);
    const sampleContent = serializeProject(sample);
    const sampleFirst = await bridge?.ensureSampleBoard?.(sampleContent, sample.title);
    const sampleSecond = await bridge?.ensureSampleBoard?.(sampleContent, sample.title);
    const sampleDelete = await bridge?.deleteBoard?.(sampleFirst?.path);
    const sampleOk = Boolean(
      sampleFirst?.ok &&
        sampleSecond?.ok &&
        sampleFirst.path === sampleSecond.path &&
        sampleSecond.created === false &&
        sampleDelete?.ok === false,
    );
    const sampleRow = Boolean(document.getElementById("sample-board"));
    const duplicateRecord = Boolean(document.getElementById("btn-timeline-record"));
    app.addObject("array");
    const arrayCard = document.querySelector(".array-card");
    const arrayMeta = arrayCard?.querySelector(".card-meta")?.textContent || "";
    document.querySelector('[data-action="array-quick"]')?.click();
    const quickNode = document.querySelector(".quick-add");
    const quickValue = quickNode?.querySelector("textarea")?.value || "";
    const quickPreview = quickNode?.querySelector("[data-preview]")?.textContent || "";
    quickNode?.querySelector("[data-cancel]")?.click();
    const pointersBefore = app.project.objects.filter((object) => object.kind === "pointer").length;
    document.querySelector('[data-action="array-pointer"]')?.click();
    const pointersAfter = app.project.objects.filter((object) => object.kind === "pointer").length;
    const cardActionsOk = Boolean(
      arrayCard &&
        arrayMeta.includes("行") &&
        quickNode &&
        quickValue.startsWith("[") &&
        quickPreview.includes("行") &&
        pointersAfter === pointersBefore + 1,
    );
    return {
      ok:
        Boolean(document.getElementById("app")) &&
        restored.steps.length === 4 &&
        sampleDiff.hasChanges &&
        diff.hasChanges &&
        diff.cells.size === 1 &&
        panesOk &&
        uiOk &&
        sampleOk &&
        sampleRow &&
        !duplicateRecord &&
        cardActionsOk &&
        Boolean(document.getElementById("board-search")) &&
        Boolean(document.getElementById("status-float")),
      dpr: window.devicePixelRatio,
      inner: [window.innerWidth, window.innerHeight],
      screen: [screen.width, screen.height],
      sampleSteps: restored.steps.length,
      sampleChanges: sampleDiff.count,
      editedChanges: diff.count,
      panes: [boardWidth, wideBoardWidth],
      uiState: uiOk,
      sampleStable: sampleOk,
      sampleDelete: sampleDelete?.ok,
      duplicateRecord,
      cardActions: cardActionsOk,
    };
  } catch (error) {
    return { ok: false, error: `${error.name}: ${error.message}` };
  }
};

async function boot() {
  try {
    const bridge = await createBridge();
    const app = new App(createProject(), "", bridge);
    await app.start();
    let smoke = new URLSearchParams(location.search).get("smoke") === "1";
    if (!smoke && bridge.isDesktop) {
      try {
        smoke = Boolean((await bridge.appInfo())?.smoke);
      } catch {
        smoke = false;
      }
    }
    if (smoke) {
      const result = await window.__TC_SMOKE__();
      if (window.pywebview?.api?.smoke_report) await window.pywebview.api.smoke_report(result);
      else console.log("smoke", result);
    }
  } catch (error) {
    console.error(error);
    const node = document.getElementById("boot-error");
    node.hidden = false;
    node.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = "Thinking Canvas 启动失败";
    const detail = document.createElement("pre");
    detail.textContent = error.stack || error.message || String(error);
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "重试";
    retry.addEventListener("click", () => location.reload());
    const hint = document.createElement("p");
    hint.className = "boot-error-hint";
    hint.textContent = "如果反复出现，先关闭其他 Thinking Canvas 窗口再试。";
    node.append(title, detail, retry, hint);
  }
}

boot();
