/** Project JSON round-trip and file naming. */
import { createProject, validateProject } from "./model.js";

export function serializeProject(project) {
  const valid = validateProject(project);
  return JSON.stringify(valid, null, 2);
}

export function deserializeProject(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error("文件不是有效的 JSON。");
  }
  return validateProject(parsed);
}

export function emptyProject(title) {
  return createProject(title);
}

export function sanitizeFileName(title) {
  const safe = String(title || "未命名画板")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return safe || "未命名画板";
}

export function projectFileName(title) {
  return `${sanitizeFileName(title)}.tcanvas.json`;
}

export function projectStats(project) {
  return {
    objects: project.objects.length,
    stateful: project.objects.filter((object) => ["array", "list", "dict", "set", "variable", "node"].includes(object.kind)).length,
    steps: project.steps.length,
  };
}
