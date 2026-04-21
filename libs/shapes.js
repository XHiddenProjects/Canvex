import { Canvex } from "./canvex.js";
import { Canvas } from "./canvas.js";
import { Image } from "./image.js";
import { math } from "./math.js";

/**
 * Utilities for building simple 2D canvas paths and drawing basic WebGL/WebGL2 primitives.
 *
 * The `Shapes` class resolves the active rendering context from `Canvex`, so callers do not need
 * to pass a rendering context into every drawing method. The active context is resolved in this
 * order:
 *
 * 1. `Canvex.ctx` when available
 * 2. `Canvex.canvas.getContext("2d")` as a 2D fallback when a canvas exists
 *
 * ## Coordinate system
 *
 * - **Canvas 2D** methods use the browser's default canvas coordinate system:
 *   origin at the top-left, positive X to the right, positive Y downward.
 * - **WebGL/WebGL2** methods assume the active vertex shader accepts an attribute named
 *   `a_position` containing pixel-space coordinates. These helpers upload raw x/y pixel values.
 *   The shader is responsible for converting those pixel coordinates into clip space.
 *
 * A minimal compatible vertex shader usually looks like this:
 *
 * ```glsl
 * attribute vec2 a_position;
 * uniform vec2 u_resolution;
 *
 * void main() {
 *   vec2 zeroToOne = a_position / u_resolution;
 *   vec2 zeroToTwo = zeroToOne * 2.0;
 *   vec2 clipSpace = zeroToTwo - 1.0;
 *   gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
 * }
 * ```
 *
 * ## Canvas 2D path behavior
 *
 * Most shape methods behave as standalone draw calls in Canvas 2D mode and manage their own path.
 * Two exceptions are important:
 *
 * - {@link Shapes.line} appends to the current path and immediately strokes it.
 * - {@link Shapes.rect} appends to the current path and then strokes/fills it.
 *
 * If you want either method to be isolated from previous path segments, call `beginPath()` before
 * drawing.
 *
 * @example
 * // Canvas 2D
 * Canvex.init("body", { ctx: "2d" });
 * Canvex.ctx.fillStyle = "#dbeafe";
 * Canvex.ctx.strokeStyle = "#2563eb";
 * Shapes.circle(100, 100, 60);
 *
 * @example
 * // WebGL / WebGL2
 * Canvex.init("body", { ctx: Canvex.WEBGL });
 * const gl = Canvex.ctx;
 * gl.useProgram(program);
 * gl.uniform2f(
 *   gl.getUniformLocation(program, "u_resolution"),
 *   Canvex.canvas.width,
 *   Canvex.canvas.height
 * );
 * Shapes.circle(160, 120, 80, 48);
 */
export class Shapes {
    /** @type {'solid'} @readonly */
    static SOLID = "solid";

    /** @type {'dashed'} @readonly */
    static DASHED = "dashed";

    /** @type {'dotted'} @readonly */
    static DOTTED = "dotted";

    /** @type {'open'} @readonly */
    static OPEN = "open";

    /** @type {'chord'} @readonly */
    static CHORD = "chord";

    /** @type {'pie'} @readonly */
    static PIE = "pie";


    /** @type {'left'} @readonly */
    static LEFT = "left";

    /** @type {'center'} @readonly */
    static CENTER = "center";

    /** @type {'right'} @readonly */
    static RIGHT = "right";

    /** @type {'top'} @readonly */
    static TOP = "top";

    /** @type {'bottom'} @readonly */
    static BOTTOM = "bottom";

    /** @type {'alphabetic'} @readonly */
    static BASELINE = "alphabetic";

    /** @type {'word'} @readonly */
    static WORD = "word";

    /** @type {'char'} @readonly */
    static CHAR = "char";

    /** @type {'normal'} @readonly */
    static NORMAL = "normal";

    /** @type {'italic'} @readonly */
    static ITALIC = "italic";

    /** @type {'bold'} @readonly */
    static BOLD = "bold";

    /** @type {'bolditalic'} @readonly */
    static BOLDITALIC = "bolditalic";

    /** @type {'left'|'center'|'right'} */
    static #textAlignHorizontal = "left";

    /** @type {'top'|'center'|'bottom'|'alphabetic'} */
    static #textAlignVertical = "alphabetic";

    /** @type {number} */
    static #textSizePixels = 16;

    /** @type {'normal'|'italic'|'bold'|'bolditalic'} */
    static #textStyleValue = "normal";

    /** @type {number|null} */
    static #textLeadingPixels = null;

    /** @type {'word'|'char'} */
    static #textWrapValue = "word";

    /** @type {string} */
    static #textFontFamily = "sans-serif";

    /**
     * Resolves the currently active rendering context from `Canvex`.
     *
     * The lookup order is:
     * 1. `Canvex.ctx`
     * 2. `Canvex.canvas.getContext("2d")` when a canvas exists
     *
     * @returns {CanvasRenderingContext2D|WebGLRenderingContext|WebGL2RenderingContext}
     * The active rendering context.
     * @throws {Error} Throws when no usable rendering context is available.
     * @private
     *
     * @example
     * // Internal helper usage
     * const ctx = this.#ctx();
     */
    static #ctx() {
        const ctx = Canvex?.ctx ?? null;
        if (ctx) return ctx;

        const canvas = Canvex?.canvas ?? null;
        if (canvas instanceof HTMLCanvasElement) {
            const fallback2d = canvas.getContext("2d");
            if (fallback2d) return fallback2d;
        }

        throw new Error(
            "Shapes requires an active Canvex rendering context. Initialize Canvex before calling Shapes methods."
        );
    }

    /**
     * Determines whether a value is a Canvas 2D rendering context.
     *
     * @param {*} ctx - Value to test.
     * @returns {ctx is CanvasRenderingContext2D}
     * `true` when `ctx` is a `CanvasRenderingContext2D`; otherwise `false`.
     * @private
     *
     * @example
     * // Internal helper usage
     * if (this.#isCanvas2D(ctx)) {
     *   ctx.strokeStyle = "#000";
     * }
     */
    static #isCanvas2D(ctx) {
        return typeof CanvasRenderingContext2D !== "undefined" && ctx instanceof CanvasRenderingContext2D;
    }

    /**
     * Determines whether a value is a WebGL or WebGL2 rendering context.
     *
     * @param {*} ctx - Value to test.
     * @returns {ctx is WebGLRenderingContext|WebGL2RenderingContext}
     * `true` when `ctx` is a WebGL-compatible rendering context; otherwise `false`.
     * @private
     *
     * @example
     * // Internal helper usage
     * if (this.#isWebGL(ctx)) {
     *   this.#drawTriangles(ctx, vertices);
     * }
     */
    static #isWebGL(ctx) {
        const hasWebGL1 = typeof WebGLRenderingContext !== "undefined" && ctx instanceof WebGLRenderingContext;
        const hasWebGL2 = typeof WebGL2RenderingContext !== "undefined" && ctx instanceof WebGL2RenderingContext;
        return hasWebGL1 || hasWebGL2;
    }

    /**
     * Validates that every provided value is a finite number.
     *
     * @param {string} label - Human-readable label used in the thrown error message.
     * @param {number[]} values - Numeric values to validate.
     * @returns {void}
     * @throws {TypeError} Throws when at least one value is not finite.
     * @private
     *
     * @example
     * // Internal helper usage
     * this.#assertFiniteNumbers("Circle values", [x, y, d, segments]);
     */
    static #assertFiniteNumbers(label, values) {
        for (const value of values) {
            if (!Number.isFinite(value)) {
                throw new TypeError(`${label} must be finite numbers`);
            }
        }
    }

    /**
     * Ensures that the provided rendering context is supported by `Shapes`.
     *
     * Supported contexts are:
     * - `CanvasRenderingContext2D`
     * - `WebGLRenderingContext`
     * - `WebGL2RenderingContext`
     *
     * @param {*} ctx - Rendering context to validate.
     * @returns {void}
     * @throws {TypeError} Throws when `ctx` is not a supported rendering context.
     * @private
     *
     * @example
     * // Internal helper usage
     * const ctx = this.#ctx();
     * this.#assertSupportedContext(ctx);
     */
    static #assertSupportedContext(ctx) {
        if (!this.#isCanvas2D(ctx) && !this.#isWebGL(ctx)) {
            throw new TypeError(
                "Unsupported rendering context. Expected CanvasRenderingContext2D, WebGLRenderingContext, or WebGL2RenderingContext."
            );
        }
    }

    /**
     * Uploads a flat list of 2D vertices to a temporary WebGL buffer and renders them as triangles.
     *
     * The active shader program must already be bound with `gl.useProgram(program)` and must expose
     * an attribute named `a_position`.
     *
     * @param {WebGLRenderingContext|WebGL2RenderingContext} gl - Active WebGL context.
     * @param {number[]} vertices - Flat vertex array in `[x1, y1, x2, y2, ...]` format.
     * @returns {void}
     * @throws {Error} Throws when no shader program is active.
     * @throws {Error} Throws when the active shader program does not expose `a_position`.
     * @throws {Error} Throws when a WebGL buffer cannot be created.
     * @private
     *
     * @example
     * // Internal helper usage
     * this.#drawTriangles(gl, [
     *   10, 10,
     *   100, 10,
     *   10, 100,
     * ]);
     */
    static #drawTriangles(gl, vertices) {
        const program = gl.getParameter(gl.CURRENT_PROGRAM);
        if (!program) {
            throw new Error(
                "WebGL drawing requires an active shader program. Call gl.useProgram(program) before Shapes methods."
            );
        }

        const positionLocation = gl.getAttribLocation(program, "a_position");
        if (positionLocation < 0) {
            throw new Error("The active shader program must define an `a_position` attribute.");
        }

        const buffer = gl.createBuffer();
        if (!buffer) {
            throw new Error("Failed to create a WebGL buffer.");
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
        gl.deleteBuffer(buffer);
    }

    /**
     * Builds triangle vertices for a rectangle subdivided into a grid.
     *
     * The returned vertex array contains two triangles for each grid cell and is intended for use
     * with {@link Shapes.#drawTriangles}.
     *
     * @param {number} x - Left edge of the rectangle in pixels.
     * @param {number} y - Top edge of the rectangle in pixels.
     * @param {number} w - Rectangle width in pixels.
     * @param {number} h - Rectangle height in pixels.
     * @param {number} [detailX=1] - Number of horizontal subdivisions.
     * @param {number} [detailY=1] - Number of vertical subdivisions.
     * @returns {number[]} Flat array of x/y vertex pairs.
     * @private
     *
     * @example
     * // Internal helper usage
     * const vertices = this.#buildRectTriangles(0, 0, 100, 50, 4, 2);
     * this.#drawTriangles(gl, vertices);
     */
    static #buildRectTriangles(x, y, w, h, detailX = 1, detailY = 1) {
        const vertices = [];
        const dx = w / detailX;
        const dy = h / detailY;

        for (let ix = 0; ix < detailX; ix += 1) {
            for (let iy = 0; iy < detailY; iy += 1) {
                const x0 = x + ix * dx;
                const y0 = y + iy * dy;
                const x1 = x0 + dx;
                const y1 = y0 + dy;

                vertices.push(
                    x0, y0,
                    x1, y0,
                    x0, y1,
                    x0, y1,
                    x1, y0,
                    x1, y1
                );
            }
        }

        return vertices;
    }


    static #activeEllipseMode() {
        try {
            if (typeof Canvas !== "undefined" && typeof Canvas._ellipseMode === "function") {
                return String(Canvas._ellipseMode()).toLowerCase();
            }
        } catch {
            // Fall back to CENTER when Canvas mode helpers are unavailable.
        }
        return (Canvas?.CENTER ?? Shapes.CENTER).toLowerCase();
    }

    static #activeRectMode() {
        try {
            if (typeof Canvas !== "undefined" && typeof Canvas._rectMode === "function") {
                return String(Canvas._rectMode()).toLowerCase();
            }
        } catch {
            // Fall back to CORNER when Canvas mode helpers are unavailable.
        }
        return (Canvas?.CORNER ?? "corner").toLowerCase();
    }

    static #resolveEllipseGeometry(x, y, w, h) {
        const mode = this.#activeEllipseMode();
        let centerX = x;
        let centerY = y;
        let width = w;
        let height = h;

        switch (mode) {
            case (Canvas?.RADIUS ?? "radius"):
                width = w * 2;
                height = h * 2;
                break;
            case (Canvas?.CORNER ?? "corner"):
                centerX = x + w / 2;
                centerY = y + h / 2;
                break;
            case (Canvas?.CORNERS ?? "corners"):
                width = w - x;
                height = h - y;
                centerX = (x + w) / 2;
                centerY = (y + h) / 2;
                break;
            default:
                break;
        }

        width = Math.abs(width);
        height = Math.abs(height);

        return {
            x: centerX,
            y: centerY,
            w: width,
            h: height,
            rx: width / 2,
            ry: height / 2
        };
    }

    static #resolveRectGeometry(x, y, w, h) {
        const mode = this.#activeRectMode();
        let left = x;
        let top = y;
        let width = w;
        let height = h;

        switch (mode) {
            case (Canvas?.CENTER ?? "center"):
                // p5.js rectMode(CENTER): x/y are the rectangle center; w/h are full width/height.
                left = x - w / 2;
                top = y - h / 2;
                break;
            case (Canvas?.RADIUS ?? "radius"):
                // p5.js rectMode(RADIUS): x/y are the rectangle center; w/h are half-width/half-height.
                left = x - w;
                top = y - h;
                width = w * 2;
                height = h * 2;
                break;
            case (Canvas?.CORNERS ?? "corners"):
                // p5.js rectMode(CORNERS): x/y are one corner; w/h are the opposite corner.
                left = x;
                top = y;
                width = w - x;
                height = h - y;
                break;
            case (Canvas?.CORNER ?? "corner"):
            default:
                // p5.js rectMode(CORNER): x/y are the top-left corner; w/h are width/height.
                break;
        }

        if (width < 0) {
            left += width;
            width = Math.abs(width);
        }
        if (height < 0) {
            top += height;
            height = Math.abs(height);
        }

        return { x: left, y: top, w: width, h: height };
    }

    /**
     * Draws a line segment between two points.
     *
     * `z1` and `z2` are accepted for API compatibility with 3D-style calls.
     * In the current implementation, the line is still rendered in 2D, so the
     * z-values are validated but not used.
     *
     * In Canvas 2D mode, this method appends a segment to the current path and
     * immediately strokes it. Call `beginPath()` first if you want the line to be
     * isolated from existing path data.
     *
     * In WebGL/WebGL2 mode, the line is drawn with `gl.LINES`.
     *
     * @param {number} x1 - The x-coordinate of the first point.
     * @param {number} y1 - The y-coordinate of the first point.
     * @param {number} x2 - The x-coordinate of the second point.
     * @param {number} y2 - The y-coordinate of the second point.
     * @param {number} [z1=0] - The z-coordinate of the first point. Currently unused.
     * @param {number} [z2=0] - The z-coordinate of the second point. Currently unused.
     * @returns {void}
     * @throws {TypeError} Thrown when any argument is not a finite number.
     *
     * @example
     * // Canvas 2D
     * Canvex.init("body", { ctx: "2d" });
     * Canvex.ctx.strokeStyle = "#2563eb";
     * Canvex.ctx.beginPath();
     * Shapes.line(20, 20, 180, 80);
     *
     * @example
     * // WebGL / WebGL2
     * Canvex.init("body", { ctx: Canvex.WEBGL });
     * const gl = Canvex.ctx;
     * gl.useProgram(program);
     * gl.uniform2f(
     *   gl.getUniformLocation(program, "u_resolution"),
     *   Canvex.canvas.width,
     *   Canvex.canvas.height
     * );
     * Shapes.line(20, 20, 180, 80, 0, 0);
     */
    static line(x1, y1, x2, y2, z1 = 0, z2 = 0) {
        const ctx = this.#ctx();
        this.#assertSupportedContext(ctx);
        this.#assertFiniteNumbers("Line coordinates", [x1, y1, x2, y2, z1, z2]);

        if (this.#isCanvas2D(ctx)) {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            return;
        }

        const program = ctx.getParameter(ctx.CURRENT_PROGRAM);
        if (!program) {
            throw new Error(
                "WebGL drawing requires an active shader program. Call gl.useProgram(program) before Shapes methods."
            );
        }

        const positionLocation = ctx.getAttribLocation(program, "a_position");
        if (positionLocation < 0) {
            throw new Error("The active shader program must define an `a_position` attribute.");
        }

        const buffer = ctx.createBuffer();
        if (!buffer) {
            throw new Error("Failed to create a WebGL buffer.");
        }

        ctx.bindBuffer(ctx.ARRAY_BUFFER, buffer);
        ctx.bufferData(
            ctx.ARRAY_BUFFER,
            new Float32Array([
                x1, y1,
                x2, y2
            ]),
            ctx.STATIC_DRAW
        );

        ctx.enableVertexAttribArray(positionLocation);
        ctx.vertexAttribPointer(positionLocation, 2, ctx.FLOAT, false, 0, 0);
        ctx.drawArrays(ctx.LINES, 0, 2);
        ctx.deleteBuffer(buffer);
    }


    /**
     * Draws a rectangle.
     *
     * In Canvas 2D mode, each corner radius may be set independently using `tl`, `tr`, `br`,
     * and `bl`. Radius values are clamped so they cannot exceed half of the rectangle's width or
     * height. The Canvas 2D branch appends to the current path, then strokes and fills it.
     * Call `beginPath()` first when you want the rectangle to be isolated from prior path data.
     *
     * In WebGL/WebGL2 mode, the rectangle is rendered as a tessellated grid of triangles based on
     * `detailX` and `detailY`. Rounded corner radii are currently ignored in WebGL/WebGL2 mode.
     *
     * @param {number} x - Left edge of the rectangle in pixels.
     * @param {number} y - Top edge of the rectangle in pixels.
     * @param {number} w - Rectangle width in pixels.
     * @param {number} h - Rectangle height in pixels.
     * @param {number} [tl=0] - Top-left corner radius in pixels (Canvas 2D only).
     * @param {number} [tr=tl] - Top-right corner radius in pixels (Canvas 2D only).
     * @param {number} [br=tr] - Bottom-right corner radius in pixels (Canvas 2D only).
     * @param {number} [bl=tl] - Bottom-left corner radius in pixels (Canvas 2D only).
     * @param {number} [detailX=1] - Horizontal subdivision count for WebGL/WebGL2 rendering.
     * @param {number} [detailY=1] - Vertical subdivision count for WebGL/WebGL2 rendering.
     * @returns {void}
     * @throws {TypeError} Throws when any numeric argument is not finite.
     *
     * @example
     * // Canvas 2D: rounded rectangle
     * Canvex.init("body", { ctx: "2d" });
     * Canvex.ctx.fillStyle = "#e0f2fe";
     * Canvex.ctx.strokeStyle = "#0284c7";
     * Canvex.ctx.beginPath();
     * Shapes.rect(40, 30, 180, 100, 16);
     *
     * @example
     * // WebGL / WebGL2: tessellated rectangle
     * Canvex.init("body", { ctx: Canvex.WEBGL });
     * const gl = Canvex.ctx;
     * gl.useProgram(program);
     * gl.uniform2f(
     *   gl.getUniformLocation(program, "u_resolution"),
     *   Canvex.canvas.width,
     *   Canvex.canvas.height
     * );
     * Shapes.rect(40, 30, 180, 100, 0, 0, 0, 0, 8, 4);
     */
    static rect(x, y, w, h, tl = 0, tr = tl, br = tr, bl = tl, detailX = 1, detailY = 1) {
        const ctx = this.#ctx();
        this.#assertSupportedContext(ctx);
        this.#assertFiniteNumbers("Rectangle values", [x, y, w, h, tl, tr, br, bl, detailX, detailY]);

        const rect = this.#resolveRectGeometry(x, y, w, h);
        const drawX = rect.x;
        const drawY = rect.y;
        const drawW = rect.w;
        const drawH = rect.h;

        if (drawW === 0 || drawH === 0) return;

        if (this.#isCanvas2D(ctx)) {
            const maxRadius = Math.max(0, Math.min(drawW, drawH) / 2);
            tl = Math.min(Math.max(0, tl), maxRadius);
            tr = Math.min(Math.max(0, tr), maxRadius);
            br = Math.min(Math.max(0, br), maxRadius);
            bl = Math.min(Math.max(0, bl), maxRadius);

            // Match p5.js behavior: each rect is an isolated draw call.
            ctx.beginPath();
            ctx.moveTo(drawX + tl, drawY);
            ctx.lineTo(drawX + drawW - tr, drawY);
            if (tr > 0) ctx.quadraticCurveTo(drawX + drawW, drawY, drawX + drawW, drawY + tr);
            else ctx.lineTo(drawX + drawW, drawY);

            ctx.lineTo(drawX + drawW, drawY + drawH - br);
            if (br > 0) ctx.quadraticCurveTo(drawX + drawW, drawY + drawH, drawX + drawW - br, drawY + drawH);
            else ctx.lineTo(drawX + drawW, drawY + drawH);

            ctx.lineTo(drawX + bl, drawY + drawH);
            if (bl > 0) ctx.quadraticCurveTo(drawX, drawY + drawH, drawX, drawY + drawH - bl);
            else ctx.lineTo(drawX, drawY + drawH);

            ctx.lineTo(drawX, drawY + tl);
            if (tl > 0) ctx.quadraticCurveTo(drawX, drawY, drawX + tl, drawY);
            else ctx.lineTo(drawX, drawY);

            ctx.closePath();
            ctx.stroke();
            ctx.fill();
            return;
        }

        detailX = Math.max(1, Math.floor(detailX));
        detailY = Math.max(1, Math.floor(detailY));
        const vertices = this.#buildRectTriangles(drawX, drawY, drawW, drawH, detailX, detailY);
        this.#drawTriangles(ctx, vertices);
    }

    /**
     * Draws a square.
     *
     * This is a convenience wrapper around {@link Shapes.rect} that uses the same value for both
     * width and height.
     *
     * @param {number} x - Left edge of the square in pixels.
     * @param {number} y - Top edge of the square in pixels.
     * @param {number} s - Side length in pixels.
     * @param {number} [tl=0] - Top-left corner radius in pixels (Canvas 2D only).
     * @param {number} [tr=tl] - Top-right corner radius in pixels (Canvas 2D only).
     * @param {number} [br=tr] - Bottom-right corner radius in pixels (Canvas 2D only).
     * @param {number} [bl=tl] - Bottom-left corner radius in pixels (Canvas 2D only).
     * @param {number} [detailX=1] - Horizontal subdivision count for WebGL/WebGL2 rendering.
     * @param {number} [detailY=1] - Vertical subdivision count for WebGL/WebGL2 rendering.
     * @returns {void}
     * @throws {TypeError} Throws when `s` is not a finite number.
     *
     * @example
     * // Canvas 2D
     * Canvex.init("body", { ctx: "2d" });
     * Canvex.ctx.fillStyle = "#dcfce7";
     * Canvex.ctx.strokeStyle = "#16a34a";
     * Canvex.ctx.beginPath();
     * Shapes.square(50, 50, 90, 12);
     *
     * @example
     * // WebGL / WebGL2
     * Canvex.init("body", { ctx: Canvex.WEBGL });
     * const gl = Canvex.ctx;
     * gl.useProgram(program);
     * gl.uniform2f(
     *   gl.getUniformLocation(program, "u_resolution"),
     *   Canvex.canvas.width,
     *   Canvex.canvas.height
     * );
     * Shapes.square(50, 50, 90, 0, 0, 0, 0, 4, 4);
     */
    static square(x, y, s, tl = 0, tr = tl, br = tr, bl = tl, detailX = 1, detailY = 1) {
        if (!Number.isFinite(s)) {
            throw new TypeError("Side length must be a finite number");
        }

        this.rect(x, y, s, s, tl, tr, br, bl, detailX, detailY);
    }

    /**
     * Draws a circle centered at `(x, y)` using the provided diameter.
     *
     * In Canvas 2D mode, the circle is created with `ctx.arc()`, then both stroked and filled.
     * In WebGL/WebGL2 mode, the circle is approximated with a triangle fan using the requested
     * number of segments.
     *
     * @param {number} x - Circle center X coordinate in pixels.
     * @param {number} y - Circle center Y coordinate in pixels.
     * @param {number} d - Circle diameter in pixels.
     * @param {number} [segments=32] - Number of segments used for WebGL/WebGL2 approximation.
     * @returns {void}
     * @throws {TypeError} Throws when any argument is not finite.
     * @throws {TypeError} Throws when `d` produces a negative radius.
     *
     * @example
     * // Canvas 2D
     * Canvex.init("body", { ctx: "2d" });
     * Canvex.ctx.fillStyle = "#fef3c7";
     * Canvex.ctx.strokeStyle = "#d97706";
     * Shapes.circle(120, 120, 80);
     *
     * @example
     * // WebGL / WebGL2
     * Canvex.init("body", { ctx: Canvex.WEBGL });
     * const gl = Canvex.ctx;
     * gl.useProgram(program);
     * gl.uniform2f(
     *   gl.getUniformLocation(program, "u_resolution"),
     *   Canvex.canvas.width,
     *   Canvex.canvas.height
     * );
     * Shapes.circle(160, 120, 80, 48);
     */
    static circle(x, y, d, segments = 32) {
        const ctx = this.#ctx();
        this.#assertSupportedContext(ctx);
        this.#assertFiniteNumbers("Circle values", [x, y, d, segments]);

        const ellipse = this.#resolveEllipseGeometry(x, y, d, d);
        const centerX = ellipse.x;
        const centerY = ellipse.y;
        const radius = Math.min(ellipse.rx, ellipse.ry);
        if (radius < 0) {
            throw new TypeError("Circle diameter must be greater than or equal to 0");
        }
        if (radius == 0) return;

        if (this.#isCanvas2D(ctx)) {
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, math.PI * 2);
            ctx.closePath();
            ctx.stroke();
            ctx.fill();
            return;
        }

        const steps = Math.max(3, Math.floor(segments));
        const vertices = [];

        for (let i = 0; i < steps; i += 1) {
            const a0 = (i / steps) * math.PI * 2;
            const a1 = ((i + 1) / steps) * math.PI * 2;
            vertices.push(
                centerX, centerY,
                centerX + Math.cos(a0) * radius, centerY + Math.sin(a0) * radius,
                centerX + Math.cos(a1) * radius, centerY + Math.sin(a1) * radius
            );
        }

        this.#drawTriangles(ctx, vertices);
    }

    /**
     * Draws an elliptical arc.
     *
     * When `mode` is omitted, the arc uses the class default behavior:
     * - it is filled like {@link math.PIE}
     * - it is stroked like {@link Shapes.OPEN}
     *
     * Supported modes are:
     * - `Shapes.OPEN` — draw only the curved perimeter
     * - `Shapes.CHORD` — close the arc with a straight line between endpoints
     * - `math.PIE` — close the arc to the center point
     *
     * In WebGL/WebGL2 mode, the curved perimeter is approximated with straight line segments.
     * Stroke rendering is intentionally simplified and is only emitted for lower detail counts in
     * the current implementation.
     *
     * @param {number} x - Ellipse center X coordinate in pixels.
     * @param {number} y - Ellipse center Y coordinate in pixels.
     * @param {number} w - Total ellipse width in pixels.
     * @param {number} h - Total ellipse height in pixels.
     * @param {number} start - Start angle in radians.
     * @param {number} stop - Stop angle in radians.
     * @param {'open'|'chord'|'pie'} [mode] - Arc closure mode. When omitted, uses PIE fill + OPEN stroke.
     * @param {number} [detail=25] - Number of perimeter segments used by WebGL/WebGL2.
     * @returns {void}
     * @throws {TypeError} Throws when any numeric argument is not finite.
     * @throws {TypeError} Throws when `mode` is not one of the supported arc modes.
     *
     * @example
     * // Canvas 2D: default behavior (PIE fill + OPEN stroke)
     * Canvex.init("body", { ctx: "2d" });
     * Canvex.ctx.fillStyle = "#fce7f3";
     * Canvex.ctx.strokeStyle = "#db2777";
     * Shapes.arc(150, 100, 140, 90, 0, Math.PI * 1.25);
     *
     * @example
     * // Canvas 2D: chord arc
     * Canvex.init("body", { ctx: "2d" });
     * Shapes.arc(150, 100, 140, 90, 0, Math.PI, Shapes.CHORD);
     *
     * @example
     * // WebGL / WebGL2
     * Canvex.init("body", { ctx: Canvex.WEBGL });
     * const gl = Canvex.ctx;
     * gl.useProgram(program);
     * gl.uniform2f(
     *   gl.getUniformLocation(program, "u_resolution"),
     *   Canvex.canvas.width,
     *   Canvex.canvas.height
     * );
     * Shapes.arc(150, 100, 140, 90, 0, Math.PI * 1.5, math.PIE, 32);
     */
    static arc(x, y, w, h, start, stop=start+math.TWO_PI, mode, detail = 25) {
        const ctx = this.#ctx();
        this.#assertSupportedContext(ctx);

        // Support arc(x, y, w, h, start, stop, detail)
        if (typeof mode === "number" && detail === 25) {
            detail = mode;
            mode = undefined;
        }

        this.#assertFiniteNumbers("Arc values", [x, y, w, h, start, stop, detail]);

        const ellipse = this.#resolveEllipseGeometry(x, y, w, h);
        const centerX = ellipse.x;
        const centerY = ellipse.y;
        const rx = ellipse.rx;
        const ry = ellipse.ry;
        if (rx === 0 || ry === 0 || start === stop) return;

        while (stop < start) stop += math.TWO_PI;

        const isDefault = mode == null;
        const m = isDefault ? math.PIE : String(mode).toLowerCase();

        // ------------------------------------------------------------------
        // Canvas 2D
        // ------------------------------------------------------------------
        if (this.#isCanvas2D(ctx)) {
            const fillPie = () => {
                ctx.beginPath();
                ctx.moveTo(centerX, centerY);
                ctx.ellipse(centerX, centerY, rx, ry, 0, start, stop);
                ctx.closePath();
                ctx.fill();
            };

            const strokeArcOnly = () => {
                ctx.beginPath();
                ctx.ellipse(centerX, centerY, rx, ry, 0, start, stop);
                ctx.stroke();
            };

            if (isDefault) {
                strokeArcOnly();
                fillPie();
                return;
            }

            if (m === math.PIE) {
                ctx.beginPath();
                ctx.moveTo(centerX, centerY);
                ctx.ellipse(centerX, centerY, rx, ry, 0, start, stop);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                return;
            }

            if (m === Shapes.CHORD) {
                ctx.beginPath();
                ctx.ellipse(centerX, centerY, rx, ry, 0, start, stop);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                return;
            }

            if (m === Shapes.OPEN) {
                strokeArcOnly();
                return;
            }

            throw new TypeError(`Invalid arc mode: ${mode}`);
        }

        // ------------------------------------------------------------------
        // WebGL / WebGL2 (same visual rules)
        // ------------------------------------------------------------------
        const steps = Math.max(2, Math.floor(detail));
        const points = [];

        for (let i = 0; i <= steps; i += 1) {
            const a = start + (stop - start) * (i / steps);
            points.push({
                x: centerX + Math.cos(a) * rx,
                y: centerY + Math.sin(a) * ry
            });
        }

        const fillPieTriangles = () => {
            const verts = [];
            for (let i = 0; i < points.length - 1; i += 1) {
                verts.push(
                    centerX, centerY,
                    points[i].x, points[i].y,
                    points[i + 1].x, points[i + 1].y
                );
            }
            if (verts.length > 0) this.#drawTriangles(ctx, verts);
        };

        const fillChordTriangles = () => {
            const verts = [];
            for (let i = 1; i < points.length - 1; i += 1) {
                verts.push(
                    points[0].x, points[0].y,
                    points[i].x, points[i].y,
                    points[i + 1].x, points[i + 1].y
                );
            }
            if (verts.length > 0) this.#drawTriangles(ctx, verts);
        };

        const strokeArcOnly = () => {
            if (steps > 50) return;
            for (let i = 0; i < points.length - 1; i += 1) {
                this.line(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
            }
        };

        if (isDefault) {
            strokeArcOnly();
            fillPieTriangles();
            return;
        }

        if (m === math.PIE) {
            fillPieTriangles();
            if (steps <= 50) {
                strokeArcOnly();
                this.line(centerX, centerY, points[0].x, points[0].y);
                this.line(centerX, centerY, points.at(-1).x, points.at(-1).y);
            }
            return;
        }

        if (m === Shapes.CHORD) {
            fillChordTriangles();
            if (steps <= 50) {
                strokeArcOnly();
                this.line(points.at(-1).x, points.at(-1).y, points[0].x, points[0].y);
            }
            return;
        }

        if (m === Shapes.OPEN) {
            strokeArcOnly();
            return;
        }

        throw new TypeError(`Invalid arc mode: ${mode}`);
    }

    /**
     * Draws a filled round point.
     *
     * In Canvas 2D mode, the point is drawn as a circle using `arc()`.
     * In WebGL/WebGL2 mode, the point is approximated with a small triangle fan.
     *
     * @param {number} x - Center X coordinate in pixels.
     * @param {number} y - Center Y coordinate in pixels.
     * @returns {void}
     * @throws {TypeError} Thrown when `x`, `y`, or `size` is not a finite number.
     *
     * @example
     * // Canvas 2D
     * Canvex.init("body", { ctx: "2d" });
     * Canvex.ctx.fillStyle = "#111827";
     * Shapes.point(80, 80);
     * Shapes.point(120, 80);
     *
     * @example
     * // WebGL / WebGL2
     * Canvex.init("body", { ctx: Canvex.WEBGL });
     * const gl = Canvex.ctx;
     * gl.useProgram(program);
     * gl.uniform2f(
     *   gl.getUniformLocation(program, "u_resolution"),
     *   Canvex.canvas.width,
     *   Canvex.canvas.height
     * );
     * Shapes.point(100, 60);
     */
    static point(x, y) {
        const ctx = this.#ctx();

        this.#assertSupportedContext(ctx);

        const size = Math.max(1, Number(ctx.lineWidth) || 1);
        this.#assertFiniteNumbers("Point values", [x, y, size]);

        const radius = size / 2;

        if (this.#isCanvas2D(ctx)) {
            // Use the current stroke color as the point color
            const previousFill = ctx.fillStyle;
            ctx.fillStyle = ctx.strokeStyle;

            ctx.beginPath();
            ctx.arc(x, y, radius, 0, math.TWO_PI);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = previousFill;
            return;
        }

        const segments = Math.max(8, Math.min(24, math.ceil(size * 2)));
        const vertices = [];

        for (let i = 0; i < segments; i += 1) {
            const a0 = (i / segments) * math.PI;
            const a1 = ((i + 1) / segments) * math.TWO_PI;

            vertices.push(
                x, y,
                x + Math.cos(a0) * radius, y + Math.sin(a0) * radius,
                x + Math.cos(a1) * radius, y + Math.sin(a1) * radius
            );
        }

        this.#drawTriangles(ctx, vertices);
    }

    /**
     * Draws a triangle from three vertices.
     *
     * In Canvas 2D mode, this method starts a new path, connects the three points, closes the
     * path, and then both strokes and fills the result.
     *
     * In WebGL/WebGL2 mode, the three vertex pairs are uploaded directly and rendered as a single
     * triangle.
     *
     * @param {number} x1 - First vertex X coordinate in pixels.
     * @param {number} y1 - First vertex Y coordinate in pixels.
     * @param {number} x2 - Second vertex X coordinate in pixels.
     * @param {number} y2 - Second vertex Y coordinate in pixels.
     * @param {number} x3 - Third vertex X coordinate in pixels.
     * @param {number} y3 - Third vertex Y coordinate in pixels.
     * @returns {void}
     * @throws {TypeError} Throws when any coordinate is not a finite number.
     *
     * @example
     * // Canvas 2D
     * Canvex.init("body", { ctx: "2d" });
     * Canvex.ctx.fillStyle = "#dbeafe";
     * Canvex.ctx.strokeStyle = "#2563eb";
     * Shapes.triangle(80, 30, 30, 140, 130, 140);
     *
     * @example
     * // WebGL / WebGL2
     * Canvex.init("body", { ctx: Canvex.WEBGL });
     * const gl = Canvex.ctx;
     * gl.useProgram(program);
     * gl.uniform2f(
     *   gl.getUniformLocation(program, "u_resolution"),
     *   Canvex.canvas.width,
     *   Canvex.canvas.height
     * );
     * Shapes.triangle(80, 30, 30, 140, 130, 140);
     */
    static triangle(x1, y1, x2, y2, x3, y3) {
        const ctx = this.#ctx();
        this.#assertSupportedContext(ctx);
        this.#assertFiniteNumbers("Triangle values", [x1, y1, x2, y2, x3, y3]);

        if (this.#isCanvas2D(ctx)) {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.lineTo(x3, y3);
            ctx.closePath();
            ctx.stroke();
            ctx.fill();
            return;
        }

        const vertices = [
            x1, y1,
            x2, y2,
            x3, y3
        ];

        this.#drawTriangles(ctx, vertices);
    }

    /**
     * Draws a quadrilateral from four vertices.
     *
     * Provide the vertices in perimeter order (clockwise or counterclockwise). Supplying points
     * out of order can create a self-intersecting shape or unexpected triangulation in
     * WebGL/WebGL2 mode.
     *
     * In Canvas 2D mode, this method starts a new path, connects the four points, closes the path,
     * and then both strokes and fills the shape.
     *
     * In WebGL/WebGL2 mode, the quadrilateral is split into two triangles using the diagonal from
     * the first vertex to the third vertex.
     *
     * @param {number} x1 - First vertex X coordinate in pixels.
     * @param {number} y1 - First vertex Y coordinate in pixels.
     * @param {number} x2 - Second vertex X coordinate in pixels.
     * @param {number} y2 - Second vertex Y coordinate in pixels.
     * @param {number} x3 - Third vertex X coordinate in pixels.
     * @param {number} y3 - Third vertex Y coordinate in pixels.
     * @param {number} x4 - Fourth vertex X coordinate in pixels.
     * @param {number} y4 - Fourth vertex Y coordinate in pixels.
     * @returns {void}
     * @throws {TypeError} Throws when any coordinate is not a finite number.
     *
     * @example
     * // Canvas 2D
     * Canvex.init("body", { ctx: "2d" });
     * Canvex.ctx.fillStyle = "#ede9fe";
     * Canvex.ctx.strokeStyle = "#7c3aed";
     * Shapes.quad(60, 40, 160, 30, 180, 120, 40, 130);
     *
     * @example
     * // WebGL / WebGL2
     * Canvex.init("body", { ctx: Canvex.WEBGL });
     * const gl = Canvex.ctx;
     * gl.useProgram(program);
     * gl.uniform2f(
     *   gl.getUniformLocation(program, "u_resolution"),
     *   Canvex.canvas.width,
     *   Canvex.canvas.height
     * );
     * Shapes.quad(60, 40, 160, 30, 180, 120, 40, 130);
     */
    static quad(x1, y1, x2, y2, x3, y3, x4, y4) {
        const ctx = this.#ctx();
        this.#assertSupportedContext(ctx);
        this.#assertFiniteNumbers("Quad values", [x1, y1, x2, y2, x3, y3, x4, y4]);

        if (this.#isCanvas2D(ctx)) {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.lineTo(x3, y3);
            ctx.lineTo(x4, y4);
            ctx.closePath();
            ctx.stroke();
            ctx.fill();
            return;
        }

        const vertices = [
            x1, y1,
            x2, y2,
            x3, y3,
            x1, y1,
            x3, y3,
            x4, y4
        ];

        this.#drawTriangles(ctx, vertices);
    }
    /**
     * Draws a hexagon centered at (x, y) with the specified size.
     * @param {number} x - The x-coordinate of the center of the hexagon.
     * @param {number} y - The y-coordinate of the center of the hexagon.
     * @param {number} size - The size of the hexagon.
     * @returns {void}
     */
    static hexagon(x, y, size) {
        const ctx = this.#ctx();
        this.#assertSupportedContext(ctx);
        this.#assertFiniteNumbers("Hexagon values", [x, y, size]);
        
        const radius = Math.max(0, size / 2);
        const angleOffset = Math.PI / 6;

        if (this.#isCanvas2D(ctx)) {
            ctx.beginPath();
            for (let i = 0; i < 6; i += 1) {
                const angle = angleOffset + (i / 6) * math.TWO_PI;
                const px = x + Math.cos(angle) * radius;
                const py = y + Math.sin(angle) * radius;
                if (i === 0) {
                    ctx.moveTo(px, py);
                } else {
                    ctx.lineTo(px, py);
                }
            }
            ctx.closePath();
            ctx.stroke();
            ctx.fill();
            return;
        }

        const vertices = [];
        for (let i = 0; i < 6; i += 1) {
            const angle = angleOffset + (i / 6) * math.TWO_PI;
            vertices.push(
                x + Math.cos(angle) * radius,
                y + Math.sin(angle) * radius
            );
        }

        this.#drawTriangles(ctx, vertices);
    }

    /**
     * Draws an octagon centered at (x, y) with the specified size.
     * @param {number} x - The x-coordinate of the center of the octagon.
     * @param {number} y - The y-coordinate of the center of the octagon.
     * @param {number} size - The size of the octagon.
     * @returns {void}
     */
    static octagon(x, y, size) {
        const ctx = this.#ctx();
        this.#assertSupportedContext(ctx);
        this.#assertFiniteNumbers("Octagon values", [x, y, size]);
        
        const radius = Math.max(0, size / 2);
        const angleOffset = Math.PI / 8;

        if (this.#isCanvas2D(ctx)) {
            ctx.beginPath();
            for (let i = 0; i < 8; i += 1) {
                const angle = angleOffset + (i / 8) * math.TWO_PI;
                const px = x + Math.cos(angle) * radius;
                const py = y + Math.sin(angle) * radius;
                if (i === 0) {
                    ctx.moveTo(px, py);
                } else {
                    ctx.lineTo(px, py);
                }
            }
            ctx.closePath();
            ctx.stroke();
            ctx.fill();
            return;
        }
    }
    static #textCtx() {
        const ctx = this.#ctx();
        if (!this.#isCanvas2D(ctx)) {
            throw new Error("Text APIs currently support CanvasRenderingContext2D only.");
        }
        this.#applyTextState(ctx);
        return ctx;
    }

    /**
     * Applies the current text state to the Canvas 2D context.
     * @param {CanvasRenderingContext2D} ctx
     * @returns {void}
     * @private
     */
    static #applyTextState(ctx) {
        const style = this.#textStyleValue;
        const size = this.#textSizePixels;
        const family = this.#textFontFamily;

        let fontStyle = "normal";
        let fontWeight = "normal";

        if (style === Shapes.ITALIC) {
            fontStyle = "italic";
        } else if (style === Shapes.BOLD) {
            fontWeight = "bold";
        } else if (style === Shapes.BOLDITALIC) {
            fontStyle = "italic";
            fontWeight = "bold";
        }

        ctx.font = `${fontStyle} ${fontWeight} ${size}px ${family}`.replace(/\s+/g, " ").trim();
        ctx.textAlign = this.#textAlignHorizontal;
        ctx.textBaseline = "alphabetic";
    }

    /**
     * Converts any supported text input into a display string.
     * @param {string|object|Array<*>|number|boolean} value
     * @returns {string}
     * @private
     */
    static #normalizeText(value) {
        if (Array.isArray(value)) {
            return value.map((item) => this.#normalizeText(item)).join("");
        }

        if (value != null && typeof value === "object") {
            try {
                return JSON.stringify(value, null, 2);
            } catch {
                return String(value);
            }
        }

        return String(value ?? "");
    }

    /**
     * Wraps text into lines according to the current wrap mode.
     * @param {CanvasRenderingContext2D} ctx
     * @param {string} text
     * @param {number|undefined} maxWidth
     * @returns {string[]}
     * @private
     */
    static #wrapLines(ctx, text, maxWidth) {
        const paragraphs = text.split(/\?/);
        if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
            return paragraphs;
        }

        const lines = [];

        const pushBrokenWord = (word) => {
            let chunk = "";
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
                lines.push("");
                continue;
            }

            if (this.#textWrapValue === Shapes.CHAR) {
                let current = "";
                for (const ch of paragraph) {
                    const test = current + ch;
                    if (current && ctx.measureText(test).width > maxWidth) {
                        lines.push(current);
                        current = ch;
                    } else {
                        current = test;
                    }
                }
                lines.push(current);
                continue;
            }

            const tokens = paragraph.split(/(\s+)/).filter((token) => token.length > 0);
            let current = "";

            for (const token of tokens) {
                const test = current + token;
                if (current && ctx.measureText(test).width > maxWidth) {
                    lines.push(current.trimEnd());
                    current = token.trimStart();
                } else {
                    current = test;
                }

                if (ctx.measureText(current).width > maxWidth) {
                    const trimmed = current.trim();
                    current = "";
                    if (trimmed) {
                        pushBrokenWord(trimmed);
                    }
                }
            }

            if (current || paragraph.trim().length === 0) {
                lines.push(current.trimEnd());
            }
        }

        return lines;
    }

    /**
     * Returns current text ascent/descent metrics.
     * @param {CanvasRenderingContext2D} ctx
     * @returns {{ascent:number, descent:number}}
     * @private
     */
    static #textMetrics(ctx) {
        const metrics = ctx.measureText("Mg");
        const ascent = Number.isFinite(metrics.actualBoundingBoxAscent) ? metrics.actualBoundingBoxAscent : this.#textSizePixels * 0.8;
        const descent = Number.isFinite(metrics.actualBoundingBoxDescent) ? metrics.actualBoundingBoxDescent : this.#textSizePixels * 0.2;
        return { ascent, descent };
    }

    /**
     * Sets text alignment.
     * @param {'left'|'center'|'right'} [horizAlign=Shapes.LEFT]
     * @param {'top'|'bottom'|'center'|'alphabetic'} [vertAlign=Shapes.BASELINE]
     * @returns {{horizontal:'left'|'center'|'right', vertical:'top'|'bottom'|'center'|'alphabetic'}}
     */
    static textAlign(horizAlign = Shapes.LEFT, vertAlign = Shapes.BASELINE) {
        const horizontal = String(horizAlign).toLowerCase();
        const vertical = String(vertAlign).toLowerCase();

        if (![Shapes.LEFT, Shapes.CENTER, Shapes.RIGHT].includes(horizontal)) {
            throw new TypeError("horizAlign must be LEFT, CENTER, or RIGHT");
        }

        if (![Shapes.TOP, Shapes.BOTTOM, Shapes.CENTER, Shapes.BASELINE].includes(vertical)) {
            throw new TypeError("vertAlign must be TOP, BOTTOM, CENTER, or BASELINE");
        }

        this.#textAlignHorizontal = horizontal;
        this.#textAlignVertical = vertical;

        const ctx = this.#textCtx();
        this.#applyTextState(ctx);

        return {
            horizontal: this.#textAlignHorizontal,
            vertical: this.#textAlignVertical
        };
    }

    /**
     * Calculates the ascent of the current font at its current size.
     * @returns {number}
     */
    static textAscent() {
        const ctx = this.#textCtx();
        return this.#textMetrics(ctx).ascent;
    }

    /**
     * Calculates the descent of the current font at its current size.
     * @returns {number}
     */
    static textDescent() {
        const ctx = this.#textCtx();
        return this.#textMetrics(ctx).descent;
    }

    /**
     * Gets or sets the spacing between lines in pixels.
     * @param {number} [leading]
     * @returns {number}
     */
    static textLeading(leading) {
        if (typeof leading === "undefined") {
            return this.#textLeadingPixels ?? this.#textSizePixels * 1.2;
        }

        if (!Number.isFinite(leading) || leading <= 0) {
            throw new TypeError("leading must be a positive number");
        }

        this.#textLeadingPixels = leading;
        return this.#textLeadingPixels;
    }

    /**
     * Gets or sets the text size in pixels.
     * @param {number} [size]
     * @returns {number}
     */
    static textSize(size) {
        if (typeof size === "undefined") {
            return this.#textSizePixels;
        }

        if (!Number.isFinite(size) || size <= 0) {
            throw new TypeError("size must be a positive number");
        }

        this.#textSizePixels = size;
        const ctx = this.#textCtx();
        this.#applyTextState(ctx);
        return this.#textSizePixels;
    }

    /**
     * Gets or sets the text style.
     * @param {'normal'|'italic'|'bold'|'bolditalic'} [style]
     * @returns {'normal'|'italic'|'bold'|'bolditalic'}
     */
    static textStyle(style) {
        if (typeof style === "undefined") {
            return this.#textStyleValue;
        }

        const nextStyle = String(style).toLowerCase();
        if (![Shapes.NORMAL, Shapes.ITALIC, Shapes.BOLD, Shapes.BOLDITALIC].includes(nextStyle)) {
            throw new TypeError("style must be NORMAL, ITALIC, BOLD, or BOLDITALIC");
        }

        this.#textStyleValue = nextStyle;
        const ctx = this.#textCtx();
        this.#applyTextState(ctx);
        return this.#textStyleValue;
    }

    /**
     * Measures the width of the provided string using the current font.
     * @param {string} str
     * @returns {number}
     */
    static textWidth(str) {
        const ctx = this.#textCtx();
        const text = this.#normalizeText(str);
        return Math.max(...text.split(/\?/).map((line) => ctx.measureText(line).width), 0);
    }

    /**
     * Gets or sets the text wrapping mode.
     * @param {'word'|'char'} [style]
     * @returns {'word'|'char'}
     */
    static textWrap(style) {
        if (typeof style === "undefined") {
            return this.#textWrapValue;
        }

        const wrap = String(style).toLowerCase();
        if (![Shapes.WORD, Shapes.CHAR].includes(wrap)) {
            throw new TypeError("style must be WORD or CHAR");
        }

        this.#textWrapValue = wrap;
        return this.#textWrapValue;
    }

    /**
     * Draws text on the canvas.
     * @param {string|object|Array<*>|number|boolean} str - Text to display.
     * @param {number} x - X coordinate.
     * @param {number} y - Y coordinate.
     * @param {number} [maxWidth] - Maximum width of the text box.
     * @param {number} [maxHeight] - Maximum height of the text box.
     * @returns {void}
     */
    static text(str, x, y, maxWidth, maxHeight) {
        const ctx = Canvas._textCtx();
        const content = Canvas._normalizeText(str);
        const lines = Canvas._wrapLines(ctx, content, maxWidth);
        const { ascent, descent } = Canvas._textMetrics(ctx);
        const leading = Canvas.textLeading();
        const state = Canvas._getTextState();
        const totalHeight = lines.length > 0
            ? ascent + descent + Math.max(0, lines.length - 1) * leading
            : 0;
    
        let drawX = x;
        if (Number.isFinite(maxWidth)) {
            if (state.horizontal === Canvas.CENTER) {
                drawX = x + maxWidth / 2;
            } else if (state.horizontal === Canvas.RIGHT) {
                drawX = x + maxWidth;
            }
        }
    
        let firstBaseline = y;
        const hasBoxHeight = Number.isFinite(maxHeight);
    
        if (hasBoxHeight) {
            if (state.vertical === Canvas.TOP) {
                firstBaseline = y + ascent;
            } else if (state.vertical === Canvas.CENTER) {
                firstBaseline = y + (maxHeight - totalHeight) / 2 + ascent;
            } else if (state.vertical === Canvas.BOTTOM) {
                firstBaseline = y + maxHeight - totalHeight + ascent;
            } else {
                firstBaseline = y + ascent;
            }
        } else {
            if (state.vertical === Canvas.TOP) {
                firstBaseline = y + ascent;
            } else if (state.vertical === Canvas.CENTER) {
                firstBaseline = y - totalHeight / 2 + ascent;
            } else if (state.vertical === Canvas.BOTTOM) {
                firstBaseline = y - totalHeight + ascent + descent;
            } else {
                firstBaseline = y;
            }
        }
    
        for (let i = 0; i < lines.length; i += 1) {
            const baselineY = firstBaseline + i * leading;
            if (hasBoxHeight && baselineY + descent > y + maxHeight) {
                break;
            }
    
            if (Number.isFinite(maxWidth)) {
                ctx.fillText(lines[i], drawX, baselineY, maxWidth);
            } else {
                ctx.fillText(lines[i], drawX, baselineY);
            }
        }
    }
    /**
     * Draws an image on the canvas.
     * @param {Image} img - Image instance to draw.
     * @param {number} x - X coordinate to draw the image.
     * @param {number} y - Y coordinate to draw the image.
     * @param {number} w - Width to draw the image in pixels.
     * @param {number} h - Height to draw the image in pixels.
     * @returns {void}
     */
    static Image(img, x, y, w, h){
        return img.constructor._draw(img, x, y, w, h);
    }
    /**
     * Draws an ellipse on the canvas.
     * @param {number} x - X coordinate of the center.
     * @param {number} y - Y coordinate of the center.
     * @param {number} w - Width of the ellipse.
     * @param {number} h - Height of the ellipse.
     * @returns {void}
     */
    static ellipse(x, y, w, h = w) {
        const ctx = this.#ctx();
        this.#assertSupportedContext(ctx);
        this.#assertFiniteNumbers("Ellipse values", [x, y, w, h]);

        const ellipse = this.#resolveEllipseGeometry(x, y, w, h);
        const centerX = ellipse.x;
        const centerY = ellipse.y;
        const rx = ellipse.rx;
        const ry = ellipse.ry;
        if (rx === 0 || ry === 0) return;

        // Native 2D canvas ellipse
        if (this.#isCanvas2D(ctx)) {
            ctx.beginPath();
            ctx.ellipse(centerX, centerY, rx, ry, 0, 0, math.TWO_PI);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            return;
        }

        // Fallback: approximate ellipse with a polygon
        const segments = Math.max(
            12,
            Math.ceil((Math.max(rx, ry) * math.PI) / 2)
        );

        const vertices = [];
        const step = math.TWO_PI / segments;

        for (let i = 0; i < segments; i++) {
            const angle = i * step;
            const px = centerX + Math.cos(angle) * rx;
            const py = centerY + Math.sin(angle) * ry;
            vertices.push([px, py]);
        }

        if (typeof this.polygon === "function") {
            this.polygon(vertices);
            return;
        }

        if (
            typeof ctx.beginPath === "function" &&
            typeof ctx.moveTo === "function" &&
            typeof ctx.lineTo === "function"
        ) {
            ctx.beginPath();
            ctx.moveTo(vertices[0][0], vertices[0][1]);
            for (let i = 1; i < vertices.length; i++) {
                ctx.lineTo(vertices[i][0], vertices[i][1]);
            }
            ctx.closePath();
            if (typeof ctx.fill === "function") ctx.fill();
            if (typeof ctx.stroke === "function") ctx.stroke();
            return;
        }

        return vertices;
    }

}