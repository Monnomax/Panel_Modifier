import St from "gi://St";
import Clutter from "gi://Clutter";
import GdkPixbuf from "gi://GdkPixbuf";

const DOWNLOAD_PROGRESS_COLOR = "rgb(53, 132, 228)";

export function getAverageAppIconColor(app) {
    try {
        const gicon = app.get_icon();
        if (!gicon) return null;

        const theme =
            typeof St.IconTheme.get_default === "function"
                ? St.IconTheme.get_default()
                : new St.IconTheme();

        const iconInfo = theme.lookup_by_gicon(
            gicon,
            48,
            St.IconLookupFlags.NONE,
        );
        if (!iconInfo) return null;

        const filename = iconInfo.get_filename();
        if (!filename) return null;

        const pixbuf = GdkPixbuf.Pixbuf.new_from_file(filename);
        const pixels = pixbuf
            .scale_simple(1, 1, GdkPixbuf.InterpType.BILINEAR)
            .get_pixels();

        return { r: pixels[0], g: pixels[1], b: pixels[2] };
    } catch (e) {
        return null;
    }
}

export class WindowIndicators {
    constructor(settings, indicatorContainer) {
        this._settings = settings;
        this._indicatorContainer = indicatorContainer;
        this._dots = [];
        this._isFocused = false;
        this._positionInitialized = false;
        this._lastApp = null;
        this._downloadProgress = null;
        this._buttonContent = this._indicatorContainer.get_parent();

        // Use a sibling in the BinLayout so the progress track overlays the
        // existing indicator instead of being laid out beside its dots.
        this._progressTrack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            style_class: "indicator-dot",
            reactive: false,
            visible: false,
            clip_to_allocation: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: false,
            y_expand: false,
        });
        this._progressFill = new St.Widget({
            reactive: false,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._progressTrack.add_child(this._progressFill);
        // Fix the fill to the track's left edge so width changes grow rightward.
        this._progressFill.set_position(0, 0);
        this._buttonContent?.add_child(this._progressTrack);

        // Встановлюємо початкову позицію
        this._updatePosition();
    }

    // Позиціонування рахується від горизонтального та вертикального
    // центру кнопки таскбара. Зміщення задається в пікселях (-100..100):
    //   X: 0 — центр, додатне — вправо, від'ємне — вліво;
    //   Y: 0 — центр, додатне — вниз, від'ємне — вгору.
    _updatePosition() {
        const activeKey = this._isFocused ? "active" : "inactive";

        const offsetX = this._settings.get_int(
            `indicator-${activeKey}-offset-x`,
        );
        const offsetY = this._settings.get_int(
            `indicator-${activeKey}-offset-y`,
        );

        // Контейнер завжди по центру кнопки, далі зсуваємо його трансформацією
        this._indicatorContainer.x_align = Clutter.ActorAlign.CENTER;
        this._indicatorContainer.y_align = Clutter.ActorAlign.CENTER;

        const targetX = offsetX;
        const targetY = offsetY;

        const container = this._indicatorContainer;
        if (
            this._positionInitialized &&
            container.get_stage() &&
            (container.translation_x !== targetX ||
                container.translation_y !== targetY)
        ) {
            container.remove_transition("translation-x");
            container.remove_transition("translation-y");
            container.ease({
                translation_x: targetX,
                translation_y: targetY,
                duration: 400,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else if (!this._positionInitialized) {
            container.translation_x = targetX;
            container.translation_y = targetY;
            this._positionInitialized = true;
        }
    }

    _getAverageColor(app) {
        return getAverageAppIconColor(app);
    }

    setDownloadProgress(progress, app = this._lastApp) {
        let normalized = null;
        if (progress?.active === true) {
            normalized = {
                active: true,
                progress: Number.isFinite(progress.progress)
                    ? Math.max(0, Math.min(100, progress.progress))
                    : null,
            };
        }

        const previous = this._downloadProgress;
        if (
            (!previous && !normalized) ||
            (previous && normalized &&
                previous.active === normalized.active &&
                previous.progress === normalized.progress)
        ) {
            return;
        }

        this._downloadProgress = normalized;
        if (app) this.update(app);
        else this._progressTrack.visible = Boolean(normalized);
    }

    _getIconWidth() {
        const button = this._indicatorContainer.get_parent()?.get_parent();
        const icon = button?._icon;
        const width = icon?.get_width?.() || icon?.width || 0;
        return Math.max(1, Math.round(width || 48));
    }

    _updateDownloadProgress(targetHeight, targetRadius, dynamicStyle, isFocused) {
        const active = this._downloadProgress?.active === true;

        this._dots.forEach((dot) => {
            dot.visible = !active;
        });

        if (!active) {
            this._progressTrack.visible = false;
            this._progressFill.remove_all_transitions();
            this._progressFill.translation_x = 0;
            this._progressFill.scale_x = 0;
            return;
        }

        const iconWidth = this._getIconWidth();
        const track = this._progressTrack;
        const fill = this._progressFill;
        const progress = this._downloadProgress.progress;

        // Keep the overlay aligned with the existing indicator's offsets.
        track.translation_x = this._indicatorContainer.translation_x;
        track.translation_y = this._indicatorContainer.translation_y;

        track.set_size(iconWidth, targetHeight);
        track.set_style(`border-radius: ${targetRadius}px; ${dynamicStyle}`);
        track.add_style_class_name("indicator-dot-active");
        track.remove_style_class_name("indicator-dot-inactive");
        if (isFocused) track.add_style_class_name("active");
        else track.remove_style_class_name("active");

        fill.set_style(
            `background-color: ${DOWNLOAD_PROGRESS_COLOR}; ` +
                `border-radius: ${targetRadius}px;`,
        );
        fill.set_height(targetHeight);
        fill.translation_y = 0;
        // Scale around the left edge rather than animating width, which can
        // appear centered by the actor's layout allocation.
        fill.set_pivot_point(0, 0.5);

        if (Number.isFinite(progress)) {
            const fillScale = Math.max(
                0,
                Math.min(1, progress / 100),
            );

            fill.remove_transition("translation-x");
            fill.translation_x = 0;
            fill.set_width(iconWidth);
            fill.remove_transition("width");
            fill.remove_transition("scale-x");
            if (Math.abs(fill.scale_x - fillScale) > 0.001) {
                fill.ease({
                    scale_x: fillScale,
                    duration: 180,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
        } else {
            // Unknown total size: animate a short blue segment across the track.
            const fillWidth = Math.max(4, Math.round(iconWidth * 0.28));
            fill.remove_transition("scale-x");
            fill.scale_x = 1;
            fill.remove_transition("width");
            fill.set_width(fillWidth);
            fill.remove_transition("translation-x");
            fill.translation_x = -fillWidth;
            fill.ease({
                translation_x: iconWidth,
                duration: 1000,
                mode: Clutter.AnimationMode.LINEAR,
                repeatCount: -1,
            });
        }

        track.visible = true;
    }

    update(app) {
        this._lastApp = app;

        const windows = app.get_windows();
        const windowCount = windows.length;
        const isFocused = windows.some((w) => w.has_focus());
        this._isFocused = isFocused;

        while (this._dots.length > windowCount) {
            this._dots.pop().destroy();
        }

        if (windowCount === 0 && !this._downloadProgress?.active) {
            this._progressTrack.visible = false;
            return;
        }

        const activeKey = isFocused ? "active" : "inactive";
        const targetWidth = this._settings.get_int(
            `indicator-${activeKey}-width`,
        );
        const targetHeight = this._settings.get_int(
            `indicator-${activeKey}-height`,
        );
        const targetRadius = this._settings.get_int(
            `indicator-${activeKey}-radius`,
        );

        const useDynamicActive = this._settings.get_boolean(
            "indicator-active-dynamic-color",
        );
        const useDynamicInactive = this._settings.get_boolean(
            "indicator-inactive-dynamic-color",
        );

        const gap = 2;
        const segmentWidth = windowCount > 0
            ? Math.max(
                1,
                (targetWidth - gap * (windowCount - 1)) / windowCount,
            )
            : 0;

        let dynamicStyle = "";
        if (
            (isFocused && useDynamicActive) ||
            (!isFocused && useDynamicInactive)
        ) {
            const color = this._getAverageColor(app);
            if (color)
                dynamicStyle = `background-color: rgb(${color.r}, ${color.g}, ${color.b});`;
        }

        // Оновлюємо позицію на випадок, якщо це потрібно під час загального оновлення
        this._updatePosition();

        while (this._dots.length < windowCount) {
            const dot = new St.Widget({ style_class: "indicator-dot" });
            dot.set_size(segmentWidth, targetHeight);
            this._indicatorContainer.add_child(dot);
            this._dots.push(dot);
        }

        this._dots.forEach((dot, index) => {
            if (!dot.get_stage()) return;

            const marginStyle =
                index < windowCount - 1
                    ? `margin-right: ${gap}px;`
                    : "margin-right: 0px;";

            dot.set_style(
                `border-radius: ${targetRadius}px; ${dynamicStyle} ${marginStyle}`,
            );

            dot.add_style_class_name("indicator-dot-active");
            dot.remove_style_class_name("indicator-dot-inactive");

            if (isFocused) dot.add_style_class_name("active");
            else dot.remove_style_class_name("active");

            if (dot.width !== segmentWidth || dot.height !== targetHeight) {
                dot.remove_all_transitions();

                dot.set_height(targetHeight);

                dot.ease({
                    width: segmentWidth,
                    duration: 400,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
        });

        this._updateDownloadProgress(
            targetHeight,
            targetRadius,
            dynamicStyle,
            isFocused,
        );
    }

    destroy() {
        this._dots.forEach((dot) => dot.destroy());
        this._dots = [];

        if (this._progressTrack && !this._progressTrack.is_finalized?.()) {
            this._progressTrack.destroy();
        }
        this._progressTrack = null;
        this._progressFill = null;
        this._lastApp = null;
        this._buttonContent = null;
        this._indicatorContainer = null;
        this._settings = null;
    }
}
