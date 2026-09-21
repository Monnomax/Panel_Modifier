import * as Main from "resource:///org/gnome/shell/ui/main.js";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";

// Логічні ID елементів панелі — саме ці рядки зберігаються у GSettings
// ("panel-element-order") і саме на них посилається вкладка "Порядок
// елементів" у вікні налаштувань.
const ID_ACTIVITIES = "activities";
const ID_TASKBAR = "taskbar";
const ID_LEFT_EXT = "left_extensions";
const ID_LEFT_CENTER_EXT = "left_center_extensions";
const ID_KEYBOARD = "keyboard";
const ID_RIGHT_CENTER_EXT = "right_center_extensions";
const ID_RIGHT_EXT = "right_extensions";
const ID_SYSTEM_MENU = "systemMenu";
const ID_DATE_MENU = "dateMenu";

const DEFAULT_ORDER = [
    ID_ACTIVITIES,
    ID_TASKBAR,
    ID_LEFT_EXT,
    ID_LEFT_CENTER_EXT,
    ID_KEYBOARD,
    ID_RIGHT_CENTER_EXT,
    ID_RIGHT_EXT,
    ID_SYSTEM_MENU,
    ID_DATE_MENU,
];

// Три стандартні бокси, з яких складається панель GNOME Shell.
// Це структурний факт про будову панелі (не спосіб розпізнавання
// елементів), тож використовується лише для обходу/перехоплення самих
// боксів, а не для визначення "хто є хто" всередині них.
const PANEL_BOXES = ["_leftBox", "_centerBox", "_rightBox"];

export class ElementRouter {
    constructor(extension) {
        this._extension = extension;

        // Явне зіставлення "реальний Clutter-актор GNOME -> логічний ID".
        // Це єдине джерело істини щодо того, "хто є хто" на панелі.
        // Будується _buildIdentityMap() і більше ніде не вгадується.
        this._identityMap = new Map();

        // Позиція, яку GNOME (або саме розширення) вказало для актора
        // всередині його оригінального боксу через
        // insert_child_at_index(child, index). Використовується, щоб
        // зберігати правильний ліво-правий порядок елементів усередині
        // однієї зони (наприклад, кількох іконок сторонніх розширень
        // у "Інші ліві розширення"), а не порядок їхнього фактичного
        // додавання під час виконання.
        this._positionHints = new WeakMap();
    }

    _getDefaultOrder() {
        return [...DEFAULT_ORDER];
    }

    _getOrder() {
        try {
            const order = JSON.parse(
                this._extension._settings.get_string("panel-element-order"),
            );
            if (Array.isArray(order) && order.length) return order;
        } catch (e) {
            console.error(
                "Panel Modifier: Failed to parse panel-element-order, using default",
                e,
            );
        }
        return this._getDefaultOrder();
    }

    // =====================================================
    // Явне зіставлення відомих системних акторів на логічні ID
    // =====================================================

    /**
     * Реєструє актор (і, за наявності, його `.container`) під заданим
     * логічним ID. У деяких версіях GNOME саме `.container`, а не сам
     * об'єкт-індикатор, є тим Clutter-актором, що реально додається в
     * бокс панелі — тож реєструємо обидва посилання на всякий випадок.
     */
    _registerIdentity(actor, id) {
        if (!actor) return;
        this._identityMap.set(actor, id);
        if (actor.container && actor.container !== actor) {
            this._identityMap.set(actor.container, id);
        }
    }

    /**
     * Будує (або перебудовує) карту "актор -> ID" на основі РЕАЛЬНИХ,
     * живих об'єктів GNOME Shell (Main.panel.statusArea,
     * Main.panel._activitiesButton, наш власний taskbar).
     *
     * Це єдине місце в класі, де відбувається розпізнавання системних
     * елементів панелі. Раніше воно робилося за допомогою toString()
     * та/або "хто в якому боксі лежав" — обидва способи ненадійні:
     * назва ролі системного меню відрізняється між версіями GNOME
     * ('quickSettings' у 45+, 'aggregateMenu' у старіших), а toString()
     * GObject-акторів не гарантує наявності назви класу. Через це
     * елементи, які не вдавалося точно розпізнати, автоматично
     * потрапляли у "загальні" зони (left_center_extensions/
     * right_extensions), навіть якщо насправді це були годинник чи
     * системне меню.
     */
    _buildIdentityMap() {
        this._identityMap.clear();

        const statusArea = Main.panel.statusArea || {};

        this._registerIdentity(
            statusArea.activities || Main.panel._activitiesButton,
            ID_ACTIVITIES,
        );
        this._registerIdentity(statusArea.dateMenu, ID_DATE_MENU);
        this._registerIdentity(statusArea.keyboard, ID_KEYBOARD);
        this._registerIdentity(
            statusArea.quickSettings ||
                statusArea.aggregateMenu ||
                statusArea.systemMenu,
            ID_SYSTEM_MENU,
        );

        if (this._extension._taskbar) {
            this._registerIdentity(this._extension._taskbar, ID_TASKBAR);
        }
    }

    /**
     * Повертає логічний ID для актора.
     * 1. Якщо актор явно зареєстрований у карті ідентичності — точний ID.
     * 2. Якщо карта ще не містить цей актор (наприклад, він з'явився вже
     *    ПІСЛЯ побудови карти — так буває з таскбаром, який створюється
     *    пізніше за перший виклик _extractOriginalChildren) — перебудовуємо
     *    карту один раз і пробуємо ще.
     * 3. Якщо актор і після цього лишається нерозпізнаним — це вже НЕ
     *    спроба вгадати, чим він є (такої спроби більше немає в коді
     *    взагалі), а свідомий дефолт для акторів, яких у принципі не
     *    може бути в карті ідентичності — іконок сторонніх розширень.
     *    GNOME не дає їм жодної постійної "ролі", тож єдиний розумний
     *    орієнтир для них — секція панелі, куди їх спочатку додав сам
     *    GNOME Shell.
     */
    _getIdForChild(child, boxName) {
        if (!child) return null;

        if (this._identityMap.size === 0) this._buildIdentityMap();

        let id = this._identityMap.get(child);
        if (id) return id;

        this._buildIdentityMap();
        id = this._identityMap.get(child);
        if (id) return id;

        // Сторонній/невідомий актор — немає кращого орієнтира, ніж
        // секція панелі, у якій GNOME Shell його розмістив.
        if (boxName === "_leftBox") return ID_LEFT_EXT;
        if (boxName === "_centerBox") return ID_LEFT_CENTER_EXT;
        return ID_RIGHT_EXT;
    }

    // =====================================================
    // Вилучення оригінальних дітей стандартних боксів панелі
    // =====================================================

    _extractOriginalChildren() {
        this._extension._originalChildren.clear();

        // Панель уже повністю зібрана GNOME Shell на цьому етапі —
        // саме час зафіксувати "хто є хто".
        this._buildIdentityMap();

        PANEL_BOXES.forEach((boxName) => {
            const box = Main.panel[boxName];
            if (
                !box ||
                (typeof box.is_finalized === "function" && box.is_finalized())
            )
                return;

            const children = [...box.get_children()];
            const validChildren = [];

            children.forEach((child, idx) => {
                if (child === this._extension._masterContainer) return;

                try {
                    child._dtpOriginalParent = box;
                    child._dtpOriginalBoxName = boxName;

                    // Фіксуємо позицію "як є"
                    this._positionHints.set(child, idx);

                    // Підписка на знищення, щоб ніколи не рухати мертві актори
                    try {
                        if (!child._panelModifierDestroyId) {
                            child._panelModifierDestroyId = child.connect(
                                "destroy",
                                () => {
                                    child._panelModifierIsDestroyed = true;
                                    if (
                                        this._extension &&
                                        this._extension._originalChildren &&
                                        this._extension._originalChildren.has(
                                            boxName,
                                        )
                                    ) {
                                        const arr =
                                            this._extension._originalChildren.get(
                                                boxName,
                                            );
                                        const i = arr.indexOf(child);
                                        if (i > -1) arr.splice(i, 1);
                                    }
                                },
                            );
                        }
                    } catch (e) {}

                    if (child.get_parent() === box) {
                        box.remove_child(child);
                    }
                    validChildren.push(child);
                } catch (e) {
                    console.warn(`Error removing child from ${boxName}:`, e);
                }
            });

            this._extension._originalChildren.set(boxName, validChildren);
        });
    }

    _interceptPanelMethods() {
        this._extension._originalBoxMethods = {};

        PANEL_BOXES.forEach((boxName) => {
            const box = Main.panel[boxName];
            if (!box || box.is_finalized?.()) return;

            // Зберігаємо оригінальні системні методи GNOME
            this._extension._originalBoxMethods[boxName] = {
                add_child: box.add_child,
                insert_child_at_index: box.insert_child_at_index,
                remove_child: box.remove_child,
            };

            // 1. Перехоплюємо додавання (без явної позиції — елемент іде в кінець)
            box.add_child = (child) => {
                if (child === this._extension._masterContainer) {
                    this._extension._originalBoxMethods[boxName].add_child.call(
                        box,
                        child,
                    );
                    return;
                }
                this._reparentChildSync(child, boxName);
            };

            // 2. Перехоплюємо вставку за індексом — GNOME (або саме
            // розширення) передає тут бажану позицію серед сусідів,
            // тож обов'язково прокидаємо її далі, а не відкидаємо.
            box.insert_child_at_index = (child, index) => {
                if (child === this._extension._masterContainer) {
                    this._extension._originalBoxMethods[
                        boxName
                    ].insert_child_at_index.call(box, child, index);
                    return;
                }
                this._reparentChildSync(child, boxName, index);
            };

            // 3. Перехоплюємо видалення (з очищенням кешу)
            box.remove_child = (child) => {
                if (child === this._extension._masterContainer) {
                    this._extension._originalBoxMethods[
                        boxName
                    ].remove_child.call(box, child);
                    return;
                }

                if (this._extension._originalChildren.has(boxName)) {
                    const childrenArray =
                        this._extension._originalChildren.get(boxName);
                    const index = childrenArray.indexOf(child);
                    if (index > -1) {
                        childrenArray.splice(index, 1);
                    }
                }

                const parent = child.get_parent();

                if (parent === box) {
                    this._extension._originalBoxMethods[
                        boxName
                    ].remove_child.call(box, child);
                } else if (parent) {
                    parent.remove_child(child);
                }
            };
        });
    }

    _restorePanelMethods() {
        if (!this._extension._originalBoxMethods) return;

        Object.keys(this._extension._originalBoxMethods).forEach((boxName) => {
            const box = Main.panel[boxName];
            if (box && !box.is_finalized?.()) {
                // Безпечне скидання методів замість оператора `delete`
                if (this._extension._originalBoxMethods[boxName].add_child) {
                    box.add_child =
                        this._extension._originalBoxMethods[boxName].add_child;
                }
                if (
                    this._extension._originalBoxMethods[boxName]
                        .insert_child_at_index
                ) {
                    box.insert_child_at_index =
                        this._extension._originalBoxMethods[
                            boxName
                        ].insert_child_at_index;
                }
                if (this._extension._originalBoxMethods[boxName].remove_child) {
                    box.remove_child =
                        this._extension._originalBoxMethods[
                            boxName
                        ].remove_child;
                }
            }
        });

        this._extension._originalBoxMethods = null;
    }

    /**
     * Вставляє актор у зону з урахуванням позиційної підказки (`hint`),
     * а не завжди в кінець. Порівнює hint нового елемента з hint-ами вже
     * присутніх у зоні сусідів і знаходить правильне місце вставки.
     * Якщо підказки немає — просто додає в кінець (поведінка за
     * замовчуванням для звичайного add_child без явної позиції).
     */
    _insertIntoZoneOrdered(zone, child, hint) {
        if (hint === undefined || hint === null) {
            zone.add_child(child);
            return;
        }

        const siblings = zone.get_children();
        let insertIndex = siblings.length;

        for (let i = 0; i < siblings.length; i++) {
            const siblingHint = this._positionHints.get(siblings[i]);
            if (siblingHint === undefined) continue;
            if (hint < siblingHint) {
                insertIndex = i;
                break;
            }
        }

        zone.insert_child_at_index(child, insertIndex);
    }

    _reparentChildSync(child, originalBoxName, hint) {
        try {
            if (!child || child._panelModifierIsDestroyed) return;

            if (hint !== undefined && hint !== null) {
                this._positionHints.set(child, hint);
            }

            // 1. Отримуємо зону безпосередньо (це вже готовий Clutter-актор)
            const targetZone = this._determineTargetZone(
                child,
                originalBoxName,
            );

            if (targetZone) {
                const currentParent = child.get_parent();
                if (currentParent === targetZone) return; // Вже на своєму місці

                if (currentParent) {
                    currentParent.remove_child(child);
                }
                this._insertIntoZoneOrdered(
                    targetZone,
                    child,
                    this._positionHints.get(child),
                );

                // 2. Додаємо до _originalChildren
                const isSelfManaged = child === this._extension._taskbar;

                if (
                    originalBoxName &&
                    !isSelfManaged &&
                    this._extension._originalChildren.has(originalBoxName)
                ) {
                    const childrenArray =
                        this._extension._originalChildren.get(originalBoxName);
                    if (!childrenArray.includes(child)) {
                        childrenArray.push(child);
                    }
                }

                // Підписка на знищення для нових елементів
                try {
                    if (!isSelfManaged && !child._panelModifierDestroyId) {
                        child._panelModifierDestroyId = child.connect(
                            "destroy",
                            () => {
                                child._panelModifierIsDestroyed = true;
                                if (
                                    originalBoxName &&
                                    this._extension &&
                                    this._extension._originalChildren &&
                                    this._extension._originalChildren.has(
                                        originalBoxName,
                                    )
                                ) {
                                    const arr =
                                        this._extension._originalChildren.get(
                                            originalBoxName,
                                        );
                                    const i = arr.indexOf(child);
                                    if (i > -1) arr.splice(i, 1);
                                }
                            },
                        );
                    }
                } catch (e) {}

                // Синхронізація видимості з безпечним відстеженням
                if (!child._hasPanelModifierVisibilitySignal) {
                    child._hasPanelModifierVisibilitySignal = true;

                    if (
                        child.visible === false &&
                        typeof child.hide === "function"
                    ) {
                        child.hide();
                        if (
                            typeof this._extension._layoutManager
                                ?._applyPanelWidth === "function"
                        ) {
                            this._extension._layoutManager._applyPanelWidth();
                        }
                    }

                    const sigId = child.connect("notify::visible", () => {
                        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                            if (
                                typeof this._extension._layoutManager
                                    ?._applyPanelWidth === "function"
                            ) {
                                this._extension._layoutManager._applyPanelWidth();
                            }
                            return GLib.SOURCE_REMOVE;
                        });
                    });
                    child._visibilitySignalId = sigId;
                }
            }
        } catch (e) {
            console.warn(`Error reparenting child: ${e.message}`);
        }
    }

    /**
     * Перетворює позицію (0-8) у порядку елементів на конкретну зону.
     * 0-2 -> ліва секція, 3-5 -> центральна, 6-8 -> права.
     */
    _zoneForIndex(index) {
        if (index >= 0 && index < 3) return this._extension._zones.left[index];
        if (index >= 3 && index < 6)
            return this._extension._zones.center[index - 3];
        if (index >= 6 && index < 9)
            return this._extension._zones.right[index - 6];
        return (
            this._extension._zones.right[2] || this._extension._zones.right[0]
        );
    }

    _determineTargetZone(child, originalBoxName) {
        const id = this._getIdForChild(child, originalBoxName);
        const order = this._getOrder();
        const index = order.indexOf(id);

        if (index === -1) {
            return (
                this._extension._zones.right[2] ||
                this._extension._zones.right[0]
            );
        }

        return this._zoneForIndex(index);
    }

    _findChildById(id) {
        if (this._identityMap.size === 0) this._buildIdentityMap();

        for (const [actor, actorId] of this._identityMap) {
            if (actorId === id) return actor;
        }

        // Сторонній/невідомий елемент — шукаємо серед збережених оригінальних дітей
        for (const [boxName, children] of this._extension._originalChildren) {
            const found = children.find((child) => {
                if (!child || child.is_finalized?.()) return false;
                return this._getIdForChild(child, boxName) === id;
            });
            if (found) return found;
        }

        return null;
    }

    _reparentToCorrectZone(child, id, order) {
        const index = order.indexOf(id);
        const total = order.length;

        let zone;
        if (index < total / 3) {
            zone = this._extension._zones.left[0];
        } else if (index < (total / 3) * 2) {
            zone = this._extension._zones.center[0];
        } else {
            zone = this._extension._zones.right[0];
        }

        if (zone && child && !child.is_finalized?.()) {
            const currentParent = child.get_parent();
            if (currentParent) {
                currentParent.remove_child(child);
            }
            zone.add_child(child);
        }
    }

    _redistributeChildren() {
        console.log("Starting child redistribution...");
        this._extension._originalChildren.forEach((children, boxName) => {
            children.forEach((child, idx) => {
                if (child && !child.is_finalized?.()) {
                    this._reparentChildSync(
                        child,
                        boxName,
                        this._positionHints.get(child) ?? idx,
                    );
                }
            });
        });
    }

    /**
     * Публічна точка входу. Не виконує важку роботу одразу, а планує її
     * на наступний idle-цикл головного циклу GLib.
     *
     * Чому це важливо: _doRefreshLayout() масово переносить (remove_child/
     * add_child) ВСІ елементи панелі одразу. Якщо робити це синхронно
     * прямо всередині обробника сигналу GSettings (changed::panel-element-
     * order) — а саме так це раніше й викликалось з extension.js — операція
     * може співпасти з моментом, коли Mutter/Clutter перебуває всередині
     * власного цикла allocate/paint, або коли один з акторів (наприклад,
     * іконка стороннього індикатора) саме перебуває у перехідному стані
     * знищення. Маніпуляція деревом акторів у такий момент — це вже не
     * "зловима" JS-помилка, а потенційний збій нативного коду. А оскільки
     * під Wayland gnome-shell одночасно є і оболонкою, і композитором,
     * такий збій обвалює всю графічну сесію (чорний екран -> LogIn),
     * а не просто розширення.
     *
     * Перенесення роботи на idle-цикл (за межі стека сигналу GSettings) —
     * стандартний спосіб уникнути цього класу проблем. Додатково: якщо
     * налаштування змінюються швидко кілька разів поспіль (наприклад,
     * при перетягуванні рядків у списку), кілька викликів _refreshLayout()
     * "склеюються" в один реальний перерахунок замість N важких перебудов
     * підряд.
     */
    _refreshLayout() {
        if (this._refreshScheduled) return;
        this._refreshScheduled = true;

        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._refreshScheduled = false;
            this._doRefreshLayout();
            return GLib.SOURCE_REMOVE;
        });
    }

    _doRefreshLayout() {
        if (!this._extension._settings || !this._extension._masterContainer)
            return;
        if (
            !this._extension._zones ||
            !this._extension._zones.left[0] ||
            !this._extension._zones.center[0] ||
            !this._extension._zones.right[0]
        )
            return;

        this._buildIdentityMap();

        const order = this._getOrder();

        ["left", "center", "right"].forEach((s) => {
            this._extension._zones[s].forEach((zone) => {
                let isValidZone = true;
                try {
                    if (
                        !zone ||
                        (typeof zone.is_finalized === "function" &&
                            zone.is_finalized())
                    )
                        isValidZone = false;
                } catch (e) {
                    isValidZone = false;
                }
                if (!isValidZone) return;

                const children = [...zone.get_children()];
                children.forEach((c) => {
                    try {
                        let isValid = true;
                        try {
                            if (
                                !c ||
                                c._panelModifierIsDestroyed ||
                                (typeof c.is_finalized === "function" &&
                                    c.is_finalized())
                            )
                                isValid = false;
                        } catch (e) {
                            isValid = false;
                        }

                        if (isValid) zone.remove_child(c);
                    } catch (e) {
                        console.warn(
                            `Panel Modifier: Failed to clear child during refresh: ${e.message}`,
                        );
                    }
                });
            });
        });

        let itemsToPlace = [];

        let isTaskbarValid = true;
        try {
            if (
                !this._extension._taskbar ||
                (typeof this._extension._taskbar.is_finalized === "function" &&
                    this._extension._taskbar.is_finalized())
            ) {
                isTaskbarValid = false;
            }
        } catch (e) {
            isTaskbarValid = false;
        }

        if (isTaskbarValid) {
            itemsToPlace.push({
                obj: this._extension._taskbar,
                id: ID_TASKBAR,
            });
        }

        this._extension._originalChildren.forEach((children, boxName) => {
            // Фільтруємо масив з кінця, щоб безпечно видаляти мертві об'єкти
            for (let i = children.length - 1; i >= 0; i--) {
                const child = children[i];
                let isValid = true;
                try {
                    if (
                        !child ||
                        child._panelModifierIsDestroyed ||
                        (typeof child.is_finalized === "function" &&
                            child.is_finalized())
                    ) {
                        isValid = false;
                    }
                } catch (e) {
                    isValid = false;
                }

                if (!isValid) {
                    children.splice(i, 1);
                    continue;
                }

                if (child !== this._extension._masterContainer) {
                    if (!itemsToPlace.some((item) => item.obj === child)) {
                        const id = this._getIdForChild(child, boxName);
                        itemsToPlace.push({ obj: child, id: id });
                    }
                }
            }
        });

        itemsToPlace.sort((a, b) => {
            let indexA = order.indexOf(a.id);
            let indexB = order.indexOf(b.id);
            if (indexA === -1) indexA = 99;
            if (indexB === -1) indexB = 99;
            if (indexA !== indexB) return indexA - indexB;

            const hintA = this._positionHints.get(a.obj);
            const hintB = this._positionHints.get(b.obj);
            if (hintA !== undefined && hintB !== undefined)
                return hintA - hintB;
            return 0;
        });

        itemsToPlace.forEach((item) => {
            const index = order.indexOf(item.id);
            const targetZone = this._zoneForIndex(index);

            let isValidZone = true;
            try {
                if (
                    !targetZone ||
                    (typeof targetZone.is_finalized === "function" &&
                        targetZone.is_finalized())
                )
                    isValidZone = false;
            } catch (e) {
                isValidZone = false;
            }

            let isValidObj = true;
            try {
                if (
                    !item.obj ||
                    item.obj._panelModifierIsDestroyed ||
                    (typeof item.obj.is_finalized === "function" &&
                        item.obj.is_finalized())
                )
                    isValidObj = false;
            } catch (e) {
                isValidObj = false;
            }

            if (isValidZone && isValidObj) {
                try {
                    item.obj.x_expand = false;
                    item.obj.y_expand = true;
                    item.obj.y_align = Clutter.ActorAlign.FILL;

                    if (index >= 0 && index < 3) {
                        item.obj.x_align = Clutter.ActorAlign.START;
                    } else if (index >= 3 && index < 6) {
                        item.obj.x_align = Clutter.ActorAlign.CENTER;
                    } else {
                        item.obj.x_align = Clutter.ActorAlign.END;
                    }

                    const currentParent = item.obj.get_parent();
                    if (currentParent) {
                        currentParent.remove_child(item.obj);
                    }
                    targetZone.add_child(item.obj);

                    if (item.id === ID_ACTIVITIES) {
                        const showBtn = this._extension._settings.get_boolean(
                            "show-activities-button",
                        );
                        showBtn ? item.obj.show() : item.obj.hide();
                    } else if (item.obj._panelModifierForceHidden) {
                        item.obj.hide();
                    } else {
                        item.obj.show();
                    }
                } catch (e) {
                    console.warn(
                        `Panel Modifier: Could not move item ${item.id}: ${e.message}`,
                    );
                }
            }
        });

        if (this._extension._layoutManager?._applyPanelWidth)
            this._extension._layoutManager._applyPanelWidth();
    }
}
