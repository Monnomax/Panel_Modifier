import * as Main from "resource:///org/gnome/shell/ui/main.js";
import St from "gi://St";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import { TaskbarContent } from "./taskbarContent.js";
import { TaskbarGeometryManager } from "./geometryManager.js";
import { TaskbarFadeEffect } from "./fadeEffect.js";

const PANEL_HORIZONTAL_PADDING = 10;

function safeDisconnectSignal(obj, id) {
    if (!obj || id == null || typeof obj.disconnect !== "function") {
        return;
    }

    try {
        if (typeof obj.is_finalized === "function" && obj.is_finalized()) {
            return;
        }
        if (typeof obj.is_destroyed === "function" && obj.is_destroyed()) {
            return;
        }

        if (typeof obj.signal_handler_is_connected === "function") {
            if (!obj.signal_handler_is_connected(id)) {
                return;
            }
        }

        obj.disconnect(id);
    } catch (e) {
        const message = e?.message ?? String(e);
        const isExpectedDisposalError =
            message.includes("has no handler with id") ||
            message.includes("already disposed") ||
            message.includes("already finalized") ||
            message.includes("destroyed");

        if (!isExpectedDisposalError) {
            // Ignore unexpected disposal errors silently.
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Taskbar (TaskBarViewport) — фіксований за шириною "візок", що обрізає
// TaskbarContent (clip_to_allocation) і плавно зміщує його всередині себе
// залежно від горизонтальної позиції курсора (sigmoid-мапінг).
//
// Архітектура:
//   Taskbar (viewport, clip_to_allocation, ширина = GeometryManager)
//     └── TaskbarContent (природна ширина = сума ширин іконок)
//
// Уся геометрія (ширина viewport/content, maxOffset, offset)
// обчислюється виключно через TaskbarGeometryManager.measure() — сам клас
// Taskbar лише читає/пише готові значення та надає GeometryManager-у
// "сирі" виміри сусідніх елементів панелі.
// ═══════════════════════════════════════════════════════════════════════
const Taskbar = GObject.registerClass(
    class Taskbar extends St.Widget {
        _init(extension, settings) {
            super._init({
                name: "customTaskbarViewport",
                style_class: "panel-taskbar-viewport",
                reactive: true,
                track_hover: true,
                clip_to_allocation: true,
                y_expand: true,
                x_expand: false,
            });

            this._extension = extension;
            this._settings = settings;

            this._content = new TaskbarContent(extension, settings);

            this._content._onDragActiveChange = (active) => {
                if (this._geometry) this._geometry.setDragActive(active);
            };
            this._content._onButtonAdded = (button) => {
                if (this._geometry) this._geometry.requestReveal(button);
            };
            this.add_child(this._content);

            this._geometry = new TaskbarGeometryManager(this);

            this._fadeEffect = null;

            try {
                this._fadeEffect = new TaskbarFadeEffect();
                this._fadeEffect.set_enabled(false);
                this.add_effect(this._fadeEffect);
            } catch (e) {
                // Ignore shader setup failures and keep the taskbar functional.
            }

            this._signals = [];
            this._hookGeometrySignals();

            this.connect("motion-event", this._onMotion.bind(this));

            this.connect("destroy", this._onDestroy.bind(this));

            // Відкладаємо перший вимір, щоб панель встигла отримати
            // реальну геометрію під час старту.
            this._initialMeasureId = GLib.idle_add(
                GLib.PRIORITY_DEFAULT,
                () => {
                    this._initialMeasureId = 0;

                    if (this._geometry) {
                        this._geometry.measure();
                    }

                    return GLib.SOURCE_REMOVE;
                },
            );
        }

        // ── Підписки на все, що може вплинути на геометрію ──────────────
        _hookGeometrySignals() {
            const track = (obj, sig, cb) => {
                if (!obj || typeof obj.connect !== "function") return;
                const id = obj.connect(sig, cb);
                this._signals.push({ obj, id });
            };

            const scheduleMeasure = () => {
                if (this._geometry) this._geometry.scheduleMeasure();
            };

            // Зміна кількості/ширини іконок таскбару.
            track(this._content, "notify::width", scheduleMeasure);

            // Зміна монітора / масштабування.
            track(Main.layoutManager, "monitors-changed", scheduleMeasure);

            // Зміна ширини всього masterContainer — найнадійніший
            // "catch-all" тригер: спрацьовує при появі/зникненні кнопок
            // розширень, зміні ширини годинника, Quick Settings, зміні
            // Dynamic Panel Width тощо, бо всі вони — нащадки цього
            // контейнера.
            if (this._extension && this._extension._masterContainer) {
                track(
                    this._extension._masterContainer,
                    "notify::width",
                    scheduleMeasure,
                );
            }
        }

        // ── "Сирі" виміри для TaskbarGeometryManager ────────────────────
        // Сума натуральних ширин усіх видимих елементів панелі, окрім
        // самого таскбару (width(left widgets) + width(right widgets)).
        _measureOtherElementsWidth() {
            const ext = this._extension;
            if (!ext || !ext._zones) return 0;

            let total = 0;
            Object.values(ext._zones).forEach((zoneArray) => {
                if (!Array.isArray(zoneArray)) return;
                zoneArray.forEach((zone) => {
                    if (!zone || zone.is_finalized?.()) return;
                    zone.get_children().forEach((child) => {
                        if (child === this) return;
                        if (!child.visible) return;
                        if (child.is_finalized?.()) return;
                        const [, natW] = child.get_preferred_width(-1);
                        total += natW;
                    });
                });
            });
            return total;
        }

        _measureSeparatorsWidth() {
            const sep = this._extension?._separators;
            if (!sep) return 0;

            let total = 0;
            [sep._leftSepBox, sep._rightSepBox].forEach((box) => {
                if (box && box.visible && !box.is_finalized?.()) {
                    const [, natW] = box.get_preferred_width(-1);
                    total += natW;
                }
            });
            return total;
        }

        _measurePanelMargins() {
            const s = this._settings;
            if (!s) return 0;

            const ml = s.get_int("margin-left") || 0;
            const mr = s.get_int("margin-right") || 0;
            // Той самий внутрішній padding, що встановлює
            // LayoutManager._applyPanelWidth() на Main.panel.
            const horizontalPadding = PANEL_HORIZONTAL_PADDING;

            return ml + mr + horizontalPadding;
        }

        // Повертає "стелю" ширини, у межах якої дозволено розташовувати
        // елементи панелі (включно з таскбаром):
        //   - Dynamic Panel Width: стеля = ширина монітора (margins/padding
        //     віднімаються окремо в measure(), бо панель сама не обмежує).
        //   - Фіксована ширина (panel-width%): стеля = фактична ширина
        //     панелі, яку встановлює LayoutManager._applyPanelWidth()
        //     (той самий розрахунок calcW), вона вже враховує
        //     margins/padding і завжди <= ширини монітора.
        _measurePanelWidthBasis(monitorWidth) {
            const s = this._settings;
            if (!s) return { basis: monitorWidth, marginsIncluded: false };

            const isDynamic = s.get_boolean("dynamic-panel-width");
            if (isDynamic) {
                return { basis: monitorWidth, marginsIncluded: false };
            }

            const ml = s.get_int("margin-left") || 0;
            const mr = s.get_int("margin-right") || 0;
            const horizontalPadding = PANEL_HORIZONTAL_PADDING;
            const widthPct = s.get_int("panel-width") || 100;

            const availW = Math.max(
                0,
                monitorWidth - ml - mr - horizontalPadding,
            );
            const calcW = Math.floor((availW * widthPct) / 100);

            // calcW вже включає віднімання margins/padding — не віднімати їх ще раз.
            return { basis: calcW, marginsIncluded: true };
        }

        // ── Застосування результатів measure() до реальних акторів ──────
        _applyGeometry() {
            const g = this._geometry;
            if (!g) return;

            this.set_width(g.viewportWidth);

            this._applyOffset();
        }

        _applyOffset() {
            const g = this._geometry;
            if (!g || !this._content) return;

            this._content.translation_x = -g.currentOffset;

            this._applyFade();
        }

        _applyFade() {
            const g = this._geometry;
            const effect = this._fadeEffect;

            if (!g || !effect) return;

            /*
             * Якщо content прокручений вправо від початкової позиції,
             * зліва вже є прихований контент.
             *
             * Якщо ще не дійшли до правого краю,
             * справа теж є прихований контент.
             */
            const epsilon = 0.5;

            const leftFade = g.currentOffset > epsilon;

            const rightFade = g.currentOffset < g.maxOffset - epsilon;

            effect.setFade(leftFade, rightFade, 48);
        }

        // ── Керування курсором ───────────────────────────────────────────
        _onMotion(actor, event) {
            const g = this._geometry;
            if (!g || !g.scrollingEnabled) return Clutter.EVENT_PROPAGATE;

            const [stageX, stageY] = event.get_coords();
            const [success, localX] = this.transform_stage_point(
                stageX,
                stageY,
            );
            if (!success) return Clutter.EVENT_PROPAGATE;

            const ratio = g.viewportWidth > 0 ? localX / g.viewportWidth : 0;
            g.setMouseRatio(ratio);

            return Clutter.EVENT_PROPAGATE;
        }

        // ── Проксі публічних методів, якими користуються інші менеджери ─
        _redisplay(...args) {
            this._content._redisplay(...args);
            if (this._geometry) this._geometry.scheduleMeasure();
        }

        _updateAllIndicators() {
            this._content._updateAllIndicators();
        }

        setReactive(reactive) {
            this._content.setReactive(reactive);
        }

        _onDestroy() {
            // Скасовуємо відкладений початковий вимір viewport.
            if (this._initialMeasureId) {
                GLib.source_remove(this._initialMeasureId);
                this._initialMeasureId = 0;
            }
            this._signals.forEach(({ obj, id }) => {
                safeDisconnectSignal(obj, id);
            });
            this._signals = [];

            if (this._geometry) {
                this._geometry.destroy();
                this._geometry = null;
            }

            this._extension = null;
            this._settings = null;
        }

        destroy() {
            if (this._content) {
                this._signals = this._signals.filter(({ obj, id }) => {
                    if (obj === this._content) {
                        safeDisconnectSignal(obj, id);
                        return false;
                    }
                    return true;
                });
            }

            if (this._fadeEffect) {
                try {
                    this._fadeEffect.stopAnimation();
                    this.remove_effect(this._fadeEffect);
                } catch (e) {}

                this._fadeEffect = null;
            }

            if (this._content && !this._content.is_finalized?.()) {
                try {
                    this._content.destroy();
                } catch (e) {}
            }

            this._content = null;

            super.destroy();
        }
    },
);

export { Taskbar, TaskbarContent };
