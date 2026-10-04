import Shell from "gi://Shell";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as AppFavorites from "resource:///org/gnome/shell/ui/appFavorites.js";
import St from "gi://St";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import { TaskbarDNDManager } from "./DND.js";
import * as AppMenu from "resource:///org/gnome/shell/ui/appMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import GObject from "gi://GObject";
import { WindowIndicators } from "./indicators.js";
import { Tooltip } from "./tooltip.js";
import { WindowPreview } from "./preview.js";
import { AnimationManager } from "./animationManager.js";
import { TaskbarGeometryManager } from "./geometryManager.js";

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
            console.warn(`Panel Modifier: Failed to disconnect signal: ${message}`);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// TaskbarContent — сам ряд кнопок таскбару (колишній клас Taskbar).
// Це "природний" контент, ширина якого дорівнює сумі ширин усіх іконок.
// Він більше НЕ додається напряму до панелі — його огортає TaskBarViewport
// (клас `Taskbar`, що експортується нижче), який відповідає за обрізання,
// плавне зміщення курсором та сумісність із Dynamic Panel Width.
// ═══════════════════════════════════════════════════════════════════════
const TaskbarContent = GObject.registerClass(
    class TaskbarContent extends St.BoxLayout {
        _init(extension, settings, extensionPath) {
            super._init({
                name: "customTaskbarContent",
                style_class: "panel-taskbar",
                reactive: true,
                x_expand: false,
                x_align: Clutter.ActorAlign.CENTER,
            });
            if (typeof this.set_spacing === "function") {
                this.set_spacing(0);
            }

            this._extension = extension;
            this._settings = settings;
            this._extensionPath = extensionPath;
            this._buttons = new Map();
            this._temporaryFavorites = new Set();
            this._dragActive = false;
            this._pendingRedisplay = false;
            this._menuManager = new PopupMenu.PopupMenuManager(Main.panel);

            // Хук, який виставляє TaskBarViewport (див. клас Taskbar нижче),
            // щоб призупиняти автоскрол під час перетягування іконки.
            this._onDragActiveChange = null;

            // Хук: викликається щоразу, коли в контенті з'являється НОВА
            // кнопка (наприклад, щойно запущена непришпинена програма),
            // щоб TaskBarViewport міг плавно проскролити її у видиму
            // область, якщо вона опинилась за межами обрізаного viewport.
            this._onButtonAdded = null;
            this._dnd = new TaskbarDNDManager(this, {
                onActiveChange: (active) => {
                    this._dragActive = active;
                    if (typeof this._onDragActiveChange === "function")
                        this._onDragActiveChange(active);

                    if (!this._dragActive && this._pendingRedisplay) {
                        this._pendingRedisplay = false;
                        this._redisplay();
                    }
                },
            });

            this._delegate = {
                handleDragOver: (source, actor, x, y, time) => {
                    return this._dnd.handleDragOver(x);
                },
                acceptDrop: (source, actor, x, y, time) => {
                    return this._dnd.acceptDrop(x, (appId, index) => {
                        let appFavorites = AppFavorites.getAppFavorites();
                        if (appFavorites) {
                            if (appFavorites.isFavorite(appId)) {
                                appFavorites.moveFavoriteToPos(appId, index);
                            } else {
                                this._temporaryFavorites.add(appId);
                                appFavorites.addFavoriteAtPos(appId, index);
                            }
                        }
                    });
                },
            };

            this._favsChangedId = AppFavorites.getAppFavorites().connect(
                "changed",
                this._onFavoritesChanged.bind(this),
            );

            this._appStateChangedId = Shell.AppSystem.get_default().connect(
                "app-state-changed",
                this._onAppStateChanged.bind(this),
            );

            // Виправлення продуктивності: зміна фокусу більше не викликає повне перемальовування
            this._focusSig = global.display.connect(
                "notify::focus-window",
                this._updateFocusState.bind(this),
            );

            // Слухачі налаштувань для динамічного оновлення розмірів та відступів
            this._settingsSignals = [];
            const resizeSettings = [
                "icon-padding-vertical",
                "icon-padding-horizontal",
                "panel-height",
            ];
            for (const key of resizeSettings) {
                this._settingsSignals.push(
                    this._settings.connect(
                        `changed::${key}`,
                        this._updateButtonSizes.bind(this),
                    ),
                );
            }

            this._redisplay();
        }

        _onAppStateChanged(appSystem, app) {
            let appFavorites = AppFavorites.getAppFavorites();
            if (!appFavorites) return;

            let runningApps = appSystem.get_running();
            let runningIds = new Set(runningApps.map((a) => a.get_id()));

            this._temporaryFavorites.forEach((appId) => {
                if (!runningIds.has(appId)) {
                    try {
                        appFavorites.removeFavorite(appId);
                    } catch (e) {}
                    this._temporaryFavorites.delete(appId);
                }
            });

            this._redisplay();
            this._extension?._layoutManager?._updatePanelAdaptiveColor?.();
        }

        _onFavoritesChanged() {
            if (this._dragActive) {
                this._pendingRedisplay = true;
                return;
            }

            this._redisplay();
        }

        _updateAllIndicators() {
            if (!this._buttons) return;
            for (let [app, btn] of this._buttons.entries()) {
                if (
                    btn &&
                    btn._indicators &&
                    typeof btn._indicators.update === "function"
                ) {
                    btn._indicators.update(app);
                }
            }
        }

        _updateFocusState() {
            let tracker = Shell.WindowTracker.get_default();
            let focusWindow = global.display.focus_window;
            let activeApp = focusWindow
                ? tracker.get_window_app(focusWindow)
                : null;

            for (let [app, button] of this._buttons.entries()) {
                if (!button || button.is_finalized?.()) continue;

                button.remove_style_class_name("focused-app");
                button.remove_style_class_name("running-app");

                if (app === activeApp) {
                    button.add_style_class_name("focused-app");
                } else if (app.get_state?.() === Shell.AppState.RUNNING) {
                    button.add_style_class_name("running-app");
                }
            }

            this._updateAllIndicators();
            this._extension?._layoutManager?._updatePanelAdaptiveColor?.();
        }

        _redisplay() {
            if (this._dragActive) {
                this._pendingRedisplay = true;
                return;
            }

            let appFavoritesInstance = AppFavorites.getAppFavorites();
            let favs = appFavoritesInstance
                ? appFavoritesInstance.getFavorites()
                : [];
            let runningApps = Shell.AppSystem.get_default().get_running() || [];
            let allApps = [...favs];

            for (let app of runningApps) {
                if (!allApps.includes(app)) allApps.push(app);
            }

            // 1. Знаходимо та анімовано видаляємо програми, яких більше немає в списку
            for (let [app, btn] of this._buttons.entries()) {
                if (!allApps.includes(app)) {
                    this._removeAnimatedButton(btn);
                    this._buttons.delete(app);
                }
            }

            // 2. Проходимо по актуальному списку: оновлюємо індекси існуючих або додаємо нові
            allApps.forEach((app, index) => {
                if (this._buttons.has(app)) {
                    // Кнопка вже існує, просто гарантуємо її правильну позицію в контейнері
                    let btn = this._buttons.get(app);
                    if (btn && !btn.is_finalized?.()) {
                        const currentIndex = this.get_children().indexOf(btn);

                        if (index >= 0 && currentIndex !== index) {
                            this.set_child_at_index(btn, index);
                        }
                        // Переконуємось, що для існуючої кнопки інстанс прев'ю
                        // або тултіпа відповідає поточному стану додатку.
                        try {
                            if (app.get_state?.() === Shell.AppState.RUNNING) {
                                if (!btn._previewInstance) {
                                    if (
                                        btn._tooltipInstance &&
                                        typeof btn._tooltipInstance.destroy ===
                                            "function"
                                    ) {
                                        try {
                                            btn._tooltipInstance.destroy();
                                        } catch (e) {}
                                        btn._tooltipInstance = null;
                                    }
                                    try {
                                        btn._previewInstance =
                                            new WindowPreview(
                                                btn,
                                                app,
                                                this._settings,
                                            );
                                    } catch (e) {}
                                }
                            } else {
                                if (!btn._tooltipInstance) {
                                    if (
                                        btn._previewInstance &&
                                        typeof btn._previewInstance.destroy ===
                                            "function"
                                    ) {
                                        try {
                                            btn._previewInstance.destroy();
                                        } catch (e) {}
                                        btn._previewInstance = null;
                                    }
                                    try {
                                        btn._tooltipInstance = new Tooltip(
                                            btn,
                                            app.get_name(),
                                            this._settings,
                                        );
                                    } catch (e) {}
                                }
                            }
                        } catch (e) {}
                    }
                } else {
                    // Програми немає, створюємо нову кнопку та запускаємо анімацію появи
                    let btn = this._createButton(app);
                    this._buttons.set(app, btn);
                    this._addAnimatedButton(btn, index);
                }
            });

            this._updateFocusState();
        }

        _removeAnimatedButton(button) {
            if (!button || button.is_finalized?.()) return;

            // Фіксуємо поточну ширину, щоб уникнути стрибків через конфлікт із CSS
            button.width = button.width;
            button.remove_all_transitions();

            button.ease({
                width: 0,
                opacity: 0,
                duration: 250,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (!button.is_finalized?.()) {
                        if (button.get_parent() === this) {
                            this.remove_child(button);
                        }
                        button.destroy();
                    }
                },
            });
        }

        _addAnimatedButton(button, index = -1) {
            button.opacity = 0;
            button.width = 0; // Початкова нульова ширина

            if (index >= 0) {
                this.insert_child_at_index(button, index);
            } else {
                this.add_child(button);
            }

            const target = button._targetWidth || 48; // Беремо збережену ширину або fallback

            button.ease({
                width: target,
                opacity: 255,
                duration: 250,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (!button.is_finalized?.()) {
                        // Передаємо контроль назад CSS
                        button.width = -1;
                    }
                },
            });

            // Повідомляємо TaskBarViewport про нову кнопку — якщо вона
            // опиниться поза видимою (обрізаною) частиною viewport, він
            // плавно проскролить її у видиму область.
            if (typeof this._onButtonAdded === "function") {
                this._onButtonAdded(button);
            }
        }

        _createTaskbarIcon(app, iconSize) {
            const textureSize = Math.max(1, Math.round(iconSize * 1.5));
            const icon = app.create_icon_texture(textureSize);
            if (icon) icon.set_size(iconSize, iconSize);
            return icon;
        }

        _createButton(app) {
            const computedSize =
                typeof this._computedIconSize === "number"
                    ? this._computedIconSize
                    : null;
            const verticalPad = Math.max(
                0,
                this._settings.get_int("icon-padding-vertical"),
            );
            const horizontalPad = Math.max(
                0,
                this._settings.get_int("icon-padding-horizontal"),
            );
            const topPad = verticalPad;
            const rightPad = horizontalPad;
            const bottomPad = verticalPad;
            const leftPad = horizontalPad;
            const panelHeight = Math.max(
                1,
                this._settings.get_int("panel-height"),
            );

            const availableIconHeight = Math.max(
                1,
                panelHeight - topPad - bottomPad,
            );
            const iconSize =
                computedSize !== null
                    ? Math.min(computedSize, availableIconHeight)
                    : availableIconHeight;
            const radius = 0;
            const btnWidth = Math.max(1, iconSize + leftPad + rightPad);

            const btnStyle =
                `border-radius: ${radius}px; padding: 0; margin: 0; ` +
                `width: ${btnWidth}px; height: ${panelHeight}px;`;

            let btn = new St.Button({
                style_class: "panel-button",
                reactive: true,
                can_focus: true,
                track_hover: true,
            });

            // Зберігаємо цільову ширину для коректної анімації розширення
            btn._targetWidth = btnWidth;

            let btnContent = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                x_expand: true,
                y_expand: true,
            });
            btn.set_child(btnContent);
            btn._btnContent = btnContent;

            let icon = this._createTaskbarIcon(app, iconSize);
            if (icon) {
                icon.add_style_class_name("taskbar-app-icon");
                icon.set_margin_top(topPad);
                icon.set_margin_right(rightPad);
                icon.set_margin_bottom(bottomPad);
                icon.set_margin_left(leftPad);
                btnContent.add_child(icon);
                btn._icon = icon;
            }

            let indicatorContainer = new St.BoxLayout({
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.END,
                x_expand: true,
                y_expand: true,
                reactive: false,
            });
            btnContent.add_child(indicatorContainer);

            let indicators = new WindowIndicators(
                this._settings,
                indicatorContainer,
            );

            btn.set_pivot_point(0.5, 0.5);
            btn.set_clip_to_allocation(false);

            const applyTransform = () => {
                if (btn.is_finalized?.()) return;

                const hoverAnimIndex = this._settings.get_int("icon-animation");
                const pressAnimIndex = this._settings.get_int(
                    "icon-press-animation",
                );
                const hoverAnimData = AnimationManager.getAnimation(
                    hoverAnimIndex,
                    this._settings,
                    "icon",
                );
                const pressAnimData = AnimationManager.getAnimation(
                    pressAnimIndex,
                    this._settings,
                    "icon",
                );
                const hoverScale =
                    this._settings.get_double("icon-scale-hover");
                const pressScale =
                    this._settings.get_double("icon-scale-press");
                const hoverShowDur = this._settings.get_int(
                    "icon-hover-show-speed",
                );
                const hoverHideDur = this._settings.get_int(
                    "icon-hover-hide-speed",
                );
                const pressShowDur = this._settings.get_int(
                    "icon-press-show-speed",
                );
                const pressHideDur = this._settings.get_int(
                    "icon-press-hide-speed",
                );

                if (btn.pressed) {
                    btn._wasPressed = true;
                    btn.ease({
                        scale_x: pressScale,
                        scale_y: pressScale,
                        duration: pressShowDur,
                        mode: pressAnimData.showMode,
                    });
                } else if (btn.hover) {
                    btn.ease({
                        scale_x: hoverScale,
                        scale_y: hoverScale,
                        duration: hoverShowDur,
                        mode: hoverAnimData.showMode,
                    });
                } else {
                    const wasPressed = btn._wasPressed;
                    btn._wasPressed = false;

                    if (wasPressed) {
                        btn.ease({
                            scale_x: 1.0,
                            scale_y: 1.0,
                            duration: pressHideDur,
                            mode: pressAnimData.showMode,
                        });
                    } else {
                        btn.ease({
                            scale_x: 1.0,
                            scale_y: 1.0,
                            duration: hoverHideDur,
                            mode: hoverAnimData.showMode,
                        });
                    }
                }
            };

            btn.connect("notify::hover", applyTransform);
            btn.connect("notify::pressed", applyTransform);

            btn._indicators = indicators;
            btn._updateIndicators = () => {
                if (!btn.is_finalized?.()) indicators.update(app);
            };

            let appSyncId = app.connect(
                "windows-changed",
                btn._updateIndicators,
            );

            // Зберігаємо інстанси прив'язано до кнопки, щоб можна було
            // міняти їх при зміні стану додатку (наприклад, коли закладка
            // стає запущеною — показувати прев'ю замість тултіпа).
            btn._previewInstance = null;
            btn._tooltipInstance = null;

            if (app.get_state() === Shell.AppState.RUNNING) {
                btn._previewInstance = new WindowPreview(
                    btn,
                    app,
                    this._settings,
                );
            } else {
                btn._tooltipInstance = new Tooltip(
                    btn,
                    app.get_name(),
                    this._settings,
                );
            }

            btn.connect("destroy", () => {
                if (appSyncId) {
                    try {
                        app.disconnect(appSyncId);
                    } catch (e) {}
                    appSyncId = 0;
                }
                if (
                    btn._previewInstance &&
                    typeof btn._previewInstance.destroy === "function"
                ) {
                    try {
                        btn._previewInstance.destroy();
                    } catch (e) {}
                    btn._previewInstance = null;
                }
                if (
                    btn._tooltipInstance &&
                    typeof btn._tooltipInstance.destroy === "function"
                ) {
                    try {
                        btn._tooltipInstance.destroy();
                    } catch (e) {}
                    btn._tooltipInstance = null;
                }
            });

            indicators.update(app);
            btn.set_style(btnStyle);

            this._dnd.makeDraggable(btn, app, iconSize);

            btn.connect("clicked", () => {
                const windows = app.get_windows() || [];
                if (windows.length === 0) return app.activate();
                const focusedWindow = global.display.focus_window;
                if (windows.some((w) => w === focusedWindow))
                    focusedWindow.minimize();
                else app.activate();
            });

            btn.connect("button-press-event", (actor, event) => {
                const button = event.get_button();
                if (button === 2) {
                    app.request_quit();
                    return Clutter.EVENT_STOP;
                } else if (button === 3) {
                    this._openMenu(btn, app);
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            return btn;
        }

        _updateButtonSizes() {
            const computedSize =
                typeof this._computedIconSize === "number"
                    ? this._computedIconSize
                    : null;
            const verticalPad = Math.max(
                0,
                this._settings.get_int("icon-padding-vertical"),
            );
            const horizontalPad = Math.max(
                0,
                this._settings.get_int("icon-padding-horizontal"),
            );
            const topPad = verticalPad;
            const rightPad = horizontalPad;
            const bottomPad = verticalPad;
            const leftPad = horizontalPad;
            const panelHeight = Math.max(
                1,
                this._settings.get_int("panel-height"),
            );

            const availableIconHeight = Math.max(
                1,
                panelHeight - topPad - bottomPad,
            );
            const iconSize =
                computedSize !== null
                    ? Math.min(computedSize, availableIconHeight)
                    : availableIconHeight;
            const radius = 0;
            const btnWidth = Math.max(1, iconSize + leftPad + rightPad);

            const btnStyle =
                `border-radius: ${radius}px; padding: 0; margin: 0; ` +
                `width: ${btnWidth}px; height: ${panelHeight}px;`;

            for (let [app, btn] of this._buttons.entries()) {
                if (!btn || btn.is_finalized?.()) continue;

                btn._targetWidth = btnWidth;
                btn.set_style(btnStyle);

                if (btn._icon) {
                    btn._icon.destroy();
                    btn._icon = null;
                }

                if (btn._btnContent) {
                    let icon = this._createTaskbarIcon(app, iconSize);
                    if (icon) {
                        icon.add_style_class_name("taskbar-app-icon");
                        icon.set_margin_top(topPad);
                        icon.set_margin_right(rightPad);
                        icon.set_margin_bottom(bottomPad);
                        icon.set_margin_left(leftPad);

                        // Додаємо на індекс 0, щоб іконка знаходилась під індикаторами
                        btn._btnContent.insert_child_at_index(icon, 0);
                        btn._icon = icon;
                    }
                }
            }
        }

        _openMenu(iconActor, app) {
            if (this._menu) {
                try {
                    this._menu.destroy();
                } catch (e) {}
                this._menu = null;
            }

            const isBottom =
                this._settings.get_string("panel-position") === "bottom";
            const side = isBottom ? St.Side.BOTTOM : St.Side.TOP;

            this._menu = new AppMenu.AppMenu(iconActor, side, {
                favoritesSection: true,
                showProxy: true,
            });

            this._menu.setApp(app);

            // Додаємо актор меню, якщо він присутній — різні версії AppMenu
            // можуть надавати різні властивості (actor, menu.actor тощо).
            try {
                const menuActor =
                    this._menu.actor ||
                    (this._menu.menu && this._menu.menu.actor) ||
                    null;

                if (menuActor) {
                    Main.layoutManager.uiGroup.add_child(menuActor);
                }
            } catch (e) {
                // Якщо додавання актора не вдалось — дозволяємо menuManager
                // взяти на себе управління додаванням.
            }

            try {
                Main.panel.menuManager.addMenu(this._menu);
            } catch (e) {
                // Ігнорувати — в різних GNOME API поведінка може відрізнятись.
            }

            try {
                this._menu.open(true);
            } catch (e) {
                logError(e);
            }
        }

        setReactive(reactive) {
            this.set_reactive(reactive);
        }

        destroy() {
            if (this._menu) {
                try {
                    this._menu.destroy();
                } catch (e) {}
                this._menu = null;
            }

            if (this._dnd) {
                if (typeof this._dnd.destroy === "function") {
                    try {
                        this._dnd.destroy();
                    } catch (e) {}
                }
                this._dnd = null;
            }

            this._menuManager = null;

            // Безпечне відключення глобальних сигналів за допомогою try-catch
            if (this._favsChangedId) {
                const appFavs = AppFavorites.getAppFavorites();
                safeDisconnectSignal(appFavs, this._favsChangedId);
                this._favsChangedId = null;
            }

            if (this._focusSig) {
                safeDisconnectSignal(global.display, this._focusSig);
                this._focusSig = null;
            }

            if (this._appStateChangedId) {
                const appSys = Shell.AppSystem.get_default();
                safeDisconnectSignal(appSys, this._appStateChangedId);
                this._appStateChangedId = null;
            }

            if (this._settingsSignals) {
                for (const id of this._settingsSignals) {
                    safeDisconnectSignal(this._settings, id);
                }
                this._settingsSignals = null;
            }

            const children = this.get_children() || [];
            children.forEach((child) => {
                if (child && !child.is_finalized?.()) {
                    child.destroy();
                }
            });

            // clear computed sizing overrides
            this._computedIconSize = null;
            this._computedIconHPad = null;
            this._extension = null;

            super.destroy();
        }

        _applyIconSizing(size, hpad, vpad) {
            try {
                if (typeof size === "number" && size > 0)
                    this._computedIconSize = Math.max(1, Math.floor(size));
                if (typeof hpad === "number" && !isNaN(hpad))
                    this._computedIconHPad = Math.max(0, Math.floor(hpad));
                if (typeof vpad === "number" && !isNaN(vpad))
                    this._computedIconVPad = Math.max(0, Math.floor(vpad));

                this._updateButtonSizes();
            } catch (e) {
                logWarn &&
                    logWarn(`Taskbar: applyIconSizing failed: ${e.message}`);
            }
        }
    },
);

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
        _init(extension, settings, extensionPath) {
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

            this._content = new TaskbarContent(
                extension,
                settings,
                extensionPath,
            );
            this._content._onDragActiveChange = (active) => {
                if (this._geometry) this._geometry.setDragActive(active);
            };
            this._content._onButtonAdded = (button) => {
                if (this._geometry) this._geometry.requestReveal(button);
            };
            this.add_child(this._content);

            this._geometry = new TaskbarGeometryManager(this);

            this._signals = [];
            this._hookGeometrySignals();

            this._motionId = this.connect(
                "motion-event",
                this._onMotion.bind(this),
            );
            this._destroyId = this.connect(
                "destroy",
                this._onDestroy.bind(this),
            );

            // Відкладаємо перший вимір, щоб панель встигла отримати
            // реальну геометрію під час старту.
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                if (this._geometry) this._geometry.measure();
                return GLib.SOURCE_REMOVE;
            });
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
            const horizontalPadding = 10;

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
            const horizontalPadding = 10;
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

        _updateButtonSizes() {
            this._content._updateButtonSizes();
            if (this._geometry) this._geometry.scheduleMeasure();
        }

        setReactive(reactive) {
            this._content.setReactive(reactive);
        }

        _applyIconSizing(size, hpad, vpad) {
            this._content._applyIconSizing(size, hpad, vpad);
            if (this._geometry) this._geometry.scheduleMeasure();
        }

        _onDestroy() {
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
            // Відʼєднуємо сигнали від _content ДО його знищення —
            // інакше _onDestroy зверталась би до вже disposed актора,
            // викликаючи C-рівневий GLib warning навіть попри JS try/catch.
            if (this._content) {
                this._signals = this._signals.filter(({ obj, id }) => {
                    if (obj === this._content) {
                        safeDisconnectSignal(obj, id);
                        return false;
                    }
                    return true;
                });
            }

            // ВАЖЛИВО: TaskbarContent.destroy() відключає власні сигнали
            // (AppFavorites, global.display, Shell.AppSystem, GSettings) і
            // знищує TaskbarDNDManager. Базовий Clutter.Actor.destroy()
            // нижче лише прибирає дерево акторів — він НЕ викликає
            // перевизначений JS-метод destroy() дочірніх акторів, тож без
            // явного виклику тут ці сигнали "протечуть".
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
