import * as Main from "resource:///org/gnome/shell/ui/main.js";
import {
    Extension,
    gettext as _,
} from "resource:///org/gnome/shell/extensions/extension.js";
import St from "gi://St";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import { PanelSeparators } from "./src/separators.js";
import { LayoutManager } from "./src/layoutManager.js";
import { ElementRouter } from "./src/elementRouter.js";
import { SystemUIManager } from "./src/systemUIManager.js";
import { LifecycleManager } from "./src/lifecycleManager.js";

const STACKED_TL = "stackedTL";
const STACKED_BR = "stackedBR";
const CENTERED_MONITOR = "centerMonitor";
const START = "START";
const MIDDLE = "MIDDLE";
const END = "END";

const anchorToPosition = {
    [START]: STACKED_TL,
    [MIDDLE]: CENTERED_MONITOR,
    [END]: STACKED_BR,
};

function safeDisconnectSignal(signalRecord) {
    if (!signalRecord || !signalRecord.obj || signalRecord.id == null) {
        return;
    }

    const obj = signalRecord.obj;
    try {
        if (typeof obj.is_finalized === "function" && obj.is_finalized()) {
            return;
        }
        if (typeof obj.is_destroyed === "function" && obj.is_destroyed()) {
            return;
        }
        obj.disconnect(signalRecord.id);
    } catch (e) {
        const message = e?.message ?? String(e);
        const isExpectedDisposalError =
            message.includes("has no handler with id") ||
            message.includes("already disposed") ||
            message.includes("already finalized") ||
            message.includes("destroyed");

        if (!isExpectedDisposalError) {
            console.warn(`Panel Modifier: Failed to disconnect signal: ${message}`);
        }
    }
}

export default class PanelLayoutExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._originalChildren = new Map();
        this._masterContainer = null;
        this._sections = { left: null, center: null, right: null };
        this._zones = { left: [], center: [], right: [] };
        this._signals = [];

        // Ініціалізація підключених менеджерів
        this._layoutManager = new LayoutManager(this);
        this._elementRouter = new ElementRouter(this);
        this._systemUIManager = new SystemUIManager(this);
        this._lifecycleManager = new LifecycleManager(this);

        console.log("Panel Modifier: Enabling...");

        // Виклики методів через відповідний менеджер розмітки
        this._layoutManager._createMasterContainer();
        this._layoutManager._createZones();

        // Перехоплюємо автоперемикання меню при наведенні одразу — це
        // не залежить від фази запуску Shell і не потребує очікування
        // startup-complete.
        this._systemUIManager._patchMenuHoverSwitch();

        this._themeContext = St.ThemeContext.get_for_stage(global.stage);
        const themeId = this._themeContext.connect("changed", () => {
            this._layoutManager._invalidateThemePanelBaseColor();
            this._layoutManager._applyPanelWidth();
        });
        this._signals.push({ obj: this._themeContext, id: themeId });

        if (Main.layoutManager._startingUp) {
            this._startupId = Main.layoutManager.connect(
                "startup-complete",
                () => {
                    Main.layoutManager.disconnect(this._startupId);
                    this._startupId = null;
                    this._lifecycleManager._finalizeStartup();
                    this._systemUIManager._preventSolidStyle();
                },
            );
        } else {
            this._lifecycleManager._finalizeStartup();
            this._systemUIManager._preventSolidStyle();
        }

        this._lifecycleManager._connectSignals();

        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            if (this._settings) {
                this._separators = new PanelSeparators(this, this._settings);
            }
            this._timeoutId = 0;
            return GLib.SOURCE_REMOVE;
        });

        const orderId = this._settings.connect(
            "changed::panel-element-order",
            () => {
                this._elementRouter._refreshLayout();
            },
        );
        this._signals.push({ obj: this._settings, id: orderId });

        const debugSignalId = this._settings.connect(
            "changed::layout-debug",
            () => {
                this._layoutManager._updateDebugVisuals();
            },
        );
        this._signals.push({ obj: this._settings, id: debugSignalId });

        // Викликаємо один раз при запуску розширення, щоб врахувати збережений стан
        this._layoutManager._updateDebugVisuals();
    }

    disable() {
        console.log("Panel Modifier: Disabling...");

        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }

        if (this._startupId) {
            Main.layoutManager.disconnect(this._startupId);
            this._startupId = null;
        }

        // ── Спочатку відключаємо всі відстежувані сигнали, ПОКИ об'єкти ще живі ──
        if (this._signals && this._signals.length > 0) {
            this._signals.forEach((signalRecord) => {
                safeDisconnectSignal(signalRecord);
            });
            this._signals = [];
        }

        if (this._separators) {
            this._separators.destroy();
            this._separators = null;
        }

        if (this._autoHideManager) {
            this._autoHideManager.disable();
            this._autoHideManager = null;
        }

        if (this._taskbar) {
            this._taskbar.destroy();
            this._taskbar = null;
        }

        if (this._signals && this._signals.length > 0) {
            this._signals.forEach((signalRecord) => {
                safeDisconnectSignal(signalRecord);
            });
            this._signals = [];
        }

        // Повернення стану через менеджер системного UI та маршрутизатор елементів
        this._systemUIManager._restoreSolidStyle();
        this._systemUIManager._restoreMenuHoverSwitch();
        this._systemUIManager._forceHideIndicator("a11y", false);
        this._elementRouter._restorePanelMethods();
        this._layoutManager._restoreOriginalLayout();

        if (Main.panel) {
            try {
                Main.panel.set_style(null);
                Main.panel.remove_style_class_name("floating-panel");

                if (Main.panel._centerBox) {
                    Main.panel._centerBox.set_x_align(
                        Clutter.ActorAlign.CENTER,
                    );
                    Main.panel._centerBox.set_x_expand(false);
                }

                ["_leftBox", "_centerBox", "_rightBox"].forEach((boxName) => {
                    if (Main.panel[boxName]) {
                        Main.panel[boxName].visible = true;
                    }
                });
            } catch (e) {
                console.error(
                    `Panel Modifier: Error restoring Main.panel: ${e.message}`,
                );
            }
        }

        this._layoutManager._cleanup();
        this._layoutManager = null;
        this._elementRouter = null;
        this._systemUIManager = null;
        this._lifecycleManager = null;
        this._settings = null;
        this._themeContext = null;
    }
}
