/** Recorded snapshots and timeline navigation. */
import { clone, newId, nowIso, pointerObjects, statefulObjects, touch } from "./model.js";

export function captureSnapshot(project) {
  const states = {};
  for (const object of statefulObjects(project)) {
    states[object.id] = clone(project.live.states[object.id]);
  }
  const pointers = {};
  for (const pointer of pointerObjects(project)) {
    pointers[pointer.id] = clone(project.live.pointers[pointer.id] || null);
  }
  return {
    objectIds: project.objects.map((object) => object.id),
    states,
    pointers,
  };
}

export function liveSnapshot(project) {
  return {
    objectIds: project.objects.map((object) => object.id),
    states: clone(project.live.states),
    pointers: clone(project.live.pointers),
  };
}

export function recordStep(project, options = {}) {
  const snapshot = captureSnapshot(project);
  const number = project.steps.length + 1;
  const step = {
    id: newId("s"),
    title: String(options.title || "").trim() || `第 ${number} 步`,
    note: String(options.note || ""),
    createdAt: nowIso(),
    ...snapshot,
  };
  project.steps.push(step);
  touch(project);
  return step;
}

export function stepIndex(project, stepId) {
  return project.steps.findIndex((step) => step.id === stepId);
}

export function stepForId(project, stepId) {
  return project.steps.find((step) => step.id === stepId) || null;
}

export function stepNumber(project, stepId) {
  return stepIndex(project, stepId) + 1;
}

export function viewSnapshot(project, stepId) {
  if (!stepId) return liveSnapshot(project);
  return stepForId(project, stepId);
}

export function previousSnapshot(project, stepId) {
  if (!stepId) {
    return project.steps.length ? project.steps[project.steps.length - 1] : null;
  }
  const index = stepIndex(project, stepId);
  return index > 0 ? project.steps[index - 1] : null;
}

export function nextSnapshot(project, stepId) {
  if (!stepId) return null;
  const index = stepIndex(project, stepId);
  return index >= 0 && index + 1 < project.steps.length ? project.steps[index + 1] : null;
}

export function setStepTitle(project, stepId, title) {
  const step = stepForId(project, stepId);
  if (!step) return false;
  step.title = String(title).trim() || step.title;
  touch(project);
  return true;
}

export function setStepNote(project, stepId, note) {
  const step = stepForId(project, stepId);
  if (!step) return false;
  step.note = String(note);
  touch(project);
  return true;
}

export function deleteStep(project, stepId) {
  const index = stepIndex(project, stepId);
  if (index < 0) return false;
  project.steps.splice(index, 1);
  touch(project);
  return true;
}

export function lastStep(project) {
  return project.steps.length ? project.steps[project.steps.length - 1] : null;
}
