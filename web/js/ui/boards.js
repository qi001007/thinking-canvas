/** Board switcher with local search and keyboard access. */
import { escapeHtml } from "./dom.js";

export class BoardsPanel {
  constructor(app) {
    this.app = app;
    this.list = document.getElementById("board-list");
    this.newButton = document.getElementById("btn-new-board");
    this.folderButton = document.getElementById("btn-boards-folder");
    this.sampleButton = document.getElementById("btn-sample");
    this.searchInput = document.getElementById("board-search");
    this.searchClear = document.getElementById("board-search-clear");
    this.countEl = document.getElementById("board-count");
    this.railCount = document.getElementById("board-rail-count");
    this.boards = [];
    this.activePath = "";
    this.query = "";
    this.list.addEventListener("click", (event) => this.onClick(event));
    this.list.addEventListener("keydown", (event) => this.onKeyDown(event));
    this.searchInput.addEventListener("input", () => this.onSearch());
    this.searchInput.addEventListener("keydown", (event) => this.onSearchKeyDown(event));
    this.searchClear.addEventListener("click", () => {
      this.setQuery("");
      this.searchInput.focus();
    });
    this.newButton.addEventListener("click", () => this.app.newBoard());
    this.folderButton.addEventListener("click", () => this.app.openBoardsFolder());
    this.sampleButton.addEventListener("click", () => this.app.loadSample());
  }

  render(boards, activePath, dir = "") {
    this.boards = boards || [];
    this.activePath = activePath || "";
    if (dir) this.folderButton.title = `打开 ${dir}`;
    this.renderList();
  }

  renderList() {
    const query = this.query.trim().toLowerCase();
    const matches = query
      ? this.boards.filter((board) => (board.title || "未命名画板").toLowerCase().includes(query))
      : this.boards;
    this.countEl.textContent = query ? `${matches.length}/${this.boards.length}` : String(this.boards.length);
    this.railCount.textContent = String(this.boards.length);
    this.searchClear.hidden = !this.query;
    const focusedPath = document.activeElement?.closest?.("[data-board-path]")?.dataset.boardPath;
    const scrollTop = this.list.scrollTop;
    if (!matches.length) {
      this.list.innerHTML = `<div class="board-empty">${this.boards.length ? "没有匹配的画板" : "还没有画板"}</div>`;
      return;
    }
    this.list.innerHTML = matches
      .map((board) => {
        const active = board.path === this.activePath;
        const title = board.title || "未命名画板";
        return `
          <div class="board-item${active ? " active" : ""}${board.invalid ? " invalid" : ""}" data-board-path="${escapeHtml(board.path)}" role="button" tabindex="0" aria-current="${active ? "true" : "false"}" title="${escapeHtml(title)}">
            <div class="board-title">${escapeHtml(title)}</div>
            <div class="board-meta">${escapeHtml(formatBoardTime(board))}</div>
            <button class="board-delete" data-delete-board="${escapeHtml(board.path)}" title="删除画板" aria-label="删除画板">×</button>
          </div>`;
      })
      .join("");
    this.list.scrollTop = scrollTop;
    if (focusedPath) {
      const target = Array.from(this.list.querySelectorAll("[data-board-path]")).find(
        (item) => item.dataset.boardPath === focusedPath,
      );
      target?.focus();
    }
  }

  updateItem(path, patch) {
    const item = this.boards.find((board) => board.path === path);
    if (!item) return;
    Object.assign(item, patch);
    this.renderList();
  }

  setQuery(value) {
    this.query = value;
    this.searchInput.value = value;
    this.renderList();
  }

  focusSearch() {
    this.searchInput.focus();
    this.searchInput.select();
  }

  onSearch() {
    this.query = this.searchInput.value;
    this.renderList();
  }

  onSearchKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (this.query) this.setQuery("");
      else this.searchInput.blur();
      return;
    }
    if (event.key === "Enter") {
      const first = this.list.querySelector("[data-board-path]");
      if (first) {
        event.preventDefault();
        this.app.loadBoard(first.dataset.boardPath);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      const first = this.list.querySelector("[data-board-path]");
      if (first) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  onClick(event) {
    const deleteButton = event.target.closest("[data-delete-board]");
    if (deleteButton) {
      event.stopPropagation();
      this.app.deleteBoard(deleteButton.dataset.deleteBoard);
      return;
    }
    const item = event.target.closest("[data-board-path]");
    if (item) this.app.loadBoard(item.dataset.boardPath);
  }

  onKeyDown(event) {
    const item = event.target.closest("[data-board-path]");
    if (!item) return;
    const items = Array.from(this.list.querySelectorAll("[data-board-path]"));
    const index = items.indexOf(item);
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.app.loadBoard(item.dataset.boardPath);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.app.deleteBoard(item.dataset.boardPath);
      return;
    }
    if (event.key === "ArrowDown" && index + 1 < items.length) {
      event.preventDefault();
      items[index + 1].focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (index > 0) items[index - 1].focus();
      else this.searchInput.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      this.searchInput.focus();
    }
  }
}

function formatBoardTime(board) {
  const value = board.updatedAt || board.mtime;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
