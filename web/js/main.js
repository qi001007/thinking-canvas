import { diffForView } from "./core/diff.js";
import { addObject, createProject } from "./core/model.js";
import { createSampleProject } from "./core/sample.js";
import { deserializeProject, serializeProject } from "./core/serialize.js";
import { recordStep } from "./core/steps.js";
import { App } from "./ui/app.js";
import { createBridge } from "./ui/bridge.js";

window.__TC_SMOKE__ = () => {
  try {
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
    return {
      ok:
        Boolean(document.getElementById("app")) &&
        restored.steps.length === 4 &&
        sampleDiff.hasChanges &&
        diff.hasChanges &&
        diff.cells.size === 1,
      dpr: window.devicePixelRatio,
      inner: [window.innerWidth, window.innerHeight],
      screen: [screen.width, screen.height],
      sampleSteps: restored.steps.length,
      sampleChanges: sampleDiff.count,
      editedChanges: diff.count,
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
      const result = window.__TC_SMOKE__();
      if (window.pywebview?.api?.smoke_report) await window.pywebview.api.smoke_report(result);
      else console.log("smoke", result);
    }
  } catch (error) {
    console.error(error);
    const node = document.getElementById("boot-error");
    node.hidden = false;
    node.textContent = `Thinking Canvas 启动失败\n\n${error.stack || error.message || error}`;
  }
}

boot();
