"""Check the external overnight writer: python3 scripts/usage-file-check.py path/to/usage-file.py."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile

source = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(source.parent))
spec = importlib.util.spec_from_file_location("usage_file", source)
writer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(writer)
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    sessions = root / "sessions"
    sessions.mkdir()
    state, output = root / "missing-state", root / "usage.json"
    writer.write(output, state, sessions)
    unknown = json.loads(output.read_text())
    assert unknown["updated"] == "unknown"
    assert [r["label"] for r in unknown["rows"]] == ["Claude weekly", "GPT", "Meta balance", "Muse allowance"]
    for r in unknown["rows"][2:]:
        assert r["left"].startswith("Unknown")
        assert all(r[key] is None for key in ("used_pct", "spent_usd", "cap_usd"))
    # A real observation for another provider never becomes a guessed Meta/Muse allowance.
    (sessions / "rollout-check.jsonl").write_text(json.dumps({
        "timestamp": "2026-11-03T14:40:00Z", "type": "event_msg",
        "payload": {"type": "token_count", "rate_limits": {"primary": {"used_percent": 37}}}
    }) + "\n")
    writer.write(output, state, sessions)
    observed = json.loads(output.read_text())
    assert observed["rows"][1]["used_pct"] == 37
    assert observed["rows"][2:] == unknown["rows"][2:]
    assert observed["updated"] == "2026-11-03T14:40:00Z"
print("Usage writer checks passed: separate unknown Meta/Muse rows, no guessed amounts or freshness.")
