# Contributing

Thanks for taking a look. This is a small local-first tool; keep changes focused and evidence-based.

## Development setup

```powershell
python -m pip install -r requirements.txt
python -m pip install pytest
python app\shell.py          # desktop window
python scripts\serve.py      # browser preview at http://127.0.0.1:8765
```

There is no front-end build step and no npm dependency. The front end is plain ES modules; Node is only used for tests.

## Before opening a PR

```powershell
node --test tests/core.test.mjs
python -m pytest tests/test_api.py -q
python app\shell.py --smoke
```

For UI changes, include a screenshot or a short screen recording, and verify the actual pywebview window, not only a browser tab.

## Design rules

- Core data logic lives in `web/js/core/` and must stay DOM-free.
- UI state (`viewStepId`, selection, viewport) lives in the UI layer; it is not persisted in the project file.
- Persistent objects (layout, notes, arrows) and step state (cells, pointer positions) are separate. Do not mix them.
- The app never executes user code and never sends project data anywhere.
- Keep the no-framework front end: small modules, explicit state, no hidden reactivity.

## License

By contributing you agree that your contribution is licensed under the MIT License.
