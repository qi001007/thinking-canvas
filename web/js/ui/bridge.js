/** Desktop bridge (pywebview) with a browser fallback for development. */
import { downloadText } from "./dom.js";

const SESSION_KEY = "thinking-canvas.session.v1";
const RECENT_KEY = "thinking-canvas.recent.v1";
const BOARDS_KEY = "thinking-canvas.boards.v2";
const DELETED_KEY = "thinking-canvas.boards.deleted.v2";
const UI_KEY = "thinking-canvas.ui.v1";
const SAMPLE_PATH = "local:board-sample";

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
    const ready = await waitForApi(inWebView ? 15000 : 1800);
    if (ready) return new DesktopBridge();
    if (inWebView) throw new Error("桌面桥接未就绪：pywebview API 在 15 秒内没有挂上。");
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

  async bootLog(stage) {
    return window.pywebview.api.js_log(stage);
  }

  async bootReady() {
    return window.pywebview.api.boot_ready();
  }

  async heartbeat() {
    return window.pywebview.api.heartbeat();
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

  async boardsInfo() {
    return window.pywebview.api.boards_info();
  }

  async listBoards() {
    return window.pywebview.api.list_boards();
  }

  async createBoard(content, title) {
    return window.pywebview.api.create_board(content, title);
  }

  async ensureSampleBoard(content, title) {
    return window.pywebview.api.ensure_sample_board(content, title);
  }

  async saveBoard(path, content) {
    return window.pywebview.api.save_board(path, content);
  }

  async loadBoard(path) {
    return window.pywebview.api.load_board(path);
  }

  async deleteBoard(path) {
    return window.pywebview.api.delete_board(path);
  }

  async openBoardsFolder() {
    return window.pywebview.api.open_boards_folder();
  }

  async loadUiState() {
    return window.pywebview.api.load_ui_state();
  }

  async saveUiState(state) {
    return window.pywebview.api.save_ui_state(state);
  }
}

class BrowserBridge {
  constructor() {
    this.fakePath = "";
    if (new URLSearchParams(location.search).get("fresh") === "1") {
      localStorage.removeItem(BOARDS_KEY);
    }
  }

  get isDesktop() {
    return false;
  }

  async appInfo() {
    return { ok: true, version: "0.1.0-dev", platform: "web", dataDir: "localStorage" };
  }

  async bootLog() {
    return { ok: true };
  }

  async bootReady() {
    return { ok: true };
  }

  async heartbeat() {
    return { ok: true };
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

  // Browser preview uses localStorage as a stand-in for boards/.
  boardStore() {
    try {
      const raw = localStorage.getItem(BOARDS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  writeBoardStore(store) {
    localStorage.setItem(BOARDS_KEY, JSON.stringify(store));
  }

  boardItem(entry) {
    return {
      path: entry.path,
      title: entry.title,
      updatedAt: entry.updatedAt,
      mtime: entry.mtime,
      size: entry.content.length,
      invalid: false,
      sample: entry.path === SAMPLE_PATH,
    };
  }

  async boardsInfo() {
    return { ok: true, dir: "localStorage（浏览器预览）" };
  }

  async listBoards() {
    const store = this.boardStore();
    const items = Object.values(store)
      .sort((a, b) => b.mtime - a.mtime)
      .map((entry) => this.boardItem(entry));
    return { ok: true, dir: "localStorage（浏览器预览）", items };
  }

  async createBoard(content, title) {
    const store = this.boardStore();
    let parsed = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      return { ok: false, error: "画板内容不是有效 JSON。" };
    }
    const id = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const entry = {
      path: `local:${id}`,
      title: parsed.title || title || "未命名画板",
      content,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      mtime: Date.now(),
    };
    store[entry.path] = entry;
    this.writeBoardStore(store);
    return { ok: true, path: entry.path, item: this.boardItem(entry) };
  }

  async ensureSampleBoard(content, title) {
    const store = this.boardStore();
    if (store[SAMPLE_PATH]) {
      return { ok: true, path: SAMPLE_PATH, created: false, item: this.boardItem(store[SAMPLE_PATH]) };
    }
    let parsed = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      return { ok: false, error: "示例内容不是有效 JSON。" };
    }
    const entry = {
      path: SAMPLE_PATH,
      title: parsed.title || title || "示例画板",
      content,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      mtime: Date.now(),
    };
    store[SAMPLE_PATH] = entry;
    this.writeBoardStore(store);
    return { ok: true, path: SAMPLE_PATH, created: true, item: this.boardItem(entry) };
  }

  async saveBoard(path, content) {
    const store = this.boardStore();
    if (!store[path]) return { ok: false, error: "画板不存在。" };
    let parsed = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      return { ok: false, error: "画板内容不是有效 JSON。" };
    }
    store[path].content = content;
    store[path].title = parsed.title || store[path].title;
    store[path].updatedAt = parsed.updatedAt || new Date().toISOString();
    store[path].mtime = Date.now();
    this.writeBoardStore(store);
    return { ok: true, path, item: this.boardItem(store[path]) };
  }

  async loadBoard(path) {
    const entry = this.boardStore()[path];
    if (!entry) return { ok: false, error: "画板不存在。" };
    return { ok: true, path, content: entry.content };
  }

  async deleteBoard(path) {
    if (path === SAMPLE_PATH) return { ok: false, error: "示例画板不能删除。" };
    const store = this.boardStore();
    if (!store[path]) return { ok: false, error: "画板不存在。" };
    let deleted = [];
    try {
      deleted = JSON.parse(localStorage.getItem(DELETED_KEY) || "[]");
    } catch {
      deleted = [];
    }
    deleted.unshift({ ...store[path], deletedAt: Date.now() });
    localStorage.setItem(DELETED_KEY, JSON.stringify(deleted.slice(0, 20)));
    delete store[path];
    this.writeBoardStore(store);
    return { ok: true, trash: "localStorage" };
  }

  async openBoardsFolder() {
    return { ok: false, error: "浏览器预览没有本地画板文件夹。" };
  }

  async loadUiState() {
    try {
      const raw = localStorage.getItem(UI_KEY);
      return { ok: true, state: raw ? JSON.parse(raw) : {} };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async saveUiState(state) {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify(state));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
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
