#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="org.monnomax.panel_modifier_download_progress"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/panel-modifier-download-progress"
HOST_DIR="$HOME/.local/lib/panel-modifier-download-progress"

rm -f "$HOME/.config/google-chrome/NativeMessagingHosts/$HOST_NAME.json"
rm -f "$HOME/.mozilla/native-messaging-hosts/$HOST_NAME.json"
rm -rf "$HOST_DIR" "$DATA_DIR"
rm -f "${XDG_CACHE_HOME:-$HOME/.cache}/panel-modifier/download-progress.json"
rm -f "${XDG_CACHE_HOME:-$HOME/.cache}/panel-modifier/download-progress.lock"

echo "Зареєстровані Native Messaging manifests і встановлені адаптери видалено."
echo "Також видали unpacked extensions у chrome://extensions та about:addons, якщо вони більше не потрібні."
