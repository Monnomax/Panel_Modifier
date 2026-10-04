import St from "gi://St";
import Clutter from "gi://Clutter";
import Shell from "gi://Shell";
import GLib from "gi://GLib";
import Pango from "gi://Pango";
import { Tooltip } from "./tooltip.js";
import { AnimationManager } from "./animationManager.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

export class WindowPreview {
    constructor(actor, app, settings) {
        this._actor = actor;
        this._app = app;
        this._settings = settings;

        this._container = null;
        this._tooltip = null;

        this._showTimerId = 0;
        this._hideTimerId = 0;

        this._destroyed = false;

        this._enterId = 0;
        this._leaveId = 0;
        this._destroyId = 0;

        this._containerEnterId = 0;
        this._containerLeaveId = 0;

        this._tooltip = new Tooltip(actor, app.get_name(), settings, false);

        this._enterId = this._actor.connect("enter-event", () =>
            this._onEnter(),
        );

        this._leaveId = this._actor.connect("leave-event", () =>
            this._onLeave(),
        );

        this._destroyId = this._actor.connect("destroy", () => this.destroy());
    }

    // =====================================================
    // Animation
    // =====================================================

    _getAnimationData(isHide) {
        const animType = this._settings?.get_int("preview-animation") ?? 3; // 3 = Ease Out Cubic
        const animData = AnimationManager.getAnimation(
            animType,
            this._settings,
            "preview",
        );

        const speed = isHide
            ? (this._settings?.get_int("preview-hide-speed") ?? 300)
            : (this._settings?.get_int("preview-show-speed") ?? 300);

        return {
            mode: isHide ? animData.hideMode : animData.showMode,
            duration: speed,
        };
    }

    // =====================================================
    // Events
    // =====================================================

    _onEnter() {
        if (this._destroyed) return;

        const showTooltips = this._settings?.get_boolean("show-tooltips");

        const showPreviews = this._settings?.get_boolean("show-previews");

        const isRunning = this._app?.get_state() === Shell.AppState.RUNNING;

        this._clearTimers();

        if (!showTooltips && !showPreviews) return;

        const shouldShowPreview = showPreviews && isRunning;

        const shouldShowTooltip = showTooltips && (!isRunning || !showPreviews);

        if (shouldShowPreview) {
            const showDelay =
                this._settings?.get_int("preview-show-delay") ?? 400;

            this._showTimerId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                showDelay,
                () => {
                    this._showTimerId = 0;

                    if (this._destroyed) return GLib.SOURCE_REMOVE;

                    this._show();

                    return GLib.SOURCE_REMOVE;
                },
            );
        } else if (shouldShowTooltip) {
            const showDelay =
                this._settings?.get_int("tooltip-show-delay") ?? 500;

            this._showTimerId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                showDelay,
                () => {
                    this._showTimerId = 0;

                    if (this._destroyed) return GLib.SOURCE_REMOVE;

                    this._tooltip?._show();

                    return GLib.SOURCE_REMOVE;
                },
            );
        }
    }

    _onLeave() {
        if (this._destroyed) return;

        this._clearShowTimer();
        this._startHideTimer();

        this._tooltip?._hideAnimated();
    }

    // =====================================================
    // Timers
    // =====================================================

    _clearTimers() {
        this._clearShowTimer();
        this._clearHideTimer();
    }

    _clearShowTimer() {
        if (this._showTimerId > 0) {
            GLib.source_remove(this._showTimerId);
            this._showTimerId = 0;
        }
    }

    _clearHideTimer() {
        if (this._hideTimerId > 0) {
            GLib.source_remove(this._hideTimerId);
            this._hideTimerId = 0;
        }
    }

    _startHideTimer() {
        this._clearHideTimer();

        const hideDelay = this._settings?.get_int("preview-hide-delay") ?? 200;

        this._hideTimerId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            hideDelay,
            () => {
                this._hideTimerId = 0;

                if (this._destroyed) return GLib.SOURCE_REMOVE;

                this._hideAnimated();

                return GLib.SOURCE_REMOVE;
            },
        );
    }

    // =====================================================
    // Show / Hide
    // =====================================================

    _show() {
        if (this._destroyed) return;

        if (this._container) return;

        const windows = this._app?.get_windows() ?? [];

        if (windows.length === 0) return;

        // Фільтруємо лише вікна з валідним актором
        const validWindows = windows.filter(
            (w) => w.get_compositor_private() !== null,
        );

        if (validWindows.length === 0) return;

        const baseSize = this._settings?.get_int("preview-base-size") ?? 250;
        const baseSizeGroup =
            this._settings?.get_int("preview-base-size-group") ?? 180;

        // При кількох вікнах використовуємо групове налаштування
        const maxWidth = validWindows.length > 1 ? baseSizeGroup : baseSize;

        // Зовнішній контейнер — горизонтальний, містить усі картки
        this._container = new St.BoxLayout({
            style_class: "dash-label window-preview-container",
            vertical: false,
            reactive: true,
            opacity: 0,
            scale_x: 0.5,
            scale_y: 0.5,
        });

        this._container.set_offscreen_redirect(
            Clutter.OffscreenRedirect.ALWAYS,
        );

        this._container.set_pivot_point(0.5, 0.5);

        // Перевіряємо, чи курсор дійсно зайшов у контейнер ззовні
        this._containerEnterId = this._container.connect(
            "enter-event",
            (actor, event) => {
                if (!this._container) return Clutter.EVENT_PROPAGATE;

                const related = event.get_related();
                if (related && this._container.contains(related)) {
                    return Clutter.EVENT_PROPAGATE;
                }
                this._clearHideTimer();
                return Clutter.EVENT_PROPAGATE;
            },
        );

        // Перевіряємо, чи курсор дійсно покинув межі всього контейнера, а не перейшов на інший внутрішній елемент
        this._containerLeaveId = this._container.connect(
            "leave-event",
            (actor, event) => {
                if (!this._container) return Clutter.EVENT_PROPAGATE;

                const related = event.get_related();
                if (related && this._container.contains(related)) {
                    return Clutter.EVENT_PROPAGATE;
                }
                this._startHideTimer();
                return Clutter.EVENT_PROPAGATE;
            },
        );

        // Будуємо картку для кожного вікна
        for (const window of validWindows) {
            const windowActor = window.get_compositor_private();

            // Картка — вертикальний бокс: хедер + клон
            const card = new St.BoxLayout({
                style_class: "preview-window-card",
                vertical: true,
                reactive: true,
            });

            // ── Хедер ──────────────────────────────────
            const header = new St.BoxLayout({
                style_class: "preview-header",
                vertical: false,
                reactive: true,
            });

            const icon = new St.Icon({
                gicon: this._app.get_icon(),
                icon_size: 16,
                style_class: "preview-header-icon",
            });

            const label = new St.Label({
                text: window.get_title(),
                style_class: "preview-title",
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });

            if (label.clutter_text) {
                label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                label.clutter_text.line_alignment = Pango.Alignment.CENTER;
            }

            const closeBtn = new St.Button({
                style_class: "preview-close-button",
                reactive: true,
                child: new St.Icon({
                    icon_name: "window-close-symbolic",
                    icon_size: 12,
                }),
            });

            closeBtn.connect("clicked", () => {
                window.delete(global.get_current_time());
                // Якщо це останнє вікно — ховаємо весь попап
                if (this._app?.get_windows().length <= 1) this._hideAnimated();
                else card.destroy();
            });

            header.add_child(icon);
            header.add_child(label);
            header.add_child(closeBtn);

            card.add_child(header);

            // ── Область прев'ю (анімується) ─────────────
            const rect = window.get_frame_rect();
            const scale = maxWidth / rect.width;

            const initialWidth = Math.round(rect.width * scale);
            const initialHeight = Math.round(rect.height * scale);

            const previewFrame = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                reactive: false,
                clip_to_allocation: true,
            });

            previewFrame.set_size(initialWidth, initialHeight);

            const cloneBtn = new St.Button({
                style_class: "preview-clone-frame",
                reactive: true,
                x_expand: true,
                y_expand: true,
            });

            cloneBtn.set_size(initialWidth, initialHeight);

            const clone = new Clutter.Clone({
                source: windowActor,
                reactive: false,
            });

            clone.set_size(initialWidth, initialHeight);

            cloneBtn.set_child(clone);
            previewFrame.add_child(cloneBtn);

            previewFrame.connect("notify::width", () => card.queue_relayout());
            previewFrame.connect("notify::height", () => card.queue_relayout());

            // Використовуємо captured-event, щоб Clutter не ігнорував середню кнопку
            cloneBtn.connect("captured-event", (actor, event) => {
                if (event.type() === Clutter.EventType.BUTTON_RELEASE) {
                    const button = event.get_button();

                    if (button === Clutter.BUTTON_PRIMARY) {
                        // Ліва кнопка — фокусуємо вікно
                        Main.activateWindow(window);
                        this._hideAnimated();
                        return Clutter.EVENT_STOP;
                    } else if (button === Clutter.BUTTON_MIDDLE) {
                        // Середня кнопка — закриваємо вікно
                        window.delete(global.get_current_time());
                        if (this._app?.get_windows().length <= 1)
                            this._hideAnimated();
                        else card.destroy();
                        return Clutter.EVENT_STOP;
                    }
                }
                return Clutter.EVENT_PROPAGATE;
            });

            card.add_child(previewFrame);

            this._container.add_child(card);
        }

        Main.uiGroup.add_child(this._container);

        this._updatePosition();

        // Зберігаємо базові розміри контейнера для коректного центрування при масштабуванні
        this._container._baseWidth = this._container.get_width();
        this._container._baseHeight = this._container.get_height();

        // Зберігаємо посилання на поточний активний контейнер для AutoHideManager
        WindowPreview.activeContainer = this._container;

        const anim = this._getAnimationData(false);

        this._container.ease({
            opacity: 255,
            duration: 150,
            mode: Clutter.AnimationMode.LINEAR,
        });

        this._container.ease({
            scale_x: 1,
            scale_y: 1,
            duration: anim.duration,
            mode: anim.mode,
        });
    }

    _hideAnimated() {
        if (!this._container) return;

        const c = this._container;
        this._container = null;

        if (WindowPreview.activeContainer === c) {
            WindowPreview.activeContainer = null;
        }

        c.remove_all_transitions();

        const anim = this._getAnimationData(true);

        c.ease({
            opacity: 0,
            duration: anim.duration,
            mode: Clutter.AnimationMode.LINEAR,
        });

        c.ease({
            scale_x: 0.5,
            scale_y: 0.5,
            duration: anim.duration,
            mode: anim.mode,
            onComplete: () => {
                if (c) c.destroy();
            },
        });
    }

    _hideImmediate() {
        if (!this._container) return;

        if (WindowPreview.activeContainer === this._container) {
            WindowPreview.activeContainer = null;
        }

        this._container.remove_all_transitions();
        this._container.destroy();
        this._container = null;
    }

    // =====================================================
    // Position
    // =====================================================

    _updatePosition() {
        if (!this._container?.get_stage()) return;

        const [x, y] = this._actor.get_transformed_position();

        const [w, h] = this._actor.get_transformed_size();

        const pw = this._container.get_width();
        const ph = this._container.get_height();

        let previewX = x + (w - pw) / 2;

        let previewY = 0;

        const panelPosition =
            this._settings?.get_string("panel-position") ?? "top";

        if (panelPosition === "top") previewY = y + h + 5;
        else previewY = y - ph - 5;

        previewX = Math.max(
            10,
            Math.min(previewX, global.stage.width - pw - 10),
        );

        previewY = Math.max(
            10,
            Math.min(previewY, global.stage.height - ph - 10),
        );

        this._container.set_position(
            Math.floor(previewX),
            Math.floor(previewY),
        );
    }

    // =====================================================
    // Cleanup
    // =====================================================

    destroy() {
        if (this._destroyed) return;

        this._destroyed = true;

        this._clearTimers();

        this._hideImmediate();

        this._tooltip?.destroy();
        this._tooltip = null;

        try {
            if (this._enterId) this._actor?.disconnect(this._enterId);
        } catch (e) {}

        try {
            if (this._leaveId) this._actor?.disconnect(this._leaveId);
        } catch (e) {}

        try {
            if (this._destroyId) this._actor?.disconnect(this._destroyId);
        } catch (e) {}

        this._enterId = 0;
        this._leaveId = 0;
        this._destroyId = 0;

        this._actor = null;
        this._app = null;
        this._settings = null;
    }
}
