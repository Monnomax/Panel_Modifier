import St from "gi://St";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import { AnimationManager } from "./animationManager.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

export class Tooltip {
    constructor(actor, text, settings, autoBindEvents = true) {
        this._actor = actor;
        this._text = text;
        this._settings = settings;

        this._tooltip = null;
        this._timerId = 0;
        this._destroyed = false;

        this._enterId = 0;
        this._leaveId = 0;
        this._destroyId = 0;
        this._overviewId = 0;
        this._themeId = 0;

        this._themeContext = St.ThemeContext.get_for_stage(global.stage);

        if (autoBindEvents) {
            this._enterId = this._actor.connect(
                "enter-event",
                () => this._onEnter()
            );

            this._leaveId = this._actor.connect(
                "leave-event",
                () => this._onLeave()
            );
        }

        this._destroyId = this._actor.connect(
            "destroy",
            () => this.destroy()
        );

        this._overviewId = Main.overview.connect(
            "showing",
            () => this._hideImmediate()
        );

        this._themeId = this._themeContext.connect(
            "changed",
            () => this._hideImmediate()
        );
    }

    // =====================================================
    // Animation
    // =====================================================

    _getAnimationData(isHide) {
        const animType = this._settings?.get_int("tooltip-animation") ?? 6; // 6 = Ease Out Quad
        const animData = AnimationManager.getAnimation(animType, this._settings, 'tooltip');

        const speed = isHide
            ? this._settings?.get_int("tooltip-hide-speed") ?? 300
            : this._settings?.get_int("tooltip-show-speed") ?? 300;

        return {
            mode: isHide ? animData.hideMode : animData.showMode,
            duration: speed,
        };
    }

    // =====================================================
    // Events
    // =====================================================

    _onEnter() {
        if (this._destroyed)
            return;

        if (!this._settings?.get_boolean("show-tooltips"))
            return;

        this._clearTimer();

        const showDelay = this._settings?.get_int("tooltip-show-delay") ?? 500;

        this._timerId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            showDelay,
            () => {
                this._timerId = 0;

                if (this._destroyed)
                    return GLib.SOURCE_REMOVE;

                this._show();

                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _onLeave() {
        if (this._destroyed)
            return;

        this._clearTimer();

        const hideDelay = this._settings?.get_int("tooltip-hide-delay") ?? 0;

        if (hideDelay > 0) {
            this._timerId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                hideDelay,
                () => {
                    this._timerId = 0;

                    if (this._destroyed)
                        return GLib.SOURCE_REMOVE;

                    this._hideAnimated();

                    return GLib.SOURCE_REMOVE;
                }
            );
        } else {
            this._hideAnimated();
        }
    }

    // =====================================================
    // Show / Hide
    // =====================================================

    _show() {
        if (this._destroyed)
            return;

        if (this._tooltip)
            return;

        if (!this._actor?.get_stage())
            return;

        this._tooltip = new St.Label({
            style_class: "dash-label tooltip",
            text: this._text,
            reactive: false,
            opacity: 0,
            scale_x: 0.5,
            scale_y: 0.5,
        });

        this._tooltip.set_offscreen_redirect(
            Clutter.OffscreenRedirect.ALWAYS
        );

        this._tooltip.set_pivot_point(0.5, 0.5);

        Main.uiGroup.add_child(this._tooltip);

        this._updatePosition();

        const anim = this._getAnimationData(false);

        this._tooltip.ease({
            opacity: 255,
            duration: 150,
            mode: Clutter.AnimationMode.LINEAR,
        });

        this._tooltip.ease({
            scale_x: 1,
            scale_y: 1,
            duration: anim.duration,
            mode: anim.mode,
        });
    }

    _hideAnimated() {
        if (!this._tooltip)
            return;

        const t = this._tooltip;
        this._tooltip = null;

        const anim = this._getAnimationData(true);

        t.remove_all_transitions();

        t.ease({
            opacity: 0,
            duration: anim.duration,
            mode: Clutter.AnimationMode.LINEAR,
            onComplete: () => {
                if (t)
                    t.destroy();
            },
        });

        t.ease({
            scale_x: 0.5,
            scale_y: 0.5,
            duration: anim.duration,
            mode: anim.mode,
        });
    }

    _hideImmediate() {
        if (!this._tooltip)
            return;

        this._tooltip.remove_all_transitions();
        this._tooltip.destroy();
        this._tooltip = null;
    }

    // =====================================================
    // Position
    // =====================================================

    _updatePosition() {
        if (!this._tooltip || !this._actor)
            return;

        const [x, y] = this._actor.get_transformed_position();
        const [w, h] = this._actor.get_transformed_size();

        const [, tw] = this._tooltip.get_preferred_width(-1);
        const [, th] = this._tooltip.get_preferred_height(-1);

        let tooltipX = x + (w - tw) / 2;
        let tooltipY = 0;

        const panelPosition =
            this._settings?.get_string("panel-position") ?? "top";

        if (panelPosition === "top")
            tooltipY = y + h + 5;
        else
            tooltipY = y - th - 5;

        tooltipX = Math.max(
            10,
            Math.min(
                tooltipX,
                global.stage.width - tw - 10
            )
        );

        this._tooltip.set_position(
            Math.floor(tooltipX),
            Math.floor(tooltipY)
        );
    }

    // =====================================================
    // Cleanup
    // =====================================================

    _clearTimer() {
        if (this._timerId > 0) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
    }

    destroy() {
        if (this._destroyed)
            return;

        this._destroyed = true;

        this._clearTimer();

        this._hideImmediate();

        try {
            if (this._enterId)
                this._actor?.disconnect(this._enterId);
        } catch (e) {}

        try {
            if (this._leaveId)
                this._actor?.disconnect(this._leaveId);
        } catch (e) {}

        try {
            if (this._destroyId)
                this._actor?.disconnect(this._destroyId);
        } catch (e) {}

        try {
            if (this._overviewId)
                Main.overview.disconnect(this._overviewId);
        } catch (e) {}

        try {
            if (this._themeId)
                this._themeContext.disconnect(this._themeId);
        } catch (e) {}

        this._enterId = 0;
        this._leaveId = 0;
        this._destroyId = 0;
        this._overviewId = 0;
        this._themeId = 0;

        this._actor = null;
        this._settings = null;
        this._themeContext = null;
    }
}