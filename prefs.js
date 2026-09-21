import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";

export default class MyPrefs extends ExtensionPreferences {
    _itemNames = {
        activities: "Кнопка «Огляд»",
        taskbar: "Панель завдань",
        left_extensions: "Інші ліві розширення",
        left_center_extensions: "Інші ліві центральні розширення",
        keyboard: "Розкладка клавіатури",
        right_center_extensions: "Інші праві центральні розширення",
        right_extensions: "Інші праві розширення",
        systemMenu: "Системне меню",
        dateMenu: "Годинник та календар",
    };

    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // --- ВКЛАДКА 1: ПАНЕЛЬ ---
        const panelPage = new Adw.PreferencesPage({
            title: "Панель",
            icon_name: "view-grid-symbolic",
        });
        window.add(panelPage);

        // --- ГРУПА: АВТОПРИХОВУВАННЯ ---
        const autohideGroup = new Adw.PreferencesGroup({
            title: "Автоприховування",
        });
        panelPage.add(autohideGroup);

        const autohideRow = new Adw.ActionRow({
            title: "Автоприховування панелі",
        });

        const autohideSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind(
            "autohide-enabled",
            autohideSwitch,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );

        const autohideSettingsBtn = new Gtk.Button({
            icon_name: "emblem-system-symbolic",
            tooltip_text: "Налаштувати поведінку та таймінги",
            valign: Gtk.Align.CENTER,
        });
        autohideSettingsBtn.connect("clicked", () => {
            this._showAutohideSettingsWindow(settings);
        });

        const autohideBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            valign: Gtk.Align.CENTER,
        });

        autohideBox.append(autohideSettingsBtn);
        autohideBox.append(autohideSwitch);

        autohideRow.add_suffix(autohideBox);
        autohideRow.activatable_widget = autohideSwitch;
        autohideGroup.add(autohideRow);

        const mainGroup = new Adw.PreferencesGroup({
            title: "Налаштування панелі",
        });
        panelPage.add(mainGroup);

        const posRow = new Adw.ActionRow({ title: "Розташування" });
        const posDropDown = new Gtk.DropDown({
            model: new Gtk.StringList({ strings: ["Зверху", "Знизу"] }),
            valign: Gtk.Align.CENTER,
        });
        posDropDown.selected =
            settings.get_string("panel-position") === "top" ? 0 : 1;
        posDropDown.connect("notify::selected", () => {
            settings.set_string(
                "panel-position",
                posDropDown.selected === 0 ? "top" : "bottom",
            );
        });
        settings.connect("changed::panel-position", () => {
            posDropDown.selected =
                settings.get_string("panel-position") === "top" ? 0 : 1;
        });
        posRow.add_suffix(posDropDown);
        mainGroup.add(posRow);

        this._addButtonSliderRow(
            mainGroup,
            settings,
            "panel-height",
            "Висота",
            24,
            100,
        );

        let panelWidthSpin = this._addButtonSliderRow(
            mainGroup,
            settings,
            "panel-width",
            "Ширина",
            50,
            100,
        );

        if (settings.list_keys().includes("dynamic-panel-width")) {
            const dynamicRow = new Adw.SwitchRow({
                title: "Динамічна ширина панелі",
            });

            settings.bind(
                "dynamic-panel-width",
                dynamicRow,
                "active",
                Gio.SettingsBindFlags.DEFAULT,
            );
            mainGroup.add(dynamicRow);

            // ДОДАНИЙ БЛОК: Рядок для розташування таскбару
            const taskbarPosRow = new Adw.ActionRow({
                title: "Розташування панелі завдань",
            });

            const taskbarPosDropDown = new Gtk.DropDown({
                model: new Gtk.StringList({
                    strings: ["Зліва", "По центру", "Зправа"],
                }),
                valign: Gtk.Align.CENTER,
            });

            const posMap = ["left", "center", "right"];
            const currentPos =
                settings.get_string("taskbar-position") || "center";
            const currentIndex = posMap.indexOf(currentPos);
            taskbarPosDropDown.selected =
                currentIndex !== -1 ? currentIndex : 1;

            taskbarPosDropDown.connect("notify::selected", () => {
                settings.set_string(
                    "taskbar-position",
                    posMap[taskbarPosDropDown.selected],
                );
            });

            taskbarPosRow.add_suffix(taskbarPosDropDown);
            mainGroup.add(taskbarPosRow);

            // Встановлюємо початковий стан активності
            panelWidthSpin.set_sensitive(!dynamicRow.active);
            taskbarPosRow.set_sensitive(!dynamicRow.active);

            // Оновлюємо доступність при перемиканні (спрацьовує і при зміні
            // через bind, зокрема після імпорту налаштувань)
            dynamicRow.connect("notify::active", () => {
                panelWidthSpin.set_sensitive(!dynamicRow.active);
                taskbarPosRow.set_sensitive(!dynamicRow.active);
            });

            // Тримаємо dropdown розташування таскбару в синхроні з GSettings
            // (наприклад, після імпорту налаштувань)
            settings.connect("changed::taskbar-position", () => {
                const pos = settings.get_string("taskbar-position") || "center";
                const idx = posMap.indexOf(pos);
                taskbarPosDropDown.selected = idx !== -1 ? idx : 1;
            });
        }

        const adaptivePanelGroup = new Adw.PreferencesGroup({
            title: "Адаптивний колір панелі",
        });
        panelPage.add(adaptivePanelGroup);

        const adaptiveEnableRow = new Adw.ActionRow({
            title: "Увімкнути адаптивний колір",
        });
        const adaptiveEnableSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind(
            "panel-adaptive-color-enabled",
            adaptiveEnableSwitch,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        adaptiveEnableRow.add_suffix(adaptiveEnableSwitch);
        adaptiveEnableRow.activatable_widget = adaptiveEnableSwitch;
        adaptivePanelGroup.add(adaptiveEnableRow);

        const adaptiveIntensityRow = this._addButtonSliderRow(
            adaptivePanelGroup,
            settings,
            "panel-adaptive-color-intensity",
            "Інтенсивність кольору",
            0,
            100,
            5,
        );
        adaptiveIntensityRow.set_sensitive(adaptiveEnableSwitch.active);
        adaptiveEnableSwitch.connect("notify::active", () => {
            adaptiveIntensityRow.set_sensitive(adaptiveEnableSwitch.active);
        });

        // --- ГРУПА: ПІДКАЗКИ ТА ПРЕВ'Ю ---
        const tooltipsGroup = new Adw.PreferencesGroup({
            title: "Підказки та прев'ю",
        });
        panelPage.add(tooltipsGroup);

        const tooltipRow = new Adw.ActionRow({
            title: "Показувати підказки",
        });

        const tooltipSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });

        settings.bind(
            "show-tooltips",
            tooltipSwitch,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );

        const tooltipSettingsBtn = new Gtk.Button({
            icon_name: "emblem-system-symbolic",
            tooltip_text: "Налаштувати анімацію підказок",
            valign: Gtk.Align.CENTER,
        });
        tooltipSettingsBtn.connect("clicked", () => {
            this._showTooltipSettingsWindow(settings);
        });

        const tooltipBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            valign: Gtk.Align.CENTER,
        });

        tooltipBox.append(tooltipSettingsBtn);
        tooltipBox.append(tooltipSwitch);

        tooltipRow.add_suffix(tooltipBox);
        tooltipRow.activatable_widget = tooltipSwitch;
        tooltipsGroup.add(tooltipRow);

        // ================================================================
        // Спільні helpers для per-preset JSON storage (tooltip, preview, icon)
        // ================================================================
        const animOptions = [
            "Back",
            "Bounce",
            "Circ",
            "Cubic",
            "Elastic",
            "Expo",
            "Linear",
            "Quad",
            "Quart",
            "Quint",
            "Sine",
        ];

        const getCustomData = () => {
            try {
                return JSON.parse(
                    settings.get_string("animation-custom-settings") || "{}",
                );
            } catch (e) {
                return {};
            }
        };

        const saveCustomData = (data) => {
            settings.set_string(
                "animation-custom-settings",
                JSON.stringify(data),
            );
        };

        // Фабрика компактної кнопки зі скролом та колбеком onChange
        const makeSpeedSlider = (title, defaultValue, onChanged) => {
            const row = new Adw.ActionRow({ title });

            const adj = new Gtk.Adjustment({
                lower: 0,
                upper: 1000,
                step_increment: 50,
                page_increment: 50,
                value: defaultValue,
            });

            const button = new Gtk.Button({
                label: Math.round(defaultValue).toString(),
                valign: Gtk.Align.CENTER,
            });
            button.set_size_request(72, -1);

            const scrollCtrl = new Gtk.EventControllerScroll({
                flags: Gtk.EventControllerScrollFlags.VERTICAL,
            });
            scrollCtrl.connect("scroll", (_ctrl, _dx, dy) => {
                adj.value = Math.max(
                    adj.lower,
                    Math.min(adj.upper, adj.value - dy * adj.step_increment),
                );
                return true;
            });
            button.add_controller(scrollCtrl);

            adj.connect("value-changed", () => {
                const val = Math.round(adj.value);
                button.label = val.toString();
                onChanged(val);
            });

            row.add_suffix(button);

            return { row, adj, valueLabel: button };
        };

        const previewRow = new Adw.ActionRow({
            title: "Показувати прев'ю",
        });

        const previewSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });

        settings.bind(
            "show-previews",
            previewSwitch,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );

        const previewSettingsBtn = new Gtk.Button({
            icon_name: "emblem-system-symbolic",
            tooltip_text: "Налаштувати анімацію прев'ю",
            valign: Gtk.Align.CENTER,
        });
        previewSettingsBtn.connect("clicked", () => {
            this._showPreviewSettingsWindow(settings);
        });

        const previewBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            valign: Gtk.Align.CENTER,
        });

        previewBox.append(previewSettingsBtn);
        previewBox.append(previewSwitch);

        previewRow.add_suffix(previewBox);
        previewRow.activatable_widget = previewSwitch;
        tooltipsGroup.add(previewRow);

        // --- ГРУПА: ВІДСТУПИ (ExpanderRow) ---
        const marginGroup = new Adw.PreferencesGroup({ title: "Відступи" });
        panelPage.add(marginGroup);

        const marginExpander = new Adw.ExpanderRow({
            title: "Зовнішні відступи панелі",
        });
        marginGroup.add(marginExpander);

        const addExpanderSlider = (target, key, title, min, max) => {
            const row = new Adw.ActionRow({ title });
            const settings = this.getSettings();

            const clampValue = (value) =>
                Math.max(min, Math.min(max, Math.round(value)));

            const button = new Gtk.Button({
                label: settings.get_int(key).toString(),
                valign: Gtk.Align.CENTER,
            });

            button.set_size_request(72, -1);

            const scrollCtrl = new Gtk.EventControllerScroll({
                flags:
                    Gtk.EventControllerScrollFlags.VERTICAL |
                    Gtk.EventControllerScrollFlags.HORIZONTAL,
            });

            scrollCtrl.connect("scroll", (_ctrl, dx, dy) => {
                const current = settings.get_int(key);
                let newVal = current;
                if (dy < 0 || dx < 0) {
                    newVal = current + 1;
                } else if (dy > 0 || dx > 0) {
                    newVal = current - 1;
                }
                newVal = clampValue(newVal);
                settings.set_int(key, newVal);
                return true;
            });

            button.add_controller(scrollCtrl);

            settings.connect(`changed::${key}`, () => {
                button.label = settings.get_int(key).toString();
            });

            row.add_suffix(button);
            target.add_row(row);
        };

        addExpanderSlider(marginExpander, "margin-top", "Зверху", 0, 100);
        addExpanderSlider(marginExpander, "margin-right", "Справа", 0, 100);
        addExpanderSlider(marginExpander, "margin-bottom", "Знизу", 0, 100);
        addExpanderSlider(marginExpander, "margin-left", "Зліва", 0, 100);

        // --- ГРУПА: ЗАОКРУГЛЕННЯ КУТІВ (ExpanderRow) ---
        const radiusGroup = new Adw.PreferencesGroup({
            title: "Заокруглення кутів",
        });
        panelPage.add(radiusGroup);

        const radiusExpander = new Adw.ExpanderRow({
            title: "Радіус кутів панелі",
        });
        radiusGroup.add(radiusExpander);

        addExpanderSlider(
            radiusExpander,
            "border-radius-top-left",
            "Зверху зліва",
            0,
            50,
        );
        addExpanderSlider(
            radiusExpander,
            "border-radius-top-right",
            "Зверху справа",
            0,
            50,
        );
        addExpanderSlider(
            radiusExpander,
            "border-radius-bottom-right",
            "Знизу справа",
            0,
            50,
        );
        addExpanderSlider(
            radiusExpander,
            "border-radius-bottom-left",
            "Знизу зліва",
            0,
            50,
        );

        // --- ВКЛАДКА 2: ІКОНКИ ---
        const iconsPage = new Adw.PreferencesPage({
            title: "Іконки програм",
            icon_name: "emblem-photos-symbolic",
        });
        window.add(iconsPage);

        const iconPaddingGroup = new Adw.PreferencesGroup({
            title: "Відступи іконок",
        });
        iconsPage.add(iconPaddingGroup);

        const iconPaddingExpander = new Adw.ExpanderRow({
            title: "Позиціювання іконок",
        });
        iconPaddingGroup.add(iconPaddingExpander);

        const initialPanelHeight = settings.get_int("panel-height");

        this._addIconPaddingRow(
            iconPaddingExpander,
            settings,
            "icon-padding-vertical",
            "Відступи по вертикалі",
            initialPanelHeight,
        );
        this._addIconPaddingRow(
            iconPaddingExpander,
            settings,
            "icon-padding-horizontal",
            "Відступи по горизонталі",
            initialPanelHeight,
        );

        // ================================================================
        // ГРУПА: АНІМАЦІЯ ІКОНОК
        // ================================================================
        const iconAnimGroup = new Adw.PreferencesGroup({
            title: "Анімація іконок",
        });
        iconsPage.add(iconAnimGroup);

        // ── ExpanderRow 1: Анімація при наведенні ─────────────────────────
        const iconHoverExpander = new Adw.ExpanderRow({
            title: "Анімація при наведенні",
        });

        const iconHoverAnimModel = Gtk.StringList.new([
            "Back",
            "Bounce",
            "Circ",
            "Cubic",
            "Elastic",
            "Expo",
            "Linear",
            "Quad",
            "Quart",
            "Quint",
            "Sine",  
        ]);
        const iconHoverAnimDropdown = new Gtk.DropDown({
            model: iconHoverAnimModel,
            valign: Gtk.Align.CENTER,
            margin_end: 12,
        });
        settings.bind(
            "icon-animation",
            iconHoverAnimDropdown,
            "selected",
            Gio.SettingsBindFlags.DEFAULT,
        );
        iconHoverExpander.add_suffix(iconHoverAnimDropdown);
        iconAnimGroup.add(iconHoverExpander);

        let iconHoverIsUpdating = false;

        const iconHoverShowSlider = makeSpeedSlider(
            "Швидкість при наведенні",
            200,
            (val) => {
                if (iconHoverIsUpdating) return;
                const preset = animOptions[iconHoverAnimDropdown.selected];
                const data = getCustomData();
                if (!data[`icon-hover:${preset}`])
                    data[`icon-hover:${preset}`] = { show: 200, hide: 200 };
                data[`icon-hover:${preset}`].show = val;
                settings.set_int("icon-hover-show-speed", val);
                saveCustomData(data);
            },
        );

        const iconHoverHideSlider = makeSpeedSlider(
            "Швидкість при відведенні",
            200,
            (val) => {
                if (iconHoverIsUpdating) return;
                const preset = animOptions[iconHoverAnimDropdown.selected];
                const data = getCustomData();
                if (!data[`icon-hover:${preset}`])
                    data[`icon-hover:${preset}`] = { show: 200, hide: 200 };
                data[`icon-hover:${preset}`].hide = val;
                settings.set_int("icon-hover-hide-speed", val);
                saveCustomData(data);
            },
        );

        iconHoverExpander.add_row(iconHoverShowSlider.row);
        iconHoverExpander.add_row(iconHoverHideSlider.row);

        const loadIconHoverPreset = () => {
            const preset = animOptions[iconHoverAnimDropdown.selected];
            const data = getCustomData();
            const cfg = data[`icon-hover:${preset}`] || {
                show: 200,
                hide: 200,
            };
            iconHoverIsUpdating = true;
            iconHoverShowSlider.adj.value = cfg.show;
            iconHoverHideSlider.adj.value = cfg.hide;
            iconHoverShowSlider.valueLabel.label = cfg.show.toString();
            iconHoverHideSlider.valueLabel.label = cfg.hide.toString();
            settings.set_int("icon-hover-show-speed", cfg.show);
            settings.set_int("icon-hover-hide-speed", cfg.hide);
            iconHoverIsUpdating = false;
        };

        iconHoverAnimDropdown.connect("notify::selected", loadIconHoverPreset);
        loadIconHoverPreset();

        // ── ExpanderRow 2: Анімація при натисканні ────────────────────────
        const iconPressExpander = new Adw.ExpanderRow({
            title: "Анімація при натисканні",
        });

        const iconPressAnimModel = Gtk.StringList.new([
            "Back",
            "Bounce",
            "Circ",
            "Cubic",
            "Elastic",
            "Expo",
            "Linear",
            "Quad",
            "Quart",
            "Quint",
            "Sine",
        ]);
        const iconPressAnimDropdown = new Gtk.DropDown({
            model: iconPressAnimModel,
            valign: Gtk.Align.CENTER,
            margin_end: 12,
        });
        settings.bind(
            "icon-press-animation",
            iconPressAnimDropdown,
            "selected",
            Gio.SettingsBindFlags.DEFAULT,
        );
        iconPressExpander.add_suffix(iconPressAnimDropdown);
        iconAnimGroup.add(iconPressExpander);

        let iconPressIsUpdating = false;

        const iconPressShowSlider = makeSpeedSlider(
            "Швидкість при натисканні",
            100,
            (val) => {
                if (iconPressIsUpdating) return;
                const preset = animOptions[iconPressAnimDropdown.selected];
                const data = getCustomData();
                if (!data[`icon-press:${preset}`])
                    data[`icon-press:${preset}`] = { show: 100, hide: 150 };
                data[`icon-press:${preset}`].show = val;
                settings.set_int("icon-press-show-speed", val);
                saveCustomData(data);
            },
        );

        const iconPressHideSlider = makeSpeedSlider(
            "Швидкість при відпусканні",
            150,
            (val) => {
                if (iconPressIsUpdating) return;
                const preset = animOptions[iconPressAnimDropdown.selected];
                const data = getCustomData();
                if (!data[`icon-press:${preset}`])
                    data[`icon-press:${preset}`] = { show: 100, hide: 150 };
                data[`icon-press:${preset}`].hide = val;
                settings.set_int("icon-press-hide-speed", val);
                saveCustomData(data);
            },
        );

        iconPressExpander.add_row(iconPressShowSlider.row);
        iconPressExpander.add_row(iconPressHideSlider.row);

        const loadIconPressPreset = () => {
            const preset = animOptions[iconPressAnimDropdown.selected];
            const data = getCustomData();
            const cfg = data[`icon-press:${preset}`] || {
                show: 100,
                hide: 150,
            };
            iconPressIsUpdating = true;
            iconPressShowSlider.adj.value = cfg.show;
            iconPressHideSlider.adj.value = cfg.hide;
            iconPressShowSlider.valueLabel.label = cfg.show.toString();
            iconPressHideSlider.valueLabel.label = cfg.hide.toString();
            settings.set_int("icon-press-show-speed", cfg.show);
            settings.set_int("icon-press-hide-speed", cfg.hide);
            iconPressIsUpdating = false;
        };

        iconPressAnimDropdown.connect("notify::selected", loadIconPressPreset);
        loadIconPressPreset();

        // --- ГРУПА: МАСШТАБУВАННЯ ---
        const scaleGroup = new Adw.PreferencesGroup({
            title: "Масштабування іконок",
        });
        iconsPage.add(scaleGroup);

        const addScaleRow = (key, title) => {
            const row = new Adw.ActionRow({ title });

            const format = (v) => (Math.round(v * 100) / 100).toFixed(2);
            const clampValue = (value) =>
                Math.max(0.5, Math.min(1.5, Math.round(value * 100) / 100));

            const button = new Gtk.Button({
                label: format(settings.get_double(key)),
                valign: Gtk.Align.CENTER,
            });

            button.set_size_request(72, -1);

            const scrollCtrl = new Gtk.EventControllerScroll({
                flags:
                    Gtk.EventControllerScrollFlags.VERTICAL |
                    Gtk.EventControllerScrollFlags.HORIZONTAL,
            });

            scrollCtrl.connect("scroll", (_ctrl, dx, dy) => {
                const current = settings.get_double(key);
                let newVal = current;
                if (dy < 0 || dx < 0) {
                    newVal = current + 0.01;
                } else if (dy > 0 || dx > 0) {
                    newVal = current - 0.01;
                }
                newVal = clampValue(newVal);
                settings.set_double(key, newVal);
                return true;
            });

            button.add_controller(scrollCtrl);

            settings.connect(`changed::${key}`, () => {
                button.label = format(settings.get_double(key));
            });

            row.add_suffix(button);
            scaleGroup.add(row);
        };

        addScaleRow("icon-scale-hover", "Масштаб при наведенні");
        addScaleRow("icon-scale-press", "Масштаб при натисканні");

        // ================================================================
        // ГРУПА: ПОЗИЦІЯ ІНДИКАТОРА
        // ================================================================
        const indicatorPositionGroup = new Adw.PreferencesGroup({
            title: "Позиція індикатора",
        });
        iconsPage.add(indicatorPositionGroup);

        const indicatorPositionRow = new Adw.ActionRow({
            title: "Розташування індикатора",
        });

        const indicatorPositionDropDown = new Gtk.DropDown({
            model: new Gtk.StringList({ strings: ["Зверху", "Знизу"] }),
            valign: Gtk.Align.CENTER,
        });
        indicatorPositionDropDown.selected =
            settings.get_string("indicator-position") === "top" ? 0 : 1;
        indicatorPositionDropDown.connect("notify::selected", () => {
            settings.set_string(
                "indicator-position",
                indicatorPositionDropDown.selected === 0 ? "top" : "bottom",
            );
        });
        settings.connect("changed::indicator-position", () => {
            indicatorPositionDropDown.selected =
                settings.get_string("indicator-position") === "top" ? 0 : 1;
        });

        indicatorPositionRow.add_suffix(indicatorPositionDropDown);
        indicatorPositionGroup.add(indicatorPositionRow);

        // ================================================================
        // ГРУПА: СТИЛЬ ІНДИКАТОРІВ
        // ================================================================
        const indicatorStyleGroup = new Adw.PreferencesGroup({
            title: "Стиль індикаторів",
        });
        iconsPage.add(indicatorStyleGroup);

        // Створюємо розгортайку для активного індикатора
        const activeExpander = new Adw.ExpanderRow({
            title: "Стиль активного індикатора",
        });
        indicatorStyleGroup.add(activeExpander);

        // Перемикач динамічного кольору всередині експандера
        const activeDynamicColorRow = new Adw.SwitchRow({
            title: "Динамічний колір",
        });
        settings.bind(
            "indicator-active-dynamic-color",
            activeDynamicColorRow,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        activeExpander.add_row(activeDynamicColorRow);

        // Додаємо числові параметри (кнопки-регулятори) в експандер
        this._addButtonSliderRow(
            activeExpander,
            settings,
            "indicator-active-height",
            "Висота індикатора",
            1,
            10,
        );
        this._addButtonSliderRow(
            activeExpander,
            settings,
            "indicator-active-width",
            "Ширина індикатора",
            1,
            50,
        );
        this._addButtonSliderRow(
            activeExpander,
            settings,
            "indicator-active-radius",
            "Радіус кутів індикатора",
            0,
            5,
        );

        // Створюємо розгортайку для неактивного індикатора
        const inactiveExpander = new Adw.ExpanderRow({
            title: "Стиль неактивного індикатора",
        });
        indicatorStyleGroup.add(inactiveExpander);

        // Перемикач динамічного кольору всередині експандера
        const inactiveDynamicColorRow = new Adw.SwitchRow({
            title: "Динамічний колір",
        });
        settings.bind(
            "indicator-inactive-dynamic-color",
            inactiveDynamicColorRow,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        inactiveExpander.add_row(inactiveDynamicColorRow);

        // Додаємо числові параметри (кнопки-регулятори) в експандер
        this._addButtonSliderRow(
            inactiveExpander,
            settings,
            "indicator-inactive-height",
            "Висота індикатора",
            1,
            10,
        );
        this._addButtonSliderRow(
            inactiveExpander,
            settings,
            "indicator-inactive-width",
            "Ширина індикатора",
            1,
            50,
        );
        this._addButtonSliderRow(
            inactiveExpander,
            settings,
            "indicator-inactive-radius",
            "Радіус кутів індикатора",
            0,
            5,
        );

        // --- SEPARATORS GROUP ---
        const sepGroup = new Adw.PreferencesGroup({
            title: "Роздільники",
        });
        panelPage.add(sepGroup);

        const makeSepRow = (title, prefix) => {
            const row = new Adw.ActionRow({ title });

            const enabledSwitch = new Gtk.Switch({
                valign: Gtk.Align.CENTER,
            });
            settings.bind(
                `${prefix}-enabled`,
                enabledSwitch,
                "active",
                Gio.SettingsBindFlags.DEFAULT,
            );

            const gearBtn = new Gtk.Button({
                icon_name: "emblem-system-symbolic",
                tooltip_text: "Налаштувати роздільник",
                valign: Gtk.Align.CENTER,
            });
            gearBtn.connect("clicked", () => {
                this._showSeparatorWindow(prefix, title);
            });

            const box = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 6,
                valign: Gtk.Align.CENTER,
            });

            box.append(gearBtn);
            box.append(enabledSwitch);
            row.add_suffix(box);
            sepGroup.add(row);
        };

        makeSepRow("Лівий роздільник", "separator-left");
        makeSepRow("Правий роздільник", "separator-right");

        // --- ВКЛАДКА 4: ДОДАТКОВО ---
        const additionalPage = new Adw.PreferencesPage({
            title: "Додатково",
            icon_name: "emblem-system-symbolic",
        });
        window.add(additionalPage);

        const additionalGroup = new Adw.PreferencesGroup({
            title: "Налаштування огляду",
        });
        additionalPage.add(additionalGroup);

        const showInOverviewRow = new Adw.SwitchRow({
            title: "Показувати панель в «Огляді»",
        });
        settings.bind(
            "hide-panel-in-overview",
            showInOverviewRow,
            "active",
            Gio.SettingsBindFlags.DEFAULT |
                Gio.SettingsBindFlags.INVERT_BOOLEAN,
        );
        additionalGroup.add(showInOverviewRow);

        const showDashRow = new Adw.SwitchRow({
            title: "Показувати Dash в «Огляді»",
        });
        settings.bind(
            "hide-dash",
            showDashRow,
            "active",
            Gio.SettingsBindFlags.DEFAULT |
                Gio.SettingsBindFlags.INVERT_BOOLEAN,
        );
        additionalGroup.add(showDashRow);

        const activitiesRow = new Adw.SwitchRow({
            title: "Показувати кнопку «Огляд»",
        });
        settings.bind(
            "show-activities-button",
            activitiesRow,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        additionalGroup.add(activitiesRow);

        const a11yRow = new Adw.SwitchRow({
            title: "Показувати меню доступності",
        });
        settings.bind(
            "show-a11y-button",
            a11yRow,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        additionalGroup.add(a11yRow);

        const menuHoverSwitchRow = new Adw.SwitchRow({
            title: "Увімкнути автоматичне перемикання між відкритими меню",
        });
        settings.bind(
            "menu-hover-switch-enabled",
            menuHoverSwitchRow,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        additionalGroup.add(menuHoverSwitchRow);

        window.add(this._makeLayoutPage(settings, window));
    }

    _makeLayoutPage(settings, window) {
        const page = new Adw.PreferencesPage({
            title: "Розташування",
            icon_name: "view-list-symbolic",
        });

        const group = new Adw.PreferencesGroup({
            title: "Порядок елементів",
        });
        page.add(group);

        const itemNames = this._itemNames;
        let activeRows = [];

        const renderList = () => {
            activeRows.forEach((row) => group.remove(row));
            activeRows = [];

            let currentOrder = [];
            try {
                // Спробуємо отримати як рядок (якщо ви зберігаєте JSON)
                const stored = settings.get_string("panel-element-order");
                currentOrder = JSON.parse(stored);
            } catch (e) {
                // Якщо не JSON, спробуємо як масив рядків (get_strv)
                try {
                    currentOrder = settings.get_strv("panel-element-order");
                } catch (e2) {
                    currentOrder = [
                        "activities",
                        "taskbar",
                        "left_extensions",
                        "left_center_extensions",
                        "keyboard",
                        "right_center_extensions",
                        "right_extensions",
                        "systemMenu",
                        "dateMenu",
                    ];
                }
            }

            // ГАРАНТІЯ: переконуємося, що це масив
            if (!Array.isArray(currentOrder)) currentOrder = [];

            currentOrder.forEach((id, index) => {
                // КРИТИЧНЕ ВИПРАВЛЕННЯ: якщо id - об'єкт, беремо його властивість або перетворюємо в рядок
                const safeId =
                    id && typeof id === "object"
                        ? id.id || JSON.stringify(id)
                        : String(id);
                const titleText = itemNames[safeId] || safeId;

                const row = new Adw.ActionRow({
                    title: String(titleText), // Примусово рядок
                });

                const box = new Gtk.Box({
                    orientation: Gtk.Orientation.HORIZONTAL,
                    spacing: 6,
                    valign: Gtk.Align.CENTER,
                });

                const btnUp = new Gtk.Button({
                    icon_name: "go-up-symbolic",
                    valign: Gtk.Align.CENTER,
                });
                btnUp.set_sensitive(index > 0);
                btnUp.connect("clicked", () => {
                    let temp = currentOrder[index - 1];
                    currentOrder[index - 1] = currentOrder[index];
                    currentOrder[index] = temp;
                    this._saveOrder(settings, currentOrder);
                    renderList();
                });

                const btnDown = new Gtk.Button({
                    icon_name: "go-down-symbolic",
                    valign: Gtk.Align.CENTER,
                });
                btnDown.set_sensitive(index < currentOrder.length - 1);
                btnDown.connect("clicked", () => {
                    let temp = currentOrder[index + 1];
                    currentOrder[index + 1] = currentOrder[index];
                    currentOrder[index] = temp;
                    this._saveOrder(settings, currentOrder);
                    renderList();
                });

                box.append(btnUp);
                box.append(btnDown);
                row.add_suffix(box);

                group.add(row);
                activeRows.push(row);
            });
        };

        renderList();
        settings.connect("changed::panel-element-order", renderList);

        const debugGroup = new Adw.PreferencesGroup({
            title: "Режим розробника",
        });
        page.add(debugGroup);

        const debugRow = new Adw.SwitchRow({
            title: "Увімкнути дебаг",
        });
        settings.bind(
            "layout-debug",
            debugRow,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        debugGroup.add(debugRow);

        // --- ГРУПА: НАЛАШТУВАННЯ ---
        const settingsActionsGroup = new Adw.PreferencesGroup({
            title: "Налаштування",
        });
        page.add(settingsActionsGroup);

        const settingsActionsRow = new Adw.ActionRow({
            title: "Дії з налаштуваннями",
        });
        settingsActionsGroup.add(settingsActionsRow);

        const actionsBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            valign: Gtk.Align.CENTER,
            homogeneous: true,
        });

        const importBtn = new Gtk.Button({
            label: "Імпорт",
            valign: Gtk.Align.CENTER,
        });
        importBtn.connect("clicked", () => {
            this._importSettings(settings, page.get_root());
        });

        const exportBtn = new Gtk.Button({
            label: "Експорт",
            valign: Gtk.Align.CENTER,
        });
        exportBtn.connect("clicked", () => {
            this._exportSettings(settings, page.get_root());
        });

        const resetBtn = new Gtk.Button({
            label: "Скинути",
            valign: Gtk.Align.CENTER,
        });
        resetBtn.add_css_class("destructive-action");
        resetBtn.connect("clicked", () => {
            this._resetSettings(settings, page.get_root());
        });

        actionsBox.append(importBtn);
        actionsBox.append(exportBtn);
        actionsBox.append(resetBtn);

        settingsActionsRow.add_suffix(actionsBox);

        return page;
    }

    // Експорт усіх ключів налаштувань у JSON-файл (значення зберігаються
    // у текстовому форматі GVariant, щоб коректно відтворити будь-який тип)
    _exportSettings(settings, parentWindow) {
        const data = {};
        for (const key of settings.list_keys()) {
            data[key] = settings.get_value(key).print(true);
        }
        const jsonText = JSON.stringify(data, null, 2);

        const fileDialog = new Gtk.FileDialog({
            title: "Експортувати налаштування",
            initial_name: "panel-settings.json",
        });

        const filter = new Gtk.FileFilter();
        filter.set_name("JSON файли");
        filter.add_pattern("*.json");
        const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
        filters.append(filter);
        fileDialog.set_filters(filters);
        fileDialog.set_default_filter(filter);

        fileDialog.save(parentWindow, null, (dialog, result) => {
            try {
                const file = dialog.save_finish(result);
                if (!file) return;

                file.replace_contents(
                    new TextEncoder().encode(jsonText),
                    null,
                    false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION,
                    null,
                );
            } catch (e) {
                if (
                    e.matches &&
                    e.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED)
                )
                    return;
                logError(e, "Не вдалося експортувати налаштування");
            }
        });
    }

    // Імпорт налаштувань з JSON-файлу, створеного функцією експорту
    _importSettings(settings, parentWindow) {
        const fileDialog = new Gtk.FileDialog({
            title: "Імпортувати налаштування",
        });

        const filter = new Gtk.FileFilter();
        filter.set_name("JSON файли");
        filter.add_pattern("*.json");
        const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
        filters.append(filter);
        fileDialog.set_filters(filters);
        fileDialog.set_default_filter(filter);

        fileDialog.open(parentWindow, null, (dialog, result) => {
            try {
                const file = dialog.open_finish(result);
                if (!file) return;

                const [ok, contents] = file.load_contents(null);
                if (!ok) return;

                const jsonText = new TextDecoder("utf-8").decode(contents);
                const data = JSON.parse(jsonText);

                const validKeys = settings.list_keys();
                for (const key of Object.keys(data)) {
                    if (!validKeys.includes(key)) continue;
                    try {
                        const variant = GLib.Variant.parse(
                            null,
                            data[key],
                            null,
                            null,
                        );
                        settings.set_value(key, variant);
                    } catch (e) {
                        logError(e, `Не вдалося імпортувати ключ "${key}"`);
                    }
                }
            } catch (e) {
                if (
                    e.matches &&
                    e.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED)
                )
                    return;
                logError(e, "Не вдалося імпортувати налаштування");
            }
        });
    }

    // Скидання всіх налаштувань розширення до значень за замовчуванням
    _resetSettings(settings, parentWindow) {
        const dialog = new Adw.MessageDialog({
            transient_for: parentWindow,
            modal: true,
            heading: "Скинути налаштування?",
            body: "Усі налаштування розширення буде повернено до значень за замовчуванням. Цю дію неможливо скасувати.",
        });
        dialog.add_response("cancel", "Скасувати");
        dialog.add_response("reset", "Скинути");
        dialog.set_response_appearance(
            "reset",
            Adw.ResponseAppearance.DESTRUCTIVE,
        );
        dialog.set_default_response("cancel");
        dialog.set_close_response("cancel");

        dialog.connect("response", (_dlg, response) => {
            if (response === "reset") {
                for (const key of settings.list_keys()) {
                    settings.reset(key);
                }
            }
        });

        dialog.present();
    }

    // Допоміжний метод для збереження, щоб не дублювати логіку
    _saveOrder(settings, order) {
        try {
            // Зберігаємо як JSON рядокрозта
            settings.set_string("panel-element-order", JSON.stringify(order));
        } catch (e) {
            // Якщо схема очікує масив рядків (as)
            settings.set_strv(
                "panel-element-order",
                order.map((i) => String(i)),
            );
        }
    }

    // Повністю універсальний метод, який замінить обидва хелпери
    _addSpinRow(container, settings, key, title, min, max, step = 1) {
        const row = new Adw.ActionRow({ title });

        // Створюємо вашу кастомну компактну кнопку замість Gtk.SpinButton
        const button = new Gtk.Button({
            label: settings.get_int(key).toString(),
            valign: Gtk.Align.CENTER,
        });

        // Задаємо фіксовану ширину, як на вашому скріншоті
        button.set_size_request(72, -1);

        // Функція обмеження значень в межах min/max
        const clampValue = (value) =>
            Math.max(min, Math.min(max, Math.round(value)));

        const setConfigValue = (value) => {
            settings.set_int(key, clampValue(value));
        };

        // Додаємо обробник прокручування мишкою (скролу)
        const scrollCtrl = new Gtk.EventControllerScroll({
            flags:
                Gtk.EventControllerScrollFlags.VERTICAL |
                Gtk.EventControllerScrollFlags.HORIZONTAL,
        });

        scrollCtrl.connect("scroll", (_ctrl, dx, dy) => {
            const current = settings.get_int(key);
            let newVal = current;
            if (dy < 0 || dx < 0) {
                newVal = current + step;
            } else if (dy > 0 || dx > 0) {
                newVal = current - step;
            }
            setConfigValue(newVal);
            return true;
        });

        button.add_controller(scrollCtrl);

        // Оновлюємо текст на кнопці, якщо значення змінено в системі
        settings.connect(`changed::${key}`, () => {
            button.label = settings.get_int(key).toString();
        });

        // Додаємо кнопку як суфікс рядка
        row.add_suffix(button);

        // УНІВЕРСАЛЬНЕ ПРАВИЛО ДОДАВАННЯ:
        // Перевіряємо, що за контейнер нам передали.
        // Якщо це ExpanderRow — ховаємо всередину через add_row, якщо група — через add.
        if (container instanceof Adw.ExpanderRow) {
            container.add_row(row);
        } else {
            container.add(row);
        }

        return row;
    }

    // Універсальний метод для button-based регулятора дробових (double) значень
    _addDoubleSpinRow(container, settings, key, title, min, max, step = 0.1) {
        const row = new Adw.ActionRow({ title });

        const format = (v) => v.toFixed(1);

        // Обмежуємо значення в межах min/max та прибираємо похибки плаваючої точки
        const clampValue = (value) => {
            const clamped = Math.max(min, Math.min(max, value));
            return Math.round(clamped * 10) / 10;
        };

        const button = new Gtk.Button({
            label: format(settings.get_double(key)),
            valign: Gtk.Align.CENTER,
        });

        button.set_size_request(72, -1);

        const scrollCtrl = new Gtk.EventControllerScroll({
            flags:
                Gtk.EventControllerScrollFlags.VERTICAL |
                Gtk.EventControllerScrollFlags.HORIZONTAL,
        });

        scrollCtrl.connect("scroll", (_ctrl, dx, dy) => {
            const current = settings.get_double(key);
            let newVal = current;
            if (dy < 0 || dx < 0) {
                newVal = current + step;
            } else if (dy > 0 || dx > 0) {
                newVal = current - step;
            }
            newVal = clampValue(newVal);
            settings.set_double(key, newVal);
            return true;
        });

        button.add_controller(scrollCtrl);

        settings.connect(`changed::${key}`, () => {
            button.label = format(settings.get_double(key));
        });

        row.add_suffix(button);

        if (container instanceof Adw.ExpanderRow) {
            container.add_row(row);
        } else {
            container.add(row);
        }

        return row;
    }

    // Універсальний метод для button-based регулятора зі скролом
    _addButtonSliderRow(container, settings, key, title, min, max, step = 1) {
        const row = new Adw.ActionRow({ title });

        const button = new Gtk.Button({
            label: settings.get_int(key).toString(),
            valign: Gtk.Align.CENTER,
        });

        button.set_size_request(72, -1);

        const clampValue = (value) =>
            Math.max(min, Math.min(max, Math.round(value)));

        const setConfigValue = (value) => {
            settings.set_int(key, clampValue(value));
        };

        const scrollCtrl = new Gtk.EventControllerScroll({
            flags:
                Gtk.EventControllerScrollFlags.VERTICAL |
                Gtk.EventControllerScrollFlags.HORIZONTAL,
        });

        scrollCtrl.connect("scroll", (_ctrl, dx, dy) => {
            const current = settings.get_int(key);
            if (dy < 0 || dx < 0) {
                setConfigValue(current + step);
            } else if (dy > 0 || dx > 0) {
                setConfigValue(current - step);
            }
            return true;
        });

        button.add_controller(scrollCtrl);

        settings.connect(`changed::${key}`, () => {
            button.label = settings.get_int(key).toString();
        });

        row.add_suffix(button);

        if (container instanceof Adw.ExpanderRow) {
            container.add_row(row);
        } else {
            container.add(row);
        }

        return row;
    }

    _addIconPaddingRow(group, settings, key, title, panelHeight) {
        const row = new Adw.ActionRow({ title });

        // Створюємо стандартну GTK кнопку
        const button = new Gtk.Button({
            label: settings.get_int(key).toString(),
            valign: Gtk.Align.CENTER,
        });

        // Задаємо мінімальну ширину, щоб кнопка не "стрибала" при зміні цифр
        button.set_size_request(72, -1);

        const clampValue = (value) =>
            Math.max(0, Math.min(50, Math.round(value)));

        const setConfigValue = (value) => {
            settings.set_int(key, clampValue(value));
        };

        // У GTK4 прокрутка (scroll) обробляється через спеціальний контролер
        const scrollCtrl = new Gtk.EventControllerScroll({
            flags:
                Gtk.EventControllerScrollFlags.VERTICAL |
                Gtk.EventControllerScrollFlags.HORIZONTAL,
        });

        scrollCtrl.connect("scroll", (_ctrl, dx, dy) => {
            const current = settings.get_int(key);
            // dy < 0 означає прокрутку вгору, dy > 0 - вниз
            if (dy < 0 || dx < 0) {
                setConfigValue(current + 1);
            } else if (dy > 0 || dx > 0) {
                setConfigValue(current - 1);
            }
            return true; // Зупиняємо подальше поширення події
        });

        // Додаємо контролер до кнопки
        button.add_controller(scrollCtrl);

        // Синхронізуємо текст на кнопці, якщо налаштування змінилося
        settings.connect(`changed::${key}`, () => {
            button.label = settings.get_int(key).toString();
        });

        row.add_suffix(button);
        group.add_row(row);

        return button;
    }

    // create a standalone preferences page for an individual separator
    _makeSeparatorPage(settings, prefix, title) {
        const page = new Adw.PreferencesPage({ title: title });

        // margins
        const marginGroup = new Adw.PreferencesGroup({
            title: "Геометрія та відступи",
        });
        page.add(marginGroup);
        this._addSpinRow(
            marginGroup,
            settings,
            `${prefix}-margin-top`,
            "Відступ зверху",
            0,
            50,
        );
        this._addSpinRow(
            marginGroup,
            settings,
            `${prefix}-margin-bottom`,
            "Відступ знизу",
            0,
            50,
        );
        this._addSpinRow(
            marginGroup,
            settings,
            `${prefix}-margin-left`,
            "Відступ зліва",
            0,
            50,
        );
        this._addSpinRow(
            marginGroup,
            settings,
            `${prefix}-margin-right`,
            "Відступ справа",
            0,
            50,
        );

        // size and radius group
        const sizeGroup = new Adw.PreferencesGroup({
            title: "Розміри та форма",
        });
        this._addSpinRow(
            sizeGroup,
            settings,
            `${prefix}-line-width`,
            "Ширина",
            1,
            20,
        );
        this._addSpinRow(
            sizeGroup,
            settings,
            `${prefix}-line-height`,
            "Висота",
            1,
            60,
        );
        this._addSpinRow(
            sizeGroup,
            settings,
            `${prefix}-border-radius`,
            "Радіус кутів",
            0,
            10,
        );
        page.add(sizeGroup);

        return page;
    }

    _showSeparatorWindow(prefix, title) {
        const settings = this.getSettings();
        const dialog = new Adw.PreferencesWindow({ title });
        dialog.add(this._makeSeparatorPage(settings, prefix, title));
        dialog.present();
    }

    _showTooltipSettingsWindow(settings) {
        const dialog = new Adw.PreferencesWindow({
            title: "Налаштування підказок",
            modal: true,
            width_request: 450,
        });

        const page = new Adw.PreferencesPage();
        dialog.add(page);

        // --- ГРУПА: АНІМАЦІЯ ---
        const animationGroup = new Adw.PreferencesGroup({ title: "Анімація" });
        page.add(animationGroup);

        this._addSpinRow(
            animationGroup,
            settings,
            "tooltip-show-delay",
            "Затримка перед появою",
            0,
            1000,
            50,
        );
        this._addSpinRow(
            animationGroup,
            settings,
            "tooltip-hide-delay",
            "Затримка перед приховуванням",
            0,
            1000,
            50,
        );

        const animExpander = new Adw.ExpanderRow({
            title: "Тип анімації",
        });
        animationGroup.add(animExpander);

        const animOptions = [
            "Back",
            "Bounce",
            "Circ",
            "Cubic",
            "Elastic",
            "Expo",
            "Linear",
            "Quad",
            "Quart",
            "Quint",
            "Sine", 
        ];

        const animModel = Gtk.StringList.new(animOptions);
        const animDropdown = new Gtk.DropDown({
            model: animModel,
            valign: Gtk.Align.CENTER,
        });

        settings.bind(
            "tooltip-animation",
            animDropdown,
            "selected",
            Gio.SettingsBindFlags.DEFAULT,
        );
        animExpander.add_suffix(animDropdown);

        // --- Слайдери швидкості з per-preset JSON-зберіганням ---
        const getCustomData = () => {
            try {
                return JSON.parse(
                    settings.get_string("animation-custom-settings") || "{}",
                );
            } catch (e) {
                return {};
            }
        };

        const saveCustomData = (data) => {
            settings.set_string(
                "animation-custom-settings",
                JSON.stringify(data),
            );
        };

        let sliders = {};
        let isUpdating = false;

        const addSpeedRow = (id, title, settingsKey) => {
            const row = new Adw.ActionRow({ title });

            const adj = new Gtk.Adjustment({
                lower: 0,
                upper: 1000,
                step_increment: 50,
                page_increment: 50,
                value: settings.get_int(settingsKey),
            });

            const button = new Gtk.Button({
                label: Math.round(adj.value).toString(),
                valign: Gtk.Align.CENTER,
            });
            button.set_size_request(72, -1);

            const scrollCtrl = new Gtk.EventControllerScroll({
                flags: Gtk.EventControllerScrollFlags.VERTICAL,
            });
            scrollCtrl.connect("scroll", (_ctrl, _dx, dy) => {
                adj.value = Math.max(
                    adj.lower,
                    Math.min(adj.upper, adj.value - dy * adj.step_increment),
                );
                return true;
            });
            button.add_controller(scrollCtrl);

            adj.connect("value-changed", () => {
                const val = Math.round(adj.value);
                button.label = val.toString();
                if (isUpdating) return;

                settings.set_int(settingsKey, val);

                const preset = animOptions[animDropdown.selected];
                const data = getCustomData();
                if (!data[`tooltip:${preset}`])
                    data[`tooltip:${preset}`] = { show: 300, hide: 300 };
                data[`tooltip:${preset}`][id] = val;
                saveCustomData(data);
            });

            row.add_suffix(button);
            animExpander.add_row(row);

            sliders[id] = { adj, button };
        };

        addSpeedRow("show", "Швидкість появи", "tooltip-show-speed");
        addSpeedRow("hide", "Швидкість приховування", "tooltip-hide-speed");

        const loadPreset = () => {
            const preset = animOptions[animDropdown.selected];
            const data = getCustomData();
            const cfg = data[`tooltip:${preset}`] || { show: 300, hide: 300 };

            isUpdating = true;
            sliders["show"].adj.value = cfg.show;
            sliders["hide"].adj.value = cfg.hide;
            sliders["show"].button.label = cfg.show.toString();
            sliders["hide"].button.label = cfg.hide.toString();
            settings.set_int("tooltip-show-speed", cfg.show);
            settings.set_int("tooltip-hide-speed", cfg.hide);
            isUpdating = false;
        };

        animDropdown.connect("notify::selected", loadPreset);
        loadPreset();

        dialog.present();
    }

    _showPreviewSettingsWindow(settings) {
        const dialog = new Adw.PreferencesWindow({
            title: "Налаштування прев'ю",
            modal: true,
            width_request: 450,
        });

        const page = new Adw.PreferencesPage();
        dialog.add(page);

        // --- ГРУПА: АНІМАЦІЯ ---
        const animationGroup = new Adw.PreferencesGroup({ title: "Анімація" });
        page.add(animationGroup);

        this._addSpinRow(
            animationGroup,
            settings,
            "preview-show-delay",
            "Затримка перед появою",
            0,
            1000,
            50,
        );
        this._addSpinRow(
            animationGroup,
            settings,
            "preview-hide-delay",
            "Затримка перед приховуванням",
            0,
            1000,
            50,
        );

        const animExpander = new Adw.ExpanderRow({
            title: "Тип анімації",
        });
        animationGroup.add(animExpander);

        const animOptions = [
            "Back",
            "Bounce",
            "Circ",
            "Cubic",
            "Elastic",
            "Expo",
            "Linear",
            "Quad",
            "Quart",
            "Quint",
            "Sine", 
        ];

        const animModel = Gtk.StringList.new(animOptions);
        const animDropdown = new Gtk.DropDown({
            model: animModel,
            valign: Gtk.Align.CENTER,
        });

        settings.bind(
            "preview-animation",
            animDropdown,
            "selected",
            Gio.SettingsBindFlags.DEFAULT,
        );
        animExpander.add_suffix(animDropdown);

        // --- Слайдери швидкості з per-preset JSON-зберіганням ---
        const getCustomData = () => {
            try {
                return JSON.parse(
                    settings.get_string("animation-custom-settings") || "{}",
                );
            } catch (e) {
                return {};
            }
        };

        const saveCustomData = (data) => {
            settings.set_string(
                "animation-custom-settings",
                JSON.stringify(data),
            );
        };

        let sliders = {};
        let isUpdating = false;

        const addSpeedRow = (id, title, settingsKey) => {
            const row = new Adw.ActionRow({ title });

            const adj = new Gtk.Adjustment({
                lower: 0,
                upper: 1000,
                step_increment: 50,
                page_increment: 50,
                value: settings.get_int(settingsKey),
            });

            const button = new Gtk.Button({
                label: Math.round(adj.value).toString(),
                valign: Gtk.Align.CENTER,
            });
            button.set_size_request(72, -1);

            const scrollCtrl = new Gtk.EventControllerScroll({
                flags: Gtk.EventControllerScrollFlags.VERTICAL,
            });
            scrollCtrl.connect("scroll", (_ctrl, _dx, dy) => {
                adj.value = Math.max(
                    adj.lower,
                    Math.min(adj.upper, adj.value - dy * adj.step_increment),
                );
                return true;
            });
            button.add_controller(scrollCtrl);

            adj.connect("value-changed", () => {
                const val = Math.round(adj.value);
                button.label = val.toString();
                if (isUpdating) return;

                settings.set_int(settingsKey, val);

                const preset = animOptions[animDropdown.selected];
                const data = getCustomData();
                if (!data[`preview:${preset}`])
                    data[`preview:${preset}`] = { show: 300, hide: 300 };
                data[`preview:${preset}`][id] = val;
                saveCustomData(data);
            });

            row.add_suffix(button);
            animExpander.add_row(row);

            sliders[id] = { adj, button };
        };

        addSpeedRow("show", "Швидкість появи", "preview-show-speed");
        addSpeedRow("hide", "Швидкість приховування", "preview-hide-speed");

        const loadPreset = () => {
            const preset = animOptions[animDropdown.selected];
            const data = getCustomData();
            const cfg = data[`preview:${preset}`] || { show: 300, hide: 300 };

            isUpdating = true;
            sliders["show"].adj.value = cfg.show;
            sliders["hide"].adj.value = cfg.hide;
            sliders["show"].button.label = cfg.show.toString();
            sliders["hide"].button.label = cfg.hide.toString();
            settings.set_int("preview-show-speed", cfg.show);
            settings.set_int("preview-hide-speed", cfg.hide);
            isUpdating = false;
        };

        animDropdown.connect("notify::selected", loadPreset);
        loadPreset();

        // --- ГРУПА: МАСШТАБУВАННЯ ПРЕВ'Ю (Quick Look) ---
        const sizeGroup = new Adw.PreferencesGroup({ title: "Розмір" });
        page.add(sizeGroup);

        this._addSpinRow(
            sizeGroup,
            settings,
            "preview-base-size",
            "Розмір прев'ю",
            200,
            500,
            50,
        );
        this._addSpinRow(
            sizeGroup,
            settings,
            "preview-base-size-group",
            "Розмір прев'ю в груповому режимі",
            200,
            500,
            50,
        );

        dialog.present();
    }

    _showAutohideSettingsWindow(settings) {
        const dialog = new Adw.PreferencesWindow({
            title: "Налаштування автоприховування",
            modal: true,
            width_request: 450,
        });

        const page = new Adw.PreferencesPage();
        dialog.add(page);

        // --- ГРУПА 1: СТАТУС ТА ПОВЕДІНКА ---
        const behaviorGroup = new Adw.PreferencesGroup({
            title: "Інтелектуальне автоприховування",
        });
        page.add(behaviorGroup);

        // 'Статус автоприховування' видалено — налаштування керується основним вікном

        const intelRow = new Adw.SwitchRow({
            title: "Інтелектуальне автоприховування",
        });
        settings.bind(
            "intelligent-autohide",
            intelRow,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        behaviorGroup.add(intelRow);

        // --- ГРУПА 2: АНІМАЦІЯ ТА ШВИДКІСТЬ ---
        const animationGroup = new Adw.PreferencesGroup({ title: "Анімація" });
        page.add(animationGroup);

        const animExpander = new Adw.ExpanderRow({
            title: "Тип анімації",
        });
        animationGroup.add(animExpander);

        const animOptions = [
            "Back",
            "Bounce",
            "Circ",
            "Cubic",
            "Elastic",
            "Expo",
            "Linear",
            "Quad",
            "Quart",
            "Quint",
            "Sine",
        ];

        const animModel = Gtk.StringList.new(animOptions);
        const animDropdown = new Gtk.DropDown({
            model: animModel,
            valign: Gtk.Align.CENTER,
        });

        const currentAnim = settings.get_string("autohide-animation");
        const startIndex = animOptions.indexOf(currentAnim);
        if (startIndex !== -1) animDropdown.selected = startIndex;
        animExpander.add_suffix(animDropdown);

        // --- ЛОГІКА ТА СЛАЙДЕРИ ---
        let sliders = {}; // Сховище для доступу до Adjustment

        const addAnimSlider = (id, title, min, max, defaultValue) => {
            const row = new Adw.ActionRow({ title });

            const adj = new Gtk.Adjustment({
                lower: min,
                upper: max,
                step_increment: 50,
                page_increment: 50,
                value: defaultValue,
            });

            const button = new Gtk.Button({
                label: Math.round(defaultValue).toString(),
                valign: Gtk.Align.CENTER,
            });
            button.set_size_request(72, -1);

            const scrollCtrl = new Gtk.EventControllerScroll({
                flags:
                    Gtk.EventControllerScrollFlags.VERTICAL |
                    Gtk.EventControllerScrollFlags.HORIZONTAL,
            });
            scrollCtrl.connect("scroll", (_ctrl, _dx, dy) => {
                const delta = -dy * adj.step_increment;
                adj.value = Math.max(
                    adj.lower,
                    Math.min(adj.upper, adj.value + delta),
                );
                return true;
            });
            button.add_controller(scrollCtrl);

            adj.connect("value-changed", () => {
                button.label = Math.round(adj.value).toString();
                saveToJSON();
            });

            row.add_suffix(button);

            animExpander.add_row(row);
            sliders[id] = adj;
        };

        addAnimSlider("show", "Швидкість появи", 50, 1000, 300);
        addAnimSlider("hide", "Швидкість приховування", 50, 1000, 300);

        const getCustomData = () => {
            try {
                return JSON.parse(
                    settings.get_string("animation-custom-settings") || "{}",
                );
            } catch (e) {
                return {};
            }
        };

        const updateSlidersFromJSON = () => {
            const selectedAnim = animOptions[animDropdown.selected];
            const data = getCustomData();
            const config = data[selectedAnim] || { show: 300, hide: 300 };

            // Тимчасово відключаємо збереження, щоб не перезаписувати JSON під час зчитування
            isUpdating = true;
            sliders["show"].value = config.show;
            sliders["hide"].value = config.hide;
            isUpdating = false;
        };

        let isUpdating = false;
        const saveToJSON = () => {
            if (isUpdating) return;
            const selectedAnim = animOptions[animDropdown.selected];
            const data = getCustomData();
            data[selectedAnim] = {
                show: Math.round(sliders["show"].value),
                hide: Math.round(sliders["hide"].value),
            };
            settings.set_string(
                "animation-custom-settings",
                JSON.stringify(data),
            );
        };

        animDropdown.connect("notify::selected", () => {
            settings.set_string(
                "autohide-animation",
                animOptions[animDropdown.selected],
            );
            updateSlidersFromJSON();
        });

        // --- ГРУПА 3: ТАЙМІНГИ ---
        const timingGroup = new Adw.PreferencesGroup({
            title: "Таймінги та чутливість",
        });
        page.add(timingGroup);

        this._addSpinRow(
            timingGroup,
            settings,
            "autohide-threshold",
            "Зона активації",
            1,
            50,
            1,
        );
        this._addSpinRow(
            timingGroup,
            settings,
            "autohide-show-delay",
            "Затримка перед появою",
            0,
            1000,
            50,
        );
        this._addSpinRow(
            timingGroup,
            settings,
            "autohide-delay",
            "Затримка перед приховуванням",
            0,
            2000,
            50,
        );

        updateSlidersFromJSON();
        dialog.present();
    }
}
