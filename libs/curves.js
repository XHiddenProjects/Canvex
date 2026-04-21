import { Canvex } from "./canvex.js";

/**
 * Curve helpers for the active Canvex rendering context.
 *
 * Supported features:
 * - Canvas 2D drawing for Bézier and Catmull-Rom spline segments.
 * - WebGL / WebGL2 drawing by sampling curves into line strips.
 * - Optional z coordinates for 3D-style calls.
 * - Interpolation helpers for retrieving points and tangents along curves.
 *
 * Notes:
 * - Drawing methods support CanvasRenderingContext2D, WebGLRenderingContext,
 *   and WebGL2RenderingContext.
 * - In Canvas 2D mode, z coordinates are accepted for API compatibility but
 *   are ignored during rasterization.
 * - In WebGL / WebGL2 mode, z coordinates are uploaded when the active shader
 *   exposes a_position as vec3/vec4. When a_position is vec2, z values are
 *   ignored and the curves render in the x/y plane.
 * - Bézier and spline drawing in WebGL / WebGL2 is approximated with sampled
 *   line strips. Increase the detail argument for smoother curves.
 */
export const Curves = class {
  /** @type {number} */
  static DEFAULT_DETAIL = 24;

  /**
   * Resolves the active rendering context from Canvex.
   *
   * Lookup order:
   * - Canvex.ctx
   * - Canvex.canvas.getContext("2d") when a canvas exists
   *
   * @returns {CanvasRenderingContext2D | WebGLRenderingContext | WebGL2RenderingContext}
   * @throws {Error} When no active rendering context is available.
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
      "Curves requires an active Canvex rendering context. Initialize Canvex before calling Curves methods."
    );
  }

  /**
   * Determines whether a value is a Canvas 2D rendering context.
   * @param {*} ctx
   * @returns {boolean}
   */
  static #isCanvas2D(ctx) {
    return typeof CanvasRenderingContext2D !== "undefined" && ctx instanceof CanvasRenderingContext2D;
  }

  /**
   * Determines whether a value is a WebGL or WebGL2 rendering context.
   * @param {*} ctx
   * @returns {boolean}
   */
  static #isWebGL(ctx) {
    const hasWebGL1 = typeof WebGLRenderingContext !== "undefined" && ctx instanceof WebGLRenderingContext;
    const hasWebGL2 = typeof WebGL2RenderingContext !== "undefined" && ctx instanceof WebGL2RenderingContext;
    return hasWebGL1 || hasWebGL2;
  }

  /**
   * Ensures that all provided values are finite numbers.
   * @param {string} label
   * @param {number[]} values
   * @returns {void}
   * @throws {TypeError}
   */
  static #assertFiniteNumbers(label, values) {
    for (const value of values) {
      if (!Number.isFinite(value)) {
        throw new TypeError(`${label} must be finite numbers`);
      }
    }
  }

  /**
   * Ensures the provided rendering context is supported.
   * @param {*} ctx
   * @returns {void}
   * @throws {TypeError}
   */
  static #assertSupportedContext(ctx) {
    if (!this.#isCanvas2D(ctx) && !this.#isWebGL(ctx)) {
      throw new TypeError(
        "Unsupported rendering context. Expected CanvasRenderingContext2D, WebGLRenderingContext, or WebGL2RenderingContext."
      );
    }
  }

  /**
   * Clamps an interpolation amount to the [0, 1] range.
   * @param {number} t
   * @returns {number}
   */
  static #clampUnit(t) {
    return Math.max(0, Math.min(1, Number(t)));
  }

  /**
   * Normalizes the requested sampling detail.
   * @param {number | undefined} detail
   * @returns {number}
   */
  static #detail(detail) {
    if (typeof detail === "undefined") return Curves.DEFAULT_DETAIL;
    if (!Number.isFinite(detail)) {
      throw new TypeError("detail must be a finite number");
    }
    return Math.max(2, Math.floor(detail));
  }

  /**
   * Returns the declared component count for the active a_position attribute.
   * @param {WebGLRenderingContext | WebGL2RenderingContext} gl
   * @param {WebGLProgram} program
   * @returns {number}
   */
  static #positionAttributeSize(gl, program) {
    const attributeCount = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES) || 0;
    for (let i = 0; i < attributeCount; i += 1) {
      const info = gl.getActiveAttrib(program, i);
      if (!info) continue;
      const name = info.name === "a_position[0]" ? "a_position" : info.name;
      if (name !== "a_position") continue;
      if (info.type === gl.FLOAT_VEC4) return 4;
      if (info.type === gl.FLOAT_VEC3) return 3;
      return 2;
    }
    return 2;
  }

  /**
   * Uploads a list of points and renders them as a WebGL line strip.
   * The active shader program must expose an attribute named a_position.
   *
   * @param {WebGLRenderingContext | WebGL2RenderingContext} gl
   * @param {{x:number, y:number, z:number}[]} points
   * @param {boolean} wants3D When true, z values are uploaded if supported.
   * @returns {void}
   */
  static #drawLineStrip(gl, points, wants3D = false) {
    const program = gl.getParameter(gl.CURRENT_PROGRAM);
    if (!program) {
      throw new Error(
        "WebGL drawing requires an active shader program. Call gl.useProgram(program) before Curves methods."
      );
    }

    const positionLocation = gl.getAttribLocation(program, "a_position");
    if (positionLocation < 0) {
      throw new Error("The active shader program must define an a_position attribute.");
    }

    const declaredSize = this.#positionAttributeSize(gl, program);
    const componentSize = wants3D && declaredSize >= 3 ? 3 : 2;

    const vertices = [];
    for (const point of points) {
      vertices.push(point.x, point.y);
      if (componentSize === 3) {
        vertices.push(point.z ?? 0);
      }
    }

    const buffer = gl.createBuffer();
    if (!buffer) {
      throw new Error("Failed to create a WebGL buffer.");
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, componentSize, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINE_STRIP, 0, points.length);
    gl.deleteBuffer(buffer);
  }

  /**
   * Parses overloaded Bézier arguments.
   * Supported signatures:
   * - bezier(x1, y1, x2, y2, x3, y3, x4, y4, [detail])
   * - bezier(x1, y1, z1, x2, y2, z2, x3, y3, z3, x4, y4, z4, [detail])
   *
   * @param {IArguments | Array<*>} argsLike
   * @returns {{detail:number, wants3D:boolean, points:{x:number,y:number,z:number}[]}}
   */
  static #parseBezierArgs(argsLike) {
    const args = Array.from(argsLike);

    if (args.length === 8 || args.length === 9) {
      const detail = this.#detail(args[8]);
      const points = [
        { x: Number(args[0]), y: Number(args[1]), z: 0 },
        { x: Number(args[2]), y: Number(args[3]), z: 0 },
        { x: Number(args[4]), y: Number(args[5]), z: 0 },
        { x: Number(args[6]), y: Number(args[7]), z: 0 }
      ];
      this.#assertFiniteNumbers(
        "Bezier values",
        [...points.flatMap((point) => [point.x, point.y]), detail]
      );
      return { detail, wants3D: false, points };
    }

    if (args.length === 12 || args.length === 13) {
      const detail = this.#detail(args[12]);
      const points = [
        { x: Number(args[0]), y: Number(args[1]), z: Number(args[2]) },
        { x: Number(args[3]), y: Number(args[4]), z: Number(args[5]) },
        { x: Number(args[6]), y: Number(args[7]), z: Number(args[8]) },
        { x: Number(args[9]), y: Number(args[10]), z: Number(args[11]) }
      ];
      this.#assertFiniteNumbers(
        "Bezier values",
        [...points.flatMap((point) => [point.x, point.y, point.z]), detail]
      );
      return { detail, wants3D: true, points };
    }

    throw new TypeError(
      "bezier() expects 8 or 9 arguments for 2D, or 12 or 13 arguments for 3D xyz control points."
    );
  }

  /**
   * Parses overloaded spline arguments.
   * Supported signatures:
   * - spline(x1, y1, x2, y2, x3, y3, x4, y4, [detail])
   * - spline(x1, y1, z1, x2, y2, z2, x3, y3, z3, x4, y4, z4, [detail])
   *
   * @param {IArguments | Array<*>} argsLike
   * @returns {{detail:number, wants3D:boolean, points:{x:number,y:number,z:number}[]}}
   */
  static #parseSplineArgs(argsLike) {
    const args = Array.from(argsLike);

    if (args.length === 8 || args.length === 9) {
      const detail = this.#detail(args[8]);
      const points = [
        { x: Number(args[0]), y: Number(args[1]), z: 0 },
        { x: Number(args[2]), y: Number(args[3]), z: 0 },
        { x: Number(args[4]), y: Number(args[5]), z: 0 },
        { x: Number(args[6]), y: Number(args[7]), z: 0 }
      ];
      this.#assertFiniteNumbers(
        "Spline values",
        [...points.flatMap((point) => [point.x, point.y]), detail]
      );
      return { detail, wants3D: false, points };
    }

    if (args.length === 12 || args.length === 13) {
      const detail = this.#detail(args[12]);
      const points = [
        { x: Number(args[0]), y: Number(args[1]), z: Number(args[2]) },
        { x: Number(args[3]), y: Number(args[4]), z: Number(args[5]) },
        { x: Number(args[6]), y: Number(args[7]), z: Number(args[8]) },
        { x: Number(args[9]), y: Number(args[10]), z: Number(args[11]) }
      ];
      this.#assertFiniteNumbers(
        "Spline values",
        [...points.flatMap((point) => [point.x, point.y, point.z]), detail]
      );
      return { detail, wants3D: true, points };
    }

    throw new TypeError(
      "spline() expects 8 or 9 arguments for 2D, or 12 or 13 arguments for 3D xyz control points."
    );
  }

  /**
   * Returns cubic Bézier control points equivalent to a uniform Catmull-Rom segment.
   * The resulting cubic runs from P1 to P2.
   *
   * @param {{x:number, y:number, z:number}} p0
   * @param {{x:number, y:number, z:number}} p1
   * @param {{x:number, y:number, z:number}} p2
   * @param {{x:number, y:number, z:number}} p3
   * @returns {{cp1:{x:number,y:number,z:number}, cp2:{x:number,y:number,z:number}}}
   */
  static #splineBezierControls(p0, p1, p2, p3) {
    return {
      cp1: {
        x: p1.x + (p2.x - p0.x) / 6,
        y: p1.y + (p2.y - p0.y) / 6,
        z: p1.z + (p2.z - p0.z) / 6
      },
      cp2: {
        x: p2.x - (p3.x - p1.x) / 6,
        y: p2.y - (p3.y - p1.y) / 6,
        z: p2.z - (p3.z - p1.z) / 6
      }
    };
  }

  /**
   * Draws a cubic Bézier curve.
   *
   * Supported signatures:
   * - bezier(x1, y1, x2, y2, x3, y3, x4, y4, [detail])
   * - bezier(x1, y1, z1, x2, y2, z2, x3, y3, z3, x4, y4, z4, [detail])
   *
   * In Canvas 2D mode, z values are ignored. In WebGL / WebGL2 mode, z values
   * are uploaded when the active shader accepts a vec3/vec4 a_position.
   *
   * @returns {void}
   */
  static bezier() {
    const { detail, wants3D, points } = this.#parseBezierArgs(arguments);
    const ctx = this.#ctx();
    this.#assertSupportedContext(ctx);

    const [p0, p1, p2, p3] = points;

    if (this.#isCanvas2D(ctx)) {
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
      ctx.fill()
      ctx.stroke();
      return;
    }

    const sampled = [];
    for (let i = 0; i <= detail; i += 1) {
      const t = i / detail;
      sampled.push({
        x: this.bezierPoint(p0.x, p1.x, p2.x, p3.x, t),
        y: this.bezierPoint(p0.y, p1.y, p2.y, p3.y, t),
        z: wants3D ? this.bezierPoint(p0.z, p1.z, p2.z, p3.z, t) : 0
      });
    }
    this.#drawLineStrip(ctx, sampled, wants3D);
  }

  /**
   * Calculates a coordinate along a cubic Bézier curve.
   *
   * Pass x, y, or z control values to sample that axis.
   *
   * @param {number} a Start value.
   * @param {number} b First control value.
   * @param {number} c Second control value.
   * @param {number} d End value.
   * @param {number} t Interpolation amount from 0 to 1.
   * @returns {number}
   */
  static bezierPoint(a, b, c, d, t) {
    this.#assertFiniteNumbers("Bezier point values", [a, b, c, d, t]);

    const u = this.#clampUnit(t);
    const mt = 1 - u;

    return (
      mt * mt * mt * a +
      3 * mt * mt * u * b +
      3 * mt * u * u * c +
      u * u * u * d
    );
  }

  /**
   * Calculates the tangent (derivative) along a cubic Bézier curve.
   *
   * Pass x, y, or z control values to sample that axis.
   *
   * @param {number} a Start value.
   * @param {number} b First control value.
   * @param {number} c Second control value.
   * @param {number} d End value.
   * @param {number} t Interpolation amount from 0 to 1.
   * @returns {number}
   */
  static bezierTangent(a, b, c, d, t) {
    this.#assertFiniteNumbers("Bezier tangent values", [a, b, c, d, t]);

    const u = this.#clampUnit(t);
    const mt = 1 - u;

    return (
      3 * mt * mt * (b - a) +
      6 * mt * u * (c - b) +
      3 * u * u * (d - c)
    );
  }

  /**
   * Draws a uniform Catmull-Rom spline segment from the second point to the third point.
   *
   * Supported signatures:
   * - spline(x1, y1, x2, y2, x3, y3, x4, y4, [detail])
   * - spline(x1, y1, z1, x2, y2, z2, x3, y3, z3, x4, y4, z4, [detail])
   *
   * In Canvas 2D mode, z values are ignored. In WebGL / WebGL2 mode, z values
   * are uploaded when the active shader accepts a vec3/vec4 a_position.
   *
   * @returns {void}
   */
  static spline() {
    const { detail, wants3D, points } = this.#parseSplineArgs(arguments);
    const ctx = this.#ctx();
    this.#assertSupportedContext(ctx);

    const [p0, p1, p2, p3] = points;

    if (this.#isCanvas2D(ctx)) {
      const controls = this.#splineBezierControls(p0, p1, p2, p3);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.bezierCurveTo(controls.cp1.x, controls.cp1.y, controls.cp2.x, controls.cp2.y, p2.x, p2.y);
      ctx.stroke();
      return;
    }

    const sampled = [];
    for (let i = 0; i <= detail; i += 1) {
      const t = i / detail;
      sampled.push({
        x: this.splinePoint(p0.x, p1.x, p2.x, p3.x, t),
        y: this.splinePoint(p0.y, p1.y, p2.y, p3.y, t),
        z: wants3D ? this.splinePoint(p0.z, p1.z, p2.z, p3.z, t) : 0
      });
    }
    this.#drawLineStrip(ctx, sampled, wants3D);
  }

  /**
   * Calculates a coordinate along a uniform Catmull-Rom spline segment.
   * The segment runs from the second value to the third value.
   *
   * Pass x, y, or z control values to sample that axis.
   *
   * @param {number} a Previous value.
   * @param {number} b Segment start value.
   * @param {number} c Segment end value.
   * @param {number} d Next value.
   * @param {number} t Interpolation amount from 0 to 1.
   * @returns {number}
   */
  static splinePoint(a, b, c, d, t) {
    this.#assertFiniteNumbers("Spline point values", [a, b, c, d, t]);

    const u = this.#clampUnit(t);
    const u2 = u * u;
    const u3 = u2 * u;

    return 0.5 * (
      (2 * b) +
      (-a + c) * u +
      (2 * a - 5 * b + 4 * c - d) * u2 +
      (-a + 3 * b - 3 * c + d) * u3
    );
  }

  /**
   * Calculates the tangent (derivative) along a uniform Catmull-Rom spline segment.
   * The segment runs from the second value to the third value.
   *
   * Pass x, y, or z control values to sample that axis.
   *
   * @param {number} a Previous value.
   * @param {number} b Segment start value.
   * @param {number} c Segment end value.
   * @param {number} d Next value.
   * @param {number} t Interpolation amount from 0 to 1.
   * @returns {number}
   */
  static splineTangent(a, b, c, d, t) {
    this.#assertFiniteNumbers("Spline tangent values", [a, b, c, d, t]);

    const u = this.#clampUnit(t);
    const u2 = u * u;

    return 0.5 * (
      (-a + c) +
      2 * (2 * a - 5 * b + 4 * c - d) * u +
      3 * (-a + 3 * b - 3 * c + d) * u2
    );
  }
};
