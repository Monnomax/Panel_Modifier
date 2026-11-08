const api = globalThis.browser ?? globalThis.chrome;
const HOST_NAME = "org.monnomax.panel_modifier_download_progress";
const BROWSER_KEY = "firefox";
const POLL_INTERVAL_MS = 500;
const RECONNECT_DELAY_MS = 1500;

let nativePort = null;
let reconnectTimer = null;
let pollTimer = null;
let pollInProgress = false;
let pollAgain = false;
let lastPayload = null;
let lastSentAt = 0;

function sendSnapshot(active, progress) {
    if (!nativePort) return;

    const payload = {
        type: "download-progress",
        browser: BROWSER_KEY,
        active: active === true,
        progress: Number.isFinite(progress)
            ? Math.max(0, Math.min(100, progress))
            : null,
    };

    const signature = JSON.stringify(payload);
    const now = Date.now();
    // Send changed percentages immediately and an unchanged heartbeat every
    // 1.5 seconds so the Shell can discard stale snapshots after a crash.
    if (signature === lastPayload && now - lastSentAt < RECONNECT_DELAY_MS) {
        return;
    }

    try {
        nativePort.postMessage(payload);
        lastPayload = signature;
        lastSentAt = now;
    } catch (error) {
        console.warn("Panel Modifier native host send failed:", error);
    }
}

async function publishProgress() {
    if (!nativePort) return;
    if (pollInProgress) {
        pollAgain = true;
        return;
    }

    pollInProgress = true;
    try {
        const activeDownloads = await api.downloads.search({ state: "in_progress" });
        if (!activeDownloads.length) {
            sendSnapshot(false, null);
            return;
        }

        const hasUnknownSize = activeDownloads.some((item) =>
            !Number.isFinite(item.totalBytes) || item.totalBytes <= 0,
        );
        if (hasUnknownSize) {
            sendSnapshot(true, null);
            return;
        }

        const totalBytes = activeDownloads.reduce(
            (sum, item) => sum + item.totalBytes,
            0,
        );
        const receivedBytes = activeDownloads.reduce((sum, item) => {
            const received = Number.isFinite(item.bytesReceived)
                ? Math.max(0, item.bytesReceived)
                : 0;
            return sum + Math.min(item.totalBytes, received);
        }, 0);

        const progress = totalBytes > 0
            ? Math.max(0, Math.min(100, (receivedBytes / totalBytes) * 100))
            : null;
        sendSnapshot(true, progress);
    } catch (error) {
        // Keep the last valid state rather than falsely marking downloads idle.
        console.warn("Panel Modifier could not query downloads:", error);
    } finally {
        pollInProgress = false;
        if (pollAgain) {
            pollAgain = false;
            queueMicrotask(publishProgress);
        }
    }
}

function scheduleReconnect() {
    if (reconnectTimer !== null) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectNativeHost();
    }, RECONNECT_DELAY_MS);
}

function connectNativeHost() {
    try {
        const port = api.runtime.connectNative(HOST_NAME);
        nativePort = port;
        lastPayload = null;
        lastSentAt = 0;

        port.onDisconnect.addListener(() => {
            // Read lastError while inside the onDisconnect event.
            const message = api.runtime.lastError?.message;
            if (message) console.warn("Panel Modifier native host disconnected:", message);
            if (nativePort === port) nativePort = null;
            scheduleReconnect();
        });

        publishProgress();
        if (pollTimer === null) {
            pollTimer = setInterval(publishProgress, POLL_INTERVAL_MS);
        }
    } catch (error) {
        nativePort = null;
        console.warn("Panel Modifier native host is not available:", error);
        scheduleReconnect();
    }
}

api.downloads.onCreated.addListener(() => publishProgress());
api.downloads.onChanged.addListener(() => publishProgress());
api.downloads.onErased.addListener(() => publishProgress());

connectNativeHost();
