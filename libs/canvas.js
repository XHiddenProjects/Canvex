import { Color } from "./color.js";
import { Canvex } from "./canvex.js";

/**
 * Canvas state helpers and text metrics APIs for Canvex.
 *
 * This replacement avoids JavaScript private class field syntax so it can run
 * in environments that reject `#privateField` parsing. It preserves the public
 * Canvas API used by the rest of the library, including the recently added
 * `strokeMode()`, `saveObj()`, `saveStl()`, and `curveDetail()` helpers.
 */
export const Canvas = class {
    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------
    static LEFT = 'left';
    static RIGHT = 'right';
    static CENTER = 'center';
    static TOP = 'top';
    static BOTTOM = 'bottom';
    static BASELINE = 'baseline';
    static WORD = 'word';
    static CHAR = 'char';
    static NORMAL = 'normal';
    static ITALIC = 'italic';
    static BOLD = 'bold';
    static BOLDITALIC = 'bolditalic';
    static LTR = 'ltr';
    static RTL = 'rtl';
    static CORNER = 'corner';
    static CORNERS = 'corners';
    static RADIUS = 'radius';
    static ROUND = 'round';
    static SQUARE = 'square';
    static BEVEL = 'bevel';
    static MITER = 'miter';
    static BUTT = 'butt';
    static SIMPLE = 'simple';
    static FULL = 'full';

    // ---------------------------------------------------------------------
    // Shared state
    // ---------------------------------------------------------------------
    static _textAlignHorizontal = 'left';
    static _textAlignVertical = 'baseline';
    static _textSizePixels = 16;
    static _textStyleValue = 'normal';
    static _textLeadingPixels = null;
    static _textWrapValue = 'word';
    static _textFontFamily = 'sans-serif';
    static _textDirectionValue = 'inherit';
    static _textPropertyState = {
        direction: 'inherit',
        fontKerning: 'auto',
        fontStretch: 'normal',
        fontVariantCaps: 'normal',
        letterSpacing: '0px',
        textRendering: 'auto',
        wordSpacing: '0px'
    };
    static _loadedFonts = new Map();
    static _fontStyleElementId = '__canvex_loaded_fonts__';
    static _canvas = null;
    static _ctxInstance = null;
    static _ellipseModeValue = 'center';
    static _rectModeValue = 'corner';
    static _smoothValue = true;
    static _strokeModeValue = 'full';
    static _curveDetailValue = 20;
    static _fillEnabled = true;
    static _strokeEnabled = true;
    static _fillStyleValue = 'rgba(255, 255, 255, 1)';
    static _strokeStyleValue = 'rgba(0, 0, 0, 1)';
    // WebGL-compatible RGBA arrays (values in 0–1 range) mirrored from fill/stroke calls.
    static _fillColorGL = [1, 1, 1, 1];
    static _strokeColorGL = [0, 0, 0, 1];

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------
    static _ctx() {
        const ctx = Canvex && Canvex.ctx ? Canvex.ctx : null;
        if (!ctx) {
            throw new Error('Canvas requires an active Canvex rendering context.');
        }
        return ctx;
    }

    static _isCanvas2DContext(ctx) {
        return typeof CanvasRenderingContext2D !== 'undefined' && ctx instanceof CanvasRenderingContext2D;
    }

    static _isWebGLContext(ctx) {
        const hasWebGL1 = typeof WebGLRenderingContext !== 'undefined' && ctx instanceof WebGLRenderingContext;
        const hasWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext;
        return hasWebGL1 || hasWebGL2;
    }

    static _resolveColorArguments(args, fallback) {
        const effective = args.length === 0 ? fallback : args;
        const value = effective.length === 1 ? effective[0] : effective;
        return Color.resolveStyle(value, this._ctx());
    }

    /**
     * Resolves color arguments to a WebGL-compatible [r, g, b, a] float array (0–1 range).
     * Used to keep 3D stroke / fill uniforms in sync with Canvas.fill() / Canvas.stroke().
     * @private
     */
    static _resolveColorGL(args, fallback) {
        const effective = args.length === 0 ? fallback : args;
        const value = effective.length === 1 ? effective[0] : effective;
        try {
            const c = Color.color(value);
            return [
                (c.r ?? 0) / 255,
                (c.g ?? 0) / 255,
                (c.b ?? 0) / 255,
                (c.a ?? 255) / 255
            ];
        } catch {
            return [0, 0, 0, 1];
        }
    }

    static _publishDrawState(target) {
        if (!target || typeof target !== 'object') return target;
        target.__canvexFillEnabled = this._fillEnabled;
        target.__canvexStrokeEnabled = this._strokeEnabled;
        target.__canvexFillStyle = this._fillStyleValue;
        target.__canvexStrokeStyle = this._strokeStyleValue;
        // WebGL-usable RGBA float arrays (components in 0–1 range).
        target.__canvexFillColorGL = this._fillColorGL;
        target.__canvexStrokeColorGL = this._strokeColorGL;
        return target;
    }

    static _syncDrawState(ctx = Canvex && Canvex.ctx ? Canvex.ctx : null) {
        if (!ctx) return null;

        if (this._isCanvas2DContext(ctx)) {
            ctx.fillStyle = this._fillEnabled ? this._fillStyleValue : 'rgba(0, 0, 0, 0)';
            ctx.strokeStyle = this._strokeEnabled ? this._strokeStyleValue : 'rgba(0, 0, 0, 0)';
        }

        this._publishDrawState(ctx);

        const canvas = Canvex?.canvas ?? ctx?.canvas ?? this._canvas ?? null;
        if (canvas) this._publishDrawState(canvas);

        return ctx;
    }

    static _syncTextStateIfPossible() {
        const ctx = Canvex && Canvex.ctx ? Canvex.ctx : null;
        if (this._isCanvas2DContext(ctx)) {
            this._applyTextState(ctx);
        }
    }

    static _sanitizeFontToken(value) {
        return String(value ?? '').trim().replace(/^['"]|['"]$/g, '').trim();
    }

    static _serializeFontFamily(family) {
        const genericFamilies = new Set([
            'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
            'ui-serif', 'ui-sans-serif', 'ui-monospace', 'emoji', 'math', 'fangsong'
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

    static _extractFontFamilyFromCss(cssText) {
        const match = String(cssText ?? '').match(/font-family\s*:\s*(['"]?)([^;'"\n\r}]+)\1/i);
        return match ? this._sanitizeFontToken(match[2]) : '';
    }

    static _inferFontName(path) {
        try {
            const base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
            const url = new URL(String(path ?? '').trim(), base);
            if (/fonts.googleapis.com$/i.test(url.hostname)) {
                const family = url.searchParams.get('family');
                if (family) {
                    return this._sanitizeFontToken(decodeURIComponent(family).split(':')[0].replace(/\+/g, ' '));
                }
            }
        } catch {
            // Ignore URL parsing failures and fall through.
        }

        const value = String(path ?? '').trim();
        const withoutHash = value.split('#')[0];
        const withoutQuery = withoutHash.split('?')[0];
        const leaf = withoutQuery.split('/').pop() || withoutQuery;
        const stem = leaf.replace(/\.[^.]+$/u, '');
        return this._sanitizeFontToken(stem) || 'custom-font';
    }

    static _registerFont(fontInfo) {
        const handle = {
            ...fontInfo,
            family: this._sanitizeFontToken(fontInfo?.family || fontInfo?.name || this._textFontFamily || 'sans-serif'),
            name: this._sanitizeFontToken(fontInfo?.name || fontInfo?.family || 'custom-font')
        };

        const aliases = new Set([
            handle.name,
            handle.family,
            fontInfo?.alias
        ].filter(Boolean).map((value) => String(value).trim()));

        for (const key of aliases) {
            this._loadedFonts.set(key, handle);
        }
        return handle;
    }

    static _resolveFont(font) {
        if (typeof font === 'string') {
            const key = this._sanitizeFontToken(font);
            if (!key) throw new TypeError('font must be a non-empty string or font object');
            return this._loadedFonts.get(font) || this._loadedFonts.get(key) || { name: key, family: key };
        }

        if (font && typeof font === 'object') {
            const family = this._sanitizeFontToken(font.family || font.fontFamily || font.name || font.alias);
            const name = this._sanitizeFontToken(font.name || font.alias || family);
            if (!family && !name) {
                throw new TypeError('font object must provide a family, fontFamily, name, or alias');
            }
            return this._registerFont({ ...font, name: name || family, family: family || name });
        }

        throw new TypeError('font must be a string or object');
    }

    static _ensureFontStyleElement() {
        if (typeof document === 'undefined' || !document.head) {
            throw new Error('Font loading requires a browser document.');
        }
        let styleElement = document.getElementById(this._fontStyleElementId);
        if (!(styleElement instanceof HTMLStyleElement)) {
            styleElement = document.createElement('style');
            styleElement.id = this._fontStyleElementId;
            styleElement.type = 'text/css';
            document.head.appendChild(styleElement);
        }
        return styleElement;
    }

    static _ensureFontStylesheet(href) {
        if (typeof document === 'undefined' || !document.head) {
            throw new Error('Font loading requires a browser document.');
        }

        const normalizedHref = new URL(href, document.baseURI).href;
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
            resolvedName = typeof name.name === 'string' ? name.name.trim() : resolvedName;
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
            name: resolvedName,
            options: resolvedOptions,
            successCallback: onSuccess,
            failureCallback: onFailure
        };
    }

    static _fontFaceDescriptors(options = {}) {
        const descriptors = {};
        for (const key of ['style', 'weight', 'stretch', 'unicodeRange', 'variant', 'featureSettings', 'display']) {
            if (typeof options[key] !== 'undefined' && options[key] !== null) {
                descriptors[key] = options[key];
            }
        }
        return descriptors;
    }

    static _getTextState() {
        return {
            horizontal: this._textAlignHorizontal,
            vertical: this._textAlignVertical,
            size: this._textSizePixels,
            style: this._textStyleValue,
            leading: this._textLeadingPixels ?? this._textSizePixels * 1.2,
            wrap: this._textWrapValue,
            fontFamily: this._textFontFamily,
            direction: this._textDirectionValue,
            properties: { ...this._textPropertyState }
        };
    }

    static _textCtx() {
        const ctx = this._ctx();
        if (!this._isCanvas2DContext(ctx)) {
            throw new Error('Text APIs currently support CanvasRenderingContext2D only.');
        }
        this._applyTextState(ctx);
        return ctx;
    }

    static _applyTextState(ctx) {
        const style = this._textStyleValue;
        const size = this._textSizePixels;
        const family = this._serializeFontFamily(this._textFontFamily);

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
        ctx.textAlign = this._textAlignHorizontal;
        ctx.textBaseline = 'alphabetic';
        this._applyTextProperties(ctx);
    }

    static _applyTextProperties(ctx) {
        for (const [key, value] of Object.entries(this._textPropertyState)) {
            if (typeof value === 'undefined' || value === null) continue;
            try {
                if (key in ctx) ctx[key] = value;
            } catch {
                // Ignore unsupported text properties.
            }
        }
        if ('direction' in ctx) {
            try {
                ctx.direction = this._textDirectionValue;
            } catch {
                // Ignore unsupported direction assignments.
            }
        }
    }

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

            if (this._textWrapValue === Canvas.CHAR) {
                pushBrokenWord(paragraph);
                continue;
            }

            const words = paragraph.split(/(\s+)/).filter((part) => part.length > 0);
            let line = '';
            for (const word of words) {
                const trial = line + word;
                if (line && ctx.measureText(trial).width > maxWidth) {
                    lines.push(line.trimEnd());
                    if (/^\s+$/.test(word)) {
                        line = '';
                    } else if (ctx.measureText(word).width > maxWidth) {
                        pushBrokenWord(word);
                        line = '';
                    } else {
                        line = word;
                    }
                } else {
                    line = trial;
                }
            }
            if (line) lines.push(line.trimEnd());
        }

        return lines;
    }

    static _textMetrics(ctx, sample = 'Mg') {
        const metrics = ctx.measureText(sample);
        const ascent = Number.isFinite(metrics.actualBoundingBoxAscent) ? metrics.actualBoundingBoxAscent : this._textSizePixels * 0.8;
        const descent = Number.isFinite(metrics.actualBoundingBoxDescent) ? metrics.actualBoundingBoxDescent : this._textSizePixels * 0.2;
        return { ascent, descent, metrics };
    }

    static _computeTextBounds(str, x = 0, y = 0, maxWidth, maxHeight) {
        const ctx = this._textCtx();
        const content = this._normalizeText(str);
        const lines = this._wrapLines(ctx, content, maxWidth);
        const state = this._getTextState();
        const leading = this.textLeading();

        const lineMetrics = lines.map((line) => {
            const metrics = ctx.measureText(line);
            return { text: line, metrics, width: metrics.width };
        });

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
            }
        }

        let left = Infinity;
        let right = -Infinity;
        let top = Infinity;
        let bottom = -Infinity;

        for (let i = 0; i < lineMetrics.length; i += 1) {
            const entry = lineMetrics[i];
            const metrics = entry.metrics;
            const baselineY = firstBaseline + i * leading;
            if (hasBoxHeight && baselineY + defaultDescent > y + maxHeight) break;

            let lineLeft = x;
            let lineRight = x + entry.width;
            if (state.horizontal === Canvas.CENTER) {
                lineLeft = x - entry.width / 2;
                lineRight = x + entry.width / 2;
            } else if (state.horizontal === Canvas.RIGHT) {
                lineLeft = x - entry.width;
                lineRight = x;
            }

            const ascent = Number.isFinite(metrics.actualBoundingBoxAscent) ? metrics.actualBoundingBoxAscent : defaultAscent;
            const descent = Number.isFinite(metrics.actualBoundingBoxDescent) ? metrics.actualBoundingBoxDescent : defaultDescent;
            const lineTop = baselineY - ascent;
            const lineBottom = baselineY + descent;

            left = Math.min(left, lineLeft);
            right = Math.max(right, lineRight);
            top = Math.min(top, lineTop);
            bottom = Math.max(bottom, lineBottom);
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
    // Canvas creation / routing
    // ---------------------------------------------------------------------
    /**
         * Creates a detached canvas element, initializes the requested rendering context,
         * and stores both so they can later be routed into the active Canvex instance.
         *
         * @param {Object} [options={}] Canvas creation options.
         * @param {number} [options.x=0] Horizontal position used when the canvas is inserted into the DOM.
         * @param {number} [options.y=0] Vertical position used when the canvas is inserted into the DOM.
         * @param {number} [options.width] Canvas width in CSS/device pixels. Falls back to the current Canvex width or viewport width.
         * @param {number} [options.height] Canvas height in CSS/device pixels. Falls back to the current Canvex height or viewport height.
         * @param {'2d'|'webgl'|'webgl2'|CanvasRenderingContext2D|WebGLRenderingContext|WebGL2RenderingContext} [options.ctx='2d'] Rendering context identifier or existing context instance.
         * @returns {HTMLCanvasElement} The created canvas element.
         * @throws {Error} Throws when a compatible rendering context cannot be created.
         */
    static create(options = {}) {
        const safe = {
            x: Number(options.x ?? 0),
            y: Number(options.y ?? 0),
            width: Math.max(1, Math.floor(Number(options.width ?? Canvex.width ?? window.innerWidth ?? 300))),
            height: Math.max(1, Math.floor(Number(options.height ?? Canvex.height ?? window.innerHeight ?? 150))),
            ctx: options.ctx ?? Canvex.C2D ?? '2d'
        };

        this._canvas = document.createElement('canvas');
        this._canvas.width = safe.width;
        this._canvas.height = safe.height;
        this._canvas.style.position = 'absolute';
        this._canvas.style.left = `${safe.x}px`;
        this._canvas.style.top = `${safe.y}px`;
        this._canvas.style.display = 'block';
        this._canvas.tabIndex = 0;
        this._canvas.style.outline = 'none';

        this._ctxInstance = this._canvas.getContext(safe.ctx);
        if (!this._ctxInstance) {
            throw new Error(`Could not create ${safe.ctx} context`);
        }
        return this._canvas;
    }

    /**

         * Promotes the canvas previously created with {@link Canvas.create} to the active

         * Canvex canvas and synchronizes the cached drawing state onto its rendering context.

         *

         * @returns {HTMLCanvasElement} The canvas that was assigned to the active Canvex instance.

         * @throws {Error} Throws when {@link Canvas.create} has not been called first.

         */

    static setCanvas() {
        if (!this._canvas || !this._ctxInstance) {
            throw new Error('Canvas.create() must be called before Canvas.setCanvas().');
        }
        Canvex._setCanvas(this._canvas, this._ctxInstance);
        this._syncDrawState(this._ctxInstance);
        return this._canvas;
    }

    /**

         * Restores the canvas and rendering context that were active before the most recent

         * {@link Canvas.setCanvas} call.

         *

         * @returns {*} Whatever value is returned by `Canvex._revertCanvas()`.

         */

    static revertCanvas() {
        return Canvex._revertCanvas();
    }

    // ---------------------------------------------------------------------
    // Basic canvas state helpers
    // ---------------------------------------------------------------------
    /**
         * Begins a new path on the active rendering context.
         *
         * Use this when you want to manually construct a shape before filling or stroking it.
         *
         * @returns {void}
         * @throws {Error} Throws when no active Canvex rendering context exists.
         */
    static start() {
        this._ctx().beginPath();
    }

    /**

         * Closes the current path on the active rendering context.

         *

         * @returns {void}

         * @throws {Error} Throws when no active Canvex rendering context exists.

         */

    static end() {
        this._ctx().closePath();
    }

    /**

         * Paints the entire active canvas using the supplied color arguments.

         *

         * When no arguments are provided, a light gray background is used.

         *

         * @param {...*} color Color components or color objects understood by `Color.resolveStyle()`.

         * @returns {string|CanvasGradient|CanvasPattern} The resolved fill style applied to the canvas background.

         * @throws {Error} Throws when no active Canvex rendering context exists.

         */

    static background(...color) {
        const ctx = this._ctx();
        const width = Number(Canvex.width ?? Canvex.canvas?.width ?? 0);
        const height = Number(Canvex.height ?? Canvex.canvas?.height ?? 0);
        const effective = color.length === 0 ? [220] : color;

        if (this._isCanvas2DContext(ctx)) {
            const fillStyle = this._resolveColorArguments(color, [220]);
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = fillStyle;
            ctx.fillRect(0, 0, width, height);
            ctx.restore();
            return fillStyle;
        }

        if (this._isWebGLContext(ctx)) {
            const value = effective.length === 1 ? effective[0] : effective;
            const resolved = Color.color(value);
            ctx.clearColor((resolved.r ?? 0) / 255, (resolved.g ?? 0) / 255, (resolved.b ?? 0) / 255, (resolved.a ?? 255) / 255);
            ctx.clear(ctx.COLOR_BUFFER_BIT | ctx.DEPTH_BUFFER_BIT);
            return value;
        }

        throw new Error('Canvas.background() requires a Canvas 2D, WebGL, or WebGL2 context.');
    }

    /**

         * Gets or sets the current fill style used by subsequent drawing operations.

         *

         * Calling this method with no arguments returns the cached fill style. Passing color

         * arguments enables filling and resolves them through `Color.resolveStyle()`.

         *

         * @param {...*} color Color components or color objects understood by `Color.resolveStyle()`.

         * @returns {string|CanvasGradient|CanvasPattern} The current or newly applied fill style.

         * @throws {Error} Throws when no active Canvex rendering context exists.

         */

    static fill(...color) {
        const ctx = this._ctx();
        if (color.length === 0) {
            return this._fillStyleValue;
        }

        const fillStyle = this._resolveColorArguments(color, [255]);
        this._fillEnabled = true;
        this._fillStyleValue = fillStyle;
        this._fillColorGL = this._resolveColorGL(color, [255]);
        this._syncDrawState(ctx);
        return fillStyle;
    }

    /**

         * Gets or sets the current stroke style used by subsequent drawing operations.

         *

         * Calling this method with no arguments returns the cached stroke style. Passing color

         * arguments enables stroking and resolves them through `Color.resolveStyle()`.

         *

         * @param {...*} color Color components or color objects understood by `Color.resolveStyle()`.

         * @returns {string|CanvasGradient|CanvasPattern} The current or newly applied stroke style.

         * @throws {Error} Throws when no active Canvex rendering context exists.

         */

    static stroke(...color) {
        const ctx = this._ctx();
        if (color.length === 0) {
            return this._strokeStyleValue;
        }

        const strokeStyle = this._resolveColorArguments(color, [0]);
        this._strokeEnabled = true;
        this._strokeStyleValue = strokeStyle;
        this._strokeColorGL = this._resolveColorGL(color, [0]);
        this._syncDrawState(ctx);
        return strokeStyle;
    }

    /**

         * Disables stroking for subsequent drawing operations while preserving the cached stroke style.

         *

         * @returns {string|CanvasGradient|CanvasPattern} The most recently configured stroke style.

         * @throws {Error} Throws when no active Canvex rendering context exists.

         */

    static noStroke() {
        const ctx = this._ctx();
        this._strokeEnabled = false;
        this._strokeColorGL = [0, 0, 0, 0];
        this._syncDrawState(ctx);
        return this._strokeStyleValue;
    }

    /**

         * Disables filling for subsequent drawing operations while preserving the cached fill style.

         *

         * @returns {string|CanvasGradient|CanvasPattern} The most recently configured fill style.

         * @throws {Error} Throws when no active Canvex rendering context exists.

         */

    static noFill() {
        const ctx = this._ctx();
        this._fillEnabled = false;
        this._fillColorGL = [0, 0, 0, 0];
        this._syncDrawState(ctx);
        return this._fillStyleValue;
    }

    /**

         * Sets the compositing and blending mode used when new pixels are drawn.

         *

         * @param {GlobalCompositeOperation|string} operation The value to assign to `globalCompositeOperation`.

         * @returns {GlobalCompositeOperation|string} The effective composite operation after assignment.

         * @throws {Error} Throws when no active Canvex rendering context exists.

         */

    static compositeOperation(operation) {
        const ctx = this._ctx();
        ctx.globalCompositeOperation = operation;
        return ctx.globalCompositeOperation;
    }

    /**

         * Gets or sets the line width used for stroke rendering.

         *

         * A falsy or invalid value is coerced to `0`, and negative values are clamped to `0`.

         *

         * @param {number} w The desired stroke width in pixels.

         * @returns {number} The effective line width assigned to the active context.

         * @throws {Error} Throws when no active Canvex rendering context exists.

         */

    static strokeWeight(w) {
        const ctx = this._ctx();
        ctx.lineWidth = Math.max(0, Number(w) || 0);
        return ctx.lineWidth;
    }

    /**

         * Pushes the current drawing state onto the rendering context stack.

         *

         * @returns {void}

         * @throws {Error} Throws when no active Canvex rendering context exists.

         */

    static save() {
        return this._ctx().save();
    }

    /**

         * Restores the most recently saved drawing state from the rendering context stack.

         *

         * @returns {void}

         * @throws {Error} Throws when no active Canvex rendering context exists.

         */

    static restore() {
        return this._ctx().restore();
    }

    // ---------------------------------------------------------------------
    // Public text APIs
    // ---------------------------------------------------------------------
    /**
         * Gets or sets the horizontal and vertical alignment used by text layout helpers.
         *
         * When called without arguments, the current alignment state is returned.
         *
         * @param {string} [horizAlign=Canvas.LEFT] Horizontal alignment constant.
         * @param {string} [vertAlign=Canvas.BASELINE] Vertical alignment constant.
         * @returns {{horizontal: string, vertical: string}|string} The current alignment object when used as a getter, or the applied horizontal alignment when used as a setter.
         * @throws {TypeError} Throws when either alignment value is invalid.
         */
    static textAlign(horizAlign = Canvas.LEFT, vertAlign = Canvas.BASELINE) {
        if (arguments.length === 0) {
            return {
                horizontal: this._textAlignHorizontal,
                vertical: this._textAlignVertical
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

        this._textAlignHorizontal = horizontal;
        this._textAlignVertical = vertical;
        this._syncTextStateIfPossible();
        return this.textAlign();
    }

    /**

         * Measures the ascent of the current text style using the active 2D rendering context.

         *

         * @returns {number} The ascent in pixels.

         * @throws {Error} Throws when text APIs are used without an active 2D canvas context.

         */

    static textAscent() {
        const ctx = this._textCtx();
        return this._textMetrics(ctx).ascent;
    }

    /**

         * Measures the descent of the current text style using the active 2D rendering context.

         *

         * @returns {number} The descent in pixels.

         * @throws {Error} Throws when text APIs are used without an active 2D canvas context.

         */

    static textDescent() {
        const ctx = this._textCtx();
        return this._textMetrics(ctx).descent;
    }

    /**

         * Alias for {@link Canvas.textAscent}.

         *

         * @returns {number} The ascent of the current font in pixels.

         */

    static fontAscent() {
        return this.textAscent();
    }

    /**

         * Alias for {@link Canvas.textDescent}.

         *

         * @returns {number} The descent of the current font in pixels.

         */

    static fontDescent() {
        return this.textDescent();
    }

    /**

         * Computes the bounding box of a text sample using the current text state.

         *

         * This is a convenience alias around the shared internal text-bounds computation.

         *

         * @param {*} [str='Mg'] The text to measure.

         * @param {number} [x=0] The anchor x-coordinate.

         * @param {number} [y=0] The anchor y-coordinate.

         * @returns {{x:number,y:number,width:number,height:number,left:number,right:number,top:number,bottom:number,lines:string[]}} The computed text bounds.

         * @throws {Error} Throws when text APIs are used without an active 2D canvas context.

         */

    static fontBounds(str = 'Mg', x = 0, y = 0) {
        return this._computeTextBounds(str, x, y);
    }

    /**

         * Computes the rendered bounds of text, optionally applying wrapping constraints.

         *

         * @param {*} str The text to measure.

         * @param {number} [x=0] The anchor x-coordinate.

         * @param {number} [y=0] The anchor y-coordinate.

         * @param {number} [maxWidth] Maximum width before text wraps.

         * @param {number} [maxHeight] Optional maximum height constraint.

         * @returns {{x:number,y:number,width:number,height:number,left:number,right:number,top:number,bottom:number,lines:string[]}} The computed text bounds.

         * @throws {Error} Throws when text APIs are used without an active 2D canvas context.

         */

    static textBounds(str, x = 0, y = 0, maxWidth, maxHeight) {
        return this._computeTextBounds(str, x, y, maxWidth, maxHeight);
    }

    /**

         * Gets or sets the line spacing used for multi-line text layout.

         *

         * When omitted, the current line spacing is returned. The default is `textSize * 1.2`

         * until a custom value is assigned.

         *

         * @param {number} [leading] Positive line spacing in pixels.

         * @returns {number} The current or newly applied leading value.

         * @throws {TypeError} Throws when `leading` is not a positive number.

         */

    static textLeading(leading) {
        if (typeof leading === 'undefined') {
            return this._textLeadingPixels ?? this._textSizePixels * 1.2;
        }
        if (!Number.isFinite(leading) || leading <= 0) {
            throw new TypeError('leading must be a positive number');
        }
        this._textLeadingPixels = leading;
        return this._textLeadingPixels;
    }

    /**

         * Gets or sets the current font size in pixels.

         *

         * Updating the size also re-synchronizes the cached text state with the active 2D context when possible.

         *

         * @param {number} [size] Positive font size in pixels.

         * @returns {number} The current or newly applied text size.

         * @throws {TypeError} Throws when `size` is not a positive number.

         */

    static textSize(size) {
        if (typeof size === 'undefined') {
            return this._textSizePixels;
        }
        if (!Number.isFinite(size) || size <= 0) {
            throw new TypeError('size must be a positive number');
        }
        this._textSizePixels = size;
        this._syncTextStateIfPossible();
        return this._textSizePixels;
    }

    /**

         * Gets or sets the current font style preset.

         *

         * Accepted values are `Canvas.NORMAL`, `Canvas.ITALIC`, `Canvas.BOLD`, and `Canvas.BOLDITALIC`.

         *

         * @param {string} [style] The style constant to apply.

         * @returns {string} The current or newly applied style.

         * @throws {TypeError} Throws when `style` is not one of the supported constants.

         */

    static textStyle(style) {
        if (typeof style === 'undefined') {
            return this._textStyleValue;
        }
        const nextStyle = String(style).toLowerCase();
        if (![Canvas.NORMAL, Canvas.ITALIC, Canvas.BOLD, Canvas.BOLDITALIC].includes(nextStyle)) {
            throw new TypeError('style must be NORMAL, ITALIC, BOLD, or BOLDITALIC');
        }
        this._textStyleValue = nextStyle;
        this._syncTextStateIfPossible();
        return this._textStyleValue;
    }

    /**

         * Gets or sets the active font family, optionally updating the current font size at the same time.

         *

         * The supplied `font` may be a font family string or a font descriptor previously registered through {@link Canvas.loadFont}.

         *

         * @param {string|Object} [font] Font family name or registered font descriptor.

         * @param {number} [size] Optional positive font size to apply together with the font.

         * @returns {string|Object} The current font descriptor/family when used as a getter, or the resolved font descriptor when used as a setter.

         * @throws {TypeError} Throws when an invalid font or size is provided.

         */

    static textFont(font, size) {
        if (typeof font === 'undefined') {
            return this._loadedFonts.get(this._textFontFamily) ?? this._textFontFamily;
        }

        const resolvedFont = this._resolveFont(font);
        this._textFontFamily = resolvedFont.family;
        this._registerFont(resolvedFont);

        if (typeof size !== 'undefined') {
            if (!Number.isFinite(size) || size <= 0) {
                throw new TypeError('size must be a positive number');
            }
            this._textSizePixels = size;
        }

        this._syncTextStateIfPossible();
        return this._loadedFonts.get(this._textFontFamily) ?? this._textFontFamily;
    }

    /**

         * Loads a font from a URL or stylesheet reference, registers it with the Canvas font cache,

         * and optionally invokes success or failure callbacks.

         *

         * This method supports direct font files as well as stylesheet-backed font families.

         *

         * @param {string} path URL or path to the font resource.

         * @param {string} [name] Optional family/name override.

         * @param {Object} [options] Optional font loading and registration settings.

         * @param {Function} [successCallback] Callback invoked with the registered font descriptor after a successful load.

         * @param {Function} [failureCallback] Callback invoked with the thrown error when loading fails.

         * @returns {Promise<Object>} A promise that resolves to the registered font descriptor.

         * @throws {TypeError} Throws when `path` is empty or invalid.

         * @throws {Error} Throws when the environment cannot load fonts or the font resource fails to register.

         */

    static async loadFont(path, name, options, successCallback, failureCallback) {
        const source = String(path ?? '').trim();
        const args = this._resolveLoadFontArgs(name, options, successCallback, failureCallback);
        if (!source) {
            const error = new TypeError('path must be a non-empty string');
            args.failureCallback?.(error);
            throw error;
        }

        const descriptors = this._fontFaceDescriptors(args.options);
        const isInlineCss = /@font-face/i.test(source);
        const isCssFile =
            /\.css(?:[?#].*)?$/i.test(source) ||
            /^data:text\/css/i.test(source) ||
            /^https?:\/\/fonts.googleapis.com\/css2\b/i.test(source) ||
            /^https?:\/\/fonts.googleapis.com\/css\b/i.test(source);

        try {
            if (typeof document === 'undefined') {
                throw new Error('loadFont() requires a browser environment with document support.');
            }

            let family = args.name || args.options.family || args.options.name || this._inferFontName(source);
            let handle;

            if (isInlineCss) {
                const style = this._ensureFontStyleElement();
                style.textContent += `\n${source}\n`;
                family = this._extractFontFamilyFromCss(source) || family;
                handle = this._registerFont({ name: family, family, source, type: 'inline-css' });
            } else if (isCssFile) {
                await this._ensureFontStylesheet(source);
                handle = this._registerFont({ name: family, family, source, type: 'stylesheet' });
            } else if (typeof FontFace !== 'undefined' && document.fonts) {
                const fontFace = new FontFace(family, `url(${JSON.stringify(source).slice(1, -1)})`, descriptors);
                await fontFace.load();
                document.fonts.add(fontFace);
                handle = this._registerFont({ name: family, family, source, type: 'font-face', fontFace });
            } else {
                handle = this._registerFont({ name: family, family, source, type: 'fallback' });
            }

            args.successCallback?.(handle);
            return handle;
        } catch (error) {
            args.failureCallback?.(error);
            throw error;
        }
    }

    /**

         * Measures the width of the provided text using the current font state.

         *

         * Multi-line strings are measured line-by-line and the widest line is returned.

         *

         * @param {*} str The text to measure.

         * @returns {number} The maximum line width in pixels.

         * @throws {Error} Throws when text APIs are used without an active 2D canvas context.

         */

    static textWidth(str) {
        const ctx = this._textCtx();
        const text = this._normalizeText(str);
        const lines = text.split(/\r?\n/);
        return Math.max(0, ...lines.map((line) => ctx.measureText(line).width));
    }

    /**

         * Gets or sets the wrapping strategy used by text layout helpers.

         *

         * Accepted values are `Canvas.WORD` and `Canvas.CHAR`.

         *

         * @param {string} [style] The wrapping strategy to apply.

         * @returns {string} The current or newly applied wrap style.

         * @throws {TypeError} Throws when `style` is not a supported wrap constant.

         */

    static textWrap(style) {
        if (typeof style === 'undefined') {
            return this._textWrapValue;
        }
        const wrap = String(style).toLowerCase();
        if (![Canvas.WORD, Canvas.CHAR].includes(wrap)) {
            throw new TypeError('style must be WORD or CHAR');
        }
        this._textWrapValue = wrap;
        return this._textWrapValue;
    }

    /**

         * Gets or sets the text direction applied to subsequent text measurements and rendering.

         *

         * Accepted values are `'inherit'`, `'ltr'`, and `'rtl'`.

         *

         * @param {string} [direction] The text direction to apply.

         * @returns {string} The current or newly applied direction.

         * @throws {TypeError} Throws when `direction` is invalid.

         */

    static textDirection(direction) {
        if (typeof direction === 'undefined') {
            return this._textDirectionValue;
        }
        const nextDirection = String(direction).toLowerCase();
        if (!['inherit', 'ltr', 'rtl'].includes(nextDirection)) {
            throw new TypeError('direction must be "inherit", "ltr", or "rtl"');
        }
        this._textDirectionValue = nextDirection;
        this._textPropertyState.direction = nextDirection;
        this._syncTextStateIfPossible();
        return this._textDirectionValue;
    }

    /**

         * Gets or sets an individual text-related rendering property.

         *

         * This helper is intended for advanced typography settings such as `fontKerning`,

         * `letterSpacing`, `wordSpacing`, and `textRendering`.

         *

         * @param {string} name The property name to read or update.

         * @param {*} [value] The value to assign. When omitted, the current property value is returned.

         * @returns {*} The current or newly applied property value.

         * @throws {TypeError} Throws when `name` is empty or not a string.

         */

    static textProperty(name, value) {
        if (typeof name !== 'string' || !name.trim()) {
            throw new TypeError('name must be a non-empty string');
        }
        const key = name.trim();
        if (typeof value === 'undefined') {
            if (key === 'direction') return this._textDirectionValue;
            return this._textPropertyState[key];
        }
        if (key === 'direction') {
            return this.textDirection(value);
        }
        this._textPropertyState[key] = value;
        this._syncTextStateIfPossible();
        return this._textPropertyState[key];
    }

    /**

         * Gets or sets multiple text-related rendering properties at once.

         *

         * When called without arguments, a shallow copy of the current text property map is returned.

         *

         * @param {Object<string, *>} [properties] Property/value pairs to apply.

         * @returns {Object<string, *>} The current text property map after any updates have been applied.

         * @throws {TypeError} Throws when `properties` is provided but is not a plain object.

         */

    static textProperties(properties) {
        if (typeof properties === 'undefined') {
            return {
                ...this._textPropertyState,
                direction: this._textDirectionValue
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

    // ---------------------------------------------------------------------
    // Shape-state helpers
    // ---------------------------------------------------------------------
    /**
         * Gets or sets the coordinate interpretation mode used by ellipse helpers.
         *
         * Accepted values are `Canvas.CENTER`, `Canvas.RADIUS`, `Canvas.CORNER`, and `Canvas.CORNERS`.
         *
         * @param {string} [mode] The ellipse mode to apply.
         * @returns {string} The current or newly applied ellipse mode.
         * @throws {TypeError} Throws when `mode` is invalid.
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

         * Gets or sets the coordinate interpretation mode used by rectangle helpers.

         *

         * Accepted values are `Canvas.CENTER`, `Canvas.RADIUS`, `Canvas.CORNER`, and `Canvas.CORNERS`.

         *

         * @param {string} [mode] The rectangle mode to apply.

         * @returns {string} The current or newly applied rectangle mode.

         * @throws {TypeError} Throws when `mode` is invalid.

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

         * Enables image smoothing on the active rendering context where supported.

         *

         * This also restores the canvas element's CSS `image-rendering` hint to `auto` when possible.

         *

         * @returns {boolean} Always returns `true` after smoothing has been enabled.

         * @throws {Error} Throws when no active Canvex rendering context exists.

         */

    static smooth() {
        const ctx = this._ctx();
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

         * Disables image smoothing on the active rendering context where supported.

         *

         * This also updates the canvas element's CSS `image-rendering` hint to `pixelated` when possible.

         *

         * @returns {boolean} Always returns `false` after smoothing has been disabled.

         * @throws {Error} Throws when no active Canvex rendering context exists.

         */

    static noSmooth() {
        const ctx = this._ctx();
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

         * Gets or sets the line cap style used for stroked path endpoints.

         *

         * Accepted values are `Canvas.ROUND`, `Canvas.SQUARE`, and `Canvas.BUTT`.

         *

         * @param {string} [cap] The line cap style to apply.

         * @returns {string} The current or newly applied line cap.

         * @throws {TypeError} Throws when `cap` is invalid.

         * @throws {Error} Throws when no active Canvex rendering context exists.

         */

    static strokeCap(cap) {
        const ctx = this._ctx();
        if (typeof cap === 'undefined') return ctx.lineCap;
        const next = String(cap).toLowerCase();
        if (![Canvas.ROUND, Canvas.SQUARE, Canvas.BUTT].includes(next)) {
            throw new TypeError('cap must be ROUND, SQUARE, or BUTT');
        }
        ctx.lineCap = next;
        return ctx.lineCap;
    }

    /**

         * Gets or sets the line join style used where stroked path segments meet.

         *

         * Accepted values are `Canvas.ROUND`, `Canvas.BEVEL`, and `Canvas.MITER`.

         *

         * @param {string} [join] The line join style to apply.

         * @returns {string} The current or newly applied line join.

         * @throws {TypeError} Throws when `join` is invalid.

         * @throws {Error} Throws when no active Canvex rendering context exists.

         */

    static strokeJoin(join) {
        const ctx = this._ctx();
        if (typeof join === 'undefined') return ctx.lineJoin;
        const next = String(join).toLowerCase();
        if (![Canvas.ROUND, Canvas.BEVEL, Canvas.MITER].includes(next)) {
            throw new TypeError('join must be ROUND, BEVEL, or MITER');
        }
        ctx.lineJoin = next;
        return ctx.lineJoin;
    }

    static _ellipseMode() {
        return this._ellipseModeValue;
    }

    static _rectMode() {
        return this._rectModeValue;
    }

    static _smoothEnabled() {
        return this._smoothValue;
    }

    // ---------------------------------------------------------------------
    // New canvas.js APIs requested by user
    // ---------------------------------------------------------------------
    /**
         * Gets or sets the custom Canvex stroke rendering mode.
         *
         * Accepted values are `Canvas.SIMPLE` and `Canvas.FULL`. The selected value is also mirrored
         * onto the active canvas element so downstream helpers can read it.
         *
         * @param {string} [mode] The stroke mode to apply.
         * @returns {string} The current or newly applied stroke mode.
         * @throws {TypeError} Throws when `mode` is invalid.
         */
    static strokeMode(mode) {
        if (typeof mode === 'undefined') {
            return this._strokeModeValue;
        }
        const next = String(mode).toLowerCase();
        if (![Canvas.SIMPLE, Canvas.FULL].includes(next)) {
            throw new TypeError('mode must be Canvas.SIMPLE or Canvas.FULL');
        }
        this._strokeModeValue = next;
        const canvas = Canvex?.canvas ?? null;
        if (canvas) canvas.__canvexStrokeMode = next;
        return this._strokeModeValue;
    }

    /**

         * Serializes compatible geometry data to Wavefront OBJ text and triggers a download in browser environments.

         *

         * The geometry argument must match the structure produced by `Shapes.buildGeometry()` or a compatible object.

         *

         * @param {Object} geometry Geometry data to export.

         * @param {string} [fileName='model.obj'] Download file name.

         * @param {Object} [options={}] Export configuration.

         * @param {boolean} [options.includeNormals=true] Include vertex normals when available or derivable.

         * @param {boolean} [options.includeUvs=true] Include texture coordinates when available.

         * @returns {string} The generated OBJ file contents.

         * @throws {TypeError} Throws when `geometry` is missing or incompatible.

         */

    static saveObj(geometry, fileName = 'model.obj', options = {}) {
        const normalized = this._normalizeGeometryForExport(geometry);
        const includeNormals = options.includeNormals !== false;
        const includeUvs = options.includeUvs !== false;
        const lines = ['# Exported by Canvex Canvas.saveObj()'];

        for (const vertex of normalized.vertices) {
            lines.push(`v ${vertex.x} ${vertex.y} ${vertex.z}`);
        }

        if (includeUvs) {
            for (const uv of normalized.uvs) {
                lines.push(`vt ${uv[0]} ${uv[1]}`);
            }
        }

        if (includeNormals) {
            for (const normal of normalized.vertexNormals) {
                lines.push(`vn ${normal.x} ${normal.y} ${normal.z}`);
            }
        }

        for (const face of normalized.faces) {
            const refs = face.map((index) => {
                const i = index + 1;
                if (includeUvs && includeNormals) return `${i}/${i}/${i}`;
                if (includeUvs) return `${i}/${i}`;
                if (includeNormals) return `${i}//${i}`;
                return `${i}`;
            });
            lines.push(`f ${refs.join(' ')}`);
        }

        const text = `${lines.join('\n')}\n`;
        if (options.download !== false) {
            this._downloadTextFile(fileName, text, 'text/plain;charset=utf-8');
        }
        return text;
    }

    /**

         * Serializes compatible geometry data to ASCII STL text and triggers a download in browser environments.

         *

         * The geometry argument must match the structure produced by `Shapes.buildGeometry()` or a compatible object.

         *

         * @param {Object} geometry Geometry data to export.

         * @param {string} [fileName='model.stl'] Download file name.

         * @param {Object} [options={}] Export configuration.

         * @param {string} [options.solidName] Optional STL solid name. Defaults to the file name without the `.stl` suffix.

         * @returns {string} The generated ASCII STL file contents.

         * @throws {TypeError} Throws when `geometry` is missing or incompatible.

         */

    static saveStl(geometry, fileName = 'model.stl', options = {}) {
        const normalized = this._normalizeGeometryForExport(geometry);
        const solidName = String(options.solidName ?? (fileName.replace(/\.stl$/i, '') || 'canvex'));
        const lines = [`solid ${solidName}`];

        for (const face of normalized.faces) {
            const a = normalized.vertices[face[0]];
            const b = normalized.vertices[face[1]];
            const c = normalized.vertices[face[2]];
            const normal = this._triangleNormal(a, b, c);
            lines.push(`  facet normal ${normal.x} ${normal.y} ${normal.z}`);
            lines.push('    outer loop');
            lines.push(`      vertex ${a.x} ${a.y} ${a.z}`);
            lines.push(`      vertex ${b.x} ${b.y} ${b.z}`);
            lines.push(`      vertex ${c.x} ${c.y} ${c.z}`);
            lines.push('    endloop');
            lines.push('  endfacet');
        }

        lines.push(`endsolid ${solidName}`);
        const text = `${lines.join('\n')}\n`;
        if (options.download !== false) {
            this._downloadTextFile(fileName, text, 'model/stl;charset=utf-8');
        }
        return text;
    }

    /**

         * Gets or sets the curve tessellation detail used by curve-based drawing helpers.

         *

         * The value is normalized to a positive integer and mirrored onto the active canvas element.

         *

         * @param {number} [detail] Desired curve detail level.

         * @returns {number} The current or newly applied curve detail.

         * @throws {TypeError} Throws when `detail` cannot be converted to a positive integer.

         */

    static curveDetail(detail) {
        if (typeof detail === 'undefined') {
            return this._curveDetailValue;
        }
        const next = Math.max(1, Math.floor(Number(detail) || 0));
        if (!Number.isFinite(next) || next <= 0) {
            throw new TypeError('detail must be a positive integer');
        }
        this._curveDetailValue = next;
        const canvas = Canvex?.canvas ?? null;
        if (canvas) canvas.__canvexCurveDetail = next;
        return this._curveDetailValue;
    }

    static _strokeMode() {
        return this._strokeModeValue;
    }

    static _curveDetail() {
        return this._curveDetailValue;
    }

    static _downloadTextFile(fileName, text, mimeType) {
        if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
            return text;
        }
        const blob = new Blob([text], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        return text;
    }

    static _normalizeGeometryForExport(geometry) {
        if (!geometry || typeof geometry !== 'object') {
            throw new TypeError('geometry must be an object created by Shapes.buildGeometry() or a compatible geometry object');
        }

        if (Array.isArray(geometry.vertices) && Array.isArray(geometry.faces)) {
            const vertices = geometry.vertices.map((vertex) => ({
                x: Number(vertex.x ?? vertex[0] ?? 0),
                y: Number(vertex.y ?? vertex[1] ?? 0),
                z: Number(vertex.z ?? vertex[2] ?? 0)
            }));
            const vertexNormals = Array.isArray(geometry.vertexNormals)
                ? geometry.vertexNormals.map((normal) => ({
                    x: Number(normal.x ?? normal[0] ?? 0),
                    y: Number(normal.y ?? normal[1] ?? 0),
                    z: Number(normal.z ?? normal[2] ?? 1)
                }))
                : vertices.map(() => ({ x: 0, y: 0, z: 1 }));
            const uvs = Array.isArray(geometry.uvs)
                ? geometry.uvs.map((uv) => [Number(uv[0] ?? 0), Number(uv[1] ?? 0)])
                : vertices.map(() => [0, 0]);
            const faces = geometry.faces.map((face) => [Number(face[0]), Number(face[1]), Number(face[2])]);
            return { vertices, vertexNormals, uvs, faces };
        }

        if (Array.isArray(geometry.positions) && Array.isArray(geometry.indices)) {
            const vertices = [];
            for (let i = 0; i < geometry.positions.length; i += 3) {
                vertices.push({
                    x: Number(geometry.positions[i] ?? 0),
                    y: Number(geometry.positions[i + 1] ?? 0),
                    z: Number(geometry.positions[i + 2] ?? 0)
                });
            }
            const vertexNormals = Array.isArray(geometry.normals)
                ? Array.from({ length: vertices.length }, (_, i) => ({
                    x: Number(geometry.normals[i * 3] ?? 0),
                    y: Number(geometry.normals[i * 3 + 1] ?? 0),
                    z: Number(geometry.normals[i * 3 + 2] ?? 1)
                }))
                : vertices.map(() => ({ x: 0, y: 0, z: 1 }));
            const uvs = Array.isArray(geometry.uvs)
                ? geometry.uvs.map((uv) => Array.isArray(uv) ? [Number(uv[0] ?? 0), Number(uv[1] ?? 0)] : [0, 0])
                : vertices.map(() => [0, 0]);
            const faces = [];
            for (let i = 0; i < geometry.indices.length; i += 3) {
                faces.push([
                    Number(geometry.indices[i] ?? 0),
                    Number(geometry.indices[i + 1] ?? 0),
                    Number(geometry.indices[i + 2] ?? 0)
                ]);
            }
            return { vertices, vertexNormals, uvs, faces };
        }

        throw new TypeError('geometry is not in a supported export format');
    }

    static _triangleNormal(a, b, c) {
        const ux = b.x - a.x;
        const uy = b.y - a.y;
        const uz = b.z - a.z;
        const vx = c.x - a.x;
        const vy = c.y - a.y;
        const vz = c.z - a.z;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const length = Math.hypot(nx, ny, nz) || 1;
        return { x: nx / length, y: ny / length, z: nz / length };
    }
};
