# Changelog

## 0.3.0 · 2026-10-22

- Split board management and tool controls into two panes, so a long board list no longer pushes tools down.
- Board pane, tool pane and inspector border are draggable; widths persist in `boards/.ui-state.json`; double-click a splitter to reset.
- Compress the board pane to a 44px icon rail and the tool pane to a 46px icon rail; both restore on click/drag.
- Search boards by title (`Ctrl+K`, `Esc`, `Enter`), with match count and an empty result state.
- Replace the fixed status bar with a transient overlay that auto-hides and has a dismiss button.
- Thin, unified scrollbars that stay transparent until the matching pane is hovered.
- Reflow the sample board vertically and adapt fit padding (56–90px) so narrow windows stay readable.

## 0.2.1 · 2026-10-22

- Migrate a legacy `%APPDATA%/ThinkingCanvas/session.json` even when `boards/` already contains boards, so an old in-progress board is not stranded outside the unified folder.

## 0.2.0 · 2026-10-22

- Board sidebar: list, create, switch, delete and open the boards folder.
- Board files now live in a single `boards/` folder next to the app; deleted boards move to `boards/.trash/`.
- Removed scattered open/save dialogs and the recent-files menu; the current board auto-saves.
- Steps can be deleted from the timeline chip or with Delete while viewing a step.
- Reduced interface copy: shorter empty state, inspector and status hints; toasts only for errors and key actions.
- Added a concise front-end design spec.
- Tabs stay crisp at native 100% (v0.1.1 behavior retained).

## 0.1.1 · 2026-10-22

- Keep fit-to-canvas at or below 100%, so small boards no longer open at 133% and look soft.
- Sharpen table typography: 13px/500 values, slightly stronger grid lines.
- Regenerate documentation screenshots at 2x for crisp tables.

## 0.1.0 · 2026-10-22

First desktop release.

- Infinite canvas with pan/zoom, marquee selection, multi-object drag, snapping guides, undo/redo.
- Data cards: array/matrix, list/stack, dict, set, variable, node, sticky note, function card.
- Step snapshots, timeline, read-only history, automatic state diff highlighting.
- Draggable pointers saved per step; pointer target outlines.
- Free connectors, rectangles, pen, text; function/invariant notes.
- Local JSON projects, native open/save dialogs, session autosave, recent files.
- PyInstaller one-file Windows build; framework-free web front end.
- Core tests, file API tests, and a real WebView2 smoke check.
