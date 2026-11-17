import * as Main from "resource:///org/gnome/shell/ui/main.js";
import St from "gi://St";
import GLib from "gi://GLib";

export class SystemUIManager {
    constructor(extension) {
        this._extension = extension;
        this._solidStyleSignalId = 0;
        this._originalUpdateSolidStyle = null;
        this._originalChangeMenu = null;
    }

    _preventSolidStyle() {
        const panel = Main.panel;
        if (!panel) return;

        if (
            typeof panel._updateSolidStyle === "function" &&
            !this._originalUpdateSolidStyle
        ) {
            this._originalUpdateSolidStyle =
                panel._updateSolidStyle.bind(panel);
            panel._updateSolidStyle = () => {};
        }

        if (!this._solidStyleSignalId) {
            this._solidStyleSignalId = panel.connect(
                "notify::style-class",
                () => {
                    this._stripSolidClasses();
                },
            );
        }

        this._stripSolidClasses();
    }

    _stripSolidClasses() {
        const panel = Main.panel;
        if (!panel) return;

        panel.remove_style_class_name("solid");
        panel.remove_style_class_name("panel-solid");
    }

    _restoreSolidStyle() {
        const panel = Main.panel;
        if (!panel) return;

        if (this._solidStyleSignalId) {
            panel.disconnect(this._solidStyleSignalId);
            this._solidStyleSignalId = 0;
        }

        if (this._originalUpdateSolidStyle) {
            panel._updateSolidStyle = this._originalUpdateSolidStyle;
            this._originalUpdateSolidStyle = null;
            panel._updateSolidStyle();
        }
    }

    _patchMenuHoverSwitch() {
        const menuManager = Main.panel?.menuManager;
        if (!menuManager || typeof menuManager._changeMenu !== "function")
            return;
        if (this._originalChangeMenu) return;

        this._originalChangeMenu = menuManager._changeMenu.bind(menuManager);

        menuManager._changeMenu = (newMenu) => {
            const enabled = this._extension._settings
                ? this._extension._settings.get_boolean(
                      "menu-hover-switch-enabled",
                  )
                : true;

            if (!enabled) return;

            return this._originalChangeMenu(newMenu);
        };
    }

    _restoreMenuHoverSwitch() {
        const menuManager = Main.panel?.menuManager;

        if (menuManager && this._originalChangeMenu) {
            menuManager._changeMenu = this._originalChangeMenu;
        }

        this._originalChangeMenu = null;
    }

    _hideDash(hide) {
        let dash = Main.overview.dash;
        if (dash) {
            if (hide) {
                dash.hide();
                dash.opacity = 0;
            } else {
                dash.show();
                dash.opacity = 255;
            }
        }
    }

    _toggleActivities(show) {
        if (show === undefined && this._extension._settings) {
            show = this._extension._settings.get_boolean(
                "show-activities-button",
            );
        }

        const act = Main.panel.statusArea["activities"];
        if (
            act &&
            typeof act.is_finalized === "function" &&
            !act.is_finalized()
        ) {
            if (show) {
                act.show();
            } else {
                act.hide();
            }
        }

        if (this._extension._zones) {
            Object.values(this._extension._zones)
                .flat()
                .forEach((zone) => {
                    if (
                        zone &&
                        typeof zone.is_finalized === "function" &&
                        !zone.is_finalized()
                    ) {
                        zone.get_children().forEach((child) => {
                            if (
                                !child ||
                                (typeof child.is_finalized === "function" &&
                                    child.is_finalized())
                            ) {
                                return;
                            }

                            if (
                                child === act ||
                                (child.constructor &&
                                    child.constructor.name &&
                                    child.constructor.name.includes(
                                        "Activities",
                                    )) ||
                                (child.name &&
                                    child.name.includes("activities"))
                            ) {
                                if (show) {
                                    child.show();
                                } else {
                                    child.hide();
                                }
                            }
                        });
                    }
                });
        }
    }

    _handleOverviewToggle(isShowing) {
        if (!Main.panel) return;

        const hidePanelInOverview = this._extension._settings.get_boolean(
            "hide-panel-in-overview",
        );

        if (isShowing) {
            Main.panel.visible = !hidePanelInOverview;
        } else {
            const autoHideManager = this._extension._autoHideManager;
            autoHideManager?._beginOverviewExit();
            Main.panel.visible = !autoHideManager?._autohideEnabled;
        }

        if (this._extension._taskbar)
            this._extension._taskbar.setReactive(!isShowing);

        if (isShowing) {
            this._hideDash(this._extension._settings.get_boolean("hide-dash"));
            if (this._extension._layoutManager?._applyPanelWidth) {
                this._extension._layoutManager._applyPanelWidth();
            }
        } else {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                if (this._extension._settings) {
                    this._extension._lifecycleManager?._applyAll();
                }

                const autoHideManager = this._extension._autoHideManager;
                if (autoHideManager?._overviewExitPending) {
                    autoHideManager._finishOverviewExit();
                } else if (Main.panel) {
                    Main.panel.visible = true;
                }

                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _forceHideIndicator(indicatorName, forceHide) {
        const item = Main.panel.statusArea[indicatorName];
        if (!item || !item.container) return;

        if (forceHide) {
            item.container.hide();
            item.container._panelModifierForceHidden = true;

            if (!item.container._customPanelOriginalShow) {
                item.container._customPanelOriginalShow = item.container.show;
                item.container.show = () => {};
            }
        } else {
            item.container._panelModifierForceHidden = false;

            if (item.container._customPanelOriginalShow) {
                item.container.show = item.container._customPanelOriginalShow;
                delete item.container._customPanelOriginalShow;
                item.container.show();
            }
        }
    }

    _movePanel(position) {
        if (!Main.panel || !Main.layoutManager.panelBox) return;
        const monitor = Main.layoutManager.primaryMonitor;
        const isBottom = position === "bottom";
        const panelHeight =
            Main.layoutManager.panelBox.height ||
            this._extension._settings.get_int("panel-height");
        Main.layoutManager.panelBox.translation_y = isBottom
            ? monitor.height - panelHeight
            : 0;

        const side = isBottom ? St.Side.BOTTOM : St.Side.TOP;
        Object.values(Main.panel.statusArea).forEach((i) => {
            if (i?.menu?.setArrowSide) i.menu.setArrowSide(side);
            else if (i?.menu?._boxPointer?.setArrowSide)
                i.menu._boxPointer.setArrowSide(side);
        });
    }
}
