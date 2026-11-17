import * as Main from "resource:///org/gnome/shell/ui/main.js";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";

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

const PANEL_BOXES = ["_leftBox", "_centerBox", "_rightBox"];

export class ElementRouter {
    constructor(extension) {
        this._extension = extension;

        this._identityMap = new Map();

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
        } catch (e) {}
        return this._getDefaultOrder();
    }

    _registerIdentity(actor, id) {
        if (!actor) return;
        this._identityMap.set(actor, id);
        if (actor.container && actor.container !== actor) {
            this._identityMap.set(actor.container, id);
        }
    }

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

    _getIdForChild(child, boxName) {
        if (!child) return null;

        if (this._identityMap.size === 0) this._buildIdentityMap();

        let id = this._identityMap.get(child);
        if (id) return id;

        this._buildIdentityMap();
        id = this._identityMap.get(child);
        if (id) return id;

        if (boxName === "_leftBox") return ID_LEFT_EXT;
        if (boxName === "_centerBox") return ID_LEFT_CENTER_EXT;
        return ID_RIGHT_EXT;
    }

    _extractOriginalChildren() {
        this._extension._originalChildren.clear();

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

                    this._positionHints.set(child, idx);

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
                } catch (e) {}
            });

            this._extension._originalChildren.set(boxName, validChildren);
        });
    }

    _interceptPanelMethods() {
        this._extension._originalBoxMethods = {};

        PANEL_BOXES.forEach((boxName) => {
            const box = Main.panel[boxName];
            if (!box || box.is_finalized?.()) return;

            this._extension._originalBoxMethods[boxName] = {
                add_child: box.add_child,
                insert_child_at_index: box.insert_child_at_index,
                remove_child: box.remove_child,
            };

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

            box.insert_child_at_index = (child, index) => {
                if (child === this._extension._masterContainer) {
                    this._extension._originalBoxMethods[
                        boxName
                    ].insert_child_at_index.call(box, child, index);
                    return;
                }
                this._reparentChildSync(child, boxName, index);
            };

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

    _isActorAlive(actor) {
        try {
            return (
                !!actor &&
                !actor._panelModifierIsDestroyed &&
                !(
                    typeof actor.is_finalized === "function" &&
                    actor.is_finalized()
                )
            );
        } catch (e) {
            return false;
        }
    }

    _isZoneAlive(zone) {
        try {
            return (
                !!zone &&
                !(
                    typeof zone.is_finalized === "function" &&
                    zone.is_finalized()
                )
            );
        } catch (e) {
            return false;
        }
    }

    _getOrderBucket(index) {
        if (index >= 0 && index < 3)
            return {
                section: "left",
                offset: index,
                align: Clutter.ActorAlign.START,
            };
        if (index >= 3 && index < 6)
            return {
                section: "center",
                offset: index - 3,
                align: Clutter.ActorAlign.CENTER,
            };
        return {
            section: "right",
            offset: Math.min(2, Math.max(0, index - 6)),
            align: Clutter.ActorAlign.END,
        };
    }

    _getHorizontalAlignForOrderIndex(index) {
        return this._getOrderBucket(index).align;
    }

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

            const targetZone = this._determineTargetZone(
                child,
                originalBoxName,
            );

            if (targetZone) {
                const currentParent = child.get_parent();
                if (currentParent === targetZone) return;

                if (currentParent) {
                    currentParent.remove_child(child);
                }
                this._insertIntoZoneOrdered(
                    targetZone,
                    child,
                    this._positionHints.get(child),
                );

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
        } catch (e) {}
    }

    _zoneForIndex(index) {
        const bucket = this._getOrderBucket(index);
        const section = this._extension._zones?.[bucket.section];
        return (
            section?.[bucket.offset] ??
            (this._extension._zones?.right?.[2] ||
                this._extension._zones?.right?.[0])
        );
    }

    _getZoneForOrderBucket(index, total) {
        if (!total) return this._extension._zones.right[0];

        if (index < total / 3) return this._extension._zones.left[0];
        if (index < (total / 3) * 2) return this._extension._zones.center[0];
        return this._extension._zones.right[0];
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
        const zone = this._getZoneForOrderBucket(index, order.length);

        if (zone && this._isActorAlive(child)) {
            const currentParent = child.get_parent();
            if (currentParent) {
                currentParent.remove_child(child);
            }
            zone.add_child(child);
        }
    }

    _redistributeChildren() {
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

    _refreshLayout() {
        if (this._refreshScheduled) return;
        this._refreshScheduled = true;

        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._refreshScheduled = false;
            this._doRefreshLayout();
            return GLib.SOURCE_REMOVE;
        });
    }

    _getOrderIndex(order, itemId) {
        const index = order.indexOf(itemId);
        return index === -1 ? 99 : index;
    }

    _collectPlacementItems(order) {
        const itemsToPlace = [];

        if (this._isActorAlive(this._extension._taskbar)) {
            itemsToPlace.push({
                obj: this._extension._taskbar,
                id: ID_TASKBAR,
            });
        }

        this._extension._originalChildren.forEach((children, boxName) => {
            for (let i = children.length - 1; i >= 0; i--) {
                const child = children[i];
                if (!this._isActorAlive(child)) {
                    children.splice(i, 1);
                    continue;
                }

                if (child === this._extension._masterContainer) continue;

                if (!itemsToPlace.some((item) => item.obj === child)) {
                    itemsToPlace.push({
                        obj: child,
                        id: this._getIdForChild(child, boxName),
                    });
                }
            }
        });

        itemsToPlace.sort((a, b) => {
            const indexA = this._getOrderIndex(order, a.id);
            const indexB = this._getOrderIndex(order, b.id);
            if (indexA !== indexB) return indexA - indexB;

            const hintA = this._positionHints.get(a.obj);
            const hintB = this._positionHints.get(b.obj);
            if (hintA !== undefined && hintB !== undefined)
                return hintA - hintB;
            return 0;
        });

        return itemsToPlace;
    }

    _applyPlacementItem(item, order) {
        const index = order.indexOf(item.id);
        const targetZone = this._zoneForIndex(index);
        const isValidZone = this._isZoneAlive(targetZone);
        const isValidObj = this._isActorAlive(item.obj);

        if (!isValidZone || !isValidObj) return;

        try {
            item.obj.x_expand = false;
            item.obj.y_expand = true;
            item.obj.y_align = Clutter.ActorAlign.FILL;
            item.obj.x_align = this._getHorizontalAlignForOrderIndex(index);

            const currentParent = item.obj.get_parent();
            if (currentParent) currentParent.remove_child(item.obj);
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
        } catch (e) {}
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
                if (!this._isZoneAlive(zone)) return;

                const children = [...zone.get_children()];
                children.forEach((c) => {
                    try {
                        if (this._isActorAlive(c)) zone.remove_child(c);
                    } catch (e) {}
                });
            });
        });

        const itemsToPlace = this._collectPlacementItems(order);
        itemsToPlace.forEach((item) => this._applyPlacementItem(item, order));

        if (this._extension._layoutManager?._applyPanelWidth)
            this._extension._layoutManager._applyPanelWidth();
    }
}
