/** Desktop bridge (pywebview) with a browser fallback for development. */
import { downloadText } from "./dom.js";

const SESSION_KEY = "thinking-canvas.session.v1";
const RECENT_KEY = "thinking-canvas.recent.v1";

function pywebviewApiReady() {
  const api = window.pywebview?.api;
  return Boolean(api && typeof api.load_session === "function" && typeof api.app_info === "function");
}

async function waitForApi(timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (pywebviewApiReady()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return pywebviewApiReady();
}

export async function createBridge() {
  if (pywebviewApiReady()) return new DesktopBridge();
  const inWebView = Boolean(window.chrome?.webview);
  const desktopHint = inWebView || new URLSearchParams(location.search).get("desktop") === "1";
  if (desktopHint) {
    const ready = await waitForApi(inWebView ? 6000 : 1800);
    if (ready) return new DesktopBridge();
    if (inWebView) throw new Error("桌面桥接未就绪：pywebview API 在 6 秒内没有挂上。");
  }
  return new BrowserBridge();
}

class DesktopBridge {
  get isDesktop() {
    return true;
  }

  async appInfo() {
    return window.pywebview.api.app_info();
  }

  async openProject() {
    return window.pywebview.api.open_project();
  }

  async openRecent(path) {
    return window.pywebview.api.open_recent(path);
  }

  async saveProject(path, content) {
    return window.pywebview.api.save_project(path, content);
  }

  async saveProjectAs(content, suggestedName) {
    return window.pywebview.api.save_project_as(content, suggestedName);
  }

  async saveSession(content, path) {
    return window.pywebview.api.save_session(content, path);
  }

  async loadSession() {
    return window.pywebview.api.load_session();
  }

  async clearSession() {
    return window.pywebview.api.clear_session();
  }

  async getRecent() {
    return window.pywebview.api.get_recent();
  }

  async exportText(name, content) {
    return window.pywebview.api.export_text(name, content);
  }
}

class BrowserBridge {
  constructor() {
    this.fakePath = "";
  }

  get isDesktop() {
    return false;
  }

  async appInfo() {
    return { ok: true, version: "0.1.0-dev", platform: "web", dataDir: "localStorage" };
  }

  async openProject() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,.tcanvas.json,application/json";
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve({ ok: false, canceled: true });
          return;
        }
        try {
          const content = await file.text();
          resolve({ ok: true, path: file.name, content });
        } catch (error) {
          resolve({ ok: false, error: error.message });
        }
      });
      input.click();
    });
  }

  async openRecent() {
    return { ok: false, error: "浏览器预览没有本地文件路径，请使用“打开”。" };
  }

  async saveProject(path, content) {
    return this.saveProjectAs(content, path || "未命名画板.tcanvas.json");
  }

  async saveProjectAs(content, suggestedName) {
    downloadText(suggestedName || "未命名画板.tcanvas.json", content);
    this.fakePath = suggestedName || "";
    this.addRecent(this.fakePath, content);
    return { ok: true, path: this.fakePath };
  }

  async saveSession(content, path) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ content, path: path || "", savedAt: Date.now() }));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return { ok: false, empty: true };
      const parsed = JSON.parse(raw);
      return { ok: true, content: parsed.content, path: parsed.path || "" };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async clearSession() {
    localStorage.removeItem(SESSION_KEY);
    return { ok: true };
  }

  async getRecent() {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      return { ok: true, items: raw ? JSON.parse(raw) : [] };
    } catch {
      return { ok: true, items: [] };
    }
  }

  async exportText(name, content) {
    downloadText(name || "thinking-canvas.json", content);
    return { ok: true, path: name };
  }

  addRecent(path, content) {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      const items = raw ? JSON.parse(raw) : [];
      let title = "未命名画板";
      try {
        title = JSON.parse(content).title || title;
      } catch {
        // keep fallback title
      }
      const next = [{ path, title, openedAt: Date.now() }, ...items.filter((item) => item.path !== path)].slice(0, 8);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // recent files are a convenience; never block saving
    }
  }
}
