#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
HOST="$REPO_ROOT/browser-integrations/native-host/download_progress_host.py"
PYTHON="$(command -v python3)"

"$PYTHON" - "$HOST" <<'PY'
import json
import os
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

host = Path(sys.argv[1])

with tempfile.TemporaryDirectory(prefix="panel-modifier-host-test-") as temporary:
    env = os.environ.copy()
    env["XDG_CACHE_HOME"] = temporary
    chrome = subprocess.Popen(
        [sys.executable, str(host), "chrome"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )
    firefox = subprocess.Popen(
        [sys.executable, str(host), "firefox"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )
    state_path = Path(temporary) / "panel-modifier" / "download-progress.json"

    def send(process, browser, active, progress):
        message = json.dumps({
            "type": "download-progress",
            "browser": browser,
            "active": active,
            "progress": progress,
        }).encode("utf-8")
        process.stdin.write(struct.pack("=I", len(message)) + message)
        process.stdin.flush()

    def wait_for(predicate, label):
        for _ in range(60):
            try:
                state = json.loads(state_path.read_text(encoding="utf-8"))
                if predicate(state):
                    return state
            except (OSError, json.JSONDecodeError):
                pass
            time.sleep(0.05)
        raise AssertionError(f"timeout waiting for {label}")

    try:
        send(chrome, "chrome", True, 41.5)
        send(firefox, "firefox", True, 72)
        state = wait_for(
            lambda s: s.get("chrome", {}).get("progress") == 41.5
            and s.get("firefox", {}).get("progress") == 72,
            "combined Chrome + Firefox states",
        )
        assert state["chrome"]["active"] is True
        assert state["firefox"]["active"] is True
        assert isinstance(state.get("_updated_at"), (int, float))

        chrome.stdin.close()
        chrome.wait(timeout=3)
        state = wait_for(
            lambda s: s.get("chrome", {}).get("active") is False
            and s.get("firefox", {}).get("active") is True,
            "Chrome disconnect cleanup without removing Firefox state",
        )

        firefox.stdin.close()
        firefox.wait(timeout=3)
        wait_for(
            lambda s: s.get("firefox", {}).get("active") is False,
            "Firefox disconnect cleanup",
        )
    finally:
        for process in (chrome, firefox):
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=2)

print("[OK] Native Messaging protocol framing")
print("[OK] Shared-state merge for simultaneous browsers")
print("[OK] Browser disconnect cleanup")
PY
