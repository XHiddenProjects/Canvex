/**
 * Lightweight sketch manager with a p5-style `setup()` / `draw()` lifecycle.
 *
 * The class owns a single shared canvas element and provides:
 * - a managed render loop capped by `frameRate()`
 * - lifecycle hooks resolved from either `window` or `Canvex`
 * - timing helpers such as `frameCount`, `deltaTime`, and `millis`
 * - automatic transform reset at the start of each draw frame for Canvas 2D
 *
 * The per-frame transform reset is important because Canvas 2D transforms are
 * cumulative. By resetting the matrix before each draw call, rotation,
 * translation, scaling, and skewing behave like frame-local transforms instead
 * of compounding forever across frames.
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

    /** @type {number} */
    static #startMillis = 0;

    /** @type {number} */
    static #targetFrameRate = 60;

    /** @type {number} */
    static #currentFrameRate = 60;

    /** @type {number} */
    static #fpsSmoothing = 0.14;

    /** @type {boolean} */
    static #isRunning = false;

    /** @type {boolean} */
    static #setupDone = false;

    /** @type {number | null} */
    static #animationFrameId = null;

    /** @type {number} */
    static #lastRenderedTime = 0;

    /** @type {number} */
    static #deltaTime = 1000 / 60;

    /** @type {number} */
    static #frameCount = 0;

    /** @type {"2d" | "webgl" | string} */
    static #currentContextMode = '2d';

    /** @type {boolean} */
    static #resetTransformPerFrame = true;

    static C2D = '2d';
    static WEBGL = 'webgl';
    static CORNER = 'corner';
    static CORNERS = 'corners';
    static RADIUS = 'radius';
    static LEFT = 'left';
    static CENTER = 'center';
    static RIGHT = 'right';
    static TOP = 'top';
    static MIDDLE = 'middle';
    static BOTTOM = 'bottom';

    // Windows/Screen dimensions for convenience
    static WINDOW_WIDTH = window.innerWidth;
    static WINDOW_HEIGHT = window.innerHeight;
    static SCREEN_WIDTH = window.screen.width;
    static SCREEN_HEIGHT = window.screen.height;
    

    /**
     * Returns the managed canvas element.
     *
     * @returns {HTMLCanvasElement}
     */
    static get canvas() {
        return Canvex.#canvas;
    }

    /**
     * Returns the active rendering context.
     *
     * @returns {CanvasRenderingContext2D | WebGLRenderingContext | WebGL2RenderingContext | null}
     */
    static get ctx() {
        return Canvex.#ctx;
    }

    /**
     * Returns the number of completed draw frames since the active run started.
     *
     * @returns {number}
     */
    static get frameCount() {
        return Canvex.#frameCount;
    }

    /**
     * Returns the elapsed time in milliseconds between the two most recent
     * rendered frames.
     *
     * @returns {number}
     */
    static get deltaTime() {
        return Canvex.#deltaTime;
    }

    /**
     * Returns the elapsed time in seconds between the two most recent rendered
     * frames.
     *
     * @returns {number}
     */
    static get deltaSeconds() {
        return Canvex.#deltaTime / 1000;
    }

    /**
     * Returns the current canvas width in pixels.
     *
     * @returns {number}
     */
    static get width() {
        return Canvex.#canvas.width;
    }

    /**
     * Returns the current canvas height in pixels.
     *
     * @returns {number}
     */
    static get height() {
        return Canvex.#canvas.height;
    }

    /**
     * Returns milliseconds elapsed since the current run started.
     *
     * @returns {number}
     */
    static get _millis() {
        return performance.now() - Canvex.#startMillis;
    }

    /**
     * Returns whether the draw loop is currently running.
     *
     * @returns {boolean}
     */
    static get isRunning() {
        return Canvex.#isRunning;
    }

    /**
     * Resolves a lifecycle hook from either `Canvex` itself or `window`.
     *
     * @private
     * @param {string} name Hook name to resolve.
     * @returns {Function | null}
     */
    static #getHook(name) {
        if (typeof Canvex[name] === "function") {
        return Canvex[name].bind(Canvex);
        }

        if (typeof window !== "undefined" && typeof window[name] === "function") {
        return window[name].bind(window);
        }

        return null;
    }

    /**
     * Returns whether the current context is a Canvas 2D context.
     *
     * @private
     * @param {unknown} ctx
     * @returns {ctx is CanvasRenderingContext2D}
     */
    static #isCanvas2D(ctx) {
        return typeof CanvasRenderingContext2D !== "undefined" && ctx instanceof CanvasRenderingContext2D;
    }

    /**
     * Resets the current frame transform to the identity matrix when the active
     * context is Canvas 2D and per-frame resets are enabled.
     *
     * @private
     * @returns {void}
     */
    static #prepareFrame() {
        const ctx = Canvex.#ctx;
        if (!Canvex.#resetTransformPerFrame || !Canvex.#isCanvas2D(ctx)) {
        return;
        }

        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    /**
     * Gets the measured frame rate or sets the target frame-rate cap.
     *
     * - `frameRate()` returns the smoothed measured FPS.
     * - `frameRate(number)` sets the target draw cap and returns the applied cap.
     *
     * @param {number} [fps] Desired frame-rate cap. Must be a finite number greater than `0`.
     * @returns {number}
     */
    static frameRate(fps) {
        if (typeof fps === "undefined") {
        return Canvex.#currentFrameRate;
        }

        const nextFps = Number(fps);
        if (!Number.isFinite(nextFps) || nextFps <= 0) {
        return Canvex.#targetFrameRate;
        }

        Canvex.#targetFrameRate = nextFps;
        return Canvex.#targetFrameRate;
    }

    /**
     * Returns the configured frame-rate cap.
     *
     * @returns {number}
     */
    static targetFrameRate() {
        return Canvex.#targetFrameRate;
    }

    /**
     * Enables or disables automatic Canvas 2D transform reset at the beginning of
     * each draw frame.
     *
     * When enabled, transform calls such as `rotate()`, `translate()`, and
     * `scale()` behave like frame-local drawing transforms instead of being
     * compounded across every frame.
     *
     * @param {boolean} [enabled] Optional new setting. Omit the argument to read the current value.
     * @returns {boolean}
     */
    static resetTransformPerFrame(enabled) {
        if (typeof enabled === "undefined") {
        return Canvex.#resetTransformPerFrame;
        }

        Canvex.#resetTransformPerFrame = Boolean(enabled);
        return Canvex.#resetTransformPerFrame;
    }

    /**
     * Creates or reconfigures the shared canvas element.
     *
     * @param {number} [x=0] Canvas CSS x-offset in pixels.
     * @param {number} [y=0] Canvas CSS y-offset in pixels.
     * @param {number} [width=window.innerWidth] Canvas width in pixels.
     * @param {number} [height=window.innerHeight] Canvas height in pixels.
     * @param {HTMLElement | string} [parent=document.body] Parent element or selector.
     * @param {"2d" | "webgl" | string} [mode="2d"] Context mode passed to `getContext()`.
     * @returns {HTMLCanvasElement}
     * @throws {Error} Thrown when the requested rendering context cannot be created.
     */
    static createCanvas(x=0,y=0,width = window.innerWidth,height = window.innerHeight,parent = document.body,mode = Canvex.C2D) {
        const canvas = Canvex.#canvas;
        const resolvedParent = typeof parent === "string" ? document.querySelector(parent) : parent;
        const safeWidth = Math.max(1, Math.floor(Number(width) || window.innerWidth));
        const safeHeight = Math.max(1, Math.floor(Number(height) || window.innerHeight));
        const nextMode = typeof mode === "string" ? mode : C2D;

        canvas.width = safeWidth;
        canvas.height = safeHeight;
        canvas.style.display = "block";
        canvas.style.position = "absolute";
        canvas.style.left = `${x}px`;
        canvas.style.top = `${y}px`;
        canvas.style.outline = "none";

        if (!canvas.hasAttribute("tabindex")) {
        canvas.setAttribute("tabindex", "0");
        }

        const context = canvas.getContext(nextMode);
        if (!context) {
        throw new Error(`Unable to create a ${nextMode} rendering context.`);
        }

        Canvex.#ctx = context;
        Canvex.#currentContextMode = nextMode;

        if (resolvedParent instanceof HTMLElement) {
        if (canvas.parentNode !== resolvedParent) {
            resolvedParent.insertAdjacentElement('afterbegin',canvas);
        }
        Canvex.#parent = resolvedParent;
        } else if (!canvas.parentNode) {
        document.body.insertAdjacentElement('afterbegin',canvas);
        Canvex.#parent = document.body;
        }

        this.#ogCanvas = canvas;
        this.#ogCtx = context;

        return canvas;
    }

    /**
     * Resizes the shared canvas while preserving the active context mode.
     *
     * @param {number} [width=window.innerWidth] New width in pixels.
     * @param {number} [height=window.innerHeight] New height in pixels.
     * @returns {HTMLCanvasElement}
     * @throws {Error} Thrown when the active rendering context cannot be recreated.
     */
    static resizeCanvas(width = window.innerWidth, height = window.innerHeight) {
        Canvex.#canvas.width = Math.max(1, Math.floor(Number(width) || window.innerWidth));
        Canvex.#canvas.height = Math.max(1, Math.floor(Number(height) || window.innerHeight));

        const context = Canvex.#canvas.getContext(Canvex.#currentContextMode);
        if (!context) {
        throw new Error(`Unable to create a ${Canvex.#currentContextMode} rendering context.`);
        }

        Canvex.#ctx = context;
        return Canvex.#canvas;
    }

    /**
     * Fills the full canvas with a solid color.
     *
     * @param {string | CanvasGradient | CanvasPattern} [color="#000"] Fill source.
     * @returns {void}
     */
    static background(color = "#000") {
        const ctx = Canvex.#ctx;
        if (!Canvex.#isCanvas2D(ctx)) {
        return;
        }

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, Canvex.width, Canvex.height);
        ctx.restore();
    }

    /**
     * Clears the full canvas.
     *
     * @returns {void}
     */
    static clear() {
        const ctx = Canvex.#ctx;
        if (!Canvex.#isCanvas2D(ctx)) {
        return;
        }

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, Canvex.width, Canvex.height);
        ctx.restore();
    }

    /**
     * Starts the sketch lifecycle and begins the draw loop.
     *
     * `setup()` is run only once per page lifetime. After setup completes, the
     * draw loop begins and is throttled according to the configured target FPS.
     *
     * @returns {Promise<void>}
     */
    static async run() {
        if (Canvex.#isRunning) {
        return;
        }

        Canvex.#isRunning = true;

        if (!Canvex.#setupDone) {
        const setup = Canvex.#getHook("setup");
        if (setup) {
            await setup();
        }

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

    /**
     * Stops the draw loop.
     *
     * @returns {void}
     */
    static stop() {
        Canvex.#isRunning = false;

        if (Canvex.#animationFrameId !== null) {
        cancelAnimationFrame(Canvex.#animationFrameId);
        Canvex.#animationFrameId = null;
        }
    }
    static _setCanvas(canvas, context){
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new Error("Provided canvas must be an instance of HTMLCanvasElement.");
        }
        if (!(context instanceof CanvasRenderingContext2D || context instanceof WebGLRenderingContext || context instanceof WebGL2RenderingContext)) {
            throw new Error("Provided context must be a valid rendering context (Canvas 2D, WebGL, or WebGL2).");
        }
        Canvex.#canvas = canvas;
        Canvex.#ctx = context;
    }
    static _revertCanvas(){
        Canvex.#canvas = Canvex.#ogCanvas;
        Canvex.#ctx = Canvex.#ogCtx;
    }

    /**
     * Internal requestAnimationFrame loop.
     *
     * @private
     * @param {number} now High-resolution timestamp provided by requestAnimationFrame.
     * @returns {void}
     */
    static #loop = (now) => {
        if (!Canvex.#isRunning) {
        return;
        }

        const draw = Canvex.#getHook("draw");
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
        Canvex.#currentFrameRate +=
            (instantaneousFps - Canvex.#currentFrameRate) * Canvex.#fpsSmoothing;

        Canvex.#prepareFrame();

        if (draw) {
            try {
            draw();
            } catch (error) {
            console.error("Canvex draw() error:", error);
            }
        }
        }

        Canvex.#animationFrameId = requestAnimationFrame(Canvex.#loop);
    };
}

/**
 * Automatically starts the sketch once the page is ready.
 *
 * @returns {void}
 */
const boot = () => {
  window.setTimeout(() => {
    Canvex.run();
  }, 0);
};

if (document.readyState === "complete" || document.readyState === "interactive") {
  boot();
} else {
  window.addEventListener("load", boot, { once: true });
}
