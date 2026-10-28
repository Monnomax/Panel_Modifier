import St from "gi://St";
import Clutter from "gi://Clutter";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

export class PanelSeparators {
    constructor(extension, settings) {
        this._extension = extension;
        this._settings = settings;
        this._panel = Main.panel;

        this._signals = [];
        this._leftSepBox = null;
        this._rightSepBox = null;
        this._leftLine = null;
        this._rightLine = null;

        this._createSeparators();
        this._connectSignals();
        this._update();
    }

    _createSeparators() {
        const createSep = () => {
            const box = new St.BoxLayout({
                vertical: true,
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: false,
                y_expand: true,
            });
            const line = new St.Widget({
                style_class: 'panel-separator',
                reactive: false,
            });
            box.add_child(line);
            return { box, line };
        };

        const left  = createSep();
        this._leftSepBox  = left.box;
        this._leftLine    = left.line;

        const right = createSep();
        this._rightSepBox = right.box;
        this._rightLine   = right.line;

        if (this._extension._masterContainer) {
            this._extension._masterContainer.insert_child_at_index(this._leftSepBox, 1);
            this._extension._masterContainer.insert_child_at_index(this._rightSepBox, 3);
        }
    }

    _connectSignals() {
        const keys = [
            'margin-left', 'margin-right', 'margin-top', 'margin-bottom',
            'line-width', 'line-height', 'border-radius', 'enabled'
        ];

        [
            { prefix: 'separator-left', update: () => this._update() },
            { prefix: 'separator-right', update: () => this._update() }
        ].forEach(item => {
            keys.forEach(key => {
                const id = this._settings.connect(`changed::${item.prefix}-${key}`, item.update);
                this._signals.push({ obj: this._settings, id });
            });
        });

        this._signals.push({
            obj: this._settings,
            id: this._settings.connect('changed::dynamic-panel-width', () => this._update())
        });

        this._signals.push({
            obj: this._panel,
            id: this._panel.connect('notify::height', () => this._update())
        });

        const themeContext = St.Settings.get();
        const themeSigId = themeContext.connect('notify::gtk-theme', () => this._update());
        this._signals.push({ obj: themeContext, id: themeSigId });
    }

    _update() {
        if (!this._leftSepBox || !this._rightSepBox) return;

        const isDynamic    = this._settings.get_boolean('dynamic-panel-width');
        const leftEnabled  = this._settings.get_boolean('separator-left-enabled');
        const rightEnabled = this._settings.get_boolean('separator-right-enabled');

        // ── LAYOUT BATCHING ──────────────────────────────────────────────────────
        // Вирішуємо видимість та стиль кожного сепаратора заздалегідь,
        // а тоді застосовуємо все одним пакетом.

        const shouldShowLeft  = isDynamic && leftEnabled;
        const shouldShowRight = isDynamic && rightEnabled;

        // Фаза читання (якщо сепаратор буде видимим)
        let leftParams  = null;
        let rightParams = null;

        if (shouldShowLeft)  leftParams  = this._readSepParams('separator-left');
        if (shouldShowRight) rightParams = this._readSepParams('separator-right');

        // Фаза запису — всі мутації разом
        if (shouldShowLeft && leftParams) {
            this._applySepParams(this._leftLine,  this._leftSepBox,  leftParams);
            this._leftSepBox.show();
        } else {
            this._leftSepBox.hide();
        }

        if (shouldShowRight && rightParams) {
            this._applySepParams(this._rightLine, this._rightSepBox, rightParams);
            this._rightSepBox.show();
        } else {
            this._rightSepBox.hide();
        }
        // ────────────────────────────────────────────────────────────────────────
    }

    // Повертає об'єкт із усіма потрібними значеннями — без доступу до акторів
    _readSepParams(prefix) {
        const s = this._settings;
        return {
            width:        s.get_int(`${prefix}-line-width`)    || 1,
            pixelHeight:  s.get_int(`${prefix}-line-height`)   || 30,
            borderRadius: s.get_int(`${prefix}-border-radius`) || 0,
            marginLeft:   s.get_int(`${prefix}-margin-left`)   || 0,
            marginRight:  s.get_int(`${prefix}-margin-right`)  || 0,
            marginTop:    s.get_int(`${prefix}-margin-top`)    || 0,
            marginBottom: s.get_int(`${prefix}-margin-bottom`) || 0,
        };
    }

    // Застосовує заздалегідь прочитані параметри до акторів
    _applySepParams(line, box, p) {
        line.set_size(p.width, p.pixelHeight);
        line.style = `border-radius: ${p.borderRadius}px;`;
        box.style  =
            `margin-left: ${p.marginLeft}px;` +
            `margin-right: ${p.marginRight}px;` +
            `margin-top: ${p.marginTop}px;` +
            `margin-bottom: ${p.marginBottom}px;` +
            `padding: 0px;`;
    }

    destroy() {
        this._signals.forEach(sig => {
            if (sig.obj && sig.id) sig.obj.disconnect(sig.id);
        });
        this._signals = [];

        if (this._leftSepBox)  this._leftSepBox.destroy();
        if (this._rightSepBox) this._rightSepBox.destroy();
    }
}
