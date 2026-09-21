import GLib from "gi://GLib";
import Clutter from "gi://Clutter";
import Meta from "gi://Meta";
import { AnimationManager } from "./animationManager.js";
import { WindowPreview } from "./preview.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PointerWatcher from "resource:///org/gnome/shell/ui/pointerWatcher.js";

export class AutoHideManager {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();

        this._autohideBehavior =
            this._settings.get_string("autohide-behavior") || "all";

        this._pointerWatch = null;
        this._autohideTimeoutId = null;
        this._ensureHideId = null;
        this._panelVisible = true;
        this._autohideEnabled = false;
        this._intelligentAutohide = false;
        this._autohideDelay = 600;
        this._motionThrottleId = null;

        this._signals = [];

        this._showTimeoutId = null;
        this._showThreshold = 5;
        this._showDelay = 150;

        // Початкове значення анімації за замовчуванням
        this._currentAnimationData = Clutter.AnimationMode.EASE_OUT_QUAD;
    }

    enable() {
        this._loadSettings();
        this._updateStruts();

        this._signals.push({
            obj: this._settings,
            id: this._settings.connect("changed::autohide-behavior", () => {
                this._autohideBehavior =
                    this._settings.get_string("autohide-behavior");
                this.updateAutohide();
            }),
        });

        this._signals.push({
            obj: global.display,
            id: global.display.connect("notify::focus-window", () => {
                this.updateAutohide();
            }),
        });

        this._signals.push({
            obj: this._settings,
            id: this._settings.connect("changed::autohide-enabled", () => {
                this._autohideEnabled =
                    this._settings.get_boolean("autohide-enabled");
                this._updateStruts();
                this.updateAutohide();
            }),
        });

        this._signals.push({
            obj: this._settings,
            id: this._settings.connect("changed::autohide-delay", () => {
                let delay = this._settings.get_int("autohide-delay");
                this._autohideDelay = delay >= 0 ? delay : 600;
            }),
        });

        this._signals.push({
            obj: this._settings,
            id: this._settings.connect("changed::autohide-show-delay", () => {
                let delay = this._settings.get_int("autohide-show-delay");
                this._showDelay = delay >= 0 ? delay : 150;
            }),
        });

        this._signals.push({
            obj: this._settings,
            id: this._settings.connect(
                "changed::autohide-show-duration",
                () => {
                    this._showDuration = this._settings.get_int(
                        "autohide-show-duration",
                    );
                },
            ),
        });

        this._signals.push({
            obj: this._settings,
            id: this._settings.connect(
                "changed::autohide-hide-duration",
                () => {
                    this._hideDuration = this._settings.get_int(
                        "autohide-hide-duration",
                    );
                },
            ),
        });

        this._signals.push({
            obj: this._settings,
            id: this._settings.connect("changed::autohide-animation", () => {
                const animName =
                    this._settings.get_string("autohide-animation");
                this._currentAnimationData = this._getAnimationData(animName);
            }),
        });

        this._signals.push({
            obj: this._settings,
            id: this._settings.connect(
                "changed::animation-custom-settings",
                () => {
                    const animName =
                        this._settings.get_string("autohide-animation");
                    this._currentAnimationData =
                        this._getAnimationData(animName);
                },
            ),
        });

        this._signals.push({
            obj: this._settings,
            id: this._settings.connect("changed::autohide-threshold", () => {
                let threshold = this._settings.get_int("autohide-threshold");
                this._showThreshold = threshold >= 1 ? threshold : 5;
            }),
        });

        this._pointerWatch = PointerWatcher.getPointerWatcher().addWatch(
            100,
            this._onPointerUpdate.bind(this),
        );

        this._signals.push({
            obj: global.workspace_manager,
            id: global.workspace_manager.connect(
                "active-workspace-changed",
                () => this.updateAutohide(),
            ),
        });

        this._signals.push({
            obj: global.display,
            id: global.display.connect("window-entered-monitor", () =>
                this.updateAutohide(),
            ),
        });

        this._signals.push({
            obj: global.window_manager,
            id: global.window_manager.connect("size-change", () =>
                this.updateAutohide(),
            ),
        });

        this._signals.push({
            obj: global.display,
            id: global.display.connect("restacked", () => {
                if (this._isTransientPopupOnTop()) return;
                this.updateAutohide();
            }),
        });

        this.updateAutohide();
    }

    disable() {
        this._autohideEnabled = false;

        // --- 1. ТАЙМЕРИ ---
        if (this._showTimeoutId) {
            GLib.source_remove(this._showTimeoutId);
            this._showTimeoutId = null;
        }

        if (this._ensureHideId) {
            GLib.source_remove(this._ensureHideId);
            this._ensureHideId = null;
        }

        if (this._motionThrottleId) {
            GLib.source_remove(this._motionThrottleId);
            this._motionThrottleId = null;
        }

        this._clearHideTimeout();

        // --- 2. SIGNALS ---
        if (this._signals && this._signals.length > 0) {
            this._signals.forEach((sig) => {
                if (sig.obj && sig.id && sig.obj.disconnect) {
                    try {
                        sig.obj.disconnect(sig.id);
                    } catch (e) {
                        // Об'єкт міг бути вже знищений системою
                    }
                }
            });
            this._signals = [];
        }

        // --- 3. POINTER WATCHER ---
        if (this._pointerWatch) {
            this._pointerWatch.remove();
            this._pointerWatch = null;
        }

        // --- 4. PANEL VISUAL & CHROME RESET ---
        const panelBox = Main.layoutManager.panelBox;
        if (panelBox) {
            try {
                Main.layoutManager.removeChrome(panelBox);
            } catch (e) {}

            panelBox.remove_all_transitions();
            panelBox.translation_y = 0;
            panelBox.visible = true;
            panelBox.opacity = 255;
            panelBox.reactive = true;

            try {
                Main.layoutManager.addChrome(panelBox, {
                    affectsStruts: true,
                    trackFullscreen: true,
                });
            } catch (e) {}
        }

        // --- 5. INTERNAL STATE RESET ---
        this._panelVisible = true;
    }

    _getAnimationData(animName) {
        return AnimationManager.getAnimation(animName, this._settings);
    }

    _loadSettings() {
        this._autohideEnabled = this._settings.get_boolean("autohide-enabled");
        this._showThreshold = this._settings.get_int("autohide-threshold");
        this._intelligentAutohide = this._settings.get_boolean(
            "intelligent-autohide",
        );

        const animName = this._settings.get_string("autohide-animation");
        this._currentAnimationData = this._getAnimationData(animName);

        let hideDelay = this._settings.get_int("autohide-delay");
        this._autohideDelay = hideDelay >= 0 ? hideDelay : 600;
        this._showDelay = this._settings.get_int("autohide-show-delay") || 150;
    }

    _animatePanel(destination, immediate, duration, mode) {
        const panelBox = Main.layoutManager.panelBox;
        if (!panelBox) return;

        if (isNaN(destination)) {
            console.warn(
                "Panel Modifier: Спроба анімації до NaN. Оновлюємо координати...",
            );
            this._updateCoords();
            destination = this._panelVisible ? this._yShow : this._yHide;

            if (isNaN(destination)) return;
        }

        panelBox.remove_all_transitions();

        const targetOpacity = destination === this._yShow ? 255 : 50;

        if (destination === this._yShow) {
            panelBox.visible = true;
            const parent = panelBox.get_parent();
            if (parent) {
                const keyboardBox = Main.layoutManager.keyboardBox;
                if (keyboardBox && keyboardBox.get_parent() === parent) {
                    parent.set_child_below_sibling(panelBox, keyboardBox);
                } else {
                    parent.set_child_above_sibling(panelBox, null);
                }
            }
        }

        if (immediate) {
            panelBox.translation_y = destination;
            panelBox.opacity = targetOpacity;
            Main.layoutManager._queueUpdateRegions();
            return;
        }

        panelBox.ease({
            translation_y: destination,
            duration: duration,
            mode: mode,
            onComplete: () => {
                panelBox.reactive = destination === this._yShow;
                if (destination !== this._yShow) {
                    panelBox.visible = false;
                }
                Main.layoutManager._queueUpdateRegions();
            },
        });

        panelBox.ease({
            opacity: targetOpacity,
            duration: duration,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _onPointerUpdate(x, y) {
        const panelBox = Main.layoutManager.panelBox;
        if (!panelBox) return;

        const monitor = Main.layoutManager.primaryMonitor;
        const position = this._settings.get_string("panel-position");

        const [, pY] = panelBox.get_transformed_position();
        const [, pH] = panelBox.get_transformed_size();

        let pX = 0,
            pW = 0;
        if (this._extension && this._extension._masterContainer) {
            [pX] = this._extension._masterContainer.get_transformed_position();
            [pW] = this._extension._masterContainer.get_transformed_size();
        } else {
            [pX] = panelBox.get_transformed_position();
            [pW] = panelBox.get_transformed_size();
        }

        let isOver;

        if (this._panelVisible) {
            isOver =
                x >= pX &&
                x <= pX + pW &&
                y >= pY &&
                y <= pY + pH + this._showThreshold;

            if (!isOver && WindowPreview && WindowPreview.activeContainer) {
                const previewContainer = WindowPreview.activeContainer;
                if (
                    previewContainer.get_stage &&
                    previewContainer.get_stage()
                ) {
                    const [prX, prY] =
                        previewContainer.get_transformed_position();
                    const [prW, prH] = previewContainer.get_transformed_size();
                    isOver =
                        x >= prX &&
                        x <= prX + prW &&
                        y >= prY &&
                        y <= prY + prH;
                }
            }
        } else {
            let isYEdge = false;

            if (position === "bottom") {
                isYEdge = y >= monitor.height - this._showThreshold;
            } else {
                isYEdge = y <= this._showThreshold;
            }

            let isXInside = x >= pX && x <= pX + pW;
            isOver = isYEdge && isXInside;
        }

        if (isOver) {
            this._clearHideTimeout();
            this._scheduleShowPanel();
        } else {
            this._clearShowTimeout();
            this.updateAutohide();
        }
    }

    _isMouseOverPanel() {
        if (!Main.panel || !Main.layoutManager.panelBox) return false;

        if (Main.panel.menuManager && Main.panel.menuManager.activeMenu) {
            return true;
        }

        const [x, y] = global.get_pointer();
        const panelBox = Main.layoutManager.panelBox;

        const [, posY] = panelBox.get_transformed_position();
        const [, height] = panelBox.get_transformed_size();

        let posX = 0,
            width = 0;
        if (this._extension && this._extension._masterContainer) {
            [posX] =
                this._extension._masterContainer.get_transformed_position();
            [width] = this._extension._masterContainer.get_transformed_size();
        } else {
            [posX] = panelBox.get_transformed_position();
            [width] = panelBox.get_transformed_size();
        }

        const margin = this._showThreshold || 5;

        const overPanel =
            x >= posX - margin &&
            x <= posX + width + margin &&
            y >= posY - margin &&
            y <= posY + height + margin;

        if (overPanel) return true;

        if (WindowPreview && WindowPreview.activeContainer) {
            const previewContainer = WindowPreview.activeContainer;
            if (previewContainer.get_stage && previewContainer.get_stage()) {
                const [pX, pY] = previewContainer.get_transformed_position();
                const [pW, pH] = previewContainer.get_transformed_size();

                const overPreview =
                    x >= pX - margin &&
                    x <= pX + pW + margin &&
                    y >= pY - margin &&
                    y <= pY + pH + margin;

                if (overPreview) return true;
            }
        }

        return false;
    }

    _updateStruts() {
        const panelBox = Main.layoutManager.panelBox;
        if (!panelBox) return;

        try {
            Main.layoutManager.removeChrome(panelBox);
        } catch (e) {}

        Main.layoutManager.addChrome(panelBox, {
            affectsStruts: !this._autohideEnabled,
            trackFullscreen: true,
        });

        if (!this._autohideEnabled) {
            panelBox.translation_y = 0;
            panelBox.visible = true;
        }
    }

    updateSettings() {
        this._loadSettings();
        this.updateAutohide();
    }

    _ensureHideTrigger() {
        if (this._ensureHideId) return;

        this._ensureHideId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            1000,
            () => {
                if (!this._autohideEnabled) {
                    this._ensureHideId = null;
                    return GLib.SOURCE_REMOVE;
                }

                if (!this._panelVisible) {
                    this._ensureHideId = null;
                    return GLib.SOURCE_REMOVE;
                }

                if (!this._isMouseOverPanel()) {
                    this.updateAutohide();
                }

                return GLib.SOURCE_CONTINUE;
            },
        );
    }

    _scheduleHidePanel() {
        if (this._autohideTimeoutId) return;

        this._autohideTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            this._autohideDelay,
            () => {
                this._hidePanel();
                this._autohideTimeoutId = null;
                return GLib.SOURCE_REMOVE;
            },
        );
    }

    _clearHideTimeout() {
        if (this._autohideTimeoutId) {
            GLib.source_remove(this._autohideTimeoutId);
            this._autohideTimeoutId = null;
        }
    }

    _clearShowTimeout() {
        if (this._showTimeoutId) {
            GLib.source_remove(this._showTimeoutId);
            this._showTimeoutId = null;
        }
    }

    _scheduleShowPanel() {
        if (this._showTimeoutId) return;

        this._showTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            this._showDelay,
            () => {
                this._showPanel();
                this._showTimeoutId = null;
                return GLib.SOURCE_REMOVE;
            },
        );
    }

    _updateCoords() {
        const panelBox = Main.layoutManager.panelBox;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!panelBox || !monitor) return;

        const position = this._settings.get_string("panel-position");
        const panelHeight = panelBox.height || 40;
        const baseY = panelBox.y || 0;

        if (position === "bottom") {
            this._yShow = monitor.height - panelHeight - baseY;
            this._yHide = monitor.height - baseY;
        } else {
            this._yShow = 0 - baseY;
            this._yHide = -panelHeight - baseY;
        }
    }

    _showPanel(immediate = false) {
        this._clearHideTimeout();
        this._updateCoords();

        const mode = this._currentAnimationData.showMode;
        const duration = immediate ? 0 : this._currentAnimationData.showDur;

        this._animatePanel(this._yShow, immediate, duration, mode);
        this._panelVisible = true;
    }

    _hidePanel(immediate = false) {
        if (!this._panelVisible || this._isMouseOverPanel()) return;
        this._updateCoords();

        const mode = this._currentAnimationData.hideMode;
        const duration = immediate ? 0 : this._currentAnimationData.hideDur;

        this._animatePanel(this._yHide, immediate, duration, mode);
        this._panelVisible = false;
    }

    _isTransientPopupOnTop() {
        const POPUP_TYPES = [
            Meta.WindowType.POPUP_MENU,
            Meta.WindowType.DROPDOWN_MENU,
            Meta.WindowType.TOOLTIP,
            Meta.WindowType.COMBO,
            Meta.WindowType.DND,
            Meta.WindowType.OVERRIDE_OTHER,
        ];

        const workspace = global.workspace_manager.get_active_workspace();
        if (!workspace) return false;

        const allWindows = global.display.list_all_windows
            ? global.display.list_all_windows()
            : workspace.list_windows();
        if (!allWindows || allWindows.length === 0) return false;

        const stacked = global.display.sort_windows_by_stacking(allWindows);
        if (!stacked || stacked.length === 0) return false;

        const topWindow = stacked[stacked.length - 1];
        if (!topWindow) return false;

        return POPUP_TYPES.includes(topWindow.get_window_type());
    }

    _shouldHideIntelligently() {
        if (!this._autohideEnabled) return false;
        if (!this._intelligentAutohide) return true;

        const workspace = global.workspace_manager.get_active_workspace();
        if (!workspace) return false;

        const NORMAL_TYPES = [
            Meta.WindowType.NORMAL,
            Meta.WindowType.DIALOG,
            Meta.WindowType.MODAL_DIALOG,
        ];

        const allWorkspaceWindows = workspace
            .list_windows()
            .filter(
                (w) =>
                    w &&
                    w.is_on_primary_monitor() &&
                    w.showing_on_its_workspace() &&
                    !w.is_hidden() &&
                    NORMAL_TYPES.includes(w.get_window_type()),
            );

        if (allWorkspaceWindows.length === 0) return false;

        const windows = global.display
            .sort_windows_by_stacking(allWorkspaceWindows)
            .reverse();

        const focusWindow = global.display.get_focus_window();

        if (this._autohideBehavior === "focused") {
            if (!focusWindow || !windows.includes(focusWindow)) return false;
            return this._doesWindowOverlapPanel(focusWindow);
        }

        if (this._autohideBehavior === "maximized") {
            const hasMaximized = windows.some(
                (w) =>
                    w && (w.maximized_horizontally || w.maximized_vertically),
            );
            if (!hasMaximized) return false;

            const topWindow = windows[0];
            if (
                topWindow &&
                !topWindow.maximized_horizontally &&
                !topWindow.maximized_vertically
            ) {
                return this._doesWindowOverlapPanel(topWindow);
            }
            return true;
        }

        const topWindow = windows[0];
        if (topWindow) {
            return this._doesWindowOverlapPanel(topWindow);
        }

        return false;
    }

    _doesWindowOverlapPanel(w) {
        if (!w) return false;
        if (w.maximized_horizontally || w.maximized_vertically) return true;

        const monitor = Main.layoutManager.primaryMonitor;
        const panelHeight = Main.panel.get_height();
        const position = this._settings.get_string("panel-position");

        if (!monitor) return false;

        const pX = monitor.x;
        const pY =
            position === "bottom"
                ? monitor.y + monitor.height - panelHeight
                : monitor.y;
        const pW = monitor.width;
        const pH = panelHeight;

        const frame = w.get_frame_rect();
        if (!frame) return false;

        return !(
            frame.x >= pX + pW ||
            frame.x + frame.width <= pX ||
            frame.y >= pY + pH ||
            frame.y + frame.height <= pY
        );
    }

    updateAutohide() {
        if (Main.overview.visible || Main.overview.animationInProgress) return;

        if (this._isMouseOverPanel()) {
            this._showPanel();
        } else if (this._shouldHideIntelligently()) {
            this._scheduleHidePanel();
            this._ensureHideTrigger();
        } else {
            this._showPanel();
        }
    }
}
