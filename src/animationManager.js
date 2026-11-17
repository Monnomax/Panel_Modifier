import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Meta from "gi://Meta";

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

class ProfileRegistry {
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
            const defaults = { hover: 200, press: 150 };
            const custom = customData[storageKey] || defaults;
            return {
                showMode: base.show,
                hideMode: base.hide,
                showDur: custom.hover ?? defaults.hover,
                hideDur: custom.press ?? defaults.press,
            };
        }

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

class TransitionEngine {
    static _active = new WeakMap();

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
                } catch (e) {}
                propNames.forEach((p) => tracked.delete(p));
                resolve();
            });
        }).then(() => {
            if (onComplete) onComplete();
        });
    }

    static cancel(actor, propNames = null) {
        if (!actor || actor.is_destroyed?.()) return;
        const tracked = this._active.get(actor);
        const names = propNames ?? (tracked ? Array.from(tracked) : []);
        names.forEach((p) => {
            try {
                actor.remove_transition(p);
            } catch (e) {}
        });
        if (tracked) names.forEach((p) => tracked.delete(p));
    }
}

class FlipTransition {
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

        const first = liveActors.map((a) => a.get_transformed_extents());

        applyFn();

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

                    if (
                        Math.abs(dx) < 0.5 &&
                        Math.abs(dy) < 0.5 &&
                        Math.abs(sx - 1) < 0.01 &&
                        Math.abs(sy - 1) < 0.01
                    ) {
                        return;
                    }

                    a.set_pivot_point(0, 0);
                    a.translation_x = dx;
                    a.translation_y = dy;
                    a.scale_x = sx;
                    a.scale_y = sy;

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

                return GLib.SOURCE_REMOVE;
            });
        });
    }
}

class TransitionScheduler {
    static _pending = new Map();
    static _scheduledTokens = new Set();

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

export class AnimationManager {
    static getAnimationData(animIdentifier, settings = null, namespace = null) {
        return ProfileRegistry.getAnimation(
            animIdentifier,
            settings,
            namespace,
        );
    }

    static getAnimation(animIdentifier, settings = null, namespace = null) {
        return this.getAnimationData(animIdentifier, settings, namespace);
    }

    static run(
        actor,
        props,
        {
            animId = "Quad",
            settings = null,
            namespace = null,
            phase = "show",
            duration: durationOverride = null,
        } = {},
    ) {
        const anim = ProfileRegistry.getAnimation(animId, settings, namespace);

        const mode = phase === "show" ? anim.showMode : anim.hideMode;

        const duration =
            durationOverride ??
            (phase === "show" ? anim.showDur : anim.hideDur);

        return TransitionEngine.run(actor, props, {
            mode,
            duration,
        });
    }

    static cancel(actor, propNames = null) {
        TransitionEngine.cancel(actor, propNames);
    }

    static layout(actors, applyFn, opts = {}) {
        return FlipTransition.run(actors, applyFn, opts);
    }

    static scheduleLayout(token, actor, applyFn, flipOpts = {}) {
        return TransitionScheduler.schedule(token, actor, applyFn, flipOpts);
    }
}
