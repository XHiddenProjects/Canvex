/**
 * Lightweight sketch manager with a p5-style `setup()` / `draw()` lifecycle.
 *
 * The class owns a single shared canvas element and provides:
 * - a managed render loop capped by `frameRate()`
 * - lifecycle hooks resolved from either `window` or `Canvex`
 * - timing helpers such as `frameCount`, `deltaTime`, and `millis`
 * - automatic transform reset at the start of each draw frame for Canvas 2D
 * - WebGL helpers that can detect WebGL/WebGL2 and install a fallback shader program
 *
 * The fallback shader exists specifically so shape helpers do not throw when no
 * user shader program has been bound yet. Users can still call `gl.useProgram(...)`
 * to replace it with a custom shader at any time.
 */
export class Canvex {
    /** @type {HTMLCanvasElement} */
    static #canvas = document.createElement("canvas");

    /** @type {CanvasRenderingContext2D | WebGLRenderingContext | WebGL2RenderingContext | null} */
    static #ctx = null;

    static #ogCanvas = this.#canvas;
    static #ogCtx = this.#ctx;

    /** @type {HTMLElement | null} */
    static #parent = null;
    static #startMillis = 0;
    static #targetFrameRate = 60;
    static #currentFrameRate = 60;
    static #fpsSmoothing = 0.14;
    static #isRunning = false;
    static #setupDone = false;
    static #animationFrameId = null;
    static #lastRenderedTime = 0;
    static #deltaTime = 1000 / 60;
    static #frameCount = 0;
    static #currentContextMode = '2d';
    static #resetTransformPerFrame = true;

    /** @type {WeakMap<WebGLRenderingContext | WebGL2RenderingContext, {program: WebGLProgram, vertexShader: WebGLShader, fragmentShader: WebGLShader}>} */
    static #defaultWebGLPrograms = new WeakMap();

    static C2D = '2d';
    static WEBGL = 'webgl';
    static WEBGL2 = 'webgl2';
    static CORNER = 'corner';
    static CORNERS = 'corners';
    static RADIUS = 'radius';
    static LEFT = 'left';
    static CENTER = 'center';
    static RIGHT = 'right';
    static TOP = 'top';
    static MIDDLE = 'middle';
    static BOTTOM = 'bottom';

    static WINDOW_WIDTH = window.innerWidth;
    static WINDOW_HEIGHT = window.innerHeight;
    static SCREEN_WIDTH = window.screen.width;
    static SCREEN_HEIGHT = window.screen.height;

    static get canvas() { return Canvex.#canvas; }
    static get ctx() { return Canvex.#ctx; }
    static get frameCount() { return Canvex.#frameCount; }
    static get deltaTime() { return Canvex.#deltaTime; }
    static get deltaSeconds() { return Canvex.#deltaTime / 1000; }
    static get width() { return Canvex.#canvas.width; }
    static get height() { return Canvex.#canvas.height; }
    static get parent() { return Canvex.#parent; }
    static get _millis() { return performance.now() - Canvex.#startMillis; }
    static get isRunning() { return Canvex.#isRunning; }
    static get contextMode() { return Canvex.#currentContextMode; }

    /**
     * Resolves a lifecycle hook from either Canvex itself or `window`.
     * @private
     * @param {string} name Hook name to resolve.
     * @returns {Function | null}
     */
    static #getHook(name) {
        if (typeof Canvex[name] === 'function') return Canvex[name].bind(Canvex);
        if (typeof window !== 'undefined' && typeof window[name] === 'function') return window[name].bind(window);
        return null;
    }

    /** @private */
    static #isCanvas2D(ctx) {
        return typeof CanvasRenderingContext2D !== 'undefined' && ctx instanceof CanvasRenderingContext2D;
    }

    /** @private */
    static #isWebGL1(ctx) {
        return typeof WebGLRenderingContext !== 'undefined' && ctx instanceof WebGLRenderingContext;
    }

    /** @private */
    static #isWebGL2(ctx) {
        return typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext;
    }

    /**
     * Returns whether the provided or active context is Canvas 2D.
     * @param {*} [ctx=Canvex.ctx] Rendering context to test.
     * @returns {boolean}
     */
    static isCanvas2D(ctx = Canvex.#ctx) {
        return Canvex.#isCanvas2D(ctx);
    }

    /**
     * Returns whether the provided or active context is WebGL or WebGL2.
     * @param {*} [ctx=Canvex.ctx] Rendering context to test.
     * @returns {boolean}
     */
    static isWebGL(ctx = Canvex.#ctx) {
        return Canvex.#isWebGL1(ctx) || Canvex.#isWebGL2(ctx);
    }

    /**
     * Returns whether the provided or active context is specifically WebGL2.
     * @param {*} [ctx=Canvex.ctx] Rendering context to test.
     * @returns {boolean}
     */
    static isWebGL2(ctx = Canvex.#ctx) {
        return Canvex.#isWebGL2(ctx);
    }

    /**
     * Returns the active shader program for the given or current WebGL context.
     * @param {WebGLRenderingContext | WebGL2RenderingContext | null} [ctx=Canvex.ctx] WebGL context to inspect.
     * @returns {WebGLProgram | null}
     */
    static currentProgram(ctx = Canvex.#ctx) {
        if (!Canvex.isWebGL(ctx)) return null;
        return ctx.getParameter(ctx.CURRENT_PROGRAM);
    }

    /**
     * Returns whether the given or current WebGL context has an active shader program.
     * @param {WebGLRenderingContext | WebGL2RenderingContext | null} [ctx=Canvex.ctx] WebGL context to inspect.
     * @returns {boolean}
     */
    static hasActiveProgram(ctx = Canvex.#ctx) {
        return Boolean(Canvex.currentProgram(ctx));
    }

    /**
     * Creates a very small fallback shader program for WebGL/WebGL2 contexts.
     *
     * The program supports an `a_position` attribute and optional `u_resolution`,
     * `u_color`, `u_projection`, `u_modelView`, and `u_useMatrices` uniforms.
     * It is intended to prevent shape helpers from throwing when no program has
     * been bound yet, not to replace a full custom material pipeline.
     *
     * @param {WebGLRenderingContext | WebGL2RenderingContext} [ctx=Canvex.ctx] WebGL context.
     * @returns {WebGLProgram | null} The fallback program, or `null` for non-WebGL contexts.
     */
    static createDefaultWebGLProgram(ctx = Canvex.#ctx) {
        if (!Canvex.isWebGL(ctx)) return null;
        const existing = Canvex.#defaultWebGLPrograms.get(ctx);
        if (existing?.program) return existing.program;

        const vertexSource = `
attribute vec4 a_position;
attribute vec3 a_normal;
attribute vec2 a_texcoord;

uniform vec2 u_resolution;
uniform mat4 u_projection;
uniform mat4 u_modelView;
uniform bool u_useMatrices;

varying vec3 v_normal;
varying vec2 v_texcoord;

void main() {
    if (u_useMatrices) {
        gl_Position = u_projection * u_modelView * vec4(a_position.xyz, 1.0);
    } else {
        vec2 safeResolution = max(u_resolution, vec2(1.0, 1.0));
        vec2 zeroToOne = a_position.xy / safeResolution;
        vec2 clipSpace = zeroToOne * 2.0 - 1.0;
        gl_Position = vec4(clipSpace * vec2(1.0, -1.0), a_position.z, 1.0);
    }
    v_normal = a_normal;
    v_texcoord = a_texcoord;
}
`;

        const fragmentSource = `
precision mediump float;

uniform vec4 u_color;

void main() {
    gl_FragColor = u_color;
}
`;

        const compile = (type, source) => {
            const shader = ctx.createShader(type);
            if (!shader) throw new Error('Failed to create a WebGL shader.');
            ctx.shaderSource(shader, source);
            ctx.compileShader(shader);
            if (!ctx.getShaderParameter(shader, ctx.COMPILE_STATUS)) {
                const log = ctx.getShaderInfoLog(shader) || 'Unknown shader compile error.';
                ctx.deleteShader(shader);
                throw new Error(`Failed to compile fallback WebGL shader: ${log}`);
            }
            return shader;
        };

        const vertexShader = compile(ctx.VERTEX_SHADER, vertexSource);
        const fragmentShader = compile(ctx.FRAGMENT_SHADER, fragmentSource);
        const program = ctx.createProgram();
        if (!program) {
            ctx.deleteShader(vertexShader);
            ctx.deleteShader(fragmentShader);
            throw new Error('Failed to create a fallback WebGL program.');
        }

        ctx.attachShader(program, vertexShader);
        ctx.attachShader(program, fragmentShader);
        ctx.linkProgram(program);
        if (!ctx.getProgramParameter(program, ctx.LINK_STATUS)) {
            const log = ctx.getProgramInfoLog(program) || 'Unknown program link error.';
            ctx.deleteProgram(program);
            ctx.deleteShader(vertexShader);
            ctx.deleteShader(fragmentShader);
            throw new Error(`Failed to link fallback WebGL program: ${log}`);
        }

        Canvex.#defaultWebGLPrograms.set(ctx, { program, vertexShader, fragmentShader });
        Canvex.#initializeDefaultWebGLProgramState(ctx, program);
        return program;
    }

    /**
     * Uses the fallback WebGL program for the given or active context.
     * @param {WebGLRenderingContext | WebGL2RenderingContext} [ctx=Canvex.ctx] WebGL context.
     * @returns {WebGLProgram | null} The fallback program, or `null` for non-WebGL contexts.
     */
    static useDefaultWebGLProgram(ctx = Canvex.#ctx) {
        const program = Canvex.createDefaultWebGLProgram(ctx);
        if (!program) return null;
        ctx.useProgram(program);
        Canvex.#initializeDefaultWebGLProgramState(ctx, program);
        return program;
    }

    /**
     * Ensures that the given or current WebGL context has an active shader program.
     * If no program is currently bound, the fallback program is created (if needed)
     * and bound automatically.
     *
     * @param {WebGLRenderingContext | WebGL2RenderingContext} [ctx=Canvex.ctx] WebGL context.
     * @returns {WebGLProgram | null} The active or newly bound program.
     */
    static ensureWebGLProgram(ctx = Canvex.#ctx) {
        if (!Canvex.isWebGL(ctx)) return null;
        const current = Canvex.currentProgram(ctx);
        if (current) return current;
        return Canvex.useDefaultWebGLProgram(ctx);
    }

    /**
     * Updates shared uniforms for the fallback WebGL program when it is active.
     * @param {WebGLRenderingContext | WebGL2RenderingContext} [ctx=Canvex.ctx] WebGL context.
     * @returns {void}
     */
    static syncDefaultWebGLState(ctx = Canvex.#ctx) {
        if (!Canvex.isWebGL(ctx)) return;
        const current = Canvex.currentProgram(ctx);
        const fallback = Canvex.#defaultWebGLPrograms.get(ctx)?.program ?? null;
        if (!current || current !== fallback) return;
        Canvex.#initializeDefaultWebGLProgramState(ctx, current);
    }

    /** @private */
    static #initializeDefaultWebGLProgramState(ctx, program) {
        ctx.useProgram(program);

        const resolutionLocation = ctx.getUniformLocation(program, 'u_resolution');
        if (resolutionLocation) {
            ctx.uniform2f(resolutionLocation, Math.max(1, Canvex.width), Math.max(1, Canvex.height));
        }

        const colorLocation = ctx.getUniformLocation(program, 'u_color');
        if (colorLocation) {
            ctx.uniform4f(colorLocation, 1, 1, 1, 1);
        }

        const useMatricesLocation = ctx.getUniformLocation(program, 'u_useMatrices');
        if (useMatricesLocation) {
            ctx.uniform1i(useMatricesLocation, 0);
        }

        const identity = new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
        ]);

        const projectionLocation = ctx.getUniformLocation(program, 'u_projection');
        if (projectionLocation) {
            ctx.uniformMatrix4fv(projectionLocation, false, identity);
        }

        const modelViewLocation = ctx.getUniformLocation(program, 'u_modelView');
        if (modelViewLocation) {
            ctx.uniformMatrix4fv(modelViewLocation, false, identity);
        }

        if ('viewport' in ctx) {
            ctx.viewport(0, 0, Math.max(1, Canvex.width), Math.max(1, Canvex.height));
        }
        if ('enable' in ctx && 'DEPTH_TEST' in ctx) {
            ctx.enable(ctx.DEPTH_TEST);
        }
    }

    /** @private */
    static #prepareFrame() {
        const ctx = Canvex.#ctx;
        if (!Canvex.#resetTransformPerFrame || !Canvex.#isCanvas2D(ctx)) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    /**
     * Gets the measured frame rate or sets the target frame-rate cap.
     * @param {number} [fps] Desired frame-rate cap.
     * @returns {number}
     */
    static frameRate(fps) {
        if (typeof fps === 'undefined') return Canvex.#currentFrameRate;
        const nextFps = Number(fps);
        if (!Number.isFinite(nextFps) || nextFps <= 0) return Canvex.#targetFrameRate;
        Canvex.#targetFrameRate = nextFps;
        return Canvex.#targetFrameRate;
    }

    static targetFrameRate() {
        return Canvex.#targetFrameRate;
    }

    static resetTransformPerFrame(enabled) {
        if (typeof enabled === 'undefined') return Canvex.#resetTransformPerFrame;
        Canvex.#resetTransformPerFrame = Boolean(enabled);
        return Canvex.#resetTransformPerFrame;
    }

    /**
     * Creates or reconfigures the shared canvas element.
     *
     * When a WebGL/WebGL2 context is requested, Canvex automatically ensures a
     * fallback shader program exists and is bound so downstream shape helpers do
     * not fail with "Call gl.useProgram(program) before ..." errors.
     *
     * @param {number} [x=0] Canvas CSS x-offset in pixels.
     * @param {number} [y=0] Canvas CSS y-offset in pixels.
     * @param {number} [width=window.innerWidth] Canvas width.
     * @param {number} [height=window.innerHeight] Canvas height.
     * @param {'2d' | 'webgl' | 'webgl2' | string} [mode='2d'] Rendering context mode.
     * @param {HTMLElement | string} [parent=document.body] Parent element or selector.
     * @returns {HTMLCanvasElement}
     */
    static createCanvas(x = 0, y = 0, width = window.innerWidth, height = window.innerHeight, mode = Canvex.C2D, parent = document.body) {
        const canvas = Canvex.#canvas;
        const resolvedParent = typeof parent === 'string' ? document.querySelector(parent) : parent;
        const safeWidth = Math.max(1, Math.floor(Number(width) || window.innerWidth));
        const safeHeight = Math.max(1, Math.floor(Number(height) || window.innerHeight));
        const nextMode = typeof mode === 'string' ? mode : Canvex.C2D;

        canvas.width = safeWidth;
        canvas.height = safeHeight;
        canvas.style.display = 'block';
        canvas.style.position = 'absolute';
        canvas.style.left = `${Number(x) || 0}px`;
        canvas.style.top = `${Number(y) || 0}px`;
        canvas.style.outline = 'none';

        if (!canvas.hasAttribute('tabindex')) {
            canvas.setAttribute('tabindex', '0');
        }

        const contextAttributes = Canvex.isWebGLMode(nextMode)
            ? {
                alpha: true,
                antialias: true,
                depth: true,
                stencil: true,
                premultipliedAlpha: true,
                preserveDrawingBuffer: false
            }
            : undefined;

        const context = canvas.getContext(nextMode, contextAttributes);
        if (!context) {
            throw new Error(`Unable to create a ${nextMode} rendering context.`);
        }

        Canvex.#ctx = context;
        Canvex.#currentContextMode = nextMode;

        if (resolvedParent instanceof HTMLElement) {
            if (canvas.parentNode !== resolvedParent) {
                resolvedParent.insertAdjacentElement('afterbegin', canvas);
            }
            Canvex.#parent = resolvedParent;
        } else if (!canvas.parentNode) {
            document.body.insertAdjacentElement('afterbegin', canvas);
            Canvex.#parent = document.body;
        }

        Canvex.#ogCanvas = canvas;
        Canvex.#ogCtx = context;

        if (Canvex.isWebGL(context)) {
            Canvex.useDefaultWebGLProgram(context);
        }

        return canvas;
    }

    /**
     * Returns whether the provided mode string represents WebGL or WebGL2.
     * @param {string} mode Context mode string.
     * @returns {boolean}
     */
    static isWebGLMode(mode) {
        const normalized = String(mode ?? '').toLowerCase();
        return normalized === Canvex.WEBGL || normalized === Canvex.WEBGL2;
    }

    /**
     * Resizes the shared canvas while preserving the active context mode.
     * @param {number} [width=window.innerWidth] New width.
     * @param {number} [height=window.innerHeight] New height.
     * @returns {HTMLCanvasElement}
     */
    static resizeCanvas(width = window.innerWidth, height = window.innerHeight) {
        Canvex.#canvas.width = Math.max(1, Math.floor(Number(width) || window.innerWidth));
        Canvex.#canvas.height = Math.max(1, Math.floor(Number(height) || window.innerHeight));

        const context = Canvex.#canvas.getContext(Canvex.#currentContextMode);
        if (!context) {
            throw new Error(`Unable to create a ${Canvex.#currentContextMode} rendering context.`);
        }

        Canvex.#ctx = context;
        if (Canvex.isWebGL(context)) {
            Canvex.ensureWebGLProgram(context);
            Canvex.syncDefaultWebGLState(context);
        }
        return Canvex.#canvas;
    }

    /**
     * Fills the full canvas with a solid color.
     * @param {string | CanvasGradient | CanvasPattern} [color='#000'] Fill source.
     * @returns {void}
     */
    static background(color = '#000') {
        const ctx = Canvex.#ctx;
        if (!Canvex.#isCanvas2D(ctx)) return;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, Canvex.width, Canvex.height);
        ctx.restore();
    }

    static clear() {
        const ctx = Canvex.#ctx;
        if (Canvex.#isCanvas2D(ctx)) {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, Canvex.width, Canvex.height);
            ctx.restore();
            return;
        }
        if (Canvex.isWebGL(ctx)) {
            ctx.clear(ctx.COLOR_BUFFER_BIT | ctx.DEPTH_BUFFER_BIT);
        }
    }

    static async run() {
        if (Canvex.#isRunning) return;
        Canvex.#isRunning = true;

        if (!Canvex.#setupDone) {
            const setup = Canvex.#getHook('setup');
            if (setup) await setup();

            if (!Canvex.#ctx) {
                Canvex.createCanvas();
            }

            Canvex.#setupDone = true;
            Canvex.#startMillis = performance.now();
            Canvex.#lastRenderedTime = 0;
            Canvex.#deltaTime = 1000 / Math.max(1, Canvex.#targetFrameRate);
            Canvex.#currentFrameRate = Canvex.#targetFrameRate;
            Canvex.#frameCount = 0;
        }

        Canvex.#animationFrameId = requestAnimationFrame(Canvex.#loop);
    }

    static stop() {
        Canvex.#isRunning = false;
        if (Canvex.#animationFrameId !== null) {
            cancelAnimationFrame(Canvex.#animationFrameId);
            Canvex.#animationFrameId = null;
        }
    }

    static _setCanvas(canvas, context) {
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new Error('Provided canvas must be an instance of HTMLCanvasElement.');
        }
        const is2d = typeof CanvasRenderingContext2D !== 'undefined' && context instanceof CanvasRenderingContext2D;
        const isGl1 = typeof WebGLRenderingContext !== 'undefined' && context instanceof WebGLRenderingContext;
        const isGl2 = typeof WebGL2RenderingContext !== 'undefined' && context instanceof WebGL2RenderingContext;
        if (!is2d && !isGl1 && !isGl2) {
            throw new Error('Provided context must be a valid rendering context (Canvas 2D, WebGL, or WebGL2).');
        }
        Canvex.#canvas = canvas;
        Canvex.#ctx = context;
        if (Canvex.isWebGL(context)) {
            Canvex.ensureWebGLProgram(context);
            Canvex.syncDefaultWebGLState(context);
        }
    }

    static _revertCanvas() {
        Canvex.#canvas = Canvex.#ogCanvas;
        Canvex.#ctx = Canvex.#ogCtx;
        if (Canvex.isWebGL(Canvex.#ctx)) {
            Canvex.ensureWebGLProgram(Canvex.#ctx);
            Canvex.syncDefaultWebGLState(Canvex.#ctx);
        }
    }

    static #loop = (now) => {
        if (!Canvex.#isRunning) return;

        const draw = Canvex.#getHook('draw');
        const targetInterval = 1000 / Math.max(1, Canvex.#targetFrameRate);

        if (Canvex.#lastRenderedTime === 0) {
            Canvex.#lastRenderedTime = now - targetInterval;
        }

        const elapsedSinceRender = now - Canvex.#lastRenderedTime;
        if (elapsedSinceRender >= targetInterval) {
            Canvex.#deltaTime = elapsedSinceRender;
            Canvex.#lastRenderedTime = now - (elapsedSinceRender % targetInterval);
            Canvex.#frameCount += 1;

            const instantaneousFps = 1000 / Math.max(0.0001, elapsedSinceRender);
            Canvex.#currentFrameRate += (instantaneousFps - Canvex.#currentFrameRate) * Canvex.#fpsSmoothing;

            Canvex.#prepareFrame();
            if (Canvex.isWebGL(Canvex.#ctx)) {
                Canvex.ensureWebGLProgram(Canvex.#ctx);
                Canvex.syncDefaultWebGLState(Canvex.#ctx);
            }

            if (draw) {
                try {
                    draw();
                } catch (error) {
                    console.error('Canvex draw() error:', error);
                }
            }
        }

        Canvex.#animationFrameId = requestAnimationFrame(Canvex.#loop);
    };
}

/**
 * Automatically starts the sketch once the page is ready.
 */
const boot = () => {
    window.setTimeout(() => {
        Canvex.run();
    }, 0);
};

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    boot();
} else {
    window.addEventListener('load', boot, { once: true });
}
