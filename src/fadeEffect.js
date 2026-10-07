import Cogl from "gi://Cogl";
import GObject from "gi://GObject";
import Shell from "gi://Shell";

const DECLARATIONS = `
uniform float left_fade;
uniform float right_fade;
uniform float fade_width;
`;

const CODE = `
vec2 uv = cogl_tex_coord0_in.xy;
float fade = 1.0;

if (fade_width > 0.00001) {
    if (left_fade > 0.5)
        fade = smoothstep(0.0, fade_width, uv.x);

    if (right_fade > 0.5)
        fade = min(
            fade,
            smoothstep(0.0, fade_width, 1.0 - uv.x)
        );
}

/*
 * Cogl використовує premultiplied alpha, тому множимо
 * весь вихідний колір, а не лише alpha.
 */
cogl_color_out *= fade;
`;

export const TaskbarFadeEffect = GObject.registerClass(
    class TaskbarFadeEffect extends Shell.GLSLEffect {
        _u = null;
        _lastState = null;

        vfunc_build_pipeline() {
            const hook =
                Shell.SnippetHook?.FRAGMENT ?? Cogl.SnippetHook.FRAGMENT;

            this.add_glsl_snippet(hook, DECLARATIONS, CODE, false);
        }

        _ensureUniforms() {
            if (this._u) return true;

            try {
                this._u = {
                    left: this.get_uniform_location("left_fade"),
                    right: this.get_uniform_location("right_fade"),
                    width: this.get_uniform_location("fade_width"),
                };

                return true;
            } catch (e) {
                console.warn(
                    `Panel Modifier: Failed to initialize taskbar fade uniforms: ${e.message}`,
                );

                this._u = null;
                return false;
            }
        }

        setFade(leftEnabled, rightEnabled, fadeWidthPx = 32) {
            const actor = this.actor;
            const actorWidth = actor?.get_width?.() ?? 0;

            /*
             * Shader працює з нормалізованими texture coordinates 0..1,
             * тому переводимо 32 px у нормалізовану ширину.
             */
            const normalizedWidth =
                actorWidth > 0
                    ? Math.min(0.5, Math.max(0, fadeWidthPx / actorWidth))
                    : 0;

            const left = !!leftEnabled;
            const right = !!rightEnabled;

            /*
             * Коли overflow немає, повністю вимикаємо effect.
             * Це важливо: тоді viewport не йде через offscreen shader
             * без необхідності.
             */
            const enabled = normalizedWidth > 0 && (left || right);

            const state = `${left ? 1 : 0}|${right ? 1 : 0}|${normalizedWidth}`;

            /*
             * Не штовхаємо uniforms у GPU на кожному кадрі без потреби.
             */
            if (state === this._lastState) return;

            this._lastState = state;

            if (!this._ensureUniforms()) return;

            this.set_uniform_float(this._u.left, 1, [left ? 1 : 0]);

            this.set_uniform_float(this._u.right, 1, [right ? 1 : 0]);

            this.set_uniform_float(this._u.width, 1, [normalizedWidth]);

            this.set_enabled(enabled);
            this.queue_repaint();
        }
    },
);
