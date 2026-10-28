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

    // =====================================================
    // Заборона "solid" фону панелі
    // =====================================================

    /**
     * GNOME Shell автоматично додає клас 'solid'/'panel-solid' до Main.panel
     * (через Panel._updateSolidStyle), коли є максимізоване або повноекранне
     * вікно. Щоб панель завжди лишалась прозорою, ми:
     *   1. Замінюємо _updateSolidStyle на no-op (перехоплює майбутні виклики).
     *   2. Слухаємо 'notify::style-class' і негайно знімаємо класи, якщо
     *      хтось їх все-одно додав (захист від сторонніх розширень).
     */
    _preventSolidStyle() {
        const panel = Main.panel;
        if (!panel) return;

        // 1. Перехоплення _updateSolidStyle
        if (
            typeof panel._updateSolidStyle === "function" &&
            !this._originalUpdateSolidStyle
        ) {
            this._originalUpdateSolidStyle =
                panel._updateSolidStyle.bind(panel);
            panel._updateSolidStyle = () => {
                // no-op: не даємо Shell зробити панель "solid"
            };
        }

        // 2. Реактивне зняття класів через сигнал
        if (!this._solidStyleSignalId) {
            this._solidStyleSignalId = panel.connect(
                "notify::style-class",
                () => {
                    this._stripSolidClasses();
                },
            );
        }

        // Знімаємо класи одразу, якщо вони вже є
        this._stripSolidClasses();
    }

    _stripSolidClasses() {
        const panel = Main.panel;
        if (!panel) return;

        // Знімаємо без умов — якщо класу нема, GNOME Shell ігнорує виклик
        panel.remove_style_class_name("solid");
        panel.remove_style_class_name("panel-solid");
    }

    /**
     * Відновлення оригінальної поведінки при disable().
     */
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
            // Відновлюємо оригінальний стан — нехай Shell сам вирішить
            panel._updateSolidStyle();
        }
    }

    // =====================================================
    // Автоперемикання між відкритими меню при наведенні
    // =====================================================

    /**
     * GNOME Shell (Main.panel.menuManager, PopupMenuManager) автоматично
     * перемикає активне меню, коли курсор наводиться на сусідню кнопку
     * статус-області, поки інше меню вже відкрите (наприклад: розкладка
     * клавіатури -> Quick Settings), а також коли фокус клавіатури
     * переходить на інше джерело меню. В обох випадках виклик іде через
     * this._changeMenu(newMenu).
     *
     * ВАЖЛИВО: обробник наведення (_onCapturedEvent) підключається до
     * сигналу captured-event через .bind(this) ще під час addMenu() —
     * тобто задовго до enable() цього розширення для вже існуючих кнопок
     * панелі (клавіатура, Quick Settings тощо). Патчити сам
     * _onCapturedEvent заднім числом марно: вже підключений обробник
     * назавжди посилається на стару функцію. Але всередині нього виклик
     * this._changeMenu(...) — це динамічний пошук властивості на
     * екземплярі під час кожного виклику, тож перевизначення саме
     * _changeMenu спрацьовує коректно незалежно від того, коли сигнали
     * було підключено.
     */
    _patchMenuHoverSwitch() {
        const menuManager = Main.panel?.menuManager;
        if (!menuManager || typeof menuManager._changeMenu !== "function")
            return;
        if (this._originalChangeMenu) return; // вже пропатчено

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

    /**
     * Відновлення оригінальної поведінки при disable().
     */
    _restoreMenuHoverSwitch() {
        const menuManager = Main.panel?.menuManager;

        if (menuManager && this._originalChangeMenu) {
            menuManager._changeMenu = this._originalChangeMenu;
        }

        this._originalChangeMenu = null;
    }

    // =====================================================
    // Dash / Activities
    // =====================================================

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
        // Якщо параметр не передано, беремо його з налаштувань
        if (show === undefined && this._extension._settings) {
            show = this._extension._settings.get_boolean(
                "show-activities-button",
            );
        }

        // 1. Керування стандартним об'єктом у statusArea
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

        // 2. Пошук кнопки всередині наших кастомних зон
        // Це важливо, оскільки _refreshLayout переміщує кнопку в одну з зон
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
                            // КРИТИЧНО ВАЖЛИВО: пропускаємо знищені актори від вимкнених розширень
                            if (
                                !child ||
                                (typeof child.is_finalized === "function" &&
                                    child.is_finalized())
                            ) {
                                return;
                            }

                            // Безпечно перевіряємо властивості тільки живих акторів
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

    // =====================================================
    // Overview toggle
    // =====================================================

    _handleOverviewToggle(isShowing) {
        if (!Main.panel) return;

        Main.panel.visible = !(
            isShowing &&
            this._extension._settings.get_boolean("hide-panel-in-overview")
        );

        if (this._extension._taskbar)
            this._extension._taskbar.setReactive(!isShowing);

        if (isShowing) {
            this._hideDash(this._extension._settings.get_boolean("hide-dash"));
            if (this._extension._layoutManager?._applyPanelWidth) {
                this._extension._layoutManager._applyPanelWidth();
            }
        } else {
            // Коли ми виходимо з огляду, чекаємо черги (idle),
            // щоб GNOME встиг скинути свої стилі, а потім зверху накладаємо наші.
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                if (this._extension._settings) {
                    // Правильне делегування через lifecycleManager після рефакторингу
                    this._extension._lifecycleManager?._applyAll();
                }
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    // =====================================================
    // Indicator visibility
    // =====================================================

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

    // =====================================================
    // Panel position
    // =====================================================

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
