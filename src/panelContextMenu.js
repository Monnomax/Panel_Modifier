import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import St from "gi://St";

export class PanelContextMenu {
    constructor(extension) {
        this._extension = extension;
        this._container = extension._masterContainer;
        this._menu = null;
        this._containerSignalId = 0;
        this._settingsSignalId = 0;
    }

    enable() {
        if (!this._container) return;

        this._container.reactive = true;
        this._createPopup();
        this._containerSignalId = this._container.connect(
            "captured-event",
            (_actor, event) => this._onCapturedEvent(event),
        );
        this._settingsSignalId = this._extension._settings.connect(
            "changed::panel-position",
            () => this._recreatePopup(),
        );
    }

    _onCapturedEvent(event) {
        const [x, y] = event.get_coords();
        let actor = global.stage.get_actor_at_pos(Clutter.PickMode.ALL, x, y);
        let insideContainer = false;

        while (actor) {
            if (actor === this._container) {
                insideContainer = true;
                break;
            }

            const styleClass =
                typeof actor.get_style_class_name === "function"
                    ? actor.get_style_class_name()
                    : "";
            const styleClasses = styleClass ? styleClass.split(/\s+/) : [];
            const isPanelButton = styleClasses.includes("panel-button");
            const isButton = actor instanceof St.Button;
            const isFocusableReactiveActor =
                actor.reactive === true && actor.can_focus === true;

            if (isButton || isPanelButton || isFocusableReactiveActor)
                return Clutter.EVENT_PROPAGATE;

            actor = actor.get_parent();
        }

        if (!insideContainer) return Clutter.EVENT_PROPAGATE;

        if (
            event.type() !== Clutter.EventType.BUTTON_PRESS ||
            event.get_button() !== 3
        ) {
            return Clutter.EVENT_PROPAGATE;
        }

        if (!this._menu) return Clutter.EVENT_PROPAGATE;

        const [eventX] = event.get_coords();
        const [containerX] = this._container.get_transformed_position();
        const [containerWidth] = this._container.get_transformed_size();
        if (containerWidth > 0) {
            const alignment = Math.max(
                0,
                Math.min(1, (eventX - containerX) / containerWidth),
            );
            this._menu.setSourceAlignment(alignment);
        }

        this._menu.open();
        return Clutter.EVENT_STOP;
    }

    _createPopup() {
        if (!this._container || !Main.panel?.menuManager) return;

        const side =
            this._extension._settings.get_string("panel-position") === "bottom"
                ? St.Side.BOTTOM
                : St.Side.TOP;

        const menu = new PopupMenu.PopupMenu(this._container, 0.5, side);

        const panelSettingsItem = new PopupMenu.PopupMenuItem(
            _("Налаштування Panel Modifier"),
        );
        panelSettingsItem.connect("activate", () =>
            this._extension.openPreferences(),
        );
        menu.addMenuItem(panelSettingsItem);

        const ubuntuSettingsItem = new PopupMenu.PopupMenuItem(
            _("Налаштування Ubuntu"),
        );
        ubuntuSettingsItem.connect("activate", () => {
            try {
                GLib.spawn_command_line_async("gnome-control-center");
            } catch (e) {
                logError(
                    e,
                    "Panel Modifier: не вдалося відкрити системні налаштування",
                );
            }
        });
        menu.addMenuItem(ubuntuSettingsItem);

        Main.layoutManager.addChrome(menu.actor, { affectsStruts: false });
        menu.actor.hide();
        Main.panel.menuManager.addMenu(menu);
        this._menu = menu;
    }

    _recreatePopup() {
        this._destroyPopup();
        this._createPopup();
    }

    _destroyPopup() {
        const menu = this._menu;
        this._menu = null;
        if (!menu) return;

        try {
            if (menu.isOpen) menu.close(false);
            menu.destroy();
        } catch (e) {}
    }

    destroy() {
        if (this._containerSignalId && this._container) {
            try {
                this._container.disconnect(this._containerSignalId);
            } catch (e) {}
            this._containerSignalId = 0;
        }

        if (this._settingsSignalId && this._extension._settings) {
            try {
                this._extension._settings.disconnect(this._settingsSignalId);
            } catch (e) {}
            this._settingsSignalId = 0;
        }

        this._destroyPopup();
        this._container = null;
        this._extension = null;
    }
}
