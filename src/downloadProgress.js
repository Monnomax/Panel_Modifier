import GLib from "gi://GLib";

const POLL_INTERVAL_MS = 250;
const SNAPSHOT_MAX_AGE_SECONDS = 5;

function getProgressFilePath() {
    return GLib.build_filenamev([
        GLib.get_user_cache_dir(),
        "panel-modifier",
        "download-progress.json",
    ]);
}

function readProgressSnapshot() {
    try {
        const [success, bytes] = GLib.file_get_contents(getProgressFilePath());
        if (!success || !bytes) return {};

        const parsed = JSON.parse(new TextDecoder("utf-8").decode(bytes));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {};
        }

        // Native host snapshots have a heartbeat timestamp. Ignore stale state
        // if the browser, extension, or native host was terminated abruptly.
        // The demo script deliberately omits this field and remains compatible.
        if (
            Number.isFinite(parsed._updated_at) &&
            Date.now() / 1000 - parsed._updated_at > SNAPSHOT_MAX_AGE_SECONDS
        ) {
            return {};
        }

        return parsed;
    } catch (e) {
        // A missing or partially written file means there is no progress to show.
        return {};
    }
}

export function getDownloadProgressForApp(appId, snapshot) {
    const id = String(appId ?? "").toLowerCase();
    let browserKey = null;

    if (id.includes("firefox")) {
        browserKey = "firefox";
    } else if (id.includes("chromium")) {
        browserKey = "chromium";
    } else if (id.includes("brave")) {
        browserKey = "brave";
    } else if (id.includes("microsoft-edge") || id.includes("msedge")) {
        browserKey = "edge";
    } else if (id.includes("google-chrome") || id.includes("chrome")) {
        browserKey = "chrome";
    }

    if (!browserKey) return null;

    const item = snapshot?.[browserKey];
    if (!item || item.active !== true) return null;

    const progress = Number.isFinite(item.progress)
        ? Math.max(0, Math.min(100, item.progress))
        : null;

    return { active: true, progress };
}

export class DownloadProgressMonitor {
    constructor(onUpdate) {
        this._onUpdate = onUpdate;
        this._timeoutId = 0;
    }

    enable() {
        if (this._timeoutId) return;

        this._poll();
        this._timeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            POLL_INTERVAL_MS,
            () => {
                this._poll();
                return GLib.SOURCE_CONTINUE;
            },
        );
    }

    _poll() {
        if (typeof this._onUpdate !== "function") return;

        this._onUpdate(readProgressSnapshot());
    }

    destroy() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }

        this._onUpdate = null;
    }
}
