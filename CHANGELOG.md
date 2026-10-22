# Changelog

## 0.3.5 · 2026-10-23

- Fix the blank window: the boot-error overlay used `display:flex` and ignored the `hidden` attribute, covering the app with an empty paper layer after a successful start. Added `.boot-error[hidden] { display:none }`.
- Reuse one WebView2 profile and allow only one normal app instance; this stops the 1.7 GB temp-profile buildup.
- Add a smoke assertion that the hidden boot overlay really has `display:none`.

## 0.3.4 · 2026-10-23

- Wait up to 15 seconds for pywebview API injection instead of failing at 6 seconds.
- Add a retry button and a close-other-windows hint to the boot error screen.

## 0.3.3 · 2026-10-23

- Reduce the timeline bar from 62px to 48px and step chips to 32px for a lighter footer.
- Remove local scratch/browser profiles and build intermediates from the workspace; no board data is touched.

## 0.3.2 · 2026-10-22

- Batch array input now uses code-like lists: `[1, 2, 3]` and `[[1, 2], [3, 4]]`, with live row/column preview and Excel TSV paste support.
- Array cell references use explicit `N 行 × M 列` dimensions instead of the ambiguous `N × M`.
- Wire up all card header tools: array `+i` and `⋯`, list/dict/set `+`; they now add cells/rows/items or open the batch editor.
- Increase the smoke watchdog from 25s to 40s to absorb one-file startup variance.

## 0.3.1 · 2026-10-22

- Make the example a stable board file (`boards/board-sample.tcanvas.json`): first open creates it, later opens and edits reuse the same file, and deletion is rejected.
- Move the example into a fixed row in the board pane; remove the sample buttons from the footer, empty state, inspector and canvas context menu.
- Remove the timeline “record a step” button; keep only the blue top-bar action.
- Reduce the timeline bar from 84px to 62px.

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
