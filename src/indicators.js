import St from "gi://St";
import Clutter from "gi://Clutter";
import GdkPixbuf from "gi://GdkPixbuf";

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
        console.log(`Panel Modifier: Помилка отримання кольору іконки: ${e.message}`);
        return null;
    }
}

export class WindowIndicators {
    constructor(settings, indicatorContainer) {
        this._settings = settings;
        this._indicatorContainer = indicatorContainer;
        this._dots = [];

        // Підключаємо слухача змін для миттєвого оновлення
        this._positionChangedId = this._settings.connect(
            "changed::indicator-position",
            this._updatePosition.bind(this),
        );

        // Встановлюємо початкову позицію
        this._updatePosition();
    }

    _updatePosition() {
        const indicatorPosition =
            this._settings.get_string("indicator-position");
        this._indicatorContainer.y_align =
            indicatorPosition === "top"
                ? Clutter.ActorAlign.START
                : Clutter.ActorAlign.END;
    }

    _getAverageColor(app) {
        return getAverageAppIconColor(app);
    }

    update(app) {
        const windows = app.get_windows();
        const windowCount = windows.length;
        const isFocused = windows.some((w) => w.has_focus());

        while (this._dots.length > windowCount) {
            this._dots.pop().destroy();
        }

        if (windowCount === 0) return;

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
        const segmentWidth = Math.max(
            1,
            (targetWidth - gap * (windowCount - 1)) / windowCount,
        );

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
    }

    destroy() {
        if (this._positionChangedId) {
            this._settings.disconnect(this._positionChangedId);
            this._positionChangedId = null;
        }
        this._dots.forEach((dot) => dot.destroy());
        this._dots = [];
    }
}
