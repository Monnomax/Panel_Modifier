#!/usr/bin/env bash
set -euo pipefail

mode="${1:-both}"
case "$mode" in
    firefox|chrome|chromium|both) ;;
    *)
        printf 'Usage: %s [firefox|chrome|chromium|both]\n' "$0" >&2
        exit 2
        ;;
esac

cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/panel-modifier"
progress_file="$cache_dir/download-progress.json"
tmp_file="$progress_file.tmp"
mkdir -p "$cache_dir"

cleanup() {
    rm -f "$tmp_file" "$progress_file"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

step=0
while true; do
    firefox_progress=$(((step * 7 + 9) % 101))
    chrome_progress=$(((step * 11 + 27) % 101))
    chromium_progress=$(((step * 13 + 41) % 101))

    firefox_active=false
    chrome_active=false
    chromium_active=false
    case "$mode" in
        firefox) firefox_active=true ;;
        chrome) chrome_active=true ;;
        chromium) chromium_active=true ;;
        both) firefox_active=true; chrome_active=true ;;
    esac

    printf '{"firefox":{"active":%s,"progress":%d},"chrome":{"active":%s,"progress":%d},"chromium":{"active":%s,"progress":%d}}\n' \
        "$firefox_active" "$firefox_progress" \
        "$chrome_active" "$chrome_progress" \
        "$chromium_active" "$chromium_progress" > "$tmp_file"
    mv -f "$tmp_file" "$progress_file"

    sleep 0.3
    step=$((step + 1))
done
