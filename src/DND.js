import St from "gi://St";
import * as DND from "resource:///org/gnome/shell/ui/dnd.js";
import * as AppFavorites from "resource:///org/gnome/shell/ui/appFavorites.js";
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";

class TaskbarDNDManager {
    constructor(taskbar, options = {}) {
        this._taskbar = taskbar;

        // Необов'язковий хук: викликається з (true) на початку перетягування
        // і з (false), коли перетягування повністю завершилось (drag-end,
        // drag-cancelled). Використовується TaskBarViewport, щоб тимчасово
        // призупиняти автоматичне зміщення контенту під час DND.
        this._onActiveChange =
            typeof options.onActiveChange === "function"
                ? options.onActiveChange
                : null;

        this._placeholder = new St.Widget({
            style_class: "taskbar-placeholder",
            visible: false,
            opacity: 0, // Початково невидимий
        });

        this._placeholder.set_x_expand(false);
        this._placeholder.set_y_expand(false);

        this._dragApp = null;
        this._dragSourceButton = null;
        this._dragSourceDestroyId = 0;
    }

    /**
     * КРИТИЧНО: Метод для повного очищення менеджера.
     * Має викликатися з taskBar.js у методі destroy().
     */
    destroy() {
        // 1. Зупиняємо всі анімації на плейсхолдері
        if (this._placeholder) {
            this._placeholder.remove_all_transitions();
            if (this._placeholder.get_parent()) {
                this._placeholder.get_parent().remove_child(this._placeholder);
            }
            this._placeholder.destroy();
            this._placeholder = null;
        }

        // 2. Зупиняємо анімації на всіх іконках таскбару
        if (this._taskbar) {
            let children = this._taskbar.get_children();
            children.forEach((child) => {
                child.remove_all_transitions();
                child.set_translation(0, 0, 0);
            });
        }

        // 3. Відключаємо сигнал знищення кнопки, якщо він активний
        if (this._dragSourceButton && this._dragSourceDestroyId) {
            this._dragSourceButton.disconnect(this._dragSourceDestroyId);
            this._dragSourceDestroyId = 0;
        }

        this._clearDragState();
        this._taskbar = null;
    }

    _getChildren() {
        if (!this._taskbar) return [];
        return this._taskbar
            .get_children()
            .filter((c) => c !== this._placeholder && c.visible);
    }

    _calculateDropIndex(localX) {
        let children = this._getChildren();

        for (let i = 0; i < children.length; i++) {
            let child = children[i];
            if (child === this._dragSourceButton) continue;

            let center = child.x + child.width / 2;
            if (localX < center) return i;
        }

        return children.length;
    }

    _ensurePlaceholderSized(button) {
        if (!button || !this._placeholder) return;

        let w = button.width;
        let h = button.height;

        if (w <= 0 || h <= 0) return;

        this._placeholder.set_size(w, h);
        this._placeholder.visible = true;

        if (this._placeholder.opacity === 0) {
            this._placeholder.ease({
                opacity: 150,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    _insertPlaceholder(dropIndex) {
        if (!this._taskbar || !this._placeholder) return;

        let children = this._getChildren();
        if (children.length === 0) return;

        let taskbarChildren = this._taskbar.get_children();
        let currentIndex = taskbarChildren.indexOf(this._placeholder);

        let targetContainerIndex;
        if (dropIndex < children.length) {
            let targetChild = children[dropIndex];
            let targetIndex = taskbarChildren.indexOf(targetChild);
            targetContainerIndex =
                currentIndex < targetIndex ? targetIndex - 1 : targetIndex;
        } else {
            let lastChild = children[children.length - 1];
            let targetIndex = taskbarChildren.indexOf(lastChild);
            targetContainerIndex =
                currentIndex < targetIndex ? targetIndex : targetIndex + 1;
        }

        if (targetContainerIndex === currentIndex) return;

        let movingForward =
            targetContainerIndex > currentIndex && currentIndex !== -1;

        if (this._placeholder.get_parent() !== this._taskbar) {
            this._placeholder.opacity = 0;
            this._taskbar.insert_child_at_index(
                this._placeholder,
                targetContainerIndex,
            );
            this._placeholder.ease({
                opacity: 150,
                duration: 250,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            this._taskbar.set_child_at_index(
                this._placeholder,
                targetContainerIndex,
            );
        }

        this._animateMagneticSlide(targetContainerIndex, movingForward);
    }

    _animateMagneticSlide(targetIndex, movingForward) {
        let children = this._getChildren();

        children.forEach((child) => {
            child.remove_all_transitions(); // ФІКС: очищення перед новою анімацією
            let offset = movingForward ? 0 : 0;

            child.set_translation(offset, 0, 0);
            child.ease({
                translation_x: 0,
                duration: 250,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
        });
    }

    _removePlaceholder() {
        if (this._placeholder && this._placeholder.get_parent()) {
            this._placeholder.remove_all_transitions();
            this._taskbar.remove_child(this._placeholder);
            this._placeholder.visible = false;
            this._placeholder.opacity = 0;
        }
    }

    _restoreDraggedButton() {
        if (!this._dragSourceButton) return;

        if (this._dragSourceDestroyId) {
            this._dragSourceButton.disconnect(this._dragSourceDestroyId);
            this._dragSourceDestroyId = 0;
        }

        this._dragSourceButton.visible = true;
        this._dragSourceButton.opacity = 255;
        this._dragSourceButton.reactive = true;
        this._dragSourceButton.set_x_expand(true);

        if (this._dragSourceButton._oldStyle !== undefined) {
            this._dragSourceButton.set_style(this._dragSourceButton._oldStyle);
        } else {
            this._dragSourceButton.set_style(null);
        }
    }

    _clearDragState() {
        this._dragApp = null;
        this._dragSourceButton = null;
        this._removePlaceholder();
    }

    _setActive(active) {
        if (this._onActiveChange) {
            try {
                this._onActiveChange(active);
            } catch (e) {}
        }
    }

    makeDraggable(button, app, iconSize) {
        let draggable = DND.makeDraggable(button);
        let isDroppedOutside = false;

        button._delegate = {
            app: app,
            getDragActor: () => app.create_icon_texture(iconSize),
            getDragActorSource: () => (isDroppedOutside ? null : button),
        };

        draggable.connect("drag-begin", () => {
            isDroppedOutside = false;
            this._dragApp = app;
            this._dragSourceButton = button;
            this._setActive(true);

            let currentIndex = this._taskbar.get_children().indexOf(button);
            this._ensurePlaceholderSized(button);

            if (this._placeholder.get_parent() !== this._taskbar) {
                this._taskbar.insert_child_at_index(
                    this._placeholder,
                    currentIndex,
                );
            } else {
                this._taskbar.set_child_at_index(
                    this._placeholder,
                    currentIndex,
                );
            }

            button.visible = false;
            button.opacity = 0;
            button.reactive = false;
            button.set_x_expand(false);
            button._oldStyle = button.get_style();

            this._dragSourceDestroyId = button.connect("destroy", () => {
                this._dragSourceButton = null;
            });

            this._dragSourceDestroyId = button.connect("destroy", () => {
                this._dragSourceButton = null;
            });
        });

        const onDragFinish = () => {
            if (this._dragSourceButton && !isDroppedOutside) {
                this._restoreDraggedButton();
            }
            this._clearDragState();
            this._setActive(false);
        };

        draggable.connect("drag-end", onDragFinish);

        draggable.connect("drag-cancelled", () => {
            if (this._taskbar) {
                let [x, y] = global.get_pointer();
                let [success, tx, ty] = this._taskbar.transform_stage_point(
                    x,
                    y,
                );

                let threshold = 50;
                let isOutside =
                    !success ||
                    tx < -threshold ||
                    tx > this._taskbar.width + threshold ||
                    ty < -threshold ||
                    ty > this._taskbar.height + threshold;

                if (isOutside) {
                    isDroppedOutside = true;

                    // ХАК: Викрадаємо актор у системи DND
                    let dragActor = draggable._dragActor;
                    if (dragActor) {
                        // Видаляємо посилання на актор з об'єкта перетягування.
                        // Це змусить систему DND "забути" про нього і припинити будь-які автоматичні анімації.
                        draggable._dragActor = null;

                        // Тепер ми єдині власники актора і можемо робити що завгодно
                        dragActor.remove_all_transitions();
                        dragActor.ease({
                            opacity: 0,
                            duration: 500,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                            onComplete: () => {
                                dragActor.destroy();
                            },
                        });
                    }

                    let appFavorites = AppFavorites.getAppFavorites();
                    let appId = app.get_id();

                    if (appFavorites.isFavorite(appId)) {
                        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                            appFavorites.removeFavorite(appId);
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                }
            }
            onDragFinish();
        });

        return draggable;
    }

    handleDragOver(localX) {
        if (!this._dragApp || !this._placeholder)
            return DND.DragMotionResult.CONTINUE;

        if (this._placeholder.width === 0) {
            this._ensurePlaceholderSized(this._dragSourceButton);
        }

        let index = this._calculateDropIndex(localX);
        this._insertPlaceholder(index);

        return DND.DragMotionResult.MOVE_DROP;
    }

    acceptDrop(localX, reorderCallback) {
        if (!this._dragApp) return false;

        let targetIndex = this._calculateDropIndex(localX);
        let appId = this._dragApp.get_id();

        this._restoreDraggedButton();

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
            this._removePlaceholder();
            return GLib.SOURCE_REMOVE;
        });

        if (typeof reorderCallback === "function")
            reorderCallback(appId, targetIndex);

        this._clearDragState();
        return true;
    }
}

export { TaskbarDNDManager };
