import Shell from "gi://Shell";
import St from "gi://St";
import Clutter from "gi://Clutter";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as AppMenu from "resource:///org/gnome/shell/ui/appMenu.js";
import { WindowIndicators } from "./indicators.js";
import { Tooltip } from "./tooltip.js";
import { WindowPreview } from "./preview.js";
import { AnimationManager } from "./animationManager.js";

export class TaskbarButtonManager {
    constructor(content, settings, dnd) {
        this._content = content;
        this._settings = settings;
        this._dnd = dnd;
        this._menu = null;
    }

    _createTaskbarIcon(app, iconSize) {
        const textureSize = Math.max(1, Math.round(iconSize * 1.5));
        const icon = app.create_icon_texture(textureSize);
        if (icon) icon.set_size(iconSize, iconSize);
        return icon;
    }

    _getButtonMetrics() {
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

        const iconSize = Math.max(1, panelHeight - topPad - bottomPad);

        const radius = 0;

        const btnWidth = Math.max(1, iconSize + leftPad + rightPad);

        const btnStyle =
            `border-radius: ${radius}px; padding: 0; margin: 0; ` +
            `width: ${btnWidth}px; height: ${panelHeight}px;`;

        return {
            topPad,
            rightPad,
            bottomPad,
            leftPad,
            iconSize,
            btnWidth,
            btnStyle,
        };
    }

    create(app) {
        const {
            topPad,
            rightPad,
            bottomPad,
            leftPad,
            iconSize,
            btnWidth,
            btnStyle,
        } = this._getButtonMetrics();

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

    updateButtonSizes() {
        const {
            topPad,
            rightPad,
            bottomPad,
            leftPad,
            iconSize,
            btnWidth,
            btnStyle,
        } = this._getButtonMetrics();

        for (const [app, btn] of this._content._buttons.entries()) {
            if (!btn || btn.is_finalized?.()) continue;

            btn._targetWidth = btnWidth;
            btn.set_style(btnStyle);

            if (btn._icon) {
                btn._icon.destroy();
                btn._icon = null;
            }

            if (btn._btnContent) {
                const icon = this._createTaskbarIcon(app, iconSize);

                if (icon) {
                    icon.add_style_class_name("taskbar-app-icon");
                    icon.set_margin_top(topPad);
                    icon.set_margin_right(rightPad);
                    icon.set_margin_bottom(bottomPad);
                    icon.set_margin_left(leftPad);

                    // Іконка під індикаторами.
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
            // Ignore menu-opening failures; they are not user-facing errors.
        }
    }

    updateState(btn, app) {
        try {
            if (app.get_state?.() === Shell.AppState.RUNNING) {
                if (!btn._previewInstance) {
                    if (
                        btn._tooltipInstance &&
                        typeof btn._tooltipInstance.destroy === "function"
                    ) {
                        try {
                            btn._tooltipInstance.destroy();
                        } catch (e) {}
                        btn._tooltipInstance = null;
                    }
                    try {
                        btn._previewInstance = new WindowPreview(
                            btn,
                            app,
                            this._settings,
                        );
                    } catch (e) {}
                }
            } else if (!btn._tooltipInstance) {
                if (
                    btn._previewInstance &&
                    typeof btn._previewInstance.destroy === "function"
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
        } catch (e) {}
    }

    destroy() {
        if (this._menu) {
            try {
                this._menu.destroy();
            } catch (e) {}
            this._menu = null;
        }
        this._content = null;
        this._settings = null;
        this._dnd = null;
    }
}
