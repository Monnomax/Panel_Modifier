# Real browser download progress

Panel Modifier already watches `~/.cache/panel-modifier/download-progress.json`. This integration adds Firefox and Google Chrome WebExtensions that query each browser's downloads API and pass snapshots to a Native Messaging host, which updates that shared JSON file. The host uses a lock + atomic replacement so simultaneous Firefox and Chrome updates do not overwrite each other.

## Install the Native Messaging hosts

From the Panel Modifier repository root run:

```bash
bash scripts/install-browser-download-progress.sh
```

This installs the native host under `~/.local/lib/panel-modifier-download-progress/`, and copies unpacked browser extensions into `~/.local/share/panel-modifier-download-progress/browser-extensions/`. To validate the native protocol before opening a browser, run `bash scripts/test-download-progress-native-host.sh`.

## Load in Google Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `~/.local/share/panel-modifier-download-progress/browser-extensions/chrome`. If `.local` is hidden in the file chooser, press Ctrl+L and enter the full path.
5. Confirm the extension ID shown by Chrome is `hiejlnmjafblhkbkgilbicpcnnokjfbl`.
6. Keep the extension enabled and restart Chrome if it was open during host installation.

The Chrome manifest includes a fixed public key so its extension ID matches the allowed origin registered by the installer. It does not grant the extension access to page contents; permissions are limited to downloads and Native Messaging.

## Load in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `~/.local/share/panel-modifier-download-progress/browser-extensions/firefox/manifest.json`.
4. Keep Firefox open while testing. Temporary add-ons are removed on browser exit, so they must be loaded again after restarting Firefox unless the add-on is signed/installed through a supported permanent-install route.

Firefox Snap/Flatpak builds are sandboxed; Native Messaging availability depends on the native-messaging portal/proxy provided by that package. If the background console reports that the native host cannot be found or launched, capture that error before changing system-wide files.

## Verify

1. Ensure the Panel Modifier extension is enabled.
2. Ensure the Firefox or Chrome icon appears in its taskbar.
3. Start downloading a reasonably large file.
4. The existing indicator should expand and show the calculated byte-weighted progress. When total size is unknown, it shows an indeterminate blue segment. Multiple simultaneous downloads in one browser are aggregated by bytes; if any active download has unknown size, that browser reports indeterminate progress.
5. Pause, resume, cancel, and complete a download to confirm the indicator appears and disappears as expected.

The native host writes only browser-level download status, not URLs, filenames, page content, or file contents. It stores a small local state snapshot in the user's cache directory. When a host disconnects it marks its browser idle; the Shell also ignores snapshots older than five seconds.

## Remove

Close both browsers, then run:

```bash
bash scripts/uninstall-browser-download-progress.sh
```

Remove the loaded unpacked extension from each browser's extensions page as well.
