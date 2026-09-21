import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Meta from "gi://Meta";

/**
 * ============================================================================
 * ANIMATIONS — таблиця профілів (крива show/hide + тривалість за замовчуванням).
 * Це "мова" всіх переходів у розширенні. Нові профілі додаються тут і одразу
 * стають доступні для будь-якого namespace (tooltip, preview, icon, layout...).
 * ============================================================================
 */
export const ANIMATIONS = {
    Back: {
        show: Clutter.AnimationMode.EASE_OUT_BACK,
        hide: Clutter.AnimationMode.EASE_IN_BACK,
        def: 350,
    },
    Bounce: {
        show: Clutter.AnimationMode.EASE_OUT_BOUNCE,
        hide: Clutter.AnimationMode.EASE_IN_BOUNCE,
        def: 500,
    },
    Circ: {
        show: Clutter.AnimationMode.EASE_OUT_CIRC,
        hide: Clutter.AnimationMode.EASE_IN_CIRC,
        def: 300,
    },
    Cubic: {
        show: Clutter.AnimationMode.EASE_OUT_CUBIC,
        hide: Clutter.AnimationMode.EASE_IN_CUBIC,
        def: 300,
    },
    Elastic: {
        show: Clutter.AnimationMode.EASE_OUT_ELASTIC,
        hide: Clutter.AnimationMode.EASE_IN_ELASTIC,
        def: 800,
    },
    Expo: {
        show: Clutter.AnimationMode.EASE_OUT_EXPO,
        hide: Clutter.AnimationMode.EASE_IN_EXPO,
        def: 400,
    },
    Linear: {
        show: Clutter.AnimationMode.LINEAR,
        hide: Clutter.AnimationMode.LINEAR,
        def: 200,
    },
    Quad: {
        show: Clutter.AnimationMode.EASE_OUT_QUAD,
        hide: Clutter.AnimationMode.EASE_IN_QUAD,
        def: 250,
    },
    Quart: {
        show: Clutter.AnimationMode.EASE_OUT_QUART,
        hide: Clutter.AnimationMode.EASE_IN_QUART,
        def: 300,
    },
    Quint: {
        show: Clutter.AnimationMode.EASE_OUT_QUINT,
        hide: Clutter.AnimationMode.EASE_IN_QUINT,
        def: 350,
    },
    Sine: {
        show: Clutter.AnimationMode.EASE_OUT_SINE,
        hide: Clutter.AnimationMode.EASE_IN_SINE,
        def: 200,
    },
};

/**
 * ============================================================================
 * ProfileRegistry — чистий резолвер конфігурації (без жодної роботи з акторами).
 * Це фактично твій попередній AnimationManager.getAnimation(), винесений
 * в окремий шар, щоб він залишався тривіально тестованим і незалежним
 * від Clutter-виконання.
 * ============================================================================
 */
class ProfileRegistry {
    /**
     * Універсальний метод отримання параметрів анімації.
     * @param {string|number} animIdentifier - Назва анімації (рядок) або її індекс (число).
     * @param {Gio.Settings|null} settings - Налаштування для витягування custom-settings (опціонально).
     * @param {string|null} namespace - Префікс у JSON: 'tooltip', 'preview', 'icon', 'layout', або null для autohide.
     * @returns {{showMode:number,hideMode:number,showDur:number,hideDur:number}}
     */
    static getAnimation(animIdentifier, settings = null, namespace = null) {
        const keys = Object.keys(ANIMATIONS);
        let animName = "Quad";

        if (typeof animIdentifier === "number") {
            const safeIndex =
                animIdentifier >= 0 && animIdentifier < keys.length
                    ? animIdentifier
                    : 6;
            animName = keys[safeIndex];
        } else if (
            typeof animIdentifier === "string" &&
            ANIMATIONS[animIdentifier]
        ) {
            animName = animIdentifier;
        }

        const base = ANIMATIONS[animName];
        let customData = {};

        if (settings) {
            try {
                const customStr = settings.get_string(
                    "animation-custom-settings",
                );
                if (customStr) customData = JSON.parse(customStr);
            } catch (e) {
                customData = {};
            }
        }

        const storageKey = namespace ? `${namespace}:${animName}` : animName;

        if (namespace === "icon") {
            // Для іконок таскбару: hover — при наведенні (showDur), press — при натисканні (hideDur)
            const defaults = { hover: 200, press: 150 };
            const custom = customData[storageKey] || defaults;
            return {
                showMode: base.show,
                hideMode: base.hide,
                showDur: custom.hover ?? defaults.hover,
                hideDur: custom.press ?? defaults.press,
            };
        }

        // Для tooltip, preview, layout та autohide: show/hide
        const custom = customData[storageKey] || {
            show: base.def,
            hide: base.def,
        };
        return {
            showMode: base.show,
            hideMode: base.hide,
            showDur: custom.show ?? base.def,
            hideDur: custom.hide ?? base.def,
        };
    }
}

/**
 * ============================================================================
 * TransitionEngine — єдине місце, де реально викликається actor.ease().
 * Відповідає за:
 *  - запуск property-переходів з правильним easing state,
 *  - скасування "висячих" переходів перед новим запуском (анти-flicker),
 *  - Promise-based завершення для координації (FLIP, scheduler).
 * ============================================================================
 */
class TransitionEngine {
    // actor -> Set<string> активних властивостей, що анімуються
    static _active = new WeakMap();

    /**
     * Запускає property-перехід на акторі.
     * @param {Clutter.Actor} actor
     * @param {Object} props - цільові значення властивостей (opacity, scale_x, translation_y, ...)
     * @param {{mode:number, duration:number, onComplete?:Function}} opts
     * @returns {Promise<void>}
     */
    static run(actor, props, { mode, duration, onComplete } = {}) {
        if (!actor || actor.is_destroyed?.()) return Promise.resolve();

        const propNames = Object.keys(props);
        this.cancel(actor, propNames);

        let tracked = this._active.get(actor);
        if (!tracked) {
            tracked = new Set();
            this._active.set(actor, tracked);
        }
        propNames.forEach((p) => tracked.add(p));

        actor.save_easing_state();
        actor.set_easing_mode(mode);
        actor.set_easing_duration(duration);
        Object.assign(actor, props);
        actor.restore_easing_state();

        return new Promise((resolve) => {
            const id = actor.connect("transitions-completed", () => {
                try {
                    if (actor && !actor.is_destroyed?.()) {
                        actor.disconnect(id);
                    }
                } catch (e) {
                    // Ignore stale-disconnect errors if the actor is already gone.
                }
                propNames.forEach((p) => tracked.delete(p));
                resolve();
            });
        }).then(() => {
            if (onComplete) onComplete();
        });
    }

    /**
     * Скасовує активні переходи на акторі (усі або лише перелічені властивості).
     * Критично для швидких повторних станів (drag, rapid hover), де інакше
     * лишаються "висячі" tweens, що конфліктують.
     * @param {Clutter.Actor} actor
     * @param {string[]|null} propNames
     */
    static cancel(actor, propNames = null) {
        if (!actor || actor.is_destroyed?.()) return;
        const tracked = this._active.get(actor);
        const names = propNames ?? (tracked ? Array.from(tracked) : []);
        names.forEach((p) => {
            try {
                actor.remove_transition(p);
            } catch (e) {
                /* немає активного transition — ок */
            }
        });
        if (tracked) names.forEach((p) => tracked.delete(p));
    }
}

/**
 * ============================================================================
 * FlipTransition — First-Last-Invert-Play для переходів компонування (layout).
 * Дозволяє анімувати наслідки reflow (Dynamic Width, зміна позиції TaskBar,
 * вставку/видалення кнопок), не борючись з St layout manager: реальна зміна
 * застосовується миттєво, а потім актор "доганяє" свою нову геометрію
 * через translation/scale.
 * ============================================================================
 */
class FlipTransition {
    /**
     * @param {Clutter.Actor[]} actors - актори, чия геометрія зміниться.
     * @param {Function} applyFn - синхронна мутація (reparent, toggle width mode, insert/remove).
     * @param {{animId?:string|number, settings?:Gio.Settings, namespace?:string}} opts
     * @returns {Promise<void>} - резолвиться після завершення всіх анімацій.
     */
    static run(
        actors,
        applyFn,
        { animId = "Cubic", settings = null, namespace = "layout" } = {},
    ) {
        const liveActors = actors.filter((a) => a && !a.is_destroyed?.());
        if (liveActors.length === 0) {
            applyFn();
            return Promise.resolve();
        }

        // FIRST: фіксуємо геометрію в координатах stage до зміни
        const first = liveActors.map((a) => a.get_transformed_extents());

        // Синхронна мутація компонування
        applyFn();

        // Чекаємо на завершення реального relayout перед вимірюванням LAST.
        //
        // ВАЖЛИВО: GLib.idle_add тут НЕ підходить. queue_relayout() лише
        // позначає актор як "потребує перерахунку" — сам allocation
        // перераховується під час relayout-проходу Clutter, який на Wayland
        // прив'язаний до frame clock композитора, а не до GLib mainloop.
        // idle_add майже завжди спрацьовує РАНІШЕ, ніж встигає відбутися
        // реальний relayout — тоді get_transformed_extents() повертає ще
        // старий (до-мутаційний) bounding box, дельта виходить ~0, і FLIP
        // фактично нічого не анімує (актор просто миттєво "телепортується").
        //
        // Meta.later_add(Meta.LaterType.BEFORE_REDRAW, ...) — офіційний
        // механізм Mutter саме для "виконати колбек після relayout, але
        // перед фактичним перемальовуванням кадру". Це той самий примітив,
        // яким користується сам GNOME Shell для роботи, залежної від
        // свіжого allocation.
        return new Promise((resolve) => {
            Meta.later_add(Meta.LaterType.BEFORE_REDRAW, () => {
                const anim = ProfileRegistry.getAnimation(
                    animId,
                    settings,
                    namespace,
                );
                const pending = [];

                liveActors.forEach((a, i) => {
                    if (a.is_destroyed?.()) return;

                    const last = a.get_transformed_extents();
                    const lastW = Math.max(last.get_width(), 1);
                    const lastH = Math.max(last.get_height(), 1);

                    const dx = first[i].get_x() - last.get_x();
                    const dy = first[i].get_y() - last.get_y();
                    const sx = first[i].get_width() / lastW;
                    const sy = first[i].get_height() / lastH;

                    // Якщо різниці немає — не чіпаємо актор взагалі
                    if (
                        Math.abs(dx) < 0.5 &&
                        Math.abs(dy) < 0.5 &&
                        Math.abs(sx - 1) < 0.01 &&
                        Math.abs(sy - 1) < 0.01
                    ) {
                        return;
                    }

                    // INVERT: миттєво повертаємо актор туди, де він виглядав "раніше"
                    a.set_pivot_point(0, 0);
                    a.translation_x = dx;
                    a.translation_y = dy;
                    a.scale_x = sx;
                    a.scale_y = sy;

                    // PLAY: анімуємо до ідентичності (реальної нової позиції)
                    pending.push(
                        TransitionEngine.run(
                            a,
                            {
                                translation_x: 0,
                                translation_y: 0,
                                scale_x: 1,
                                scale_y: 1,
                            },
                            { mode: anim.showMode, duration: anim.showDur },
                        ),
                    );
                });

                Promise.all(pending).then(resolve);

                // GLib.SOURCE_REMOVE (false) — виконати колбек лише один раз
                return GLib.SOURCE_REMOVE;
            });
        });
    }
}

/**
 * ============================================================================
 * TransitionScheduler — батчить кілька layout-мутацій, що відбуваються
 * в межах одного тіку, в один спільний FLIP-прохід. Це те, що дає ефект
 * "панель — єдиний живий об'єкт" замість кількох незалежних анімацій.
 * ============================================================================
 */
class TransitionScheduler {
    static _pending = new Map(); // token -> { actors:[], applyFns:[] }
    static _scheduledTokens = new Set();

    /**
     * Реєструє мутацію компонування під спільним токеном (напр. 'panel-layout').
     * Усі виклики з однаковим токеном у межах поточного циклу подій будуть
     * застосовані та заанімовані одним координованим FLIP-переходом.
     * @param {string} token
     * @param {Clutter.Actor} actor
     * @param {Function} applyFn
     * @param {Object} [flipOpts] - передається у FlipTransition.run (animId, settings, namespace)
     * @returns {Promise<void>}
     */
    static schedule(token, actor, applyFn, flipOpts = {}) {
        if (!this._pending.has(token)) {
            this._pending.set(token, {
                actors: [],
                applyFns: [],
                flipOpts,
                resolvers: [],
            });
        }
        const batch = this._pending.get(token);
        if (actor) batch.actors.push(actor);
        batch.applyFns.push(applyFn);
        Object.assign(batch.flipOpts, flipOpts);

        const donePromise = new Promise((resolve) =>
            batch.resolvers.push(resolve),
        );

        if (!this._scheduledTokens.has(token)) {
            this._scheduledTokens.add(token);
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._scheduledTokens.delete(token);
                const b = this._pending.get(token);
                this._pending.delete(token);
                if (!b) return GLib.SOURCE_REMOVE;

                FlipTransition.run(
                    b.actors,
                    () => b.applyFns.forEach((fn) => fn()),
                    b.flipOpts,
                ).then(() => b.resolvers.forEach((r) => r()));

                return GLib.SOURCE_REMOVE;
            });
        }

        return donePromise;
    }
}

/**
 * ============================================================================
 * AnimationManager — публічний фасад. Єдина точка входу для будь-якого
 * переходу в розширенні. Зворотно сумісний: getAnimation() не змінився.
 * ============================================================================
 */
export class AnimationManager {
    /** @deprecated лишається для сумісності — делегує в ProfileRegistry */
    static getAnimation(animIdentifier, settings = null, namespace = null) {
        return ProfileRegistry.getAnimation(
            animIdentifier,
            settings,
            namespace,
        );
    }

    /**
     * Простий property-перехід (tooltip, preview, icon, autohide тощо).
     * @param {Clutter.Actor} actor
     * @param {Object} props - цільові властивості (opacity, translation_y, scale_x, ...)
     * @param {{animId:string|number, settings?:Gio.Settings, namespace?:string|null, phase?:'show'|'hide'}} opts
     * @returns {Promise<void>}
     *
     * Приклад (Tooltip show):
     *   AnimationManager.run(tooltipActor, { opacity: 255, translation_y: 0 }, {
     *       animId: settings.get_int('tooltip-animation'),
     *       settings, namespace: 'tooltip', phase: 'show'
     *   });
     */
    static run(
        actor,
        props,
        {
            animId = "Quad",
            settings = null,
            namespace = null,
            phase = "show",
        } = {},
    ) {
        const anim = ProfileRegistry.getAnimation(animId, settings, namespace);
        const mode = phase === "show" ? anim.showMode : anim.hideMode;
        const duration = phase === "show" ? anim.showDur : anim.hideDur;
        return TransitionEngine.run(actor, props, { mode, duration });
    }

    /** Скасувати активні переходи на акторі (наприклад, у disable() чи при швидкій зміні стану) */
    static cancel(actor, propNames = null) {
        TransitionEngine.cancel(actor, propNames);
    }

    /**
     * Разовий FLIP-перехід компонування без батчингу через scheduler.
     * Використовувати, коли мутація гарантовано одинока (не частина
     * ширшої групи змін в тому ж тіку).
     * @param {Clutter.Actor[]} actors
     * @param {Function} applyFn
     * @param {{animId?:string|number, settings?:Gio.Settings, namespace?:string}} opts
     * @returns {Promise<void>}
     *
     * Приклад (Dynamic Width toggle):
     *   AnimationManager.layout([panelBox, ...taskbarButtons], () => {
     *       panel.dynamicWidthEnabled = !panel.dynamicWidthEnabled;
     *       panel.relayout();
     *   }, { animId: 'Cubic', settings });
     */
    static layout(actors, applyFn, opts = {}) {
        return FlipTransition.run(actors, applyFn, opts);
    }

    /**
     * Батчований FLIP-перехід — кілька незалежних змін компонування, що
     * трапляються в одному тіку (напр. вставка кнопки + resize панелі
     * + зсув clock), склеюються в один координований перехід.
     * @param {string} token - спільний ідентифікатор групи (напр. 'panel-layout')
     * @param {Clutter.Actor} actor - актор, чия геометрія зміниться цією мутацією (може бути null)
     * @param {Function} applyFn - сама мутація
     * @param {Object} [flipOpts]
     * @returns {Promise<void>}
     *
     * Приклад (TaskBar position change, кілька акторів рухаються разом):
     *   AnimationManager.scheduleLayout('panel-layout', button, () => {
     *       taskbar.setPosition('center');
     *   }, { animId: 'Cubic', settings });
     */
    static scheduleLayout(token, actor, applyFn, flipOpts = {}) {
        return TransitionScheduler.schedule(token, actor, applyFn, flipOpts);
    }
}
