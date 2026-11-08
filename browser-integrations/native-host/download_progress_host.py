#!/usr/bin/python3
"""Native Messaging bridge for Panel Modifier browser download progress."""

from __future__ import annotations

import fcntl
import json
import math
import os
import signal
import struct
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

MAX_MESSAGE_BYTES = 1024 * 1024
ALLOWED_BROWSERS = {"firefox", "chrome"}


def read_exact(stream: Any, length: int) -> bytes | None:
    data = bytearray()
    while len(data) < length:
        chunk = stream.read(length - len(data))
        if not chunk:
            return None
        data.extend(chunk)
    return bytes(data)


def cache_paths() -> tuple[Path, Path]:
    cache_root = Path(os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache")))
    state_dir = cache_root / "panel-modifier"
    return state_dir / "download-progress.json", state_dir / "download-progress.lock"


def read_state(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as state_file:
            value = json.load(state_file)
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def write_state(browser: str, active: bool, progress: float | None) -> None:
    state_path, lock_path = cache_paths()
    state_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)

    normalized_progress: float | None = None
    if active and isinstance(progress, (int, float)) and math.isfinite(progress):
        normalized_progress = max(0.0, min(100.0, float(progress)))

    # All browser host processes update the same JSON file. flock prevents a
    # Firefox write from accidentally overwriting a concurrent Chrome update.
    with lock_path.open("a+", encoding="utf-8") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        state = read_state(state_path)
        state[browser] = {
            "active": bool(active),
            "progress": normalized_progress if active else None,
        }
        state["_updated_at"] = time.time()

        fd, temp_name = tempfile.mkstemp(
            prefix=".download-progress-",
            suffix=".tmp",
            dir=state_path.parent,
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as temp_file:
                os.fchmod(temp_file.fileno(), 0o600)
                json.dump(state, temp_file, separators=(",", ":"))
                temp_file.write("\n")
                temp_file.flush()
                os.fsync(temp_file.fileno())
            os.replace(temp_name, state_path)
        finally:
            try:
                os.unlink(temp_name)
            except FileNotFoundError:
                pass
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def main() -> int:
    browser = sys.argv[1].lower() if len(sys.argv) > 1 else ""
    if browser not in ALLOWED_BROWSERS:
        print("Invalid browser key for Panel Modifier native host", file=sys.stderr)
        return 2

    def stop_handler(_signum: int, _frame: Any) -> None:
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, stop_handler)
    signal.signal(signal.SIGINT, stop_handler)

    try:
        input_stream = sys.stdin.buffer
        while True:
            header = read_exact(input_stream, 4)
            if header is None:
                break
            message_length = struct.unpack("=I", header)[0]
            if message_length > MAX_MESSAGE_BYTES:
                print("Panel Modifier native message exceeded 1 MiB", file=sys.stderr)
                break

            encoded_message = read_exact(input_stream, message_length)
            if encoded_message is None:
                break

            try:
                message = json.loads(encoded_message.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                continue

            if (
                not isinstance(message, dict)
                or message.get("type") != "download-progress"
                or message.get("browser") != browser
            ):
                continue

            active = message.get("active") is True
            progress = message.get("progress")
            write_state(browser, active, progress)
    except SystemExit:
        pass
    except Exception as error:  # Do not write diagnostics to stdout: it is the protocol pipe.
        print(f"Panel Modifier native host error: {error}", file=sys.stderr)
        return 1
    finally:
        try:
            write_state(browser, False, None)
        except Exception as error:
            print(f"Panel Modifier could not clear download state: {error}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
