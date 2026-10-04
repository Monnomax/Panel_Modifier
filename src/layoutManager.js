import * as Main from "resource:///org/gnome/shell/ui/main.js";
import St from "gi://St";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Shell from "gi://Shell";
import { getAverageAppIconColor } from "./indicators.js";

export class LayoutManager {
    constructor(extension) {
        this._extension = extension;
        this._masterContainerBaseStyle = "";
        this._themePanelBaseColor = null;
    }

    _invalidateThemePanelBaseColor() {
        this._themePanelBaseColor = null;
    }

    _getThemePanelBaseColor() {
        if (this._themePanelBaseColor) return this._themePanelBaseColor;

        const probe = new St.Widget({
            name: "panel",
            style_class: "panel-layout-master",
            reactive: false,
            visible: false,
        });

        let color = null;
        try {
            Main.layoutManager.uiGroup.add_child(probe);
            const themeNode = probe.get_theme_node();

            const bg = themeNode.get_background_color();
            if (bg && bg.alpha > 0) {
                color = {
                    red: bg.red,
                    green: bg.green,
                    blue: bg.blue,
                    alpha: bg.alpha,
                };
            } else {
                const shadow =
                    typeof themeNode.get_box_shadow === "function"
                        ? themeNode.get_box_shadow()
                        : null;
                if (shadow && shadow.color && shadow.color.alpha > 0) {
                    color = {
                        red: shadow.color.red,
                        green: shadow.color.green,
                        blue: shadow.color.blue,
                        alpha: shadow.color.alpha,
                    };
                }
            }
        } catch (e) {
            color = null;
        } finally {
            if (probe.get_parent()) probe.get_parent().remove_child(probe);
            probe.destroy();
        }

        if (!color) color = { red: 0, green: 0, blue: 0, alpha: 140 };

        this._themePanelBaseColor = color;
        return color;
    }

    _getAdaptiveOverlayColor() {
        const ext = this._extension;
        const settings = ext?._settings;
        if (!settings) return null;

        if (!settings.get_boolean("panel-adaptive-color-enabled")) return null;

        const intensity = Math.max(
            0,
            Math.min(
                100,
                settings.get_int("panel-adaptive-color-intensity") || 0,
            ),
        );
        if (intensity <= 0) return null;

        const tracker = Shell.WindowTracker.get_default();
        const focusWindow = global.display.focus_window;
        let app = focusWindow ? tracker.get_window_app(focusWindow) : null;

        if (!app) {
            const runningApps =
                Shell.AppSystem.get_default().get_running() || [];
            app = runningApps.length > 0 ? runningApps[0] : null;
        }

        if (!app) return null;

        const iconColor = getAverageAppIconColor(app);
        if (!iconColor) return null;

        const base = this._getThemePanelBaseColor();
        const k = intensity / 100;

        const r = Math.round(base.red * (1 - k) + iconColor.r * k);
        const g = Math.round(base.green * (1 - k) + iconColor.g * k);
        const b = Math.round(base.blue * (1 - k) + iconColor.b * k);
        const a = (base.alpha / 255).toFixed(3);

        return `background-color: rgba(${r}, ${g}, ${b}, ${a});`;
    }

    _composeMasterContainerStyle(baseStyle) {
        const overlayStyle = this._getAdaptiveOverlayColor();
        return overlayStyle ? `${baseStyle}${overlayStyle}` : baseStyle;
    }

    _updatePanelAdaptiveColor() {
        const mc = this._extension?._masterContainer;
        if (!mc || !this._masterContainerBaseStyle) return;
        mc.style = this._composeMasterContainerStyle(
            this._masterContainerBaseStyle,
        );
    }

    _createMasterContainer() {
        this._extension._masterContainer = new St.BoxLayout({
            name: "panel",
            vertical: false,
            x_expand: false,
            y_expand: true,
            style_class: "panel-layout-master",
        });

        this._extension._sections.left = new St.BoxLayout({
            name: "panel-section-left",
            vertical: false,
            x_expand: false,
            x_align: Clutter.ActorAlign.START,
        });

        this._extension._sections.center = new St.BoxLayout({
            name: "panel-section-center",
            vertical: false,
            x_expand: false,
            x_align: Clutter.ActorAlign.CENTER,
        });

        this._extension._sections.right = new St.BoxLayout({
            name: "panel-section-right",
            vertical: false,
            x_expand: false,
            x_align: Clutter.ActorAlign.END,
        });

        this._extension._masterContainer.add_child(
            this._extension._sections.left,
        );
        this._extension._masterContainer.add_child(
            this._extension._sections.center,
        );
        this._extension._masterContainer.add_child(
            this._extension._sections.right,
        );
    }

    _createZones() {
        const sections = ["left", "center", "right"];
        const zones = ["start", "center", "end"];

        sections.forEach((s) => {
            this._extension._zones[s] = zones.map((z) => {
                const zone = new St.BoxLayout({
                    name: `zone-${s}-${z}`,
                    vertical: false,
                    x_expand: true,
                    x_align: Clutter.ActorAlign.CENTER,
                });
                this._extension._sections[s].add_child(zone);
                return zone;
            });
        });
    }

    _replacePanelContent() {
        ["_leftBox", "_centerBox", "_rightBox"].forEach((boxName) => {
            const box = Main.panel[boxName];
            if (box) {
                box.get_children().forEach((c) => {
                    if (c.get_parent() === box) box.remove_child(c);
                });
                box.x_expand = boxName === "_centerBox";
                box.visible = boxName === "_centerBox";
            }
        });

        Main.panel._centerBox.set_x_align(Clutter.ActorAlign.FILL);
        Main.panel._centerBox.set_x_expand(true);

        const existingParent = this._extension._masterContainer.get_parent();
        if (existingParent)
            existingParent.remove_child(this._extension._masterContainer);

        Main.panel._centerBox.add_child(this._extension._masterContainer);
        this._applyPanelWidth();
    }

    _applyPanelWidth() {
        if (
            !this._extension._masterContainer ||
            !this._extension._settings ||
            !Main.panel
        )
            return;

        // ── LAYOUT BATCHING ──────────────────────────────────────────────────────
        // Фаза читання: збираємо ВСІ значення з GSettings та обчислюємо геометрію
        // до першої мутації Clutter-акторів.
        const s = this._extension._settings;

        const getNum = (key) => {
            try {
                const val = s.get_int(key);
                return typeof val === "number" && !isNaN(val) ? val : 0;
            } catch {
                return 0;
            }
        };

        const isDynamic = s.get_boolean("dynamic-panel-width");
        const taskbarPos = s.get_string("taskbar-position") || "center";
        const widthPct = getNum("panel-width") || 100;

        const monitor =
            Main.layoutManager.primaryMonitor ||
            Main.layoutManager.focusMonitor;
        const monitorWidth = monitor ? monitor.width : global.stage.width;

        const h = getNum("panel-height") || 32;
        const mt = getNum("margin-top");
        const mb = getNum("margin-bottom");
        const ml = getNum("margin-left");
        const mr = getNum("margin-right");
        const rtl = getNum("border-radius-top-left");
        const rtr = getNum("border-radius-top-right");
        const rbl = getNum("border-radius-bottom-left");
        const rbr = getNum("border-radius-bottom-right");

        const totalH = h + mt + mb;
        const horizontalPadding = 10;

        // Будуємо рядок стилю повністю в пам'яті — без доступу до акторів
        let styleStr =
            `height:${h}px;` +
            `margin-top:${mt}px;` +
            `margin-bottom:${mb}px;` +
            `margin-left:${ml}px;` +
            `margin-right:${mr}px;` +
            `border-radius:${rtl}px ${rtr}px ${rbr}px ${rbl}px;` +
            `padding: 0px ${horizontalPadding / 2}px;`;

        // Розраховуємо ширину до запису
        let containerXExpand = false;
        let containerXAlign = Clutter.ActorAlign.CENTER;

        if (isDynamic) {
            // Let St use the actor's natural width in dynamic mode.
        } else {
            const availW = Math.max(
                0,
                monitorWidth - ml - mr - horizontalPadding,
            );
            const calcW = Math.floor((availW * widthPct) / 100);
            containerXExpand = true;
            styleStr += `width:${calcW}px;`;
        }

        // Обчислюємо параметри секцій — теж до запису
        const sectionParams = {};
        ["left", "center", "right"].forEach((s) => {
            const params = { yExpand: true };
            if (isDynamic) {
                params.xExpand = false;
                params.xAlign =
                    s === "left"
                        ? Clutter.ActorAlign.START
                        : s === "center"
                          ? Clutter.ActorAlign.CENTER
                          : Clutter.ActorAlign.END;
            } else if (taskbarPos === "left") {
                if (s === "left") {
                    params.xExpand = false;
                    params.xAlign = Clutter.ActorAlign.START;
                }
                if (s === "center") {
                    params.xExpand = false;
                    params.xAlign = Clutter.ActorAlign.START;
                }
                if (s === "right") {
                    params.xExpand = true;
                    params.xAlign = Clutter.ActorAlign.END;
                }
            } else if (taskbarPos === "right") {
                if (s === "left") {
                    params.xExpand = true;
                    params.xAlign = Clutter.ActorAlign.START;
                }
                if (s === "center") {
                    params.xExpand = false;
                    params.xAlign = Clutter.ActorAlign.END;
                }
                if (s === "right") {
                    params.xExpand = false;
                    params.xAlign = Clutter.ActorAlign.END;
                }
            } else {
                if (s === "left") {
                    params.xExpand = true;
                    params.xAlign = Clutter.ActorAlign.START;
                }
                if (s === "center") {
                    params.xExpand = false;
                    params.xAlign = Clutter.ActorAlign.CENTER;
                }
                if (s === "right") {
                    params.xExpand = true;
                    params.xAlign = Clutter.ActorAlign.END;
                }
            }
            sectionParams[s] = params;
        });

        // ── ФАЗА ЗАПИСУ (всі мутації Clutter в одному блоці) ────────────────────
        // Панель — один set_height, один set style
        Main.panel.set_height(totalH);
        Main.panel.remove_style_class_name("panel-solid");
        Main.panel.remove_style_class_name("solid");
        Main.panel.style =
            "background-color: transparent !important; background: none !important; " +
            "border: none !important; box-shadow: none !important;";

        if (Main.layoutManager.panelBox) {
            Main.layoutManager.panelBox.set_height(totalH);
        }

        // masterContainer — один блок властивостей
        const mc = this._extension._masterContainer;
        mc.set_x_expand(containerXExpand);
        mc.set_x_align(containerXAlign);
        this._masterContainerBaseStyle = styleStr;
        mc.style = this._composeMasterContainerStyle(styleStr);

        // Секції — пакетно
        ["left", "center", "right"].forEach((key) => {
            const sec = this._extension._sections[key];
            if (!sec) return;
            const p = sectionParams[key];
            sec.set_y_expand(p.yExpand);
            sec.set_x_expand(p.xExpand);
            sec.set_x_align(p.xAlign);
        });

        // queue_relayout — єдиний виклик після всіх змін
        Main.panel.queue_relayout();
        // ────────────────────────────────────────────────────────────────────────

        // Синхронізуємо бар'єр автоприховування після ререндеру
        GLib.idle_add(GLib.PRIORITY_LOW, () => {
            if (this._extension._autoHideManager?.updateBarrierGeometry) {
                this._extension._autoHideManager.updateBarrierGeometry();
            }
            return GLib.SOURCE_REMOVE;
        });

        // Будь-яка зміна ширини/полів панелі може змінити простір,
        // доступний для TaskBarViewport (Dynamic Panel Width, зміна
        // масштабу, margins тощо) — плануємо перерахунок його геометрії
        // через єдиний координатор GeometryManager.
        if (this._extension._taskbar?._geometry?.scheduleMeasure) {
            this._extension._taskbar._geometry.scheduleMeasure();
        }
    }

    // =====================================================
    // Debug-візуалізація секцій та зон
    // =====================================================

    _updateDebugVisuals() {
        if (!this._extension._settings) return;

        const isDebugEnabled =
            this._extension._settings.get_boolean("layout-debug");

        // Кольори для рамок секцій (ліва, середня, права)
        const sectionColors = {
            left: "rgba(255, 0, 0, 0.75)", // Червоний
            center: "rgba(255, 255, 0, 0.75)", // Жовтий
            right: "rgba(0, 255, 0, 0.75)", // Зелений
        };

        // Кольори для напівпрозорого тла зон всередині секцій
        const zoneColors = {
            left: "rgba(255, 0, 0, 0.25)",
            center: "rgba(255, 255, 0, 0.25)",
            right: "rgba(0, 255, 0, 0.25)",
        };

        // 1. Обробка секцій (masterContainer)
        if (this._extension._sections) {
            Object.entries(this._extension._sections).forEach(
                ([sectionName, sectionActor]) => {
                    if (
                        !sectionActor ||
                        typeof sectionActor.set_style !== "function"
                    )
                        return;

                    if (isDebugEnabled) {
                        sectionActor.set_style(
                            `border: 1px solid ${sectionColors[sectionName]};`,
                        );
                    } else {
                        sectionActor.set_style(null);
                    }
                },
            );
        }

        // 2. Обробка зон всередині секцій
        if (this._extension._zones) {
            Object.entries(this._extension._zones).forEach(
                ([sectionName, zonesArray]) => {
                    if (!zonesArray || !Array.isArray(zonesArray)) return;

                    zonesArray.forEach((zoneActor) => {
                        if (
                            !zoneActor ||
                            typeof zoneActor.set_style !== "function"
                        )
                            return;

                        if (isDebugEnabled) {
                            zoneActor.set_style(
                                `background-color: ${zoneColors[sectionName]}; ` +
                                    `border: 1px dashed ${sectionColors[sectionName]}; ` +
                                    `margin: 1px; ` +
                                    `min-width: 20px;`,
                            );
                        } else {
                            zoneActor.set_style(null);
                        }
                    });
                },
            );
        }
    }

    // =====================================================
    // Відновлення оригінальної розкладки панелі (disable())
    // =====================================================

    _restoreOriginalLayout() {
        const ext = this._extension;
        if (!ext._masterContainer) return;

        ext._originalChildren.forEach((children, boxName) => {
            const box = Main.panel[boxName];
            if (!box) return;

            children.forEach((child) => {
                try {
                    let isValid = false;
                    try {
                        isValid =
                            child &&
                            (typeof child.is_finalized !== "function" ||
                                !child.is_finalized());
                    } catch (e) {
                        isValid = false; // сам виклик is_finalized() на disposed об'єкті теж може кинути
                    }

                    if (isValid) {
                        if (child._visibilitySignalId) {
                            child.disconnect(child._visibilitySignalId);
                            delete child._visibilitySignalId;
                        }
                        delete child._hasPanelModifierVisibilitySignal;

                        const currentParent = child.get_parent();
                        if (currentParent) currentParent.remove_child(child);

                        box.add_child(child);
                        child.show();
                    }
                } catch (e) {
                    console.warn(
                        `Failed to restore child in ${boxName}: ${e.message}`,
                    );
                }
            });
        });

        const masterParent = ext._masterContainer.get_parent();
        if (
            masterParent &&
            ext._masterContainer.get_parent() === masterParent
        ) {
            masterParent.remove_child(ext._masterContainer);
        }

        this._restorePanelHeight();
    }

    // =====================================================
    // Скидання явної висоти панелі (disable())
    // =====================================================

    /**
     * _applyPanelWidth() викликає Main.panel.set_height(totalH) та
     * panelBox.set_height(totalH) — це встановлює ЯВНУ (fixed) висоту
     * актора на рівні Clutter, яка має пріоритет над висотою з теми
     * (#panel { height: ... } у gnome-shell.css). Скидання style/класів
     * у disable() цього не торкається, бо set_height() — не CSS-властивість.
     * Тому потрібно явно повернути висоту до природної (-1), щоб тема
     * знову сама визначала розмір панелі.
     */
    _restorePanelHeight() {
        if (Main.panel) {
            Main.panel.set_height(-1);
        }
        if (Main.layoutManager.panelBox) {
            Main.layoutManager.panelBox.set_height(-1);
        }
    }

    // =====================================================
    // Повне очищення акторів розмітки (disable())
    // =====================================================

    _cleanup() {
        const ext = this._extension;

        const safeDestroy = (actor) => {
            if (!actor) return;
            try {
                const isNotFinalized =
                    typeof actor.is_finalized !== "function" ||
                    !actor.is_finalized();
                if (isNotFinalized) {
                    if (typeof actor.get_children === "function") {
                        actor.get_children().forEach((c) => {
                            if (c.get_parent() === actor) {
                                actor.remove_child(c);
                            }
                        });
                    }
                    actor.destroy();
                }
            } catch (e) {
                console.warn(`Error during safeDestroy: ${e.message}`);
            }
        };

        if (ext._zones) {
            Object.values(ext._zones)
                .flat()
                .forEach((zone) => safeDestroy(zone));
        }

        if (ext._sections) {
            Object.values(ext._sections).forEach((section) =>
                safeDestroy(section),
            );
        }

        if (ext._separators) {
            ext._separators.destroy();
            ext._separators = null;
        }

        safeDestroy(ext._masterContainer);

        ext._masterContainer = null;
        ext._sections = { left: null, center: null, right: null };
        ext._zones = { left: [], center: [], right: [] };
        ext._originalChildren.clear();
    }
}
