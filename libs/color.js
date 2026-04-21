import { Canvex } from "./canvex.js";
export const Color = class {
    /**
     * Creates a normalized color object.
     *
     * Supported inputs:
     * - `Color.color(gray)`
     * - `Color.color(gray, alpha)`
     * - `Color.color(r, g, b)`
     * - `Color.color(r, g, b, a)`
     * - `Color.color("#ff00aa")`
     * - `Color.color("rgb(255, 0, 0)")`
     * - `Color.color([255, 0, 0, 128])`
     * - `Color.color({ r: 255, g: 0, b: 0, a: 128 })`
     *
     * @param {...*} input - Color input.
     * @returns {{ r: number, g: number, b: number, a: number }} Normalized color object.
     */
    static color(...input) {
        return this.#parse(input.length === 1 ? input[0] : input);
    }

    /**
     * Gets or sets the alpha channel.
     *
     * @param {*} color - Source color.
     * @param {number} [value] - New alpha value in the range `0..255`.
     * @returns {number|{ r: number, g: number, b: number, a: number }} Alpha channel when called as a getter, otherwise a new color.
     */
    static alpha(color, value) {
        const c = this.#parse(color);
        if (arguments.length === 1) return c.a;
        return { ...c, a: this.#clamp255(value) };
    }

    /**
     * Gets or sets the blue channel.
     *
     * @param {*} color - Source color.
     * @param {number} [value] - New blue value in the range `0..255`.
     * @returns {number|{ r: number, g: number, b: number, a: number }} Blue channel when called as a getter, otherwise a new color.
     */
    static blue(color, value) {
        const c = this.#parse(color);
        if (arguments.length === 1) return c.b;
        return { ...c, b: this.#clamp255(value) };
    }

    /**
     * Gets or sets brightness using the HSV/HSB value channel.
     *
     * @param {*} color - Source color.
     * @param {number} [value] - New brightness in the range `0..100`.
     * @returns {number|{ r: number, g: number, b: number, a: number }} Brightness when called as a getter, otherwise a new color.
     */
    static brightness(color, value) {
        const c = this.#parse(color);
        const hsv = this.#rgbToHsv(c.r, c.g, c.b);
        if (arguments.length === 1) return hsv.v;
        const rgb = this.#hsvToRgb(hsv.h, hsv.s, this.#clamp(value, 0, 100));
        return { ...rgb, a: c.a };
    }

    /**
     * Gets or sets the green channel.
     *
     * @param {*} color - Source color.
     * @param {number} [value] - New green value in the range `0..255`.
     * @returns {number|{ r: number, g: number, b: number, a: number }} Green channel when called as a getter, otherwise a new color.
     */
    static green(color, value) {
        const c = this.#parse(color);
        if (arguments.length === 1) return c.g;
        return { ...c, g: this.#clamp255(value) };
    }

    /**
     * Gets or sets hue using the HSL color model.
     *
     * @param {*} color - Source color.
     * @param {number} [value] - New hue in degrees.
     * @returns {number|{ r: number, g: number, b: number, a: number }} Hue when called as a getter, otherwise a new color.
     */
    static hue(color, value) {
        const c = this.#parse(color);
        const hsl = this.#rgbToHsl(c.r, c.g, c.b);
        if (arguments.length === 1) return hsl.h;
        const rgb = this.#hslToRgb(this.#wrapHue(value), hsl.s, hsl.l);
        return { ...rgb, a: c.a };
    }

    /**
     * Linearly interpolates between two colors.
     *
     * @param {*} color1 - Starting color.
     * @param {*} color2 - Ending color.
     * @param {number} amount - Interpolation amount from `0` to `1`.
     * @returns {{ r: number, g: number, b: number, a: number }} Interpolated color.
     */
    static lerpColor(color1, color2, amount) {
        const a = this.#parse(color1);
        const b = this.#parse(color2);
        const t = this.#clamp(Number(amount), 0, 1);
        return {
            r: this.#clamp255(a.r + (b.r - a.r) * t),
            g: this.#clamp255(a.g + (b.g - a.g) * t),
            b: this.#clamp255(a.b + (b.b - a.b) * t),
            a: this.#clamp255(a.a + (b.a - a.a) * t),
        };
    }

    /**
     * Gets or sets lightness using the HSL color model.
     *
     * @param {*} color - Source color.
     * @param {number} [value] - New lightness in the range `0..100`.
     * @returns {number|{ r: number, g: number, b: number, a: number }} Lightness when called as a getter, otherwise a new color.
     */
    static lightness(color, value) {
        const c = this.#parse(color);
        const hsl = this.#rgbToHsl(c.r, c.g, c.b);
        if (arguments.length === 1) return hsl.l;
        const rgb = this.#hslToRgb(hsl.h, hsl.s, this.#clamp(value, 0, 100));
        return { ...rgb, a: c.a };
    }

    /**
     * Interpolates across a palette.
     *
     * Supported forms:
     * - `Color.paletteLerp(["white", "red", "green"], t)`
     * - `Color.paletteLerp(["white", 0], ["red", 0.05], ["green", 0.25], ["blue", 1], t)`
     *
     * In the first form, colors are distributed evenly across `0..1`.
     * In the second form, each stop is defined as `[color, position]` where `position`
     * is a number from `0` to `1`.
     *
     * @param {...*} args - Palette arguments followed by an interpolation amount.
     * @returns {{ r: number, g: number, b: number, a: number }} Interpolated color.
     */
    static paletteLerp(...args) {
        if (args.length < 2) {
            throw new TypeError("paletteLerp expects at least one palette and an interpolation amount");
        }

        const amount = this.#clamp(Number(args.at(-1)), 0, 1);
        const paletteArgs = args.slice(0, -1);

        // Form: Color.paletteLerp(["white", "red", "green"], t)
        if (paletteArgs.length === 1 && Array.isArray(paletteArgs[0]) && !this.#isStop(paletteArgs[0])) {
            const colors = paletteArgs[0];
            if (colors.length === 0) {
                throw new TypeError("paletteLerp expects a non-empty palette");
            }
            if (colors.length === 1) {
                return this.#parse(colors[0]);
            }

            const scaled = amount * (colors.length - 1);
            const index = Math.min(colors.length - 2, Math.floor(scaled));
            const localT = scaled - index;
            return this.lerpColor(colors[index], colors[index + 1], localT);
        }

        // Form: Color.paletteLerp([color, pos], [color, pos], ..., t)
        const stops = paletteArgs.map((entry) => {
            if (!this.#isStop(entry)) {
                throw new TypeError(
                    "paletteLerp stop entries must be arrays in the form [color, position]"
                );
            }
            return {
                color: this.#parse(entry[0]),
                position: this.#clamp(Number(entry[1]), 0, 1),
            };
        }).sort((a, b) => a.position - b.position);

        if (stops.length === 0) {
            throw new TypeError("paletteLerp expects at least one stop");
        }

        if (amount <= stops[0].position) {
            return stops[0].color;
        }

        if (amount >= stops.at(-1).position) {
            return stops.at(-1).color;
        }

        for (let i = 0; i < stops.length - 1; i += 1) {
            const a = stops[i];
            const b = stops[i + 1];

            if (amount >= a.position && amount <= b.position) {
                const span = b.position - a.position;
                const localT = span === 0 ? 0 : (amount - a.position) / span;
                return this.lerpColor(a.color, b.color, localT);
            }
        }

        return stops.at(-1).color;
    }

    /**
     * Gets or sets the red channel.
     *
     * @param {*} color - Source color.
     * @param {number} [value] - New red value in the range `0..255`.
     * @returns {number|{ r: number, g: number, b: number, a: number }} Red channel when called as a getter, otherwise a new color.
     */
    static red(color, value) {
        const c = this.#parse(color);
        if (arguments.length === 1) return c.r;
        return { ...c, r: this.#clamp255(value) };
    }

    /**
     * Gets or sets saturation using the HSL color model.
     *
     * @param {*} color - Source color.
     * @param {number} [value] - New saturation in the range `0..100`.
     * @returns {number|{ r: number, g: number, b: number, a: number }} Saturation when called as a getter, otherwise a new color.
     */
    static saturation(color, value) {
        const c = this.#parse(color);
        const hsl = this.#rgbToHsl(c.r, c.g, c.b);
        if (arguments.length === 1) return hsl.s;
        const rgb = this.#hslToRgb(hsl.h, this.#clamp(value, 0, 100), hsl.l);
        return { ...rgb, a: c.a };
    }

    /**
     * Converts a normalized color object into a CSS `rgba(...)` string.
     *
     * @param {*} color - Source color.
     * @returns {string} CSS color string.
     */
    static toString(color) {
        const c = this.#parse(color);
        const alpha = +(c.a / 255).toFixed(4);
        return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
    }


    /**
     * Creates a canvas gradient.
     *
     * Supported forms:
     * - `Color.gradient("linear", x0, y0, x1, y1, [[0, "#fff"], [1, "#000"]])`
     * - `Color.gradient("radial", x0, y0, r0, x1, y1, r1, [[0, "#fff"], [1, "#000"]])`
     *
     * Stop entries may be arrays like `[offset, color]` or objects like
     * `{ offset: 0.5, color: "orange" }`.
     *
     * If a rendering context is not passed explicitly, the method tries to use
     * `globalThis.Canvex?.ctx`.
     *
     * @param {...*} args - Gradient arguments.
     * @returns {CanvasGradient} A native canvas gradient object.
     */
/**
 * Creates a canvas gradient definition or an immediate native gradient when
 * a rendering context is supplied explicitly as the first argument.
 *
 * Supported forms:
 * - `Color.gradient("linear", x0, y0, x1, y1, [[0, "#fff"], [1, "#000"]])`
 * - `Color.gradient("radial", x0, y0, r0, x1, y1, r1, [[0, "#fff"], [1, "#000"]])`
 * - `Color.gradient(ctx, "linear", ...)`
 * - `Color.gradient(ctx, "radial", ...)`
 *
 * Without an explicit rendering context, this returns a plain object that
 * can be passed to `Canvas.fill(...)` / `Canvas.stroke(...)`.
 *
 * @param {...*} args - Gradient arguments.
 * @returns {CanvasGradient|Object} A native gradient or a deferred gradient definition.
 */
static gradient(...args) {
    let ctx = null;

    if (this.#isRenderingContext(args[0])) {
        ctx = args.shift();
    }

    const type = String(args.shift() ?? '').trim().toLowerCase();

    if (type === 'linear') {
        if (args.length < 5) {
            throw new TypeError('Linear gradients require x0, y0, x1, y1, and at least one color stop.');
        }

        const [x0, y0, x1, y1, ...stopArgs] = args;
        const definition = {
            __canvexStyle: 'gradient',
            type: 'linear',
            x0: this.#finiteGradientNumber(x0, 'x0'),
            y0: this.#finiteGradientNumber(y0, 'y0'),
            x1: this.#finiteGradientNumber(x1, 'x1'),
            y1: this.#finiteGradientNumber(y1, 'y1'),
            stops: this.#normalizeGradientStops(stopArgs),
        };

        return ctx ? this.#createGradientFromDefinition(definition, ctx) : definition;
    }

    if (type === 'radial') {
        if (args.length < 7) {
            throw new TypeError('Radial gradients require x0, y0, r0, x1, y1, r1, and at least one color stop.');
        }

        const [x0, y0, r0, x1, y1, r1, ...stopArgs] = args;
        const definition = {
            __canvexStyle: 'gradient',
            type: 'radial',
            x0: this.#finiteGradientNumber(x0, 'x0'),
            y0: this.#finiteGradientNumber(y0, 'y0'),
            r0: this.#finiteGradientNumber(r0, 'r0'),
            x1: this.#finiteGradientNumber(x1, 'x1'),
            y1: this.#finiteGradientNumber(y1, 'y1'),
            r1: this.#finiteGradientNumber(r1, 'r1'),
            stops: this.#normalizeGradientStops(stopArgs),
        };

        return ctx ? this.#createGradientFromDefinition(definition, ctx) : definition;
    }

    throw new TypeError('Color.gradient() type must be "linear" or "radial".');
}

/**
 * Resolves a solid color, a deferred gradient definition, or an already
 * materialized native canvas style into a value assignable to
 * `ctx.fillStyle` / `ctx.strokeStyle`.
 *
 * @param {*} style - Solid color or style object.
 * @param {*} [ctx] - Optional 2D rendering context used to materialize gradients.
 * @returns {string|CanvasGradient|CanvasPattern|Object} The resolved canvas style.
 */
static resolveStyle(style, ctx = Canvex?.ctx ?? globalThis?.Canvex?.ctx ?? null) {
    if (this.#isGradientDefinition(style)) {
        return ctx ? this.#createGradientFromDefinition(style, ctx) : style;
    }

    if (this.#isNativeCanvasStyle(style)) {
        return style;
    }

    return this.toString(style);
}

static #createGradientFromDefinition(definition, ctx) {
    if (!this.#isGradientDefinition(definition)) {
        throw new TypeError('Gradient definition is invalid.');
    }

    if (!this.#isRenderingContext(ctx)) {
        throw new Error('A 2D rendering context is required to materialize a gradient.');
    }

    const gradient = definition.type === 'linear'
        ? ctx.createLinearGradient(definition.x0, definition.y0, definition.x1, definition.y1)
        : ctx.createRadialGradient(definition.x0, definition.y0, definition.r0, definition.x1, definition.y1, definition.r1);

    for (const stop of definition.stops) {
        gradient.addColorStop(stop.offset, stop.color);
    }

    return gradient;
}

static #isRenderingContext(value) {
    return !!(
        value
        && typeof value === 'object'
        && typeof value.createLinearGradient === 'function'
        && typeof value.createRadialGradient === 'function'
    );
}

static #isGradientDefinition(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    const type = String(value.type ?? value.gradientType ?? '').trim().toLowerCase();
    return Array.isArray(value.stops) && (type === 'linear' || type === 'radial');
}

static #isNativeCanvasStyle(value) {
    return !!(
        value
        && typeof value === 'object'
        && !Array.isArray(value)
        && !this.#isGradientDefinition(value)
        && (
            typeof value.addColorStop === 'function'
            || typeof value.setTransform === 'function'
        )
    );
}

static #normalizeGradientStops(stopArgs) {
    if (stopArgs.length === 0) {
        throw new TypeError('Color.gradient() requires at least one color stop.');
    }

    const rawStops =
        stopArgs.length === 1
        && Array.isArray(stopArgs[0])
        && stopArgs[0].every((entry) => Array.isArray(entry) || (entry && typeof entry === 'object'))
            ? stopArgs[0]
            : stopArgs;

    if (!Array.isArray(rawStops) || rawStops.length === 0) {
        throw new TypeError('Gradient stops must be provided as an array of stops.');
    }

    return rawStops.map((entry) => {
        let offset;
        let color;

        if (Array.isArray(entry)) {
            [offset, color] = entry;
        } else if (entry && typeof entry === 'object') {
            offset = entry.offset ?? entry.position;
            color = entry.color ?? entry.value;
        } else {
            throw new TypeError('Each gradient stop must be [offset, color] or { offset, color }.');
        }

        if (typeof color === 'undefined') {
            throw new TypeError('Each gradient stop must include a color.');
        }

        if (this.#isGradientDefinition(color) || this.#isNativeCanvasStyle(color)) {
            throw new TypeError('Gradient stop colors must be solid CSS-compatible colors.');
        }

        return {
            offset: this.#clamp(Number(offset), 0, 1),
            color: this.toString(color),
        };
    });
}
    static #finiteGradientNumber(value, label) {
        const n = Number(value);
        if (!Number.isFinite(n)) {
            throw new TypeError(`Gradient ${label} must be a finite number`);
        }
        return n;
    }

    static #isStop(value) {
        return Array.isArray(value) && value.length === 2 && typeof value[1] === "number";
    }

    static #parse(input) {
        if (this.#isGradientDefinition(input) || this.#isNativeCanvasStyle(input)) {
            throw new TypeError('Canvas style objects cannot be converted into RGBA channel data.');
        }

        if (Array.isArray(input)) {
            if (input.length === 0) return { r: 0, g: 0, b: 0, a: 255 };

            const isNumericTuple = input.every(
                (value) => typeof value === "number" || (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value)))
            );

            if (isNumericTuple) {
                const values = input.map(Number);
                if (values.length === 1) {
                    const gray = this.#clamp255(values[0]);
                    return { r: gray, g: gray, b: gray, a: 255 };
                }
                if (values.length === 2) {
                    const gray = this.#clamp255(values[0]);
                    return { r: gray, g: gray, b: gray, a: this.#clamp255(values[1]) };
                }
                if (values.length === 3) {
                    return {
                        r: this.#clamp255(values[0]),
                        g: this.#clamp255(values[1]),
                        b: this.#clamp255(values[2]),
                        a: 255,
                    };
                }
                return {
                    r: this.#clamp255(values[0]),
                    g: this.#clamp255(values[1]),
                    b: this.#clamp255(values[2]),
                    a: this.#clamp255(values[3]),
                };
            }

            if (input.length === 1) {
                return this.#parse(input[0]);
            }
        }

        if (typeof input === "number") {
            const gray = this.#clamp255(input);
            return { r: gray, g: gray, b: gray, a: 255 };
        }

        if (typeof input === "string") {
            return this.#parseCssColor(input);
        }

        if (input && typeof input === "object") {
            if ("r" in input || "g" in input || "b" in input || "a" in input) {
                return {
                    r: this.#clamp255(Number(input.r ?? 0)),
                    g: this.#clamp255(Number(input.g ?? 0)),
                    b: this.#clamp255(Number(input.b ?? 0)),
                    a: this.#clamp255(Number(input.a ?? 255)),
                };
            }
        }

        throw new TypeError("Unsupported color input");
    }

    static #parseCssColor(value) {
        const text = String(value).trim();

        if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text)) {
            return this.#parseHex(text);
        }

        if (typeof document !== "undefined") {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            if (ctx) {
                ctx.fillStyle = "#000";
                ctx.fillStyle = text;
                const resolved = String(ctx.fillStyle).trim();

                if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(resolved)) {
                    return this.#parseHex(resolved);
                }

                const rgbMatch = resolved.match(/^rgba?\(([^)]+)\)$/i);
                if (rgbMatch) {
                    const parts = rgbMatch[1].split(",").map((part) => Number(part.trim()));
                    return {
                        r: this.#clamp255(parts[0]),
                        g: this.#clamp255(parts[1]),
                        b: this.#clamp255(parts[2]),
                        a: this.#clamp255((parts[3] ?? 1) * 255),
                    };
                }
            }
        }

        throw new TypeError(`Unsupported color string: ${value}`);
    }

    static #parseHex(hex) {
        let value = hex.replace(/^#/, "");

        if (value.length === 3) {
            value = value.split("").map((ch) => ch + ch).join("");
            return {
                r: parseInt(value.slice(0, 2), 16),
                g: parseInt(value.slice(2, 4), 16),
                b: parseInt(value.slice(4, 6), 16),
                a: 255,
            };
        }

        if (value.length === 4) {
            value = value.split("").map((ch) => ch + ch).join("");
            return {
                r: parseInt(value.slice(0, 2), 16),
                g: parseInt(value.slice(2, 4), 16),
                b: parseInt(value.slice(4, 6), 16),
                a: parseInt(value.slice(6, 8), 16),
            };
        }

        if (value.length === 6) {
            return {
                r: parseInt(value.slice(0, 2), 16),
                g: parseInt(value.slice(2, 4), 16),
                b: parseInt(value.slice(4, 6), 16),
                a: 255,
            };
        }

        if (value.length === 8) {
            return {
                r: parseInt(value.slice(0, 2), 16),
                g: parseInt(value.slice(2, 4), 16),
                b: parseInt(value.slice(4, 6), 16),
                a: parseInt(value.slice(6, 8), 16),
            };
        }

        throw new TypeError(`Unsupported hex color: ${hex}`);
    }

    static #rgbToHsl(r, g, b) {
        const rn = r / 255;
        const gn = g / 255;
        const bn = b / 255;
        const max = Math.max(rn, gn, bn);
        const min = Math.min(rn, gn, bn);
        const delta = max - min;
        let h = 0;
        let s = 0;
        const l = (max + min) / 2;

        if (delta !== 0) {
            s = delta / (1 - Math.abs(2 * l - 1));
            switch (max) {
                case rn:
                    h = 60 * (((gn - bn) / delta) % 6);
                    break;
                case gn:
                    h = 60 * (((bn - rn) / delta) + 2);
                    break;
                default:
                    h = 60 * (((rn - gn) / delta) + 4);
                    break;
            }
        }

        return {
            h: this.#wrapHue(h),
            s: +(s * 100).toFixed(4),
            l: +(l * 100).toFixed(4),
        };
    }

    static #hslToRgb(h, s, l) {
        const hue = this.#wrapHue(h);
        const sat = this.#clamp(s, 0, 100) / 100;
        const lig = this.#clamp(l, 0, 100) / 100;
        const c = (1 - Math.abs(2 * lig - 1)) * sat;
        const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
        const m = lig - c / 2;
        let rn = 0;
        let gn = 0;
        let bn = 0;

        if (hue < 60) [rn, gn, bn] = [c, x, 0];
        else if (hue < 120) [rn, gn, bn] = [x, c, 0];
        else if (hue < 180) [rn, gn, bn] = [0, c, x];
        else if (hue < 240) [rn, gn, bn] = [0, x, c];
        else if (hue < 300) [rn, gn, bn] = [x, 0, c];
        else [rn, gn, bn] = [c, 0, x];

        return {
            r: this.#clamp255((rn + m) * 255),
            g: this.#clamp255((gn + m) * 255),
            b: this.#clamp255((bn + m) * 255),
        };
    }

    static #rgbToHsv(r, g, b) {
        const rn = r / 255;
        const gn = g / 255;
        const bn = b / 255;
        const max = Math.max(rn, gn, bn);
        const min = Math.min(rn, gn, bn);
        const delta = max - min;
        let h = 0;
        const v = max;
        const s = max === 0 ? 0 : delta / max;

        if (delta !== 0) {
            switch (max) {
                case rn:
                    h = 60 * (((gn - bn) / delta) % 6);
                    break;
                case gn:
                    h = 60 * (((bn - rn) / delta) + 2);
                    break;
                default:
                    h = 60 * (((rn - gn) / delta) + 4);
                    break;
            }
        }

        return {
            h: this.#wrapHue(h),
            s: +(s * 100).toFixed(4),
            v: +(v * 100).toFixed(4),
        };
    }

    static #hsvToRgb(h, s, v) {
        const hue = this.#wrapHue(h);
        const sat = this.#clamp(s, 0, 100) / 100;
        const val = this.#clamp(v, 0, 100) / 100;
        const c = val * sat;
        const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
        const m = val - c;
        let rn = 0;
        let gn = 0;
        let bn = 0;

        if (hue < 60) [rn, gn, bn] = [c, x, 0];
        else if (hue < 120) [rn, gn, bn] = [x, c, 0];
        else if (hue < 180) [rn, gn, bn] = [0, c, x];
        else if (hue < 240) [rn, gn, bn] = [0, x, c];
        else if (hue < 300) [rn, gn, bn] = [x, 0, c];
        else [rn, gn, bn] = [c, 0, x];

        return {
            r: this.#clamp255((rn + m) * 255),
            g: this.#clamp255((gn + m) * 255),
            b: this.#clamp255((bn + m) * 255),
        };
    }

    static #clamp(value, min, max) {
        const n = Number(value);
        if (!Number.isFinite(n)) {
            throw new TypeError("Color channel values must be finite numbers");
        }
        return Math.min(max, Math.max(min, n));
    }

    static #clamp255(value) {
        return Math.round(this.#clamp(value, 0, 255));
    }

    static #wrapHue(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) {
            throw new TypeError("Hue must be a finite number");
        }
        return ((n % 360) + 360) % 360;
    }
    /**
     * Converts style to RGBA
     * @param {string} style Style string
     * @returns {Number[]} Returns the RGBA
     */
    static styleToRgba(style) {
        if (typeof style !== 'string') {
            throw new TypeError('WebGL background() currently supports solid colors only. Gradients and patterns are not supported.');
        }

        if (typeof document === 'undefined') {
            throw new Error('WebGL background() color parsing requires a browser document.');
        }

        const probeCanvas = document.createElement('canvas');
        const probeCtx = probeCanvas.getContext('2d');
        if (!probeCtx) {
            throw new Error('Unable to create a temporary 2D context for color parsing.');
        }

        probeCtx.fillStyle = '#000';
        probeCtx.fillStyle = style;
        const normalized = String(probeCtx.fillStyle).trim();

        if (normalized.startsWith('#')) {
            let hex = normalized.slice(1);
            if (hex.length === 3) {
            hex = hex.split('').map((ch) => ch + ch).join('');
            } else if (hex.length === 4) {
            hex = hex.split('').map((ch) => ch + ch).join('');
            }

            if (hex.length === 6) {
            const r = parseInt(hex.slice(0, 2), 16) / 255;
            const g = parseInt(hex.slice(2, 4), 16) / 255;
            const b = parseInt(hex.slice(4, 6), 16) / 255;
            return [r, g, b, 1];
            }

            if (hex.length === 8) {
            const r = parseInt(hex.slice(0, 2), 16) / 255;
            const g = parseInt(hex.slice(2, 4), 16) / 255;
            const b = parseInt(hex.slice(4, 6), 16) / 255;
            const a = parseInt(hex.slice(6, 8), 16) / 255;
            return [r, g, b, a];
            }
        }

        const match = normalized.match(/^rgba?\(([^)]+)\)$/i);
        if (!match) {
            throw new TypeError(`Unsupported WebGL background color format: ${normalized}`);
        }

        const parts = match[1].split(',').map((part) => part.trim());
        const r = Math.max(0, Math.min(255, Number(parts[0]))) / 255;
        const g = Math.max(0, Math.min(255, Number(parts[1]))) / 255;
        const b = Math.max(0, Math.min(255, Number(parts[2]))) / 255;
        const a = parts.length > 3 ? Math.max(0, Math.min(1, Number(parts[3]))) : 1;
        return [r, g, b, a];
        }
};
