import { Canvex } from "./canvex.js";
import { Camera } from "./camera.js";
import { math } from "./math.js";
import  { pointer } from './events.js'
/**
 * Interaction utilities for Canvex 3D sketches.
 *
 * Provides visual debugging helpers and user-driven camera control for
 * WebGL / WebGL2 sketches. All methods are safe to call from Canvas 2D
 * contexts — they will silently no-op when a 3D context is not active.
 */
export const Interaction = class {

    // -------------------------------------------------------------------------
    // Debug mode
    // -------------------------------------------------------------------------

    /** @type {boolean} Whether debug overlays are currently active. @private */
    static #debugActive = false;

    /**
     * The size of each grid cell in world units.
     * @type {number}
     * @private
     */
    static #gridSize = 100;

    /**
     * The number of grid cells on each side of the origin.
     * @type {number}
     * @private
     */
    static #gridDivisions = 10;

    /**
     * Length of the axes indicator arrows in world units.
     * @type {number}
     * @private
     */
    static #axisLength = 120;

    /** @type {boolean} Whether global mouse listeners are attached. @private */
    static #orbitGlobalListenersAttached = false;

    // -------------------------------------------------------------------------
    // Orbit control — persistent spherical state
    // -------------------------------------------------------------------------

    /** @type {number|null} Azimuth angle θ in radians (rotation around world Y). @private */
    static #orbitTheta = null;

    /** @type {number|null} Polar angle φ in radians (elevation from world +Y). @private */
    static #orbitPhi = null;

    /** @type {number|null} Distance from the look-at target. @private */
    static #orbitRadius = null;

    /** @type {number} Look-at target X. @private */
    static #orbitTargetX = 0;

    /** @type {number} Look-at target Y. @private */
    static #orbitTargetY = 0;

    /** @type {number} Look-at target Z. @private */
    static #orbitTargetZ = 0;

    /** @type {number} Horizontal drag sensitivity. @private */
    static #orbitSensitivityX = 1;

    /** @type {number} Vertical drag sensitivity. @private */
    static #orbitSensitivityY = 1;

    /** @type {number} Zoom sensitivity. @private */
    static #orbitSensitivityZ = 1;

    /** @type {boolean} @private */
    static #orbitFreeRotation = true;

    /** @type {boolean} @private */
    static #orbitDisableTouchActions = false;

    /** @type {boolean} @private */
    static #preventContextMenu = false;

    // Pointer / drag state
    /** @type {boolean} Whether a drag is currently active. @private */
    static #orbitDragging = false;

    /** @type {number} Client X at the start of or last drag tick. @private */
    static #orbitLastX = 0;

    /** @type {number} Client Y at the start of or last drag tick. @private */
    static #orbitLastY = 0;

    // Touch pinch state
    /** @type {number|null} Previous pinch distance (px). @private */
    static #orbitLastPinchDist = null;

    // -------------------------------------------------------------------------

    static #ensureDefaultPerspective3D() {
        const snap = Camera.snapshot();
        const eyeX = snap?.eyeX ?? snap?.eye?.x ?? 0;
        const eyeY = snap?.eyeY ?? snap?.eye?.y ?? 0;
        const eyeZ = snap?.eyeZ ?? snap?.eye?.z ?? 0;
        const centerX = snap?.centerX ?? snap?.center?.x ?? 0;
        const centerY = snap?.centerY ?? snap?.center?.y ?? 0;
        const centerZ = snap?.centerZ ?? snap?.center?.z ?? 0;

        if (eyeX === 0 && eyeY === 0 &&
            centerX === 0 && centerY === 0 && centerZ === 0) {
            // Sync projection to live canvas size (pass aspect=null so Camera
            // reads the canvas dimensions each frame, avoiding squashed shapes).
            const canvas = typeof Canvex !== 'undefined' ? Canvex.canvas : null;
            const canvasHeight = canvas ? canvas.height : 400;
            const cameraZ = (canvasHeight / 2) / Math.tan(Math.PI / 4);
            const fovy = 2 * Math.atan((canvasHeight / 2) / cameraZ);
            Camera.perspective(fovy, null, 0.1, 10000);
            return Camera.snapshot();
        }

        return snap;
    }

    /**
     * Uploads the Camera's current projection and view matrices into the active
     * shader program. This activates the `u_useMatrices` flag so the default
     * Canvex shader uses the proper 3D transform instead of the 2D pixel-space
     * fallback, making `Shapes.box()` and all other 3D primitives visible.
     *
     * @param {WebGLRenderingContext | WebGL2RenderingContext} gl
     * @private
     */
    static #uploadCameraMatrices(gl) {
        const program = gl.getParameter(gl.CURRENT_PROGRAM);
        if (!program) return;

        const snap = this.#ensureDefaultPerspective3D();

        const uProj = gl.getUniformLocation(program, "u_projection");
        if (uProj) gl.uniformMatrix4fv(uProj, false, new Float32Array(snap.projectionMatrix));

        const uMV = gl.getUniformLocation(program, "u_modelView");
        if (uMV) gl.uniformMatrix4fv(uMV, false, new Float32Array(snap.viewMatrix));

        const uUse = gl.getUniformLocation(program, "u_useMatrices");
        if (uUse) gl.uniform1i(uUse, 1);
    }

    /**
     * Returns the active WebGL / WebGL2 context, or null for Canvas 2D.
     * @returns {WebGLRenderingContext | WebGL2RenderingContext | null}
     * @private
     */
    static #gl() {
        const ctx = Canvex.ctx;
        const isGL =
            (typeof WebGLRenderingContext !== "undefined" && ctx instanceof WebGLRenderingContext) ||
            (typeof WebGL2RenderingContext !== "undefined" && ctx instanceof WebGL2RenderingContext);
        return isGL ? ctx : null;
    }

    // ---- Minimal shader helpers for line drawing ----------------------------

    /** @type {WeakMap<WebGLRenderingContext|WebGL2RenderingContext, WebGLProgram>} @private */
    static #linePrograms = new WeakMap();

    /**
     * Returns (or lazily creates) a minimal line-drawing shader program for
     * the given WebGL context. The program exposes:
     *   - attribute  vec4  a_position
     *   - uniform    mat4  u_projection
     *   - uniform    mat4  u_modelView
     *   - uniform    vec4  u_color
     *
     * @param {WebGLRenderingContext | WebGL2RenderingContext} gl
     * @returns {WebGLProgram | null}
     * @private
     */
    static #getLineProgram(gl) {
        if (this.#linePrograms.has(gl)) return this.#linePrograms.get(gl);

        const isGL2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
        const precision = "precision mediump float;\n";
        const vsHeader = isGL2 ? "#version 300 es\nin vec4 a_position;\nuniform mat4 u_projection;\nuniform mat4 u_modelView;\nvoid main() {\n  gl_Position = u_projection * u_modelView * a_position;\n}" : `${precision}attribute vec4 a_position;\nuniform mat4 u_projection;\nuniform mat4 u_modelView;\nvoid main() {\n  gl_Position = u_projection * u_modelView * a_position;\n}`;
        const fsHeader = isGL2 ? `#version 300 es\n${precision}uniform vec4 u_color;\nout vec4 fragColor;\nvoid main() {\n  fragColor = u_color;\n}` : `${precision}uniform vec4 u_color;\nvoid main() {\n  gl_FragColor = u_color;\n}`;

        const compile = (type, src) => {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, src);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.error("Interaction shader error:", gl.getShaderInfoLog(shader));
                gl.deleteShader(shader);
                return null;
            }
            return shader;
        };

        const vs = compile(gl.VERTEX_SHADER, vsHeader);
        const fs = compile(gl.FRAGMENT_SHADER, fsHeader);
        if (!vs || !fs) return null;

        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error("Interaction program link error:", gl.getProgramInfoLog(program));
            return null;
        }

        this.#linePrograms.set(gl, program);
        return program;
    }

    /**
     * Draws a batch of line segments in a single color using a minimal
     * internal shader, without disturbing the user's active program or
     * bound buffers.
     *
     * @param {WebGLRenderingContext | WebGL2RenderingContext} gl
     * @param {Float32Array} vertices  Flat XYZ triplets — each pair of triplets is one segment.
     * @param {[number,number,number,number]} color  RGBA in [0, 1].
     * @param {number[]} projectionMatrix   Column-major 4x4 projection matrix.
     * @param {number[]} modelViewMatrix    Column-major 4x4 model-view matrix.
     * @private
     */
    static #drawLines(gl, vertices, color, projectionMatrix, modelViewMatrix) {
        const program = this.#getLineProgram(gl);
        if (!program) return;

        // Save state
        const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM);
        const prevBuffer  = gl.getParameter(gl.ARRAY_BUFFER_BINDING);

        gl.useProgram(program);

        // Upload matrices
        const uProj = gl.getUniformLocation(program, "u_projection");
        const uMV   = gl.getUniformLocation(program, "u_modelView");
        const uCol  = gl.getUniformLocation(program, "u_color");
        gl.uniformMatrix4fv(uProj, false, projectionMatrix);
        gl.uniformMatrix4fv(uMV,   false, modelViewMatrix);
        gl.uniform4fv(uCol, color);

        // Upload geometry
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW);

        const aPos = gl.getAttribLocation(program, "a_position");
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.LINES, 0, vertices.length / 3);

        // Restore state
        gl.disableVertexAttribArray(aPos);
        gl.deleteBuffer(buf);
        gl.bindBuffer(gl.ARRAY_BUFFER, prevBuffer);
        gl.useProgram(prevProgram);
    }

    /**
     * Renders a flat ground grid and an XYZ axes icon into the current
     * WebGL / WebGL2 frame. Call this once per `draw()` call while debug mode
     * is active (handled automatically by {@link Interaction.debugMode}).
     *
     * The grid lies on the XZ plane centred at the world origin. The axes
     * indicator is drawn at the origin: X = red, Y = green, Z = blue.
     *
     * @private
     */
    static #renderDebugOverlays() {
        const gl = this.#gl();
        if (!gl) return;

        const snap = Camera.snapshot();
        const proj = snap.projectionMatrix;
        const view = snap.viewMatrix;

        const half     = this.#gridSize * this.#gridDivisions * 0.5;
        const step     = this.#gridSize;
        const divs     = this.#gridDivisions;
        const lineVerts = [];

        // XZ-plane grid lines
        for (let i = 0; i <= divs; i++) {
            const t = -half + i * step;
            // Lines parallel to Z
            lineVerts.push(-half, 0, t,  half, 0, t);
            // Lines parallel to X
            lineVerts.push(t, 0, -half,  t, 0,  half);
        }

        const identity = [
            1,0,0,0,
            0,1,0,0,
            0,0,1,0,
            0,0,0,1
        ];

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // Draw grid in a translucent grey
        this.#drawLines(
            gl,
            new Float32Array(lineVerts),
            [0.5, 0.5, 0.5, 0.35],
            proj,
            view
        );

        const ax = this.#axisLength;

        // X axis — red
        this.#drawLines(gl, new Float32Array([0,0,0, ax,0,0]), [1, 0.18, 0.18, 1], proj, view);
        // Y axis — green
        this.#drawLines(gl, new Float32Array([0,0,0, 0,ax,0]), [0.18, 1, 0.18, 1], proj, view);
        // Z axis — blue
        this.#drawLines(gl, new Float32Array([0,0,0, 0,0,ax]), [0.18, 0.45, 1, 1], proj, view);

        // Negative halves of axes (dimmer, dashed appearance via shorter segments)
        this.#drawLines(gl, new Float32Array([0,0,0, -ax*0.5,0,0]), [1, 0.18, 0.18, 0.3], proj, view);
        this.#drawLines(gl, new Float32Array([0,0,0, 0,-ax*0.5,0]), [0.18, 1, 0.18, 0.3], proj, view);
        this.#drawLines(gl, new Float32Array([0,0,0, 0,0,-ax*0.5]), [0.18, 0.45, 1, 0.3], proj, view);

        gl.disable(gl.BLEND);
    }




    /**
     * Multiplies two column-major 4x4 matrices: returns a * b.
     * @param {number[]} a
     * @param {number[]} b
     * @returns {number[]}
     * @private
     */
    static #mat4Multiply(a, b) {
        const out = new Array(16).fill(0);
        for (let col = 0; col < 4; col++) {
            for (let row = 0; row < 4; row++) {
                let sum = 0;
                for (let k = 0; k < 4; k++) {
                    sum += a[k * 4 + row] * b[col * 4 + k];
                }
                out[col * 4 + row] = sum;
            }
        }
        return out;
    }


    /**
     * Returns the Euclidean distance between two touch points.
     * @param {Touch} a
     * @param {Touch} b
     * @returns {number}
     * @private
     */
    static #pinchDist(a, b) {
        const dx = a.clientX - b.clientX;
        const dy = a.clientY - b.clientY;
        return Math.hypot(dx, dy);
    }

    /**
     * Returns true when an input event originated from the active canvas.
     * @param {Event} event
     * @returns {boolean}
     * @private
     */
    static #eventTargetsCanvas(event) {
        const canvas = Canvex.canvas;
        if (!canvas) return false;

        const target = event?.target ?? null;
        if (!target) return true;

        return target === canvas || (typeof canvas.contains === "function" && canvas.contains(target));
    }

    /**
     * Extracts a client-space pointer position from mouse or touch events.
     * Falls back to the shared pointer state when the event object lacks clientX/Y.
     * @param {MouseEvent|TouchEvent|PointerEvent|Event} event
     * @returns {{x:number,y:number}}
     * @private
     */
    static #eventClientPoint(event) {
        const touch = event?.touches?.[0] ?? event?.changedTouches?.[0] ?? null;
        if (touch) {
            return {
                x: Number(touch.clientX) || 0,
                y: Number(touch.clientY) || 0
            };
        }

        const x = Number.isFinite(event?.clientX) ? event.clientX : pointer.winMouseX;
        const y = Number.isFinite(event?.clientY) ? event.clientY : pointer.winMouseY;

        return {
            x: Number(x) || 0,
            y: Number(y) || 0
        };
    }




    static #wrapAngle(angle) {
        const TAU = Math.PI * 2;
        angle = angle % TAU;
        return angle < 0 ? angle + TAU : angle;
    }


    /**
     * Initialises spherical orbit state from the current camera snapshot.
     * Called once on the very first orbitControl() invocation so any
     * Camera.camera() call made before it is correctly inherited.
     * @private
     */
    static #orbitInitFromCamera() {
        const snap = Camera.snapshot();

        const ex = snap?.eyeX    ?? snap?.eye?.x    ?? 0;
        const ey = snap?.eyeY    ?? snap?.eye?.y    ?? 0;
        let   ez = snap?.eyeZ    ?? snap?.eye?.z    ?? 200;
        const cx = snap?.centerX ?? snap?.center?.x ?? 0;
        const cy = snap?.centerY ?? snap?.center?.y ?? 0;
        const cz = snap?.centerZ ?? snap?.center?.z ?? 0;

        // If the camera is still at the library factory default (eye on Z axis,
        // looking at origin), reposition it to the canvas-proportional distance
        // so shapes fill the viewport exactly as the reference images show.
        const isFactoryDefault =
            ex === 0 && ey === 0 &&
            cx === 0 && cy === 0 && cz === 0;
        if (isFactoryDefault) {
            const canvas = typeof Canvex !== 'undefined' ? Canvex.canvas : null;
            const canvasHeight = canvas ? canvas.height : 400;
            ez = (canvasHeight / 2) / Math.tan(Math.PI / 6); // tan(30°)
            const fovy = 2 * Math.atan((canvasHeight / 2) / ez);
            Camera.perspective(fovy, null, 0.1, 10000);
            Camera.camera(0, 0, ez, 0, 0, 0, 0, 1, 0);
        }

        // Store the look-at target
        this.#orbitTargetX = cx;
        this.#orbitTargetY = cy;
        this.#orbitTargetZ = cz;

        // Vector from target to eye
        const dx = ex - cx;
        const dy = ey - cy;
        const dz = ez - cz;

        this.#orbitRadius = Math.hypot(dx, dy, dz) || 200;

        // φ: angle from +Y axis down toward the XZ plane.
        // When the camera is on the Z-axis (dy === 0) force exactly π/2 so
        // the initial orbit is equatorial — consistent for every shape including
        // torus, which must start side-on just like box and plane.
        if (dy === 0) {
            this.#orbitPhi = Math.PI / 2;
        } else {
            this.#orbitPhi = Math.acos(Math.max(-1, Math.min(1, dy / this.#orbitRadius)));
        }

        // θ: azimuth in XZ plane, measured from +Z toward +X
        this.#orbitTheta  = Math.atan2(dx, dz);
    }

    /**
     * Applies the current (θ, φ, r) spherical state to the Camera.
     *
     * φ roams the full [0, 2π] range with no clamping.  The up-vector is the
     * analytic derivative of the eye position w.r.t. φ, giving a perfectly
     * smooth, continuous orientation through both poles and the upside-down
     * half — no bouncing, no flipping, no gimbal lock.
     * @private
     */
    static #orbitApplyCamera() {
        const r      = this.#orbitRadius;
        const phi    = this.#orbitPhi;
        const th     = this.#orbitTheta;
        const sinPhi = Math.sin(phi);
        const cosPhi = Math.cos(phi);
        const sinTh  = Math.sin(th);
        const cosTh  = Math.cos(th);

        // Spherical → Cartesian  (Y-up, p5.js / Canvex convention)
        const eyeX = this.#orbitTargetX + r * sinPhi * sinTh;
        const eyeY = this.#orbitTargetY + r * cosPhi;
        const eyeZ = this.#orbitTargetZ + r * sinPhi * cosTh;

        // Up = d(eye)/dφ  (un-normalised; Camera.camera normalises internally)
        //   dx/dφ =  r · cos(φ) · sin(θ)
        //   dy/dφ = -r · sin(φ)
        //   dz/dφ =  r · cos(φ) · cos(θ)
        // This vector is always tangent to the meridian, so it correctly
        // flips to (0,-1,0) when the camera passes the bottom pole — exactly
        // what you want for uninterrupted full-sphere rotation.
        let upX = cosPhi * sinTh;
        let upY = -sinPhi;
        let upZ = cosPhi * cosTh;

        // At the poles sinPhi ≈ 0 AND cosPhi ≈ ±1, so the up vector
        // degenerates to (±sinTh, 0, ±cosTh) — a valid horizontal direction.
        // No special-case needed; the formula handles it naturally.

        Camera.camera(
            eyeX, eyeY, eyeZ,
            this.#orbitTargetX,
            this.#orbitTargetY,
            this.#orbitTargetZ,
            upX, upY, upZ
        );
    }


    // =========================================================================
    // Public API
    // =========================================================================

    /**
     * Enables debug mode for 3D sketches.
     *
     * While active, a flat XZ-plane grid and an XYZ axes icon are drawn at the
     * world origin every frame. Call this once inside `draw()` (or `setup()`)
     * to keep the overlays visible. The grid and axes are rendered on top of
     * the cleared buffer but beneath your own geometry when called at the start
     * of `draw()`.
     *
     * - The grid spans the XZ plane, centred at the world origin.
     * - The axes icon shows X in red, Y in green, and Z in blue.
     * - No-ops silently when the active context is Canvas 2D.
     *
     * @param {object}  [options={}]           Optional configuration.
     * @param {number}  [options.gridSize=100]        World-unit size of each grid cell.
     * @param {number}  [options.gridDivisions=10]    Number of cells on each side of the origin.
     * @param {number}  [options.axisLength=120]      Length of the axis indicator arrows.
     * @returns {void}
     *
     * @example
     * function draw() {
     *   Canvex.clear();
     *   Interaction.debugMode();
     *   // … draw your scene …
     * }
     */
    static debugMode({ gridSize = 100, gridDivisions = 10, axisLength = 120 } = {}) {
        if (!this.#gl()) return;

        this.#gridSize      = gridSize;
        this.#gridDivisions = gridDivisions;
        this.#axisLength    = axisLength;
        this.#debugActive   = true;

        this.#uploadCameraMatrices(this.#gl());
        this.#renderDebugOverlays();
    }

    /**
     * Disables debug mode, stopping the grid and axes overlays from being
     * drawn on future frames.
     *
     * Has no effect if {@link Interaction.debugMode} has not been called.
     *
     * @returns {void}
     *
     * @example
     * // Toggle debug with the 'd' key
     * Keyboard.keyPressed = (e) => {
     *   if (e.key === 'd') {
     *     if (Interaction.isDebugMode) Interaction.noDebugMode();
     *     else Interaction.debugMode();
     *   }
     * };
     */
    static noDebugMode() {
        this.#debugActive = false;
    }

    /**
     * Whether debug overlays are currently enabled.
     * @type {boolean}
     */
    static get isDebugMode() {
        return this.#debugActive;
    }

    /**
     * Enables interactive orbit control for the active 3D sketch.
     *
     * Once called, the user can:
     * - **Mouse / trackpad** — click-drag to orbit, scroll-wheel to zoom.
     * - **Touchscreen** — single-finger drag to orbit, two-finger pinch to zoom.
     *
     * ### Why it always follows the pointer
     *
     * The implementation uses a **pure spherical coordinate** representation
     * (azimuth θ, polar φ, radius r) stored persistently between frames.  Every
     * drag tick computes a delta in *screen pixels* and converts it to angular
     * deltas that are **scaled by the canvas size**, exactly as p5.js v2 does:
     *
     *   Δθ = −ΔpixelX / (width  / 2) · π · sensitivityX
     *   Δφ = −ΔpixelY / (height / 2) · π · sensitivityY
     *
     * This ensures 1:1 pointer-to-rotation feel regardless of the camera's
     * current orientation — there is no Euler-angle accumulation and therefore
     * no gimbal lock or direction reversal.
     *
     * The orbit target defaults to the current camera's look-at point. The
     * spherical coordinates (azimuth, polar angle, radius) are initialised from
     * the camera state at the time of the **first** `orbitControl()` call, so
     * any `Camera.camera()` call made before it is respected.
     *
     * Call `orbitControl()` once per `draw()` frame to keep the camera
     * continuously updated. Event listeners are attached only once regardless
     * of how many times this method is called.
     *
     * No-ops silently when the active context is Canvas 2D.
     *
     * @param {number} [sensitivityX=1]  Horizontal drag sensitivity (azimuth).
     * @param {number} [sensitivityY=1]  Vertical drag sensitivity (polar).
     * @param {number} [sensitivityZ=1]  Zoom sensitivity (wheel / pinch).
     * @param {object}  [options={}]
     * @param {boolean} [options.disableTouchActions=false]  Set `touch-action:none` on the canvas.
     * @param {boolean} [options.freeRotation=true]          Allow rotation past the poles.
     * @param {boolean} [options.preventContextMenu=false]   Suppress right-click context menu.
     * @returns {void}
     */
    static orbitControl(sensitivityX = 1, sensitivityY = 1, sensitivityZ = 1, options = {}) {
        if (!this.#gl()) return;

        const {
            disableTouchActions = false,
            freeRotation        = true,
            preventContextMenu  = false,
        } = options;

        // freeRotation option is accepted for API compatibility but φ always
        // wraps freely — clamping has been removed entirely.
        void freeRotation;

        // Store sensitivity and flag updates — picked up each frame.
        this.#orbitSensitivityX        = Number.isFinite(sensitivityX) && sensitivityX > 0 ? sensitivityX : 1;
        this.#orbitSensitivityY        = Number.isFinite(sensitivityY) && sensitivityY > 0 ? sensitivityY : 1;
        this.#orbitSensitivityZ        = Number.isFinite(sensitivityZ) && sensitivityZ > 0 ? sensitivityZ : 1;
        this.#orbitDisableTouchActions = !!disableTouchActions;
        this.#preventContextMenu       = !!preventContextMenu;

        // Apply / remove touch-action CSS.
        const canvas = Canvex.canvas;
        if (canvas) {
            canvas.style.touchAction = disableTouchActions ? "none" : "";
        }

        // ── One-time initialisation ──────────────────────────────────────────
        if (this.#orbitTheta === null) {
            this.#orbitInitFromCamera();
        }

        // ── Attach global listeners (only once) ─────────────────────────────
        if (!this.#orbitGlobalListenersAttached) {
            this.#orbitGlobalListenersAttached = true;
            this.#attachOrbitListeners();
        }

        // ── Apply current spherical state to Camera every frame ──────────────
        this.#orbitApplyCamera();
        this.#uploadCameraMatrices(this.#gl());
    }

    /**
     * Attaches the mouse / touch / wheel event listeners that drive the orbit.
     * Called exactly once; safe to call again (no-op after first call).
     * @private
     */
    static #attachOrbitListeners() {
        // ── Mouse down ────────────────────────────────────────────────────────
        const onMouseDown = (e) => {
            if (!this.#eventTargetsCanvas(e)) return;
            if (e.button !== 0 && e.button !== 2) return; // left or right only
            this.#orbitDragging = true;
            const pt = this.#eventClientPoint(e);
            this.#orbitLastX = pt.x;
            this.#orbitLastY = pt.y;
        };

        // ── Mouse move ────────────────────────────────────────────────────────
        const onMouseMove = (e) => {
            if (!this.#orbitDragging) return;
            const pt = this.#eventClientPoint(e);
            this.#applyOrbitDrag(pt.x, pt.y);
        };

        // ── Mouse up / leave ─────────────────────────────────────────────────
        const onMouseUp = () => {
            this.#orbitDragging     = false;
            this.#orbitLastPinchDist = null;
        };

        // ── Scroll wheel (zoom) ───────────────────────────────────────────────
        const onWheel = (e) => {
            if (!this.#eventTargetsCanvas(e)) return;
            e.preventDefault();
            // deltaY > 0 → zoom out (increase radius); < 0 → zoom in
            const factor = 1 + e.deltaY * 0.001 * this.#orbitSensitivityZ;
            this.#orbitRadius = Math.max(1, this.#orbitRadius * factor);
        };

        // ── Touch start ───────────────────────────────────────────────────────
        const onTouchStart = (e) => {
            if (!this.#eventTargetsCanvas(e)) return;
            if (e.touches.length === 1) {
                this.#orbitDragging = true;
                this.#orbitLastX    = e.touches[0].clientX;
                this.#orbitLastY    = e.touches[0].clientY;
                this.#orbitLastPinchDist = null;
            } else if (e.touches.length === 2) {
                this.#orbitDragging      = false;
                this.#orbitLastPinchDist = this.#pinchDist(e.touches[0], e.touches[1]);
            }
        };

        // ── Touch move ────────────────────────────────────────────────────────
        const onTouchMove = (e) => {
            if (!this.#eventTargetsCanvas(e)) return;
            if (e.touches.length === 1 && this.#orbitDragging) {
                const pt = this.#eventClientPoint(e);
                this.#applyOrbitDrag(pt.x, pt.y);
            } else if (e.touches.length === 2) {
                const dist = this.#pinchDist(e.touches[0], e.touches[1]);
                if (this.#orbitLastPinchDist !== null) {
                    const ratio  = this.#orbitLastPinchDist / dist; // >1 pinch in, <1 spread
                    const scaled = 1 + (ratio - 1) * this.#orbitSensitivityZ;
                    this.#orbitRadius = Math.max(1, this.#orbitRadius * scaled);
                }
                this.#orbitLastPinchDist = dist;
            }
        };

        // ── Touch end ─────────────────────────────────────────────────────────
        const onTouchEnd = (e) => {
            if (e.touches.length === 0) {
                this.#orbitDragging      = false;
                this.#orbitLastPinchDist = null;
            } else if (e.touches.length === 1) {
                // Went from 2-finger to 1-finger — restart single-touch drag
                this.#orbitLastPinchDist = null;
                this.#orbitDragging      = true;
                this.#orbitLastX         = e.touches[0].clientX;
                this.#orbitLastY         = e.touches[0].clientY;
            }
        };

        // ── Context-menu suppression ──────────────────────────────────────────
        const onContextMenu = (e) => {
            if (this.#preventContextMenu && this.#eventTargetsCanvas(e)) {
                e.preventDefault();
            }
        };

        // Bind everything — mouse moves and releases on the whole window so
        // the drag isn't lost when the cursor leaves the canvas.
        window.addEventListener("mousedown",   onMouseDown,  { passive: true  });
        window.addEventListener("mousemove",   onMouseMove,  { passive: true  });
        window.addEventListener("mouseup",     onMouseUp,    { passive: true  });
        window.addEventListener("touchstart",  onTouchStart, { passive: true  });
        window.addEventListener("touchmove",   onTouchMove,  { passive: false });
        window.addEventListener("touchend",    onTouchEnd,   { passive: true  });
        window.addEventListener("contextmenu", onContextMenu,{ passive: false });

        // Wheel on the canvas only — prevents hijacking the page scroll.
        const cv = Canvex.canvas;
        if (cv) {
            cv.addEventListener("wheel", onWheel, { passive: false });
        }
    }

    /**
     * Core drag handler — converts a raw client-coordinate position into
     * azimuth/polar deltas and applies them to the spherical orbit state.
     *
     * The formula mirrors p5.js v2 `interaction.js` line ~155:
     *
     *   Δθ = −ΔpixelX / (width  / 2) · π · sensitivityX
     *   Δφ = −ΔpixelY / (height / 2) · π · sensitivityY
     *
     * Normalising by half the canvas dimension means dragging from edge to
     * edge = 180 ° rotation, keeping the feel predictable regardless of
     * canvas size or current camera angle.
     *
     * @param {number} clientX
     * @param {number} clientY
     * @private
     */
    static #applyOrbitDrag(clientX, clientY) {
        const dx = clientX - this.#orbitLastX;
        const dy = clientY - this.#orbitLastY;

        this.#orbitLastX = clientX;
        this.#orbitLastY = clientY;

        // Guard against micro-moves that don't change the position
        if (dx === 0 && dy === 0) return;

        const canvas = Canvex.canvas;
        const w = canvas?.width  || 400;
        const h = canvas?.height || 400;

        // Pixels → radians, normalised to canvas half-size (p5.js formula)
        let dTheta = (dx / (w * 0.5)) * Math.PI * this.#orbitSensitivityX;
        const dPhi   = (dy / (h * 0.5)) * Math.PI * this.#orbitSensitivityY;

        // When the camera is upside-down (φ in (π, 2π)), horizontal drag must
        // be negated so the scene always follows the cursor direction — matching
        // the behaviour p5.js users expect regardless of orientation.
        const phi = this.#orbitPhi;
        if (phi > Math.PI) {
            dTheta = -dTheta;
        }

        this.#orbitTheta = this.#wrapAngle(this.#orbitTheta + dTheta);
        // φ always wraps freely — no clamping, no bouncing at the poles.
        this.#orbitPhi   = this.#wrapAngle(this.#orbitPhi   + dPhi);
    }
};
