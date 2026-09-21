import * as Main from "resource:///org/gnome/shell/ui/main.js";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import { AutoHideManager } from "./autoHideManager.js";
import { Taskbar } from "./taskBar.js";

export class LifecycleManager {
    constructor(extension) {
        this._extension = extension;
    }

    // =====================================================
    // Запуск розширення (фінальна фаза, після старту GNOME Shell)
    // =====================================================

    _finalizeStartup() {
        console.log("Panel Modifier: Finalizing startup...");

        const ext = this._extension;

        ext._elementRouter._extractOriginalChildren();
        ext._elementRouter._interceptPanelMethods();
        ext._layoutManager._replacePanelContent();
        this._initializeTaskbar();
        this._applyInitialSettings();

        ext._elementRouter._refreshLayout();

        ext._autoHideManager = new AutoHideManager(ext);
        if (ext._autoHideManager) {
            ext._autoHideManager.enable();
        }

        // Підписка на зміну розміру панелі видалена (не використовується)
    }

    _initializeTaskbar() {
        const ext = this._extension;

        ext._taskbar = new Taskbar(ext, ext._settings, ext.path);
        ext._taskbar.x_expand = false;
        ext._taskbar.x_align = Clutter.ActorAlign.CENTER;

        ext._elementRouter._reparentChildSync(ext._taskbar, "_centerBox");
        console.log("Taskbar added to dynamic layout");

        ext._taskbar._redisplay();
        if (ext._autoHideManager) {
            ext._autoHideManager.enable();
        }
    }

    // =====================================================
    // Підключення сигналів налаштувань
    // =====================================================

    _connectSignals() {
        const ext = this._extension;

        const sObj =
            ext._settings &&
            typeof ext._settings.connect !== "function" &&
            ext._settings.settings
                ? ext._settings.settings
                : ext._settings;

        if (!sObj || typeof sObj.connect !== "function") {
            console.error(
                "Panel Modifier: Could not find a valid settings object to connect signals",
            );
            return;
        }

        const keys = [
            "show-activities-button",
            "panel-position",
            "hide-dash",
            "panel-height",
            "panel-width",
            "dynamic-panel-width",
            "taskbar-position",
            "panel-adaptive-color-enabled",
            "panel-adaptive-color-intensity",
            "margin-top",
            "margin-bottom",
            "margin-left",
            "margin-right",
            "border-radius-top-left",
            "border-radius-top-right",
            "border-radius-bottom-left",
            "border-radius-bottom-right",
            "indicator-active-dynamic-color",
            "indicator-active-height",
            "indicator-active-width",
            "indicator-active-radius",
            "indicator-inactive-dynamic-color",
            "indicator-inactive-height",
            "indicator-inactive-width",
            "indicator-inactive-radius",
            "hide-panel-in-overview",
            "show-a11y-button",
            "autohide-enabled",
            "intelligent-autohide",
            "autohide-delay",
            "panel-element-order",
            "icon-padding-top",
            "icon-padding-right",
            "icon-padding-bottom",
            "icon-padding-left",
            "icon-scale-hover",
            "icon-scale-press",
        ];

        keys.forEach((key) => {
            let id = sObj.connect(`changed::${key}`, () => {
                if (key.includes("autohide")) {
                    if (ext._autoHideManager)
                        ext._autoHideManager.updateSettings();
                } else if (key === "panel-element-order") {
                    ext._elementRouter._refreshLayout();
                } else if (key === "show-activities-button") {
                    // _toggleActivities() сам по собі не завжди показує/ховає
                    // кнопку коректно (актор міг бути перепризначений під
                    // час _doRefreshLayout). _refreshLayout() перебудовує
                    // розкладку і застосовує show-activities-button так само,
                    // як це відбувається при зміні порядку елементів —
                    // саме це надійно оновлює видимість кнопки.
                    this._applyAll();
                    ext._elementRouter._refreshLayout();
                } else {
                    this._applyAll();
                }
            });
            ext._signals.push({ obj: sObj, id: id });
        });

        if (Main.overview) {
            ext._signals.push({
                obj: Main.overview,
                id: Main.overview.connect("showing", () =>
                    ext._systemUIManager._handleOverviewToggle(true),
                ),
            });
            ext._signals.push({
                obj: Main.overview,
                id: Main.overview.connect("hidden", () => {
                    ext._systemUIManager._handleOverviewToggle(false);
                    this._applyAll();
                }),
            });
        }
    }

    // =====================================================
    // Застосування налаштувань
    // =====================================================

    _applyInitialSettings() {
        const ext = this._extension;

        GLib.idle_add(GLib.PRIORITY_LOW, () => {
            if (!ext._settings) return GLib.SOURCE_REMOVE;

            ext._systemUIManager._hideDash(
                ext._settings.get_boolean("hide-dash"),
            );
            ext._systemUIManager._toggleActivities(
                ext._settings.get_boolean("show-activities-button"),
            );

            this._applyAll();

            ext._layoutManager._applyPanelWidth();
            return GLib.SOURCE_REMOVE;
        });
    }

    _updateTaskbarVisibility() {
        const ext = this._extension;
        if (ext._taskbar) {
            ext._taskbar.visible = true;
        }
    }

    _applyAll() {
        const ext = this._extension;
        if (!ext._settings) return;

        ext._layoutManager._applyPanelWidth();
        ext._systemUIManager._toggleActivities();

        const showA11y = ext._settings.get_boolean("show-a11y-button");
        ext._systemUIManager._forceHideIndicator("a11y", !showA11y);

        this._updateTaskbarVisibility();

        // --- Перемальовуємо іконки при зміні відступів чи висоти ---
        if (ext._taskbar && typeof ext._taskbar._redisplay === "function") {
            ext._taskbar._redisplay();
        } else if (
            ext._taskbar &&
            typeof ext._taskbar._updateAllIndicators === "function"
        ) {
            ext._taskbar._updateAllIndicators();
        }

        if (ext._autoHideManager) {
            ext._autoHideManager.updateSettings();
        }
    }
}
