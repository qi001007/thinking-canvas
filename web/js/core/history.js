/** Snapshot-based undo/redo. The project is small enough that full clones are simpler than commands. */
import { clone } from "./model.js";

export class History {
  constructor(limit = 80) {
    this.limit = limit;
    this.past = [];
    this.future = [];
  }

  reset() {
    this.past = [];
    this.future = [];
  }

  push(project) {
    this.past.push(clone(project));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current) {
    if (!this.past.length) return null;
    this.future.push(clone(current));
    return this.past.pop();
  }

  redo(current) {
    if (!this.future.length) return null;
    this.past.push(clone(current));
    return this.future.pop();
  }

  canUndo() {
    return this.past.length > 0;
  }

  canRedo() {
    return this.future.length > 0;
  }
}
