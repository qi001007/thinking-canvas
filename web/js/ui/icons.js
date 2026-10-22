const PATHS = {
  select: '<path d="M5 3l7 17 2.5-6.5L21 11 5 3z"/>',
  hand: '<path d="M8 11V7a2 2 0 014 0v4-6a2 2 0 014 0v6-3a2 2 0 014 0v7a7 7 0 01-7 7h-1a7 7 0 01-7-7v-2a2 2 0 014 0v1"/>',
  connector: '<path d="M4 19L20 5M13 5h7v7"/>',
  pen: '<path d="M4 20l4-1 10-10-3-3L5 16l-1 4z"/><path d="M14 6l3 3"/>',
  rect: '<rect x="4" y="5" width="16" height="14" rx="2"/>',
  eraser: '<path d="M4 16l8-8 6 6-4 4H7l-3-2z"/><path d="M9 11l6 6"/><path d="M4 20h16"/>',
  array: '<rect x="3" y="8" width="18" height="8" rx="2"/><path d="M9 8v8M15 8v8"/>',
  matrix: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>',
  list: '<rect x="4" y="4" width="16" height="4" rx="1"/><rect x="4" y="10" width="16" height="4" rx="1"/><rect x="4" y="16" width="16" height="4" rx="1"/>',
  dict: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M10 4v16M3 9h18M3 14h18"/>',
  set: '<path d="M8 5H6a2 2 0 00-2 2v10a2 2 0 002 2h2M16 5h2a2 2 0 012 2v10a2 2 0 01-2 2h-2M9 12h6"/>',
  variable: '<path d="M5 6l14 12M19 6L5 18"/>',
  node: '<circle cx="12" cy="12" r="7"/><path d="M5 12H2M22 12h-3"/>',
  sticky: '<path d="M5 4h14v10l-5 6H5V4z"/><path d="M14 20v-6h5"/>',
  invariant: '<path d="M5 4h14v10l-5 6H5V4z"/><path d="M9 11l2 2 4-4"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  function: '<path d="M7 20V6a2 2 0 012-2h4M5 10h8M14 20l2-8 2 5 2-3h2"/>',
  undo: '<path d="M9 7H5v4M5 11a7 7 0 1014 0"/>',
  redo: '<path d="M15 7h4v4M19 11a7 7 0 11-14 0"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
  copy: '<rect x="8" y="8" width="11" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5M3 16l9 5 9-5"/>',
  pointer: '<path d="M12 21s-6-5.5-6-10a6 6 0 1112 0c0 4.5-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 114 2c-.8.6-1.5 1.1-1.5 2.5M12 17h.01"/>',
  menu: '<path d="M5 7h14M5 12h14M5 17h14"/>',
  board: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16M8 9h13"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/>',
};

export function icon(name) {
  const path = PATHS[name] || PATHS.help;
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((node) => {
    node.innerHTML = icon(node.dataset.icon);
  });
}
