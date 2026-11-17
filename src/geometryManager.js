import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

const FRAME_MS = 16;
const SMOOTHING = 0.22;
const SIGMOID_K = 8;
const CONVERGE_EPS = 0.4;

function clamp(v, min, max) {
    if (max < min) return min;
    return Math.min(max, Math.max(min, v));
}

function sigmoidEase(x) {
    const s = (t) => 1 / (1 + Math.exp(-SIGMOID_K * (t - 0.5)));
    const s0 = s(0);
    const s1 = s(1);
    return (s(x) - s0) / (s1 - s0);
}

export class TaskbarGeometryManager {
    constructor(taskbar) {
        this._taskbar = taskbar;

        this.viewportWidth = 0;
        this.contentWidth = 0;
        this.maxOffset = 0;
        this.currentOffset = 0;
        this.targetOffset = 0;
        this.scrollingEnabled = false;

        this._tickId = 0;
        this._measureIdleId = 0;
        this._dragActive = false;
        this._destroyed = false;
        this._pendingReveal = null;
        this._pendingRevealAttempts = 0;
        this._pendingRevealDestroyId = 0;
    }

    scheduleMeasure() {
        if (this._destroyed || this._measureIdleId) return;
        this._measureIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._measureIdleId = 0;
            if (!this._destroyed) this.measure();
            return GLib.SOURCE_REMOVE;
        });
    }

    measure() {
        if (this._destroyed) return;

        const t = this._taskbar;
        if (!t || !t._content) return;

        const monitor =
            Main.layoutManager.primaryMonitor ||
            Main.layoutManager.focusMonitor;
        const monitorWidth = monitor ? monitor.width : global.stage.width;

        const otherWidth = t._measureOtherElementsWidth();
        const separatorsWidth = t._measureSeparatorsWidth();

        const { basis, marginsIncluded } =
            t._measurePanelWidthBasis(monitorWidth);
        const margins = marginsIncluded ? 0 : t._measurePanelMargins();

        const available = Math.max(
            0,
            basis - otherWidth - separatorsWidth - margins,
        );

        const [, contentNatural] = t._content.get_preferred_width(-1);
        this.contentWidth = Math.max(0, contentNatural);

        this.viewportWidth = Math.max(
            0,
            Math.min(this.contentWidth, available),
        );
        this.maxOffset = Math.max(0, this.contentWidth - this.viewportWidth);
        this.scrollingEnabled = this.contentWidth > this.viewportWidth + 0.5;

        if (!this.scrollingEnabled) {
            this.currentOffset = 0;
            this.targetOffset = 0;
            this._clearPendingRevealSignal();
            this._pendingReveal = null;
            this._pendingRevealAttempts = 0;
            this._stopTicker();
        } else {
            this.targetOffset = clamp(this.targetOffset, 0, this.maxOffset);
            this.currentOffset = clamp(this.currentOffset, 0, this.maxOffset);

            if (this._pendingReveal) {
                const btn = this._pendingReveal;

                let stillPending = false;
                let box = null;

                try {
                    if (
                        !btn.is_finalized?.() &&
                        btn.get_parent() === t._content
                    ) {
                        box = btn.get_allocation_box();
                        stillPending = true;
                    }
                } catch (e) {
                    stillPending = false;
                }

                if (!stillPending) {
                    this._clearPendingRevealSignal();
                    this._pendingReveal = null;
                    this._pendingRevealAttempts = 0;
                } else if (box && box.x2 > box.x1) {
                    this.targetOffset = clamp(
                        this._computeRevealOffset(box),
                        0,
                        this.maxOffset,
                    );
                    this._clearPendingRevealSignal();
                    this._pendingReveal = null;
                } else if (this._pendingRevealAttempts < 20) {
                    this._pendingRevealAttempts =
                        (this._pendingRevealAttempts || 0) + 1;
                    this.scheduleMeasure();
                } else {
                    this._clearPendingRevealSignal();
                    this._pendingReveal = null;
                    this._pendingRevealAttempts = 0;
                }
            }

            if (Math.abs(this.targetOffset - this.currentOffset) > 0.05) {
                this._startTicker();
            }
        }

        t._applyGeometry();
    }

    _computeRevealOffset(box) {
        const margin = 4;
        let target = this.targetOffset;

        if (box.x2 - target > this.viewportWidth) {
            target = box.x2 - this.viewportWidth + margin;
        }
        if (box.x1 - target < 0) {
            target = box.x1 - margin;
        }

        return target;
    }

    requestReveal(buttonActor) {
        if (this._destroyed || !buttonActor) return;

        this._clearPendingRevealSignal();

        this._pendingReveal = buttonActor;
        this._pendingRevealAttempts = 0;

        try {
            this._pendingRevealDestroyId = buttonActor.connect(
                "destroy",
                () => {
                    if (this._pendingReveal === buttonActor) {
                        this._pendingReveal = null;
                        this._pendingRevealAttempts = 0;
                    }
                    this._pendingRevealDestroyId = 0;
                },
            );
        } catch (e) {
            this._pendingRevealDestroyId = 0;
        }

        this.scheduleMeasure();
    }

    _clearPendingRevealSignal() {
        if (this._pendingReveal && this._pendingRevealDestroyId) {
            try {
                if (!this._pendingReveal.is_finalized?.())
                    this._pendingReveal.disconnect(
                        this._pendingRevealDestroyId,
                    );
            } catch (e) {}
        }
        this._pendingRevealDestroyId = 0;
    }

    setMouseRatio(ratio) {
        if (this._destroyed || this._dragActive || !this.scrollingEnabled)
            return;

        const clamped = clamp(ratio, 0, 1);
        const eased = sigmoidEase(clamped);
        this.targetOffset = clamp(eased * this.maxOffset, 0, this.maxOffset);
        this._startTicker();
    }

    setDragActive(active) {
        if (this._destroyed) return;

        this._dragActive = !!active;

        if (this._dragActive) {
            this._stopTicker();
        } else {
            this.scheduleMeasure();
        }
    }

    _startTicker() {
        if (this._tickId || this._destroyed) return;

        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FRAME_MS, () => {
            if (this._destroyed || this._dragActive) {
                this._tickId = 0;
                return GLib.SOURCE_REMOVE;
            }

            this.currentOffset +=
                (this.targetOffset - this.currentOffset) * SMOOTHING;

            if (
                Math.abs(this.targetOffset - this.currentOffset) < CONVERGE_EPS
            ) {
                this.currentOffset = this.targetOffset;
                this._taskbar._applyOffset();
                this._tickId = 0;
                return GLib.SOURCE_REMOVE;
            }

            this._taskbar._applyOffset();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopTicker() {
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
    }

    destroy() {
        this._destroyed = true;
        this._stopTicker();

        if (this._measureIdleId) {
            GLib.source_remove(this._measureIdleId);
            this._measureIdleId = 0;
        }

        this._clearPendingRevealSignal();
        this._pendingReveal = null;

        this._taskbar = null;
    }
}
