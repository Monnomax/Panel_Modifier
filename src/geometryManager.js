import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

const FRAME_MS = 16;
const SMOOTHING = 0.22;
const SIGMOID_K = 8;
const CONVERGE_EPS = 0.4;

function clamp(v, min, max) {
    if (max < min) return min;
    return Math.min(max, Math.max(min, v));
}

// S-подібна функція: на краях повільно й точно, у центрі — швидше.
// Нормалізована так, що f(0) = 0, f(1) = 1.
function sigmoidEase(x) {
    const s = (t) => 1 / (1 + Math.exp(-SIGMOID_K * (t - 0.5)));
    const s0 = s(0);
    const s1 = s(1);
    return (s(x) - s0) / (s1 - s0);
}

/**
 * TaskbarGeometryManager — єдиний централізований координатор геометрії
 * TaskBarViewport / TaskBarContent.
 *
 * Будь-яка подія, що впливає на геометрію панелі (зміна ширини панелі,
 * поява/зникнення кнопки розширення, зміна ширини годинника, зміна
 * масштабу, додавання/видалення іконки таскбару тощо) повинна проходити
 * через scheduleMeasure() -> measure(). Жодна інша частина коду не
 * повинна незалежно виставляти viewportWidth / offset.
 *
 * measure() перераховує:
 *   - viewportWidth
 *   - contentWidth
 *   - maxOffset
 *   - scrollingEnabled
 *   - допустимий діапазон offset (з клампом і збереженням позиції)
 */
export class TaskbarGeometryManager {
    constructor(taskbar) {
        this._taskbar = taskbar;

        this.viewportWidth = 0;
        this.contentWidth = 0;
        this.maxOffset = 0;
        this.currentOffset = 0;
        this.targetOffset = 0;
        this.scrollingEnabled = false;

        this._tickId = 0;
        this._measureIdleId = 0;
        this._dragActive = false;
        this._destroyed = false;
        this._pendingReveal = null;
        this._pendingRevealAttempts = 0;
        this._pendingRevealDestroyId = 0;
    }

    // ── Планування перерахунку ───────────────────────────────────────────
    // Коалесує декілька подій, що трапились в межах одного кадру, в один
    // виклик measure(), щоб уникнути надлишкових перерахунків.
    scheduleMeasure() {
        if (this._destroyed || this._measureIdleId) return;
        this._measureIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._measureIdleId = 0;
            if (!this._destroyed) this.measure();
            return GLib.SOURCE_REMOVE;
        });
    }

    // ── Головний перерахунок геометрії ───────────────────────────────────
    measure() {
        if (this._destroyed) return;

        const t = this._taskbar;
        if (!t || !t._content) return;

        const monitor =
            Main.layoutManager.primaryMonitor ||
            Main.layoutManager.focusMonitor;
        const monitorWidth = monitor ? monitor.width : global.stage.width;

        const otherWidth = t._measureOtherElementsWidth();
        const separatorsWidth = t._measureSeparatorsWidth();

        // Базова "стеля" ширини: у Dynamic Panel Width це весь монітор
        // (з відрахуванням margins/padding), у фіксованому режимі — це
        // фактична ширина панелі (panel-width%), яка вже враховує
        // margins/padding і може бути вужчою за монітор.
        const { basis, marginsIncluded } =
            t._measurePanelWidthBasis(monitorWidth);
        const margins = marginsIncluded ? 0 : t._measurePanelMargins();

        // taskbarWidth = panelBasis − left/right widgets − separators − margins
        const available = Math.max(
            0,
            basis - otherWidth - separatorsWidth - margins,
        );

        const [, contentNatural] = t._content.get_preferred_width(-1);
        this.contentWidth = Math.max(0, contentNatural);

        // Ширина viewport ніколи не перевищує доступний простір і ніколи
        // не перевищує реальну потребу контенту.
        this.viewportWidth = Math.max(
            0,
            Math.min(this.contentWidth, available),
        );
        this.maxOffset = Math.max(0, this.contentWidth - this.viewportWidth);
        this.scrollingEnabled = this.contentWidth > this.viewportWidth + 0.5;

        if (!this.scrollingEnabled) {
            // contentWidth <= viewportWidth: вимикаємо scrolling/sigmoid,
            // offset = 0.
            this.currentOffset = 0;
            this.targetOffset = 0;
            this._clearPendingRevealSignal();
            this._pendingReveal = null;
            this._pendingRevealAttempts = 0;
            this._stopTicker();
        } else {
            // Зберігаємо поточну позицію. Скидаємо offset у нуль НЕ можна —
            // лише кламп до нового допустимого діапазону, якщо потрібно.
            this.targetOffset = clamp(this.targetOffset, 0, this.maxOffset);
            this.currentOffset = clamp(this.currentOffset, 0, this.maxOffset);

            // Якщо очікує показ нової (щойно доданої) кнопки — підтягуємо
            // до неї targetOffset мінімально необхідно, щоб вона потрапила
            // у видиму частину viewport. Це вирішує ситуацію, коли щойно
            // запущена непришпинена програма додається в кінець контенту
            // і опиняється поза видимою (обрізаною) областю.
            if (this._pendingReveal) {
                const btn = this._pendingReveal;

                // ВАЖЛИВО: is_finalized() повертає true лише коли GObject
                // повністю звільнено (finalize). Якщо кнопку щойно
                // знищили через destroy() (наприклад, програма закрилась
                // одразу після запуску, ще до того як цей pendingReveal
                // встиг спрацювати), GObject уже "disposed", але JS-
                // обгортка ще жива — is_finalized() поверне false, а
                // будь-який виклик методу на ній (get_parent,
                // get_allocation_box) кине "already disposed —
                // impossible to access it" і зупинить ВЕСЬ measure() ще
                // до t._applyGeometry(), ламаючи геометрію на кожному
                // наступному перерахунку
                // (посилання на мертву кнопку нікуди не зникає).
                // Тому будь-який доступ до btn обов'язково в try/catch.
                let stillPending = false;
                let box = null;

                try {
                    if (
                        !btn.is_finalized?.() &&
                        btn.get_parent() === t._content
                    ) {
                        box = btn.get_allocation_box();
                        stillPending = true;
                    }
                } catch (e) {
                    stillPending = false;
                }

                if (!stillPending) {
                    this._clearPendingRevealSignal();
                    this._pendingReveal = null;
                    this._pendingRevealAttempts = 0;
                } else if (box && box.x2 > box.x1) {
                    this.targetOffset = clamp(
                        this._computeRevealOffset(box),
                        0,
                        this.maxOffset,
                    );
                    this._clearPendingRevealSignal();
                    this._pendingReveal = null;
                } else if (this._pendingRevealAttempts < 20) {
                    // Актор ще не отримав реальну алокацію (перший
                    // кадр після вставки) — пробуємо ще раз наступного
                    // перерахунку, а не втрачаємо запит на показ.
                    this._pendingRevealAttempts =
                        (this._pendingRevealAttempts || 0) + 1;
                    this.scheduleMeasure();
                } else {
                    this._clearPendingRevealSignal();
                    this._pendingReveal = null;
                    this._pendingRevealAttempts = 0;
                }
            }

            if (Math.abs(this.targetOffset - this.currentOffset) > 0.05) {
                this._startTicker();
            }
        }

        t._applyGeometry();
    }

    // Мінімальне зміщення targetOffset, щоб прямокутник [box.x1, box.x2]
    // (у системі координат content, без урахування translation) повністю
    // потрапив у видиму ширину viewport.
    _computeRevealOffset(box) {
        const margin = 4;
        let target = this.targetOffset;

        if (box.x2 - target > this.viewportWidth) {
            target = box.x2 - this.viewportWidth + margin;
        }
        if (box.x1 - target < 0) {
            target = box.x1 - margin;
        }

        return target;
    }

    // Викликається, коли в TaskbarContent з'явилась нова кнопка (новий
    // запуск непришпинованої програми, нова іконка тощо). Планує показ
    // цієї кнопки одразу, щойно стане відома її реальна алокація.
    requestReveal(buttonActor) {
        if (this._destroyed || !buttonActor) return;

        this._clearPendingRevealSignal();

        this._pendingReveal = buttonActor;
        this._pendingRevealAttempts = 0;

        // Проактивно звільняємось від посилання, щойно кнопку знищено
        // (наприклад, програма закрилась одразу після запуску, ще до
        // наступного measure()) — це головне джерело "already disposed"
        // при спробі отримати get_parent()/get_allocation_box() на
        // задиспозеному GObject. try/catch у measure() лишається як
        // страхувальна сітка, але цей сигнал прибирає причину заздалегідь.
        try {
            this._pendingRevealDestroyId = buttonActor.connect(
                "destroy",
                () => {
                    if (this._pendingReveal === buttonActor) {
                        this._pendingReveal = null;
                        this._pendingRevealAttempts = 0;
                    }
                    this._pendingRevealDestroyId = 0;
                },
            );
        } catch (e) {
            this._pendingRevealDestroyId = 0;
        }

        this.scheduleMeasure();
    }

    _clearPendingRevealSignal() {
        if (this._pendingReveal && this._pendingRevealDestroyId) {
            try {
                if (!this._pendingReveal.is_finalized?.())
                    this._pendingReveal.disconnect(
                        this._pendingRevealDestroyId,
                    );
            } catch (e) {}
        }
        this._pendingRevealDestroyId = 0;
    }

    // ── Керування позицією курсором (sigmoid-мапінг) ─────────────────────
    setMouseRatio(ratio) {
        if (this._destroyed || this._dragActive || !this.scrollingEnabled)
            return;

        const clamped = clamp(ratio, 0, 1);
        const eased = sigmoidEase(clamped);
        this.targetOffset = clamp(eased * this.maxOffset, 0, this.maxOffset);
        this._startTicker();
    }

    // ── Drag & Drop сумісність ────────────────────────────────────────────
    // Під час DND автоматичне зміщення тимчасово вимикається; після
    // завершення перетягування виконується рівно один остаточний
    // перерахунок геометрії.
    setDragActive(active) {
        if (this._destroyed) return;

        this._dragActive = !!active;

        if (this._dragActive) {
            this._stopTicker();
        } else {
            this.scheduleMeasure();
        }
    }

    // ── Плавне наближення currentOffset → targetOffset ───────────────────
    _startTicker() {
        if (this._tickId || this._destroyed) return;

        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FRAME_MS, () => {
            if (this._destroyed || this._dragActive) {
                this._tickId = 0;
                return GLib.SOURCE_REMOVE;
            }

            this.currentOffset +=
                (this.targetOffset - this.currentOffset) * SMOOTHING;

            if (
                Math.abs(this.targetOffset - this.currentOffset) < CONVERGE_EPS
            ) {
                this.currentOffset = this.targetOffset;
                this._taskbar._applyOffset();
                this._tickId = 0;
                return GLib.SOURCE_REMOVE;
            }

            this._taskbar._applyOffset();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopTicker() {
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
    }

    destroy() {
        this._destroyed = true;
        this._stopTicker();

        if (this._measureIdleId) {
            GLib.source_remove(this._measureIdleId);
            this._measureIdleId = 0;
        }

        this._clearPendingRevealSignal();
        this._pendingReveal = null;

        this._taskbar = null;
    }
}
