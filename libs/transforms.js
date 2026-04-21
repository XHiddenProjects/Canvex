import { Canvas } from "./canvas.js";
import { Canvex } from "./canvex.js";
import { math } from "./math.js";

/**
 * Transform utilities for the active Canvex rendering context.
 *
 * This module supports both Canvas 2D and WebGL / WebGL2 contexts.
 *
 * ## Angle mode
 * Angle-based transform methods support a configurable angle mode via
 * {@link Transform.angleMode}. Use {@link Transform.RADIANS} or
 * {@link Transform.DEGREES} to control how the following methods interpret
 * angle arguments:
 * - {@link Transform.rotate}
 * - {@link Transform.rotateAround}
 * - {@link Transform.rotateX}
 * - {@link Transform.rotateY}
 * - {@link Transform.rotateZ}
 * - {@link Transform.shearX}
 * - {@link Transform.shearY}
 *
 * ## Canvas 2D behavior
 * Canvas 2D methods call the underlying `CanvasRenderingContext2D` transform
 * APIs directly.
 *
 * ## WebGL / WebGL2 behavior
 * WebGL contexts do not have built-in immediate-mode transform APIs, so this
 * class maintains an internal 4x4 model matrix stack. You can read the current
 * matrix with {@link Transform.matrix4} and upload it to a shader uniform with
 * {@link Transform.setMatrixUniform}.
 *
 * The WebGL matrix stack automatically resets to the identity matrix once per
 * rendered frame by default so transform behavior stays frame-local and smooth,
 * matching Canvas 2D expectations.
 */
export class Transform {
  /**
   * Angle mode constant for radian input.
   *
   * @type {"radians"}
   */
  static RADIANS = "radians";

  /**
   * Angle mode constant for degree input.
   *
   * @type {"degrees"}
   */
  static DEGREES = "degrees";

  /** @type {"radians" | "degrees"} */
  static #angleMode = Transform.RADIANS;

  /** @type {Float32Array[]} */
  static #webglMatrixStack = [Transform.#identityMatrix()];

  /** @type {number} */
  static #lastWebGLFrame = -1;

  /** @type {boolean} */
  static #resetWebGLMatrixPerFrame = true;

  /**
   * Returns the active rendering context.
   *
   * @private
   * @returns {CanvasRenderingContext2D | WebGLRenderingContext | WebGL2RenderingContext | null}
   */
  static #ctx() {
    return Canvex.ctx;
  }

  /**
   * Returns whether the supplied context is a Canvas 2D context.
   *
   * @private
   * @param {unknown} ctx Context value to test.
   * @returns {ctx is CanvasRenderingContext2D}
   */
  static #isCanvas2D(ctx) {
    return typeof CanvasRenderingContext2D !== "undefined" && ctx instanceof CanvasRenderingContext2D;
  }

  /**
   * Returns whether the supplied context is a WebGL or WebGL2 context.
   *
   * @private
   * @param {unknown} ctx Context value to test.
   * @returns {ctx is WebGLRenderingContext | WebGL2RenderingContext}
   */
  static #isWebGL(ctx) {
    return (
      (typeof WebGLRenderingContext !== "undefined" && ctx instanceof WebGLRenderingContext) ||
      (typeof WebGL2RenderingContext !== "undefined" && ctx instanceof WebGL2RenderingContext)
    );
  }

  /**
   * Returns a new 4x4 identity matrix in column-major order.
   *
   * @private
   * @returns {Float32Array}
   */
  static #identityMatrix() {
    return new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
  }

  /**
   * Multiplies two 4x4 matrices in column-major order.
   *
   * @private
   * @param {ArrayLike<number>} a Left matrix.
   * @param {ArrayLike<number>} b Right matrix.
   * @returns {Float32Array}
   */
  static #multiply4(a, b) {
    const out = new Float32Array(16);

    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

    const b00 = b[0], b01 = b[1], b02 = b[2], b03 = b[3];
    const b10 = b[4], b11 = b[5], b12 = b[6], b13 = b[7];
    const b20 = b[8], b21 = b[9], b22 = b[10], b23 = b[11];
    const b30 = b[12], b31 = b[13], b32 = b[14], b33 = b[15];

    out[0] = a00 * b00 + a10 * b01 + a20 * b02 + a30 * b03;
    out[1] = a01 * b00 + a11 * b01 + a21 * b02 + a31 * b03;
    out[2] = a02 * b00 + a12 * b01 + a22 * b02 + a32 * b03;
    out[3] = a03 * b00 + a13 * b01 + a23 * b02 + a33 * b03;

    out[4] = a00 * b10 + a10 * b11 + a20 * b12 + a30 * b13;
    out[5] = a01 * b10 + a11 * b11 + a21 * b12 + a31 * b13;
    out[6] = a02 * b10 + a12 * b11 + a22 * b12 + a32 * b13;
    out[7] = a03 * b10 + a13 * b11 + a23 * b12 + a33 * b13;

    out[8] = a00 * b20 + a10 * b21 + a20 * b22 + a30 * b23;
    out[9] = a01 * b20 + a11 * b21 + a21 * b22 + a31 * b23;
    out[10] = a02 * b20 + a12 * b21 + a22 * b22 + a32 * b23;
    out[11] = a03 * b20 + a13 * b21 + a23 * b22 + a33 * b23;

    out[12] = a00 * b30 + a10 * b31 + a20 * b32 + a30 * b33;
    out[13] = a01 * b30 + a11 * b31 + a21 * b32 + a31 * b33;
    out[14] = a02 * b30 + a12 * b31 + a22 * b32 + a32 * b33;
    out[15] = a03 * b30 + a13 * b31 + a23 * b32 + a33 * b33;

    return out;
  }

  /**
   * Applies a 4x4 matrix to the top of the internal WebGL matrix stack.
   *
   * @private
   * @param {ArrayLike<number>} matrix Matrix to post-multiply onto the current top matrix.
   * @returns {void}
   */
  static #applyWebGLMatrix(matrix) {
    Transform.#ensureWebGLFrame();
    const topIndex = Transform.#webglMatrixStack.length - 1;
    Transform.#webglMatrixStack[topIndex] = Transform.#multiply4(
      Transform.#webglMatrixStack[topIndex],
      matrix
    );
  }

  /**
   * Ensures the WebGL matrix stack is reset once per rendered frame when
   * automatic per-frame reset is enabled.
   *
   * @private
   * @returns {void}
   */
  static #ensureWebGLFrame() {
    const ctx = Transform.#ctx();
    if (!Transform.#isWebGL(ctx) || !Transform.#resetWebGLMatrixPerFrame) {
      return;
    }

    const frame = typeof Canvex.frameCount === "number" ? Canvex.frameCount : -1;
    if (frame !== Transform.#lastWebGLFrame) {
      Transform.#webglMatrixStack = [Transform.#identityMatrix()];
      Transform.#lastWebGLFrame = frame;
    }
  }

  /**
   * Normalizes an angle according to the current angle mode.
   *
   * All normalized values are returned in radians because both Canvas 2D and
   * the internal WebGL rotation helpers use radians internally.
   *
   * @private
   * @param {number} angle Angle expressed in the current angle mode.
   * @returns {number}
   */
  static #normalizeAngle(angle) {
    const value = Number(angle) || 0;
    return Transform.#angleMode === Transform.DEGREES
      ? math.degrees(value)
      : value;
  }

  /**
   * Returns the current angle mode or applies a new one.
   *
   * @param {"radians" | "degrees"} [mode] New angle mode. Omit the argument to read the current value.
   * @returns {"radians" | "degrees"}
   * @throws {Error} Thrown when the supplied mode is not supported.
   */
  static angleMode(mode) {
    if (typeof mode === "undefined") {
      return Transform.#angleMode;
    }

    const normalized = String(mode).toLowerCase();
    if (normalized !== Transform.RADIANS && normalized !== Transform.DEGREES) {
      throw new Error(`Unsupported angle mode: ${mode}. Use Transform.RADIANS or Transform.DEGREES.`);
    }

    Transform.#angleMode = normalized;
    return Transform.#angleMode;
  }

  /**
   * Returns whether the internal WebGL matrix stack resets automatically once
   * per rendered frame, or updates that behavior.
   *
   * @param {boolean} [enabled] New setting. Omit the argument to read the current value.
   * @returns {boolean}
   */
  static resetMatrixPerFrame(enabled) {
    if (typeof enabled === "undefined") {
      return Transform.#resetWebGLMatrixPerFrame;
    }

    Transform.#resetWebGLMatrixPerFrame = Boolean(enabled);
    return Transform.#resetWebGLMatrixPerFrame;
  }

  /**
   * Applies a transformation matrix to the active context.
   *
   * - Canvas 2D expects a 6-element matrix `[a, b, c, d, e, f]`.
   * - WebGL / WebGL2 expects a 16-element 4x4 matrix in column-major order.
   *
   * @param {number[]} matrix Transformation matrix.
   * @returns {void}
   * @throws {Error} Thrown when the matrix length is invalid or the context type is unsupported.
   */
  static applyMatrix(matrix) {
    const ctx = this.#ctx();

    if (this.#isCanvas2D(ctx)) {
      if (!Array.isArray(matrix) || matrix.length !== 6) {
        throw new Error("Canvas 2D matrices must contain exactly 6 elements.");
      }
      ctx.transform(...matrix);
      return;
    }

    if (this.#isWebGL(ctx)) {
      if (!Array.isArray(matrix) || matrix.length !== 16) {
        throw new Error("WebGL matrices must contain exactly 16 elements.");
      }
      this.#applyWebGLMatrix(matrix);
      return;
    }

    throw new Error("Transform APIs support CanvasRenderingContext2D and WebGL/WebGL2 contexts.");
  }

  /**
   * Saves the current drawing and transform state.
   *
   * Canvas 2D uses the native context stack. WebGL / WebGL2 duplicates the
   * current internal 4x4 matrix and pushes it onto the internal stack.
   *
   * @returns {void}
   */
  static push() {
    const ctx = this.#ctx();

    if (this.#isCanvas2D(ctx)) {
      if (Canvas && typeof Canvas.save === "function") {
        Canvas.save();
      } else {
        ctx.save();
      }
      return;
    }

    if (this.#isWebGL(ctx)) {
      this.#ensureWebGLFrame();
      const top = Transform.#webglMatrixStack[Transform.#webglMatrixStack.length - 1];
      Transform.#webglMatrixStack.push(new Float32Array(top));
      return;
    }

    throw new Error("Transform APIs support CanvasRenderingContext2D and WebGL/WebGL2 contexts.");
  }

  /**
   * Restores the most recently saved drawing and transform state.
   *
   * @returns {void}
   */
  static pop() {
    const ctx = this.#ctx();

    if (this.#isCanvas2D(ctx)) {
      if (Canvas && typeof Canvas.restore === "function") {
        Canvas.restore();
      } else {
        ctx.restore();
      }
      return;
    }

    if (this.#isWebGL(ctx)) {
      this.#ensureWebGLFrame();
      if (Transform.#webglMatrixStack.length > 1) {
        Transform.#webglMatrixStack.pop();
      }
      return;
    }

    throw new Error("Transform APIs support CanvasRenderingContext2D and WebGL/WebGL2 contexts.");
  }

  /**
   * Resets the current transformation matrix to the identity transform.
   *
   * For WebGL / WebGL2, this resets the top of the internal 4x4 matrix stack.
   *
   * @returns {void}
   */
  static resetMatrix() {
    const ctx = this.#ctx();

    if (this.#isCanvas2D(ctx)) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }

    if (this.#isWebGL(ctx)) {
      this.#ensureWebGLFrame();
      Transform.#webglMatrixStack[Transform.#webglMatrixStack.length - 1] = Transform.#identityMatrix();
      return;
    }

    throw new Error("Transform APIs support CanvasRenderingContext2D and WebGL/WebGL2 contexts.");
  }

  /**
   * Translates the current coordinate system.
   *
   * For Canvas 2D, the optional `z` component is ignored.
   * For WebGL / WebGL2, translation is applied to all three axes.
   *
   * @param {number} x Horizontal translation.
   * @param {number} [y=0] Vertical translation.
   * @param {number} [z=0] Depth translation for WebGL / WebGL2.
   * @returns {void}
   */
  static translate(x, y = 0, z = 0) {
    const ctx = this.#ctx();
    const tx = Number(x) || 0;
    const ty = Number(y) || 0;
    const tz = Number(z) || 0;

    if (this.#isCanvas2D(ctx)) {
      ctx.translate(tx, ty);
      return;
    }

    if (this.#isWebGL(ctx)) {
      this.#applyWebGLMatrix([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        tx, ty, tz, 1,
      ]);
      return;
    }

    throw new Error("Transform APIs support CanvasRenderingContext2D and WebGL/WebGL2 contexts.");
  }

  /**
   * Rotates the current coordinate system around the Z axis using the active
   * angle mode.
   *
   * @param {number} angle Angle expressed in the current angle mode.
   * @returns {void}
   */
  static rotate(angle) {
    return this.rotateZ(angle);
  }

  /**
   * Rotates the current coordinate system around the X axis using the active
   * angle mode.
   *
   * Canvas 2D does not support X-axis rotation and will ignore this call.
   *
   * @param {number} angle Angle expressed in the current angle mode.
   * @returns {void}
   */
  static rotateX(angle) {
    const ctx = this.#ctx();
    const radians = this.#normalizeAngle(angle);
    const c = Math.cos(radians);
    const s = Math.sin(radians);

    if (this.#isCanvas2D(ctx)) {
      return;
    }

    if (this.#isWebGL(ctx)) {
      this.#applyWebGLMatrix([
        1, 0, 0, 0,
        0, c, s, 0,
        0, -s, c, 0,
        0, 0, 0, 1,
      ]);
      return;
    }

    throw new Error("Transform APIs support CanvasRenderingContext2D and WebGL/WebGL2 contexts.");
  }

  /**
   * Rotates the current coordinate system around the Y axis using the active
   * angle mode.
   *
   * Canvas 2D does not support Y-axis rotation and will ignore this call.
   *
   * @param {number} angle Angle expressed in the current angle mode.
   * @returns {void}
   */
  static rotateY(angle) {
    const ctx = this.#ctx();
    const radians = this.#normalizeAngle(angle);
    const c = Math.cos(radians);
    const s = Math.sin(radians);

    if (this.#isCanvas2D(ctx)) {
      return;
    }

    if (this.#isWebGL(ctx)) {
      this.#applyWebGLMatrix([
        c, 0, -s, 0,
        0, 1, 0, 0,
        s, 0, c, 0,
        0, 0, 0, 1,
      ]);
      return;
    }

    throw new Error("Transform APIs support CanvasRenderingContext2D and WebGL/WebGL2 contexts.");
  }

  /**
   * Rotates the current coordinate system around the Z axis using the active
   * angle mode.
   *
   * For Canvas 2D, this is equivalent to the native `rotate()` transform.
   *
   * @param {number} angle Angle expressed in the current angle mode.
   * @returns {void}
   */
  static rotateZ(angle) {
    const ctx = this.#ctx();
    const radians = this.#normalizeAngle(angle);
    const c = Math.cos(radians);
    const s = Math.sin(radians);

    if (this.#isCanvas2D(ctx)) {
      ctx.rotate(radians);
      return;
    }

    if (this.#isWebGL(ctx)) {
      this.#applyWebGLMatrix([
        c, s, 0, 0,
        -s, c, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ]);
      return;
    }

    throw new Error("Transform APIs support CanvasRenderingContext2D and WebGL/WebGL2 contexts.");
  }

  /**
   * Rotates explicitly in degrees, regardless of the active angle mode.
   *
   * @param {number} angle Angle in degrees.
   * @returns {void}
   */
  static rotateDegrees(angle) {
    const previousMode = Transform.#angleMode;
    Transform.#angleMode = Transform.DEGREES;
    try {
      this.rotate(angle);
    } finally {
      Transform.#angleMode = previousMode;
    }
  }

  /**
   * Rotates explicitly in radians, regardless of the active angle mode.
   *
   * @param {number} angle Angle in radians.
   * @returns {void}
   */
  static rotateRadians(angle) {
    const previousMode = Transform.#angleMode;
    Transform.#angleMode = Transform.RADIANS;
    try {
      this.rotate(angle);
    } finally {
      Transform.#angleMode = previousMode;
    }
  }

  /**
   * Scales the current coordinate system.
   *
   * When only `x` is supplied, uniform scaling is applied. For WebGL / WebGL2,
   * the optional `z` scale defaults to `1`.
   *
   * @param {number} x Horizontal scale factor.
   * @param {number} [y=x] Vertical scale factor.
   * @param {number} [z=1] Depth scale factor for WebGL / WebGL2.
   * @returns {void}
   */
  static scale(x, y = x, z = 1) {
    const ctx = this.#ctx();
    const sx = Number(x);
    const sy = Number(y);
    const sz = Number(z);
    const nx = Number.isFinite(sx) ? sx : 1;
    const ny = Number.isFinite(sy) ? sy : 1;
    const nz = Number.isFinite(sz) ? sz : 1;

    if (this.#isCanvas2D(ctx)) {
      ctx.scale(nx, ny);
      return;
    }

    if (this.#isWebGL(ctx)) {
      this.#applyWebGLMatrix([
        nx, 0, 0, 0,
        0, ny, 0, 0,
        0, 0, nz, 0,
        0, 0, 0, 1,
      ]);
      return;
    }

    throw new Error("Transform APIs support CanvasRenderingContext2D and WebGL/WebGL2 contexts.");
  }

  /**
   * Skews the current transform along the X axis using the active angle mode.
   *
   * Canvas 2D applies a 2D shear. WebGL / WebGL2 applies a 4x4 shear matrix.
   *
   * @param {number} angle Angle expressed in the current angle mode.
   * @returns {void}
   */
  static shearX(angle) {
    const value = Math.tan(this.#normalizeAngle(angle));
    const ctx = this.#ctx();

    if (this.#isCanvas2D(ctx)) {
      this.applyMatrix([1, 0, value, 1, 0, 0]);
      return;
    }

    if (this.#isWebGL(ctx)) {
      this.applyMatrix([
        1, 0, 0, 0,
        value, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ]);
      return;
    }

    throw new Error("Transform APIs support CanvasRenderingContext2D and WebGL/WebGL2 contexts.");
  }

  /**
   * Skews the current transform along the Y axis using the active angle mode.
   *
   * @param {number} angle Angle expressed in the current angle mode.
   * @returns {void}
   */
  static shearY(angle) {
    const value = Math.tan(this.#normalizeAngle(angle));
    const ctx = this.#ctx();

    if (this.#isCanvas2D(ctx)) {
      this.applyMatrix([1, value, 0, 1, 0, 0]);
      return;
    }

    if (this.#isWebGL(ctx)) {
      this.applyMatrix([
        1, value, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ]);
      return;
    }

    throw new Error("Transform APIs support CanvasRenderingContext2D and WebGL/WebGL2 contexts.");
  }

  /**
   * Rotates around a pivot point using the active angle mode.
   *
   * For WebGL / WebGL2, the pivot is applied in XY space with an optional `z`
   * pivot component.
   *
   * @param {number} angle Angle expressed in the current angle mode.
   * @param {number} x Pivot x-coordinate.
   * @param {number} y Pivot y-coordinate.
   * @param {number} [z=0] Pivot z-coordinate for WebGL / WebGL2.
   * @returns {void}
   */
  static rotateAround(angle, x, y, z = 0) {
    this.translate(x, y, z);
    this.rotate(angle);
    this.translate(-(Number(x) || 0), -(Number(y) || 0), -(Number(z) || 0));
  }

  /**
   * Returns the current internal WebGL / WebGL2 4x4 model matrix.
   *
   * For Canvas 2D, this method returns an identity matrix because the current
   * transform state is managed directly by the native context.
   *
   * @returns {Float32Array}
   */
  static matrix4() {
    const ctx = this.#ctx();

    if (this.#isWebGL(ctx)) {
      this.#ensureWebGLFrame();
      return new Float32Array(Transform.#webglMatrixStack[Transform.#webglMatrixStack.length - 1]);
    }

    return Transform.#identityMatrix();
  }

  /**
   * Returns the current internal WebGL / WebGL2 matrix stack depth.
   *
   * For Canvas 2D, the value is always `0` because the native context manages
   * its own state stack.
   *
   * @returns {number}
   */
  static stackDepth() {
    const ctx = this.#ctx();
    if (this.#isWebGL(ctx)) {
      this.#ensureWebGLFrame();
      return Transform.#webglMatrixStack.length;
    }
    return 0;
  }

  /**
   * Uploads the current WebGL / WebGL2 4x4 transform matrix to a shader uniform.
   *
   * This helper is useful when your shader expects a model or transform matrix,
   * for example `uniform mat4 u_matrix;`.
   *
   * @param {WebGLProgram | null | undefined} [program] Program that owns the target uniform. When omitted, the current program is used if available.
   * @param {string} [uniformName="u_matrix"] Uniform name to update.
   * @param {boolean} [transpose=false] Whether to transpose during upload. This should normally remain `false` in WebGL.
   * @returns {WebGLUniformLocation | null} The resolved uniform location, or `null` when the uniform could not be found.
   * @throws {Error} Thrown when the active context is not WebGL / WebGL2.
   */
  static setMatrixUniform(program, uniformName = "u_matrix", transpose = false) {
    const ctx = this.#ctx();

    if (!this.#isWebGL(ctx)) {
      throw new Error("setMatrixUniform() is only available for WebGL/WebGL2 contexts.");
    }

    this.#ensureWebGLFrame();

    const targetProgram = program || ctx.getParameter(ctx.CURRENT_PROGRAM);
    if (!targetProgram) {
      return null;
    }

    const location = ctx.getUniformLocation(targetProgram, uniformName);
    if (!location) {
      return null;
    }

    ctx.uniformMatrix4fv(location, transpose, Transform.#webglMatrixStack[Transform.#webglMatrixStack.length - 1]);
    return location;
  }
}
