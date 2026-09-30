#!/usr/bin/env python3
"""host_beat.py <mode> <exit code> — the server's heartbeat in state/host_beat.json (where the last cycle ran, when,
and how it ended). runner-watch and the owner read it; it carries no secrets."""
import platform, sys
import _path  # noqa: F401
from executor import common as C

prev = C.load_json(C.ROOT / "state" / "host_beat.json") or {}
code = int(sys.argv[2]) if len(sys.argv) > 2 else 0
beat = {"host": C.os.environ.get("EXECUTOR_HOST_NAME", "unknown"), "mode": sys.argv[1] if len(sys.argv) > 1 else "cycle",
        "t": C.iso(), "exit": code, "python": platform.python_version(),
        "fails_in_a_row": (prev.get("fails_in_a_row", 0) + 1) if code else 0}
C.write_json(C.ROOT / "state" / "host_beat.json", beat)
print(beat)
