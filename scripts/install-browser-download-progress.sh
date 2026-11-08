#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
HOST_NAME="org.monnomax.panel_modifier_download_progress"
CHROME_EXTENSION_ID="ipieokjckgdaiogjlmjeajlejifeakjf"
FIREFOX_EXTENSION_ID="panel-modifier-download-progress@monnomax.local"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/panel-modifier-download-progress"
HOST_DIR="$HOME/.local/lib/panel-modifier-download-progress"
PYTHON="$(command -v python3 || true)"

if [[ -z "$PYTHON" ]]; then
    echo "ПОМИЛКА: Python 3 не знайдено. Встанови python3 і повтори." >&2
    exit 1
fi

for required in \
    "$REPO_ROOT/browser-integrations/native-host/download_progress_host.py" \
    "$REPO_ROOT/browser-integrations/chrome/manifest.json" \
    "$REPO_ROOT/browser-integrations/chrome/background.js" \
    "$REPO_ROOT/browser-integrations/firefox/manifest.json" \
    "$REPO_ROOT/browser-integrations/firefox/background.js"; do
    if [[ ! -f "$required" ]]; then
        echo "ПОМИЛКА: не знайдено файл $required" >&2
        exit 1
    fi
done

install -d -m 700 "$HOST_DIR"
install -m 755 "$REPO_ROOT/browser-integrations/native-host/download_progress_host.py" \
    "$HOST_DIR/download_progress_host.py"

make_wrapper() {
    local browser="$1"
    local destination="$HOST_DIR/native-host-$browser"
    {
        printf '#!/bin/sh\nexec %q %q %q\n' \
            "$PYTHON" "$HOST_DIR/download_progress_host.py" "$browser"
    } > "$destination"
    chmod 755 "$destination"
}
make_wrapper chrome
make_wrapper firefox

install -d -m 755 "$DATA_DIR/browser-extensions/chrome" "$DATA_DIR/browser-extensions/firefox"
install -m 644 "$REPO_ROOT/browser-integrations/chrome/manifest.json" \
    "$REPO_ROOT/browser-integrations/chrome/background.js" \
    "$DATA_DIR/browser-extensions/chrome/"
install -m 644 "$REPO_ROOT/browser-integrations/firefox/manifest.json" \
    "$REPO_ROOT/browser-integrations/firefox/background.js" \
    "$DATA_DIR/browser-extensions/firefox/"

export HOST_NAME HOST_DIR CHROME_EXTENSION_ID FIREFOX_EXTENSION_ID HOME
"$PYTHON" - <<'PY'
import json
import os
import shutil
from pathlib import Path

home = Path(os.environ["HOME"])
host_name = os.environ["HOST_NAME"]
host_dir = Path(os.environ["HOST_DIR"])
chrome_id = os.environ["CHROME_EXTENSION_ID"]
firefox_id = os.environ["FIREFOX_EXTENSION_ID"]

chrome_installed = any(shutil.which(name) for name in ("google-chrome", "google-chrome-stable", "google-chrome-beta")) or (home / ".config/google-chrome").is_dir()
firefox_installed = shutil.which("firefox") is not None or Path("/snap/bin/firefox").exists() or (home / ".mozilla/firefox").is_dir()

host = {
    "name": host_name,
    "description": "Panel Modifier download progress bridge",
    "type": "stdio",
}

def write_manifest(path: Path, body: dict) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")
    path.chmod(0o600)
    print(f"[OK] Native Messaging manifest: {path}")

if chrome_installed:
    body = dict(host, path=str(host_dir / "native-host-chrome"), allowed_origins=[f"chrome-extension://{chrome_id}/"])
    write_manifest(home / ".config/google-chrome/NativeMessagingHosts" / f"{host_name}.json", body)
else:
    print("[SKIP] Google Chrome не знайдено; адаптер збережено, але manifest не зареєстровано.")

if firefox_installed:
    body = dict(host, path=str(host_dir / "native-host-firefox"), allowed_extensions=[firefox_id])
    write_manifest(home / ".mozilla/native-messaging-hosts" / f"{host_name}.json", body)
else:
    print("[SKIP] Firefox не знайдено; адаптер збережено, але manifest не зареєстровано.")
PY

if command -v snap >/dev/null 2>&1 && snap list firefox >/dev/null 2>&1; then
    echo
    echo "УВАГА: виявлено Firefox Snap. Native Messaging у snap залежить від підтримки native-messaging-proxy/portal у встановленій версії."
    echo "Якщо Firefox покаже помилку підключення, перевіримо її окремо; Chrome не залежить від цього обмеження."
fi

echo
echo "Встановлення завершено."
echo "Chrome: $DATA_DIR/browser-extensions/chrome"
echo "Firefox: $DATA_DIR/browser-extensions/firefox"
echo "Native host: $HOST_DIR"
echo "Chrome ID закріплено ключем у manifest: $CHROME_EXTENSION_ID"
echo "Тепер завантаж відповідне unpacked extension у браузері та перезапусти браузер."
