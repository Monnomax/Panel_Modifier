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

    update(app) {
        const windows = app.get_windows();
        const windowCount = windows.length;
        const isFocused = windows.some((w) => w.has_focus());
        this._isFocused = isFocused;

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
        this._dots.forEach((dot) => dot.destroy());
        this._dots = [];
    }
}
