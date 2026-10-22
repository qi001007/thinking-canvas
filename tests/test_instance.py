import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.instance import clear_state, heartbeat_age, is_healthy, read_state, write_state  # noqa: E402


def test_state_roundtrip_and_pid_scoped_clear(tmp_path):
    path = tmp_path / "instance.json"
    write_state({"pid": 11, "state": "starting", "started_at": 100.0}, path)

    assert read_state(path)["pid"] == 11

    clear_state(22, path)
    assert read_state(path)["pid"] == 11

    clear_state(11, path)
    assert read_state(path) == {}


def test_health_requires_ready_and_fresh_heartbeat():
    now = time.time()

    assert is_healthy({"state": "ready", "heartbeat_at": now}, now=now)
    assert not is_healthy({"state": "ready", "heartbeat_at": now - 10}, now=now)
    assert not is_healthy({"state": "starting", "heartbeat_at": now}, now=now)
    assert heartbeat_age({"started_at": now - 3}, now=now) == 3.0
