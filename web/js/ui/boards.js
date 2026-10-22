/** Left-side board switcher. */
import { escapeHtml } from "./dom.js";

export class BoardsPanel {
  constructor(app) {
    this.app = app;
    this.list = document.getElementById("board-list");
    this.newButton = document.getElementById("btn-new-board");
    this.folderButton = document.getElementById("btn-boards-folder");
    this.sampleButton = document.getElementById("btn-sample");
    this.boards = [];
    this.activePath = "";
    this.list.addEventListener("click", (event) => this.onClick(event));
    this.list.addEventListener("keydown", (event) => this.onKeyDown(event));
    this.newButton.addEventListener("click", () => this.app.newBoard());
    this.folderButton.addEventListener("click", () => this.app.openBoardsFolder());
    this.sampleButton.addEventListener("click", () => this.app.loadSample());
  }

  render(boards, activePath, dir = "") {
    this.boards = boards || [];
    this.activePath = activePath || "";
    if (dir) this.folderButton.title = `打开 ${dir}`;
    if (!this.boards.length) {
      this.list.innerHTML = '<div class="board-empty">还没有画板</div>';
      return;
    }
    this.list.innerHTML = this.boards
      .map((board) => {
        const active = board.path === this.activePath;
        const title = board.title || "未命名画板";
        return `
          <div class="board-item${active ? " active" : ""}${board.invalid ? " invalid" : ""}" data-board-path="${escapeHtml(board.path)}" role="button" tabindex="0" title="${escapeHtml(title)}">
            <div class="board-title">${escapeHtml(title)}</div>
            <div class="board-meta">${escapeHtml(formatBoardTime(board))}</div>
            <button class="board-delete" data-delete-board="${escapeHtml(board.path)}" title="删除画板" aria-label="删除画板">×</button>
          </div>`;
      })
      .join("");
  }

  updateItem(path, patch) {
    const item = this.boards.find((board) => board.path === path);
    if (!item) return;
    Object.assign(item, patch);
    this.render(this.boards, this.activePath);
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
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.app.loadBoard(item.dataset.boardPath);
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.app.deleteBoard(item.dataset.boardPath);
    }
  }
}

function formatBoardTime(board) {
  const value = board.updatedAt || board.mtime;
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
