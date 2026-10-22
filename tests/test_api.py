import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.api import FileApi  # noqa: E402


def project_json(title="测试画板"):
    return {
        "schemaVersion": 1,
        "title": title,
        "createdAt": "2026-10-22T00:00:00.000Z",
        "updatedAt": "2026-10-22T00:00:00.000Z",
        "objects": [],
        "live": {"states": {}, "pointers": {}},
        "steps": [],
    }


def test_save_open_and_recent(tmp_path):
    api = FileApi(data_dir=tmp_path, boards_dir=tmp_path / "boards")
    path = tmp_path / "board.tcanvas.json"
    content = json.dumps(project_json("两数之和"), ensure_ascii=False)
    result = api.save_project(str(path), content)
    assert result["ok"] is True
    assert result["path"] == str(path)
    assert path.read_text(encoding="utf-8") == content

    recent = api.get_recent()
    assert recent["ok"] is True
    assert recent["items"][0]["title"] == "两数之和"

    opened = api.open_recent(str(path))
    assert opened["ok"] is True
    assert opened["content"] == content
    assert not list(tmp_path.glob(".thinking-canvas-*.tmp"))


def test_session_roundtrip_and_clear(tmp_path):
    api = FileApi(data_dir=tmp_path, boards_dir=tmp_path / "boards")
    content = json.dumps(project_json(), ensure_ascii=False)
    assert api.save_session(content, "x.tcanvas.json")["ok"] is True
    loaded = api.load_session()
    assert loaded["ok"] is True
    assert loaded["content"] == content
    assert loaded["path"] == "x.tcanvas.json"
    assert api.clear_session()["ok"] is True
    assert api.load_session()["empty"] is True


def test_invalid_content_is_rejected_without_overwriting(tmp_path):
    api = FileApi(data_dir=tmp_path, boards_dir=tmp_path / "boards")
    path = tmp_path / "board.tcanvas.json"
    path.write_text("keep me", encoding="utf-8")
    result = api.save_project(str(path), "{not json")
    assert result["ok"] is False
    assert path.read_text(encoding="utf-8") == "keep me"
    assert api.load_session()["ok"] is False


def test_save_session_rejects_wrong_shape(tmp_path):
    api = FileApi(data_dir=tmp_path, boards_dir=tmp_path / "boards")
    result = api.save_session(json.dumps({"objects": []}), "")
    assert result["ok"] is False
    assert api.load_session()["empty"] is True


def test_app_info_reports_data_dir(tmp_path):
    api = FileApi(data_dir=tmp_path, boards_dir=tmp_path / "boards")
    info = api.app_info()
    assert info["ok"] is True
    assert info["version"] == "0.3.8"
    assert info["dataDir"] == str(tmp_path)


def test_ui_state_roundtrip_and_limits(tmp_path):
    api = FileApi(data_dir=tmp_path, boards_dir=tmp_path / "boards")
    assert api.load_ui_state() == {"ok": True, "state": {}}
    state = {"panes": {"boards": 212, "tools": 46, "inspector": 292}}
    assert api.save_ui_state(state)["ok"] is True
    assert api.load_ui_state()["state"] == state
    assert api.save_ui_state([])["ok"] is False
    assert api.save_ui_state({"x": "a" * (65 * 1024)})["ok"] is False
    assert api.list_boards()["items"] == []


def test_sample_board_is_stable_and_protected(tmp_path):
    api = FileApi(data_dir=tmp_path, boards_dir=tmp_path / "boards")
    first = api.ensure_sample_board(json.dumps(project_json("示例 A"), ensure_ascii=False), "示例 A")
    assert first["ok"] is True
    assert first["created"] is True
    path = Path(first["path"])
    assert path.name == "board-sample.tcanvas.json"
    assert first["item"]["sample"] is True

    second = api.ensure_sample_board(json.dumps(project_json("示例 B"), ensure_ascii=False), "示例 B")
    assert second["ok"] is True
    assert second["created"] is False
    assert second["path"] == first["path"]
    assert json.loads(path.read_text(encoding="utf-8"))["title"] == "示例 A"

    listed = api.list_boards()["items"]
    assert [item["sample"] for item in listed] == [True]
    assert api.delete_board(str(path))["ok"] is False
    assert path.exists()


def test_board_crud_and_trash(tmp_path):
    api = FileApi(data_dir=tmp_path, boards_dir=tmp_path / "boards")
    first = api.create_board(json.dumps(project_json("画板 A"), ensure_ascii=False), "画板 A")
    assert first["ok"] is True
    path = Path(first["path"])
    assert path.parent == tmp_path / "boards"
    assert path.name.endswith(".tcanvas.json")

    listed = api.list_boards()
    assert listed["ok"] is True
    assert [item["title"] for item in listed["items"]] == ["画板 A"]

    changed = json.dumps(project_json("画板 B"), ensure_ascii=False)
    assert api.save_board(str(path), changed)["ok"] is True
    loaded = api.load_board(str(path))
    assert loaded["ok"] is True
    assert json.loads(loaded["content"])["title"] == "画板 B"
    assert api.list_boards()["items"][0]["title"] == "画板 B"

    deleted = api.delete_board(str(path))
    assert deleted["ok"] is True
    assert not path.exists()
    assert Path(deleted["trash"]).exists()
    assert api.list_boards()["items"] == []


def test_board_path_must_stay_inside_boards(tmp_path):
    api = FileApi(data_dir=tmp_path, boards_dir=tmp_path / "boards")
    outside = tmp_path / "outside.tcanvas.json"
    result = api.save_board(str(outside), json.dumps(project_json(), ensure_ascii=False))
    assert result["ok"] is False
    assert not outside.exists()


def test_legacy_session_is_removed_after_empty_migration(tmp_path):
    api = FileApi(data_dir=tmp_path, boards_dir=tmp_path / "boards")
    legacy = tmp_path / "session.json"
    legacy.write_text(json.dumps({"content": json.dumps(project_json(), ensure_ascii=False)}), encoding="utf-8")
    listed = api.list_boards()
    assert listed["ok"] is True
    assert legacy.exists() is False

def test_legacy_session_migrates_even_when_boards_exist(tmp_path):
    seed = FileApi(data_dir=tmp_path, boards_dir=tmp_path / "boards")
    seed.create_board(json.dumps(project_json("已有画板"), ensure_ascii=False), "已有画板")
    legacy_data = project_json("旧画板")
    legacy_data["objects"] = [{"id": "legacy", "kind": "text"}]
    legacy = tmp_path / "session.json"
    legacy.write_text(json.dumps({"content": json.dumps(legacy_data, ensure_ascii=False)}, ensure_ascii=False), encoding="utf-8")
    api = FileApi(data_dir=tmp_path, boards_dir=tmp_path / "boards")
    listed = api.list_boards()
    titles = [item["title"] for item in listed["items"]]
    assert "旧画板" in titles
    assert "已有画板" in titles
    assert legacy.exists() is False
