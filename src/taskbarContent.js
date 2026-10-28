import Shell from "gi://Shell";
import * as AppFavorites from "resource:///org/gnome/shell/ui/appFavorites.js";
import St from "gi://St";
import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import { TaskbarDNDManager } from "./DND.js";
import { TaskbarButtonManager } from "./taskbarButton.js";

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

const TaskbarContent = GObject.registerClass(
    class TaskbarContent extends St.BoxLayout {
        _init(extension, settings) {
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
            this._buttons = new Map();
            this._temporaryFavorites = new Set();
            this._dragActive = false;
            this._pendingRedisplay = false;

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
            this._buttonManager = new TaskbarButtonManager(
                this,
                this._settings,
                this._dnd,
            );

            this._delegate = {
                handleDragOver: (source, actor, x, y, time) => {
                    return this._dnd.handleDragOver(x);
                },
                acceptDrop: (source, actor, x, y, time) => {
                    return this._dnd.acceptDrop(x, (appId, index) => {
                        let appFavorites = AppFavorites.getAppFavorites();
                        if (appFavorites) {
                            if (appFavorites.isFavorite(appId)) {
                                // Переставляємо улюблену програму одним оновленням.
                                // moveFavoriteToPos() спочатку видаляє програму,
                                // а потім додає її знову, спричиняючи два оновлення GNOME.
                                const key = appFavorites.FAVORITE_APPS_KEY;
                                const favoriteIds =
                                    global.settings.get_strv(key);
                                const oldIndex = favoriteIds.indexOf(appId);

                                if (oldIndex !== -1) {
                                    favoriteIds.splice(oldIndex, 1);

                                    const newIndex = Math.max(
                                        0,
                                        Math.min(index, favoriteIds.length),
                                    );

                                    favoriteIds.splice(newIndex, 0, appId);

                                    global.settings.set_strv(key, favoriteIds);
                                }
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
                        this._buttonManager.updateState(btn, app);
                    }
                } else {
                    // Програми немає, створюємо нову кнопку та запускаємо анімацію появи
                    let btn = this._buttonManager.create(app);
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

        _updateButtonSizes() {
            this._buttonManager.updateButtonSizes();
        }

        setReactive(reactive) {
            this.set_reactive(reactive);
        }

        destroy() {
            this._buttonManager.destroy();
            this._buttonManager = null;

            // 1. Знищуємо менеджер Drag & Drop.
            if (this._dnd) {
                try {
                    this._dnd.destroy();
                } catch (e) {}
                this._dnd = null;
            }

            // 2. Відключаємо сигнал зміни обраного.
            if (this._favsChangedId) {
                safeDisconnectSignal(
                    AppFavorites.getAppFavorites(),
                    this._favsChangedId,
                );
                this._favsChangedId = null;
            }

            // 3. Відключаємо сигнал зміни фокусованого вікна.
            if (this._focusSig) {
                safeDisconnectSignal(global.display, this._focusSig);
                this._focusSig = null;
            }

            // 4. Відключаємо сигнал зміни стану програм.
            if (this._appStateChangedId) {
                safeDisconnectSignal(
                    Shell.AppSystem.get_default(),
                    this._appStateChangedId,
                );
                this._appStateChangedId = null;
            }

            // 5. Відключаємо сигнали налаштувань.
            if (this._settingsSignals) {
                for (const id of this._settingsSignals) {
                    safeDisconnectSignal(this._settings, id);
                }
                this._settingsSignals = null;
            }

            // 6. Видаляємо тимчасові закладки цього таскбару.
            const appFavorites = AppFavorites.getAppFavorites();

            if (this._temporaryFavorites) {
                if (appFavorites) {
                    for (const appId of this._temporaryFavorites) {
                        try {
                            if (appFavorites.isFavorite(appId)) {
                                appFavorites.removeFavorite(appId);
                            }
                        } catch (e) {
                            // Ігноруємо помилки під час завершення роботи.
                        }
                    }
                }

                this._temporaryFavorites.clear();
            }

            // 7. Скасовуємо анімації та знищуємо дочірні актори.
            const children = this.get_children() || [];

            for (const child of children) {
                if (!child || child.is_finalized?.()) continue;

                try {
                    child.remove_all_transitions();
                    child.destroy();
                } catch (e) {}
            }

            // 8. Звільняємо посилання на знищені кнопки.
            this._buttons.clear();

            // 9. Від'єднуємо callback-функції від батьківського Taskbar.
            this._onDragActiveChange = null;
            this._onButtonAdded = null;

            // 10. Скидаємо внутрішній стан.
            this._dragActive = false;
            this._pendingRedisplay = false;

            // 11. Звільняємо посилання на розширення та налаштування.
            this._extension = null;
            this._settings = null;

            super.destroy();
        }
    },
);

export { TaskbarContent };
