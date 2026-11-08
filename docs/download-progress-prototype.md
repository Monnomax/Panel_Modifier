# Browser download progress prototype

This is a visual/integration prototype. It does not yet read download events directly from Firefox or Chrome. Instead, Panel Modifier polls a small JSON file so the indicator can be verified before adding browser extensions and Native Messaging hosts.

The file is:

```text
${XDG_CACHE_HOME:-~/.cache}/panel-modifier/download-progress.json
```

The file is a JSON object keyed by browser (`firefox`, `chrome`, `chromium`, `brave`, or `edge`). An active download entry has `active: true` and a `progress` percentage from 0 to 100:

```json
{
  "firefox": { "active": true, "progress": 65 },
  "chrome": { "active": true, "progress": 30 }
}
```

If `progress` is `null`, the indicator displays an animated blue segment because the total file size is unknown.

Run the demo from the extension checkout:

```bash
bash scripts/demo-download-progress.sh both
```

Supported arguments are `firefox`, `chrome`, `chromium`, and `both`. Press Ctrl+C to stop the demo and remove the test file. The matching browser must have an icon in the Panel Modifier taskbar (pinned or running).

The visual progress fill is blue; the background reuses the existing active/inactive indicator styling and expands to the browser icon width. Browser API integration will be added separately after this appearance is verified.
