import { Color } from "./color.js";
import { Canvex } from "./canvex.js";

/**
 * Canvas state helpers and text metrics APIs for Canvex.
 *
 * This class centralizes mutable canvas state such as fill and stroke colors,
 * text alignment, font selection, wrapping behavior, measurement utilities,
 * and font loading. Text rendering itself is intended to remain in
 * `Shapes.text()`, while this class manages the configuration and metrics used
 * by that renderer.
 */
export const Canvas = class {
    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /** Horizontal alignment constant for left-aligned text. */
    static LEFT = 'left';

    /** Horizontal alignment constant for right-aligned text. */
    static RIGHT = 'right';

    /** Horizontal/vertical alignment constant for centered text. */
    static CENTER = 'center';

    /** Vertical alignment constant for top-aligned text blocks. */
    static TOP = 'top';

    /** Vertical alignment constant for bottom-aligned text blocks. */
    static BOTTOM = 'bottom';

    /** Vertical alignment constant for alphabetic baseline alignment. */
    static BASELINE = 'baseline';

    /** Wrapping mode constant for wrapping at word boundaries. */
    static WORD = 'word';

    /** Wrapping mode constant for wrapping at character boundaries. */
    static CHAR = 'char';

    /** Text style constant for a normal font posture and weight. */
    static NORMAL = 'normal';

    /** Text style constant for italic text. */
    static ITALIC = 'italic';

    /** Text style constant for bold text. */
    static BOLD = 'bold';

    /** Text style constant for bold italic text. */
    static BOLDITALIC = 'bolditalic';

    /** Text direction constant for left-to-right layout. */
    static LTR = 'ltr';

    /** Text direction constant for right-to-left layout. */
    static RTL = 'rtl';

    /** Rectangle/ellipse mode constant for x/y representing a corner. */
    static CORNER = 'corner';
    /** Rectangle/ellipse mode constant for x/y + width/height spanning two corners. */
    static CORNERS = 'corners';
    /** Rectangle/ellipse mode constant for x/y with width/height interpreted as radii. */
    static RADIUS = 'radius';
    /** Stroke cap / join constant for rounded ends or corners. */
    static ROUND = 'round';
    /** Stroke cap constant for square/projection line ends. */
    static SQUARE = 'square';
    /** Stroke join constant for beveled corners. */
    static BEVEL = 'bevel';
    /** Stroke join constant for mitered corners. */
    static MITER = 'miter';
    /** Stroke cap constant for flat line ends. */
    static BUTT = 'butt';

    // ---------------------------------------------------------------------
    // Internal text state
    // ---------------------------------------------------------------------
    static #textAlignHorizontal = 'left';
    static #textAlignVertical = 'baseline';
    static #textSizePixels = 16;
    static #textStyleValue = 'normal';
    static #textLeadingPixels = null;
    static #textWrapValue = 'word';
    static #textFontFamily = 'sans-serif';
    static #textDirectionValue = 'inherit';
    static #textPropertyState = {
        direction: 'inherit',
        fontKerning: 'auto',
        fontStretch: 'normal',
        fontVariantCaps: 'normal',
        letterSpacing: '0px',
        textRendering: 'auto',
        wordSpacing: '0px'
    };
    static #loadedFonts = new Map();
    static #fontStyleElementId = '__canvex_loaded_fonts__';
    static #canvas;
    static #ctxInstance;

    // Private method declarations (must be before methods that call them)
    /**
     * Resolves the active rendering context from `Canvex`.
     *
     * @returns {*} The active rendering context.
     * @throws {Error} Throws when no active rendering context is available.
     * @private
     */
    static #ctx() {
        const ctx = Canvex?.ctx ?? null;
        if (!ctx) throw new Error('Canvas requires an active Canvex rendering context.');
        return ctx;
    }



    /**
     * Resolves color arguments into a CSS color string.
     *
     * @param {Array<*>} args - User-supplied color arguments.
     * @param {Array<*>} fallback - Fallback arguments used when none are supplied.
     * @returns {string|CanvasGradient|CanvasPattern} A CSS color string or native canvas style object.
     * @private
     */
/**
 * Resolves color arguments into a canvas fill/stroke style.
 *
 * @param {Array<*>} args - User-supplied color arguments.
 * @param {Array<*>} fallback - Fallback arguments used when none are supplied.
 * @returns {string|CanvasGradient|CanvasPattern|Object} A CSS color string or native canvas style object.
 * @private
 */
static #resolveColorArguments(args, fallback) {
    const effective = args.length === 0 ? fallback : args;
    const value = effective.length === 1 ? effective[0] : effective;
    return Color.resolveStyle(value, this.#ctx());
}

    /**
     * Creates a canvas object
     * @param {{x?: number, y?: number, width?: number, height?: number, ctx?: '2d'|'bitmaprenderer'|'webgl'|'webgl2' }} [options={}] Options
     * @returns {HTMLCanvasElement} Canvas element
     */
    static create(options={}){
        options = {
            ...{
                x: Canvex.y,
                y: Canvex.x,
                width: Canvex.WIDTH,
                height: Canvex.HEIGHT,
                ctx: Canvex.C2D
            },...options
        }
        this.#canvas = document.createElement('canvas');
        this.#canvas.width = options?.width||20;
        this.#canvas.height = options?.height||20;
        this.#canvas.style.position = "absolute";
        this.#canvas.style.left = `${Number(options?.x ?? 0)}px`;
        this.#canvas.style.top = `${Number(options?.y ?? 0)}px`;
        this.#canvas.style.display = "block";
        this.#canvas.tabIndex = 0;
        this.#canvas.style.outline = "none";
        const mode = options.ctx ?? this.C2D;
        this.#ctxInstance = this.#canvas.getContext(mode);
        if (!this.#ctxInstance) {
            throw new Error(`Could not create ${mode} context`);
        }
    }
    /**
     * Set the context to make changes
     * @param {HTMLCanvasElement} canvas Canvas element
     * @param {CanvasRenderingContext2D|ImageBitmapRenderingContext|WebGLRenderingContext|WebGL2RenderingContext} [ctx] Context type identifier
     */
    static setCanvas(){
        Canvex._setCanvas(this.#canvas,this.#ctxInstance);
    }
    /**
     * Reverts back to the original canvas target
     * @returns {void}
     */
    static revertCanvas(){
        return Canvex._revertCanvas();
    }

    // ---------------------------------------------------------------------
    // Basic canvas state helpers
    // ---------------------------------------------------------------------

    /**
     * Begins a new path on the active canvas context.
     *
     * Use this before issuing path commands that should be isolated from any
     * existing path segments on the current 2D context.
     *
     * @returns {void}
     */
    static start() {
        this.#ctx().beginPath();
    }

    /**
     * Closes the current path on the active canvas context.
     *
     * This is a convenience wrapper around `CanvasRenderingContext2D.closePath()`.
     *
     * @returns {void}
     */
    static end() {
        this.#ctx().closePath();
    }

    static #isCanvas2DContext(ctx) {
        return typeof CanvasRenderingContext2D !== 'undefined' && ctx instanceof CanvasRenderingContext2D;
    }

    static #isWebGLContext(ctx) {
        const hasWebGL1 = typeof WebGLRenderingContext !== 'undefined' && ctx instanceof WebGLRenderingContext;
        const hasWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext;
        return hasWebGL1 || hasWebGL2;
    }

    /**
     * Paints the entire canvas with a solid background color.
     *
     * The method temporarily saves and restores the context state so that the
     * caller's existing drawing configuration remains unchanged after the
     * background fill completes.
     *
     * @param {...*} color - Any color input supported by `Color.color(...)`.
     * @returns {string|CanvasGradient|CanvasPattern} The applied fill style.
     */
    static background(...color) {
        const ctx = this.#ctx();
        const width = Number(Canvex.WIDTH ?? Canvex.canvas?.width ?? 0);
        const height = Number(Canvex.HEIGHT ?? Canvex.canvas?.height ?? 0);

        const effective = color.length === 0 ? [220] : color;

        if (this.#isCanvas2DContext(ctx)) {
            const fillStyle = this.#resolveColorArguments(color, [220]);
            ctx.fillStyle = fillStyle;
            ctx.fillRect(0, 0, width, height);
            ctx.beginPath();
            ctx.fillStyle = 'white';
            ctx.strokeStyle = 'black';
            return fillStyle;
        }

        if (this.#isWebGLContext(ctx)) {
            const value = effective.length === 1 ? effective[0] : effective;

            let style;
            if (typeof document !== 'undefined') {
            const probeCanvas = document.createElement('canvas');
            const probeCtx = probeCanvas.getContext('2d');
            style = Color.resolveStyle(value, probeCtx ?? ctx);
            } else {
            style = value;
            }

            const [r, g, b, a] = Color.styleToRgba(style);
            const previousClearColor = ctx.getParameter(ctx.COLOR_CLEAR_VALUE);

            ctx.clearColor(r, g, b, a);

            let clearMask = ctx.COLOR_BUFFER_BIT;
            if ('DEPTH_BUFFER_BIT' in ctx) clearMask |= ctx.DEPTH_BUFFER_BIT;
            if ('STENCIL_BUFFER_BIT' in ctx) clearMask |= ctx.STENCIL_BUFFER_BIT;
            ctx.clear(clearMask);

            ctx.clearColor(
            previousClearColor[0],
            previousClearColor[1],
            previousClearColor[2],
            previousClearColor[3]
            );

            return style;
        }

        throw new Error('Canvas.background() requires a Canvas 2D, WebGL, or WebGL2 context.');
        }

    /**
     * Gets or sets the active fill style.
     *
     * When called without arguments, the current context fill style is returned.
     * When one or more arguments are provided, they are parsed through
     * `Color.color(...)` and applied to the context.
     *
     * @param {...*} color - Color arguments supported by `Color.color(...)`.
     * @returns {string|CanvasGradient|CanvasPattern} The current or newly applied fill style.
     */
    static fill(...color) {
        const ctx = this.#ctx();
        if (color.length === 0) return String(ctx.fillStyle);
        const fillStyle = this.#resolveColorArguments(color, [255]);
        ctx.fillStyle = fillStyle;
        return fillStyle;
    }

    /**
     * Gets or sets the active stroke style.
     *
     * When called without arguments, the current context stroke style is returned.
     * When one or more arguments are provided, they are parsed through
     * `Color.color(...)` and applied to the context.
     *
     * @param {...*} color - Color arguments supported by `Color.color(...)`.
     * @returns {string|CanvasGradient|CanvasPattern} The current or newly applied stroke style.
     */
    static stroke(...color) {
        const ctx = this.#ctx();
        if (color.length === 0) return String(ctx.strokeStyle);
        const strokeStyle = this.#resolveColorArguments(color, [0]);
        ctx.strokeStyle = strokeStyle;
        return strokeStyle;
    }

    /**
     * Disables stroke output by setting the stroke style to a fully transparent color.
     *
     * @returns {string} The applied CSS stroke style.
     */
    static noStroke() {
        const ctx = this.#ctx();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0)';
        return ctx.strokeStyle;
    }

    /**
     * Disables fill output by setting the fill style to a fully transparent color.
     *
     * @returns {string} The applied CSS fill style.
     */
    static noFill() {
        const ctx = this.#ctx();
        ctx.fillStyle = 'rgba(0, 0, 0, 0)';
        return ctx.fillStyle;
    }

    /**
     * Sets the global composite operation for the active canvas context.
     * @param {'source-over'|'source-in'|'source-out'|'destination-over'|'destination-in'|'destination-out'|'lighter'|'copy'|'xor'|'multiply'|'screen'|'overlay'|'darken'|'lighten'|'color-dodge'|'color-burn'|'hard-light'|'soft-light'|'difference'|'exclusion'|'hue'|'saturation'|'color'|'luminosity'} operation 
     * @returns 
     */
    static compositeOperation(operation){
        const ctx = this.#ctx();
        ctx.globalCompositeOperation = operation;
        return ctx.globalCompositeOperation;
    }

    /**
     * Sets the current stroke width.
     *
     * Values below zero are clamped to `0`.
     *
     * @param {number} w - Desired stroke width in CSS pixels.
     * @returns {number} The applied line width.
     */
    static strokeWeight(w) {
        const ctx = this.#ctx();
        ctx.lineWidth = Math.max(0, Number(w) || 0);
        return ctx.lineWidth;
    }

    /**
     * Saves the current canvas state.
     *
     * This mirrors `CanvasRenderingContext2D.save()` and can be paired with
     * {@link Canvas.restore}.
     *
     * @returns {void}
     */
    static save() {
        return this.#ctx().save();
    }

    /**
     * Restores the most recently saved canvas state.
     *
     * @returns {void}
     */
    static restore() {
        return this.#ctx().restore();
    }

    /**
     * Reapplies the current text state when a 2D context is already active.
     *
     * This helper is used after changes to font-related state so the active
     * context immediately reflects those updates.
     *
     * @returns {void}
     * @internal
     */
    static _syncTextStateIfPossible() {
        const ctx = Canvex?.ctx ?? null;
        if (typeof CanvasRenderingContext2D !== 'undefined' && ctx instanceof CanvasRenderingContext2D) {
            this._applyTextState(ctx);
        }
    }

    /**
     * Removes wrapping quotes and surrounding whitespace from a font token.
     *
     * @param {*} value - Candidate font token.
     * @returns {string} The normalized font token.
     * @internal
     */
    static _sanitizeFontToken(value) {
        return String(value ?? '').trim().replace(/^['"]|['"]$/g, '').trim();
    }

    /**
     * Converts a font-family declaration into a canvas-safe font-family fragment.
     *
     * Family names that contain spaces are automatically quoted unless they are
     * already quoted or match a standard generic family keyword.
     *
     * @param {string} family - Raw font family value.
     * @returns {string} A serialized font-family fragment suitable for `ctx.font`.
     * @internal
     */
    static _serializeFontFamily(family) {
        const genericFamilies = new Set([
            'serif',
            'sans-serif',
            'monospace',
            'cursive',
            'fantasy',
            'system-ui',
            'ui-serif',
            'ui-sans-serif',
            'ui-monospace',
            'emoji',
            'math',
            'fangsong'
        ]);

        return String(family ?? 'sans-serif')
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
            .map((part) => {
                if (/^['"].*['"]$/.test(part)) return part;
                const normalized = this._sanitizeFontToken(part);
                if (!normalized) return '';
                if (genericFamilies.has(normalized.toLowerCase()) || /^[a-z0-9_-]+$/i.test(normalized)) {
                    return normalized;
                }
                return `"${normalized.replace(/"/g, '\\"')}"`;
            })
            .filter(Boolean)
            .join(', ');
    }

    /**
     * Extracts the first `font-family` descriptor from CSS text.
     *
     * @param {string} cssText - CSS text that may contain one or more `@font-face` rules.
     * @returns {string} The extracted font family, or an empty string when none is found.
     * @internal
     */
    static _extractFontFamilyFromCss(cssText) {
        const match = String(cssText ?? '').match(/font-family\s*:\s*(['"]?)([^;'"\n\r}]+)\1/i);
        return match ? this._sanitizeFontToken(match[2]) : '';
    }

    /**
     * Infers a usable font family name from a path or URL.
     *
     * For Google Fonts URLs, the `family` query parameter is used when present.
     * Otherwise, the file stem is used as a fallback.
     *
     * @param {string} path - Font file URL, CSS URL, or CSS string source label.
     * @returns {string} The inferred font family name.
     * @internal
     */
    static _inferFontName(path) {
        try {
            const base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
            const url = new URL(String(path ?? '').trim(), base);
            if (/fonts\.googleapis\.com$/i.test(url.hostname)) {
                const family = url.searchParams.get('family');
                if (family) {
                    return this._sanitizeFontToken(decodeURIComponent(family).split(':')[0].replace(/\+/g, ' '));
                }
            }
        } catch {
            // fall through to filename inference
        }

        const value = String(path ?? '').trim();
        const withoutHash = value.split('#')[0];
        const withoutQuery = withoutHash.split('?')[0];
        const leaf = withoutQuery.split('/').pop() || withoutQuery;
        const stem = leaf.replace(/\.[^.]+$/u, '');
        return this._sanitizeFontToken(stem) || 'custom-font';
    }

    /**
     * Registers a font handle under its known aliases.
     *
     * @param {Object} fontInfo - Font metadata and aliases.
     * @returns {Object} The normalized font handle.
     * @internal
     */
    static _registerFont(fontInfo) {
        const handle = {
            ...fontInfo,
            family: this._sanitizeFontToken(fontInfo?.family || fontInfo?.name || this.#textFontFamily || 'sans-serif'),
            name: this._sanitizeFontToken(fontInfo?.name || fontInfo?.family || 'custom-font')
        };

        for (const key of new Set([handle.name, handle.family, fontInfo?.alias].filter(Boolean).map((value) => String(value).trim()))) {
            this.#loadedFonts.set(key, handle);
        }

        return handle;
    }

    /**
     * Resolves a textFont input into a normalized font handle.
     *
     * @param {string|Object} font - Font family name or font handle object.
     * @returns {{name:string, family:string}} The resolved font descriptor.
     * @throws {TypeError} Throws when the font input cannot be interpreted.
     * @internal
     */
    static _resolveFont(font) {
        if (typeof font === 'string') {
            const key = this._sanitizeFontToken(font);
            if (!key) throw new TypeError('font must be a non-empty string or font object');
            return this.#loadedFonts.get(font) ?? this.#loadedFonts.get(key) ?? { name: key, family: key };
        }

        if (font && typeof font === 'object') {
            const family = this._sanitizeFontToken(font.family ?? font.fontFamily ?? font.name ?? font.alias);
            const name = this._sanitizeFontToken(font.name ?? font.alias ?? family);
            if (!family && !name) {
                throw new TypeError('font object must provide a family, fontFamily, name, or alias');
            }
            return this._registerFont({ ...font, name: name || family, family: family || name });
        }

        throw new TypeError('font must be a string or object');
    }

    /**
     * Ensures that a shared `<style>` element exists for inline font rules.
     *
     * @returns {HTMLStyleElement} The managed style element.
     * @throws {Error} Throws when no browser document is available.
     * @internal
     */
    static _ensureFontStyleElement() {
        if (typeof document === 'undefined' || !document.head) {
            throw new Error('Font loading requires a browser document.');
        }

        let styleElement = document.getElementById(this.#fontStyleElementId);
        if (!(styleElement instanceof HTMLStyleElement)) {
            styleElement = document.createElement('style');
            styleElement.id = this.#fontStyleElementId;
            styleElement.type = 'text/css';
            document.head.appendChild(styleElement);
        }

        return styleElement;
    }

    /**
     * Ensures a stylesheet link for remote font CSS has been loaded.
     *
     * @param {string} href - Stylesheet URL to load.
     * @returns {Promise<HTMLLinkElement>} Resolves once the stylesheet has loaded.
     * @throws {Error} Throws when no browser document is available.
     * @internal
     */
    static _ensureFontStylesheet(href) {
        if (typeof document === 'undefined' || !document.head) {
            throw new Error('Font loading requires a browser document.');
        }

        const base = document.baseURI;
        const normalizedHref = new URL(href, base).href;
        const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).find((link) => link.href === normalizedHref);
        if (existing) {
            if (existing.dataset.canvexLoaded === 'true' || existing.sheet) {
                return Promise.resolve(existing);
            }
            return new Promise((resolve, reject) => {
                existing.addEventListener('load', () => {
                    existing.dataset.canvexLoaded = 'true';
                    resolve(existing);
                }, { once: true });
                existing.addEventListener('error', () => reject(new Error(`Failed to load stylesheet: ${href}`)), { once: true });
            });
        }

        return new Promise((resolve, reject) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            link.onload = () => {
                link.dataset.canvexLoaded = 'true';
                resolve(link);
            };
            link.onerror = () => reject(new Error(`Failed to load stylesheet: ${href}`));
            document.head.appendChild(link);
        });
    }

    /**
     * Normalizes the overloaded arguments accepted by {@link Canvas.loadFont}.
     *
     * @param {*} name - Alias, options object, callback, or undefined.
     * @param {*} options - Options object, callback, or undefined.
     * @param {*} successCallback - Success callback, or undefined.
     * @param {*} failureCallback - Failure callback, or undefined.
     * @returns {{name:(string|undefined), options:Object, successCallback:(Function|undefined), failureCallback:(Function|undefined)}}
     * A normalized argument object.
     * @internal
     */
    static _resolveLoadFontArgs(name, options, successCallback, failureCallback) {
        let resolvedName = typeof name === 'string' ? name.trim() : undefined;
        let resolvedOptions = {};
        let onSuccess;
        let onFailure;

        if (typeof name === 'function') {
            onSuccess = name;
            onFailure = typeof options === 'function' ? options : undefined;
        } else if (name && typeof name === 'object' && !Array.isArray(name)) {
            resolvedOptions = { ...name };
            onSuccess = typeof options === 'function' ? options : undefined;
            onFailure = typeof successCallback === 'function' ? successCallback : undefined;
        } else {
            resolvedOptions = options && typeof options === 'object' && !Array.isArray(options) ? { ...options } : {};
            if (typeof options === 'function') {
                onSuccess = options;
                onFailure = typeof successCallback === 'function' ? successCallback : undefined;
            } else {
                onSuccess = typeof successCallback === 'function' ? successCallback : undefined;
                onFailure = typeof failureCallback === 'function' ? failureCallback : undefined;
            }
        }

        return {
            name: resolvedName || undefined,
            options: resolvedOptions,
            successCallback: onSuccess,
            failureCallback: onFailure
        };
    }

    /**
     * Selects the descriptors accepted by the `FontFace` constructor.
     *
     * @param {Object} [options={}] - Candidate font-face descriptors.
     * @returns {Object} A filtered descriptor object.
     * @internal
     */
    static _fontFaceDescriptors(options = {}) {
        const descriptors = {};
        for (const key of ['style', 'weight', 'stretch', 'unicodeRange', 'variant', 'featureSettings', 'display']) {
            if (typeof options[key] !== 'undefined' && options[key] !== null) {
                descriptors[key] = options[key];
            }
        }
        return descriptors;
    }

    /**
     * Returns a snapshot of the current text state.
     *
     * @returns {{horizontal:string, vertical:string, size:number, style:string, leading:number, wrap:string, fontFamily:string, direction:string, properties:Object}}
     * A plain object describing the current text configuration.
     * @internal
     */
    static _getTextState() {
        return {
            horizontal: this.#textAlignHorizontal,
            vertical: this.#textAlignVertical,
            size: this.#textSizePixels,
            style: this.#textStyleValue,
            leading: this.#textLeadingPixels ?? this.#textSizePixels * 1.2,
            wrap: this.#textWrapValue,
            fontFamily: this.#textFontFamily,
            direction: this.#textDirectionValue,
            properties: { ...this.#textPropertyState }
        };
    }

    /**
     * Resolves the active 2D text context and applies the current text state.
     *
     * @returns {CanvasRenderingContext2D} The active 2D rendering context.
     * @throws {Error} Throws when the active context is not a 2D canvas context.
     * @internal
     */
    static _textCtx() {
        const ctx = this.#ctx();
        if (!(typeof CanvasRenderingContext2D !== 'undefined' && ctx instanceof CanvasRenderingContext2D)) {
            throw new Error('Text APIs currently support CanvasRenderingContext2D only.');
        }
        this._applyTextState(ctx);
        return ctx;
    }

    /**
     * Applies font, alignment, baseline, direction, and extra text properties to a 2D context.
     *
     * @param {CanvasRenderingContext2D} ctx - Target 2D context.
     * @returns {void}
     * @internal
     */
    static _applyTextState(ctx) {
        const style = this.#textStyleValue;
        const size = this.#textSizePixels;
        const family = this._serializeFontFamily(this.#textFontFamily);

        let fontStyle = 'normal';
        let fontWeight = 'normal';

        if (style === Canvas.ITALIC) {
            fontStyle = 'italic';
        } else if (style === Canvas.BOLD) {
            fontWeight = 'bold';
        } else if (style === Canvas.BOLDITALIC) {
            fontStyle = 'italic';
            fontWeight = 'bold';
        }

        ctx.font = `${fontStyle} ${fontWeight} ${size}px ${family}`.replace(/\s+/g, ' ').trim();
        ctx.textAlign = this.#textAlignHorizontal;
        ctx.textBaseline = 'alphabetic';
        this._applyTextProperties(ctx);
    }

    /**
     * Applies additional text properties supported by the current browser.
     *
     * Unsupported properties are ignored rather than causing errors.
     *
     * @param {CanvasRenderingContext2D} ctx - Target 2D context.
     * @returns {void}
     * @internal
     */
    static _applyTextProperties(ctx) {
        const props = this.#textPropertyState;
        for (const [key, value] of Object.entries(props)) {
            if (typeof value === 'undefined' || value === null) continue;
            try {
                if (key in ctx) ctx[key] = value;
            } catch {
                // Ignore unsupported canvas text properties.
            }
        }

        if ('direction' in ctx) {
            try {
                ctx.direction = this.#textDirectionValue;
            } catch {
                // Ignore unsupported direction assignments.
            }
        }
    }

    /**
     * Converts arbitrary text input into a display string.
     *
     * Arrays are concatenated, objects are serialized as JSON when possible,
     * and all other values are coerced with `String(...)`.
     *
     * @param {*} value - Text-like input.
     * @returns {string} The normalized display string.
     * @internal
     */
    static _normalizeText(value) {
        if (Array.isArray(value)) {
            return value.map((item) => this._normalizeText(item)).join('');
        }

        if (value != null && typeof value === 'object') {
            try {
                return JSON.stringify(value, null, 2);
            } catch {
                return String(value);
            }
        }

        return String(value ?? '');
    }

    /**
     * Wraps text into lines according to the active wrap mode.
     *
     * @param {CanvasRenderingContext2D} ctx - Measuring context.
     * @param {string} text - Text content to wrap.
     * @param {number|undefined} maxWidth - Maximum width in pixels.
     * @returns {string[]} Wrapped lines.
     * @internal
     */
    static _wrapLines(ctx, text, maxWidth) {
        const paragraphs = String(text ?? '').split(/\r?\n/);
        if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
            return paragraphs;
        }

        const lines = [];

        const pushBrokenWord = (word) => {
            let chunk = '';
            for (const ch of word) {
                const trial = chunk + ch;
                if (chunk && ctx.measureText(trial).width > maxWidth) {
                    lines.push(chunk);
                    chunk = ch;
                } else {
                    chunk = trial;
                }
            }
            if (chunk) lines.push(chunk);
        };

        for (const paragraph of paragraphs) {
            if (paragraph.length === 0) {
                lines.push('');
                continue;
            }

            if (this.#textWrapValue === Canvas.CHAR) {
                let current = '';
                for (const ch of paragraph) {
                    const test = current + ch;
                    if (current && ctx.measureText(test).width > maxWidth) {
                        lines.push(current);
                        current = ch;
                    } else {
                        current = test;
                    }
                }
                if (current) lines.push(current);
                continue;
            }

            const words = paragraph.split(/\s+/).filter(Boolean);
            let current = '';

            for (const word of words) {
                const trial = current ? `${current} ${word}` : word;
                if (!current) {
                    if (ctx.measureText(word).width > maxWidth) {
                        pushBrokenWord(word);
                    } else {
                        current = word;
                    }
                    continue;
                }

                if (ctx.measureText(trial).width <= maxWidth) {
                    current = trial;
                } else {
                    lines.push(current);
                    if (ctx.measureText(word).width > maxWidth) {
                        pushBrokenWord(word);
                        current = '';
                    } else {
                        current = word;
                    }
                }
            }

            if (current) lines.push(current);
        }

        return lines;
    }

    /**
     * Measures the ascent and descent of the current font.
     *
     * @param {CanvasRenderingContext2D} ctx - Measuring context.
     * @param {string} [sample='Mg'] - Sample string used to derive text metrics.
     * @returns {{ascent:number, descent:number, metrics:TextMetrics}} Current font metrics.
     * @internal
     */
    static _textMetrics(ctx, sample = 'Mg') {
        const metrics = ctx.measureText(sample);
        const ascent = Number.isFinite(metrics.actualBoundingBoxAscent) ? metrics.actualBoundingBoxAscent : this.#textSizePixels * 0.8;
        const descent = Number.isFinite(metrics.actualBoundingBoxDescent) ? metrics.actualBoundingBoxDescent : this.#textSizePixels * 0.2;
        return { ascent, descent, metrics };
    }

    /**
     * Computes an approximate bounding box for a text string or wrapped text block.
     *
     * @param {*} str - Text content to measure.
     * @param {number} [x=0] - Reference x-coordinate.
     * @param {number} [y=0] - Reference y-coordinate.
     * @param {number} [maxWidth] - Optional wrapping width.
     * @param {number} [maxHeight] - Optional height constraint.
     * @returns {{x:number, y:number, w:number, h:number, left:number, right:number, top:number, bottom:number, width:number, height:number, advance:number, ascent:number, descent:number, lines:string[]}}
     * A bounding box descriptor for the measured text.
     * @internal
     */
    static _computeTextBounds(str, x = 0, y = 0, maxWidth, maxHeight) {
        const ctx = this._textCtx();
        const content = this._normalizeText(str);
        const lines = this._wrapLines(ctx, content, maxWidth);
        const state = this._getTextState();
        const leading = this.textLeading();

        const lineMetrics = lines.map((line) => ({
            text: line,
            metrics: ctx.measureText(line),
            width: ctx.measureText(line).width
        }));

        const maxLineWidth = Math.max(0, ...lineMetrics.map((entry) => entry.width));
        const defaultAscent = this.fontAscent();
        const defaultDescent = this.fontDescent();
        const totalHeight = lines.length > 0
            ? defaultAscent + defaultDescent + Math.max(0, lines.length - 1) * leading
            : 0;

        let firstBaseline = y;
        const hasBoxHeight = Number.isFinite(maxHeight);
        if (hasBoxHeight) {
            if (state.vertical === Canvas.TOP) {
                firstBaseline = y + defaultAscent;
            } else if (state.vertical === Canvas.CENTER) {
                firstBaseline = y + (maxHeight - totalHeight) / 2 + defaultAscent;
            } else if (state.vertical === Canvas.BOTTOM) {
                firstBaseline = y + maxHeight - totalHeight + defaultAscent;
            } else {
                firstBaseline = y + defaultAscent;
            }
        } else {
            if (state.vertical === Canvas.TOP) {
                firstBaseline = y + defaultAscent;
            } else if (state.vertical === Canvas.CENTER) {
                firstBaseline = y - totalHeight / 2 + defaultAscent;
            } else if (state.vertical === Canvas.BOTTOM) {
                firstBaseline = y - totalHeight + defaultAscent + defaultDescent;
            } else {
                firstBaseline = y;
            }
        }

        let left = Infinity;
        let right = -Infinity;
        let top = Infinity;
        let bottom = -Infinity;

        for (let i = 0; i < lineMetrics.length; i += 1) {
            const entry = lineMetrics[i];
            const metrics = entry.metrics;
            const width = entry.width;
            const baselineY = firstBaseline + i * leading;
            if (hasBoxHeight && baselineY + defaultDescent > y + maxHeight) break;

            let drawX = x;
            if (Number.isFinite(maxWidth)) {
                if (state.horizontal === Canvas.CENTER) {
                    drawX = x + maxWidth / 2;
                } else if (state.horizontal === Canvas.RIGHT) {
                    drawX = x + maxWidth;
                }
            }

            const actualLeft = Number.isFinite(metrics.actualBoundingBoxLeft) ? metrics.actualBoundingBoxLeft : (state.horizontal === Canvas.CENTER ? width / 2 : state.horizontal === Canvas.RIGHT ? width : 0);
            const actualRight = Number.isFinite(metrics.actualBoundingBoxRight) ? metrics.actualBoundingBoxRight : (state.horizontal === Canvas.CENTER ? width / 2 : state.horizontal === Canvas.RIGHT ? 0 : width);
            const actualAscent = Number.isFinite(metrics.actualBoundingBoxAscent) ? metrics.actualBoundingBoxAscent : defaultAscent;
            const actualDescent = Number.isFinite(metrics.actualBoundingBoxDescent) ? metrics.actualBoundingBoxDescent : defaultDescent;

            left = Math.min(left, drawX - actualLeft);
            right = Math.max(right, drawX + actualRight);
            top = Math.min(top, baselineY - actualAscent);
            bottom = Math.max(bottom, baselineY + actualDescent);
        }

        if (!Number.isFinite(left)) {
            left = x;
            right = x;
            top = y;
            bottom = y;
        }

        return {
            x: left,
            y: top,
            w: right - left,
            h: bottom - top,
            left,
            right,
            top,
            bottom,
            width: right - left,
            height: bottom - top,
            advance: maxLineWidth,
            ascent: firstBaseline - top,
            descent: bottom - firstBaseline,
            lines: lineMetrics.map((entry) => entry.text)
        };
    }

    // ---------------------------------------------------------------------
    // Public text APIs
    // ---------------------------------------------------------------------

    /**
     * Gets or sets text alignment.
     *
     * When called with no arguments, the current alignment state is returned.
     *
     * @param {'left'|'center'|'right'} [horizAlign=Canvas.LEFT] - Horizontal alignment.
     * @param {'top'|'bottom'|'center'|'baseline'} [vertAlign=Canvas.BASELINE] - Vertical alignment.
     * @returns {{horizontal:'left'|'center'|'right', vertical:'top'|'bottom'|'center'|'baseline'}}
     * The current alignment state.
     * @throws {TypeError} Throws when either alignment value is unsupported.
     */
    static textAlign(horizAlign = Canvas.LEFT, vertAlign = Canvas.BASELINE) {
        if (arguments.length === 0) {
            return {
                horizontal: this.#textAlignHorizontal,
                vertical: this.#textAlignVertical
            };
        }

        const horizontal = String(horizAlign).toLowerCase();
        const vertical = String(vertAlign).toLowerCase();

        if (![Canvas.LEFT, Canvas.CENTER, Canvas.RIGHT].includes(horizontal)) {
            throw new TypeError('horizAlign must be LEFT, CENTER, or RIGHT');
        }
        if (![Canvas.TOP, Canvas.BOTTOM, Canvas.CENTER, Canvas.BASELINE].includes(vertical)) {
            throw new TypeError('vertAlign must be TOP, BOTTOM, CENTER, or BASELINE');
        }

        this.#textAlignHorizontal = horizontal;
        this.#textAlignVertical = vertical;
        this._syncTextStateIfPossible();
        return this.textAlign();
    }

    /**
     * Measures the ascent of the current font.
     *
     * @returns {number} The ascent in pixels.
     */
    static textAscent() {
        const ctx = this._textCtx();
        return this._textMetrics(ctx).ascent;
    }

    /**
     * Measures the descent of the current font.
     *
     * @returns {number} The descent in pixels.
     */
    static textDescent() {
        const ctx = this._textCtx();
        return this._textMetrics(ctx).descent;
    }

    /**
     * Alias of {@link Canvas.textAscent} for font-centric naming.
     *
     * @returns {number} The font ascent in pixels.
     */
    static fontAscent() {
        return this.textAscent();
    }

    /**
     * Alias of {@link Canvas.textDescent} for font-centric naming.
     *
     * @returns {number} The font descent in pixels.
     */
    static fontDescent() {
        return this.textDescent();
    }

    /**
     * Computes a bounding box for a single line of text using the current font state.
     *
     * @param {*} [str='Mg'] - Text to measure.
     * @param {number} [x=0] - Reference x-coordinate.
     * @param {number} [y=0] - Reference y-coordinate.
     * @returns {{x:number, y:number, w:number, h:number, left:number, right:number, top:number, bottom:number, width:number, height:number, advance:number, ascent:number, descent:number, lines:string[]}}
     * A bounding box descriptor.
     */
    static fontBounds(str = 'Mg', x = 0, y = 0) {
        return this._computeTextBounds(str, x, y);
    }

    /**
     * Computes a bounding box for text, optionally considering wrapping and a maximum height.
     *
     * @param {*} str - Text to measure.
     * @param {number} [x=0] - Reference x-coordinate.
     * @param {number} [y=0] - Reference y-coordinate.
     * @param {number} [maxWidth] - Optional maximum wrapping width in pixels.
     * @param {number} [maxHeight] - Optional maximum text block height in pixels.
     * @returns {{x:number, y:number, w:number, h:number, left:number, right:number, top:number, bottom:number, width:number, height:number, advance:number, ascent:number, descent:number, lines:string[]}}
     * A bounding box descriptor.
     */
    static textBounds(str, x = 0, y = 0, maxWidth, maxHeight) {
        return this._computeTextBounds(str, x, y, maxWidth, maxHeight);
    }

    /**
     * Gets or sets the line spacing used for multi-line text layout.
     *
     * @param {number} [leading] - Desired line spacing in pixels.
     * @returns {number} The current or newly applied leading value.
     * @throws {TypeError} Throws when `leading` is not a positive finite number.
     */
    static textLeading(leading) {
        if (typeof leading === 'undefined') {
            return this.#textLeadingPixels ?? this.#textSizePixels * 1.2;
        }
        if (!Number.isFinite(leading) || leading <= 0) {
            throw new TypeError('leading must be a positive number');
        }
        this.#textLeadingPixels = leading;
        return this.#textLeadingPixels;
    }

    /**
     * Gets or sets the current text size.
     *
     * @param {number} [size] - Desired text size in pixels.
     * @returns {number} The current or newly applied text size.
     * @throws {TypeError} Throws when `size` is not a positive finite number.
     */
    static textSize(size) {
        if (typeof size === 'undefined') {
            return this.#textSizePixels;
        }
        if (!Number.isFinite(size) || size <= 0) {
            throw new TypeError('size must be a positive number');
        }
        this.#textSizePixels = size;
        this._syncTextStateIfPossible();
        return this.#textSizePixels;
    }

    /**
     * Gets or sets the current text style.
     *
     * Supported values are `NORMAL`, `ITALIC`, `BOLD`, and `BOLDITALIC`.
     *
     * @param {'normal'|'italic'|'bold'|'bolditalic'} [style] - Desired text style.
     * @returns {'normal'|'italic'|'bold'|'bolditalic'} The current or newly applied style.
     * @throws {TypeError} Throws when an unsupported style is supplied.
     */
    static textStyle(style) {
        if (typeof style === 'undefined') {
            return this.#textStyleValue;
        }
        const nextStyle = String(style).toLowerCase();
        if (![Canvas.NORMAL, Canvas.ITALIC, Canvas.BOLD, Canvas.BOLDITALIC].includes(nextStyle)) {
            throw new TypeError('style must be NORMAL, ITALIC, BOLD, or BOLDITALIC');
        }
        this.#textStyleValue = nextStyle;
        this._syncTextStateIfPossible();
        return this.#textStyleValue;
    }

    /**
     * Gets or sets the active text font, optionally updating the size at the same time.
     *
     * @param {string|Object} [font] - Font family name or registered font handle.
     * @param {number} [size] - Optional text size to apply alongside the font.
     * @returns {string|Object} The current or newly selected font handle/family.
     * @throws {TypeError} Throws when `size` is invalid.
     */
    static textFont(font, size) {
        if (typeof font === 'undefined') {
            return this.#loadedFonts.get(this.#textFontFamily) ?? this.#textFontFamily;
        }

        const resolvedFont = this._resolveFont(font);
        this.#textFontFamily = resolvedFont.family;
        this._registerFont(resolvedFont);

        if (typeof size !== 'undefined') {
            if (!Number.isFinite(size) || size <= 0) {
                throw new TypeError('size must be a positive number');
            }
            this.#textSizePixels = size;
        }

        this._syncTextStateIfPossible();
        return this.#loadedFonts.get(this.#textFontFamily) ?? this.#textFontFamily;
    }

    /**
     * Loads a font from a font file, stylesheet URL, or inline `@font-face` rule.
     *
     * This method supports direct font files, CSS font endpoints such as Google
     * Fonts, and inline `@font-face` text blocks. The resolved value is a font
     * handle that can be passed directly to {@link Canvas.textFont}.
     *
     * @param {string} path - Font file URL, CSS URL, or inline `@font-face` rule.
     * @param {string|Object} [name] - Optional alias string or options object.
     * @param {Object} [options] - Optional font-face descriptors or loader options.
     * @param {Function} [successCallback] - Invoked after successful loading.
     * @param {Function} [failureCallback] - Invoked when loading fails.
     * @returns {Promise<Object>} Resolves with the loaded font handle.
     * @throws {TypeError|Error} Throws when input is invalid or loading fails.
     */
    static async loadFont(path, name, options, successCallback, failureCallback) {
        const source = String(path ?? '').trim();
        if (!source) {
            const error = new TypeError('path must be a non-empty string');
            const callbacks = this._resolveLoadFontArgs(name, options, successCallback, failureCallback);
            callbacks.failureCallback?.(error);
            throw error;
        }

        const args = this._resolveLoadFontArgs(name, options, successCallback, failureCallback);
        const descriptors = this._fontFaceDescriptors(args.options);
        const isInlineCss = /@font-face/i.test(source);
        const isCssFile =
            /\.css(?:[?#].*)?$/i.test(source) ||
            /^data:text\/css/i.test(source) ||
            /^https?:\/\/fonts\.googleapis\.com\/css2\b/i.test(source) ||
            /^https?:\/\/fonts\.googleapis\.com\/css\b/i.test(source);

        try {
            if (typeof document === 'undefined') {
                throw new Error('loadFont() requires a browser environment with document support.');
            }

            const family = this._sanitizeFontToken(
                args.name ||
                args.options.family ||
                args.options.fontFamily ||
                (isInlineCss ? this._extractFontFamilyFromCss(source) : this._inferFontName(source))
            );

            if (!family) {
                throw new Error('Could not determine a font family name. Pass the `name` argument explicitly.');
            }

            let handle;

            if (isInlineCss) {
                const styleElement = this._ensureFontStyleElement();
                styleElement.appendChild(document.createTextNode(`\n${source}\n`));
                if (document.fonts) {
                    await document.fonts.load(`16px ${this._serializeFontFamily(family)}`);
                }
                handle = this._registerFont({
                    name: args.name || family,
                    alias: args.name,
                    family,
                    source,
                    descriptors,
                    status: 'loaded',
                    type: 'css-text'
                });
            } else if (isCssFile) {
                await this._ensureFontStylesheet(source);
                if (document.fonts) {
                    await document.fonts.load(`16px ${this._serializeFontFamily(family)}`);
                }
                handle = this._registerFont({
                    name: args.name || family,
                    alias: args.name,
                    family,
                    source,
                    descriptors,
                    status: 'loaded',
                    type: 'css-file'
                });
            } else {
                if (typeof FontFace === 'undefined' || !document.fonts) {
                    throw new Error('loadFont() needs the FontFace API and document.fonts for direct font files.');
                }

                const face = new FontFace(family, `url(${JSON.stringify(source)})`, descriptors);
                const loadedFace = await face.load();
                document.fonts.add(loadedFace);
                await document.fonts.load(`16px ${this._serializeFontFamily(family)}`);

                handle = this._registerFont({
                    name: args.name || family,
                    alias: args.name,
                    family,
                    source,
                    descriptors,
                    fontFace: loadedFace,
                    status: 'loaded',
                    type: 'font-file'
                });
            }

            args.successCallback?.(handle);
            return handle;
        } catch (error) {
            args.failureCallback?.(error);
            throw error;
        }
    }

    /**
     * Measures the rendered width of the supplied text using the current font state.
     *
     * Multi-line text is measured line by line and the maximum width is returned.
     *
     * @param {*} str - Text content to measure.
     * @returns {number} The measured width in pixels.
     */
    static textWidth(str) {
        const ctx = this._textCtx();
        const text = this._normalizeText(str);
        const lines = text.split(/\r?\n/);
        return Math.max(0, ...lines.map((line) => ctx.measureText(line).width));
    }

    /**
     * Gets or sets the current wrapping mode.
     *
     * @param {'word'|'char'} [style] - Wrapping mode.
     * @returns {'word'|'char'} The current or newly applied wrapping mode.
     * @throws {TypeError} Throws when `style` is not `WORD` or `CHAR`.
     */
    static textWrap(style) {
        if (typeof style === 'undefined') {
            return this.#textWrapValue;
        }
        const wrap = String(style).toLowerCase();
        if (![Canvas.WORD, Canvas.CHAR].includes(wrap)) {
            throw new TypeError('style must be WORD or CHAR');
        }
        this.#textWrapValue = wrap;
        return this.#textWrapValue;
    }

    /**
     * Gets or sets the current text direction.
     *
     * Supported values are `inherit`, `ltr`, and `rtl`.
     *
     * @param {'inherit'|'ltr'|'rtl'} [direction] - Desired text direction.
     * @returns {'inherit'|'ltr'|'rtl'} The current or newly applied direction.
     * @throws {TypeError} Throws when `direction` is invalid.
     */
    static textDirection(direction) {
        if (typeof direction === 'undefined') {
            return this.#textDirectionValue;
        }
        const nextDirection = String(direction).toLowerCase();
        if (!['inherit', 'ltr', 'rtl'].includes(nextDirection)) {
            throw new TypeError('direction must be "inherit", "ltr", or "rtl"');
        }
        this.#textDirectionValue = nextDirection;
        this.#textPropertyState.direction = nextDirection;
        this._syncTextStateIfPossible();
        return this.#textDirectionValue;
    }

    /**
     * Gets or sets a single advanced text property.
     *
     * Properties are applied opportunistically: unsupported canvas properties are
     * stored in state and ignored by the renderer when the browser does not
     * expose them on the active context.
     *
     * @param {string} name - Property name.
     * @param {*} [value] - Optional value to assign.
     * @returns {*} The current or newly applied property value.
     * @throws {TypeError} Throws when `name` is empty.
     */
    static textProperty(name, value) {
        if (typeof name !== 'string' || !name.trim()) {
            throw new TypeError('name must be a non-empty string');
        }
        const key = name.trim();

        if (typeof value === 'undefined') {
            if (key === 'direction') return this.#textDirectionValue;
            return this.#textPropertyState[key];
        }

        if (key === 'direction') {
            return this.textDirection(value);
        }

        this.#textPropertyState[key] = value;
        this._syncTextStateIfPossible();
        return this.#textPropertyState[key];
    }

    /**
     * Gets or sets multiple advanced text properties at once.
     *
     * When called with no arguments, a shallow copy of the current property state
     * is returned.
     *
     * @param {Object} [properties] - Property bag to merge into the current state.
     * @returns {Object} The current property state.
     * @throws {TypeError} Throws when `properties` is not a plain object.
     */
    static textProperties(properties) {
        if (typeof properties === 'undefined') {
            return {
                ...this.#textPropertyState,
                direction: this.#textDirectionValue
            };
        }
        if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
            throw new TypeError('properties must be an object');
        }
        for (const [key, value] of Object.entries(properties)) {
            this.textProperty(key, value);
        }
        return this.textProperties();
    }

    static _ellipseModeValue = 'center';
    static _rectModeValue = 'corner';
    static _smoothValue = true;

    /**
     * Gets or sets ellipse mode.
     * Supported values are CENTER, RADIUS, CORNER, and CORNERS.
     * @param {'center'|'radius'|'corner'|'corners'} [mode]
     * @returns {'center'|'radius'|'corner'|'corners'}
     */
    static ellipseMode(mode) {
        const allowed = [Canvas.CENTER, Canvas.RADIUS, Canvas.CORNER, Canvas.CORNERS];
        if (typeof mode === 'undefined') return this._ellipseModeValue;
        const next = String(mode).toLowerCase();
        if (!allowed.includes(next)) {
            throw new TypeError('mode must be CENTER, RADIUS, CORNER, or CORNERS');
        }
        this._ellipseModeValue = next;
        return this._ellipseModeValue;
    }

    /**
     * Gets or sets rectangle mode.
     * Supported values are CENTER, RADIUS, CORNER, and CORNERS.
     * @param {'center'|'radius'|'corner'|'corners'} [mode]
     * @returns {'center'|'radius'|'corner'|'corners'}
     */
    static rectMode(mode) {
        const allowed = [Canvas.CENTER, Canvas.RADIUS, Canvas.CORNER, Canvas.CORNERS];
        if (typeof mode === 'undefined') return this._rectModeValue;
        const next = String(mode).toLowerCase();
        if (!allowed.includes(next)) {
            throw new TypeError('mode must be CENTER, RADIUS, CORNER, or CORNERS');
        }
        this._rectModeValue = next;
        return this._rectModeValue;
    }

    /**
     * Enables antialiasing where the active renderer supports it.
     * @returns {boolean} The current smoothing state.
     */
    static smooth() {
        const ctx = this.#ctx();
        this._smoothValue = true;
        try {
            if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = true;
            if ('webkitImageSmoothingEnabled' in ctx) ctx.webkitImageSmoothingEnabled = true;
            if ('mozImageSmoothingEnabled' in ctx) ctx.mozImageSmoothingEnabled = true;
            if ('msImageSmoothingEnabled' in ctx) ctx.msImageSmoothingEnabled = true;
            if (ctx.canvas?.style) ctx.canvas.style.imageRendering = 'auto';
        } catch {
            // Ignore unsupported smoothing flags.
        }
        return this._smoothValue;
    }

    /**
     * Disables antialiasing where the active renderer supports it.
     * @returns {boolean} The current smoothing state.
     */
    static noSmooth() {
        const ctx = this.#ctx();
        this._smoothValue = false;
        try {
            if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = false;
            if ('webkitImageSmoothingEnabled' in ctx) ctx.webkitImageSmoothingEnabled = false;
            if ('mozImageSmoothingEnabled' in ctx) ctx.mozImageSmoothingEnabled = false;
            if ('msImageSmoothingEnabled' in ctx) ctx.msImageSmoothingEnabled = false;
            if (ctx.canvas?.style) ctx.canvas.style.imageRendering = 'pixelated';
        } catch {
            // Ignore unsupported smoothing flags.
        }
        return this._smoothValue;
    }

    /**
     * Gets or sets the current line cap style.
     * Supported values are ROUND, SQUARE, and BUTT.
     * @param {'round'|'square'|'butt'} [cap]
     * @returns {'round'|'square'|'butt'}
     */
    static strokeCap(cap) {
        const ctx = this.#ctx();
        if (typeof cap === 'undefined') return ctx.lineCap;
        const next = String(cap).toLowerCase();
        if (![Canvas.ROUND, Canvas.SQUARE, Canvas.BUTT].includes(next)) {
            throw new TypeError('cap must be ROUND, SQUARE, or BUTT');
        }
        ctx.lineCap = next;
        return ctx.lineCap;
    }

    /**
     * Gets or sets the current line join style.
     * Supported values are ROUND, BEVEL, and MITER.
     * @param {'round'|'bevel'|'miter'} [join]
     * @returns {'round'|'bevel'|'miter'}
     */
    static strokeJoin(join) {
        const ctx = this.#ctx();
        if (typeof join === 'undefined') return ctx.lineJoin;
        const next = String(join).toLowerCase();
        if (![Canvas.ROUND, Canvas.BEVEL, Canvas.MITER].includes(next)) {
            throw new TypeError('join must be ROUND, BEVEL, or MITER');
        }
        ctx.lineJoin = next;
        return ctx.lineJoin;
    }


    /** @internal Returns the active ellipse mode for shape helpers. */
    static _ellipseMode() {
    return this._ellipseModeValue;
    }

    /** @internal Returns the active rect mode for shape helpers. */
    static _rectMode() {
    return this._rectModeValue;
    }

    /** @internal Returns whether smoothing is enabled. */
    static _smoothEnabled() {
    return this._smoothValue;
    }
};
