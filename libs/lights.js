import { Canvex } from "./canvex.js";
import { Color } from "./color.js";

/**
 * Lightweight light-state manager for Canvex.
 *
 * The methods in this class mirror familiar sketch-style lighting APIs while
 * remaining renderer-agnostic. Each call stores normalized light definitions in
 * an internal state object that a WebGL renderer or shader pipeline can consume.
 *
 * Notes:
 * - These methods do not implement a full shader pipeline by themselves.
 * - State is mirrored onto `Canvex.canvas.__canvexLights` whenever possible so
 *   render helpers can access the latest lighting configuration.
 */
export const Lights = class {
  /** @type {{ambient: Array<object>, directional: Array<object>, point: Array<object>, spot: Array<object>, image: object | null, panorama: object | null, falloff: {constant:number, linear:number, quadratic:number}, specularColor: number[], enabled: boolean}} */
  static #state = {
    ambient: [],
    directional: [],
    point: [],
    spot: [],
    image: null,
    panorama: null,
    falloff: { constant: 1, linear: 0, quadratic: 0 },
    specularColor: [255, 255, 255],
    enabled: false,
  };

  /**
   * Returns a deep-cloned snapshot of the current lighting state.
   * @returns {{ambient: Array<object>, directional: Array<object>, point: Array<object>, spot: Array<object>, image: object | null, panorama: object | null, falloff: {constant:number, linear:number, quadratic:number}, specularColor: number[], enabled: boolean}}
   */
  static get state() {
    if (typeof structuredClone === "function") {
      return structuredClone(Lights.#state);
    }
    return JSON.parse(JSON.stringify(Lights.#state));
  }

  /**
   * Creates a light that shines from all directions.
   *
   * Supported call patterns:
   * - `ambientLight(gray)`
   * - `ambientLight(r, g, b)`
   * - `ambientLight([r, g, b])`
   * - `ambientLight({ r, g, b })`
   * - `ambientLight(Color.color(...))`
   * - `ambientLight("#ffcc00")`
   *
   * @param {...any} colorArgs Color definition for the ambient light.
   * @returns {{type:"ambient", color:number[], color01:number[]}} The stored ambient-light definition.
   */
  static ambientLight(...colorArgs) {
    const color = Lights.#toColor(...colorArgs);
    const light = {
      type: "ambient",
      color,
      color01: Lights.#toUnitColor(color),
    };

    Lights.#state.ambient.push(light);
    Lights.#state.enabled = true;
    Lights.#syncCanvasState();
    return light;
  }

  /**
   * Creates a light that shines in one direction.
   *
   * Supported call patterns:
   * - `directionalLight(r, g, b, x, y, z)`
   * - `directionalLight(color, x, y, z)`
   * - `directionalLight(Color.color(...), x, y, z)`
   * - `directionalLight(color, [x, y, z])`
   *
   * Direction vectors are normalized before storage.
   *
   * @param {...any} args Color and direction arguments.
   * @returns {{type:"directional", color:number[], color01:number[], direction:number[]}} The stored directional-light definition.
   */
  static directionalLight(...args) {
    const { colorArgs, vectorArgs } = Lights.#splitColorAndVectorArgs(args, 3, [0, 0, -1]);
    const color = Lights.#toColor(...colorArgs);
    const direction = Lights.#normalizeVec3(Lights.#toVec3(...vectorArgs));

    const light = {
      type: "directional",
      color,
      color01: Lights.#toUnitColor(color),
      direction,
    };

    Lights.#state.directional.push(light);
    Lights.#state.enabled = true;
    Lights.#syncCanvasState();
    return light;
  }

  /**
   * Creates an ambient light from an image.
   *
   * The source may be an `HTMLImageElement`, `HTMLCanvasElement`, `ImageBitmap`,
   * `OffscreenCanvas`, a URL string, or any object with a `src` property.
   *
   * @param {HTMLImageElement|HTMLCanvasElement|ImageBitmap|OffscreenCanvas|string|{src:string}} source Environment-image source.
   * @param {{intensity?: number, tint?: any}} [options={}] Optional image-light settings.
   * @param {number} [options.intensity=1] Light intensity multiplier.
   * @param {any} [options.tint=[255,255,255]] Optional tint applied by renderers.
   * @returns {{type:"image", source:any, intensity:number, tint:number[], tint01:number[]}} The stored image-light definition.
   */
  static imageLight(source, options = {}) {
    const intensity = Lights.#toFiniteNumber(options.intensity, 1);
    const tint = Lights.#toColor(options.tint ?? [255, 255, 255]);
    const imageSource = Lights.#coerceSource(source);

    const light = {
      type: "image",
      source: imageSource,
      intensity,
      tint,
      tint01: Lights.#toUnitColor(tint),
    };

    Lights.#state.image = light;
    Lights.#state.enabled = true;
    Lights.#syncCanvasState();
    return light;
  }

  /**
   * Sets the falloff rate for `pointLight()` and `spotLight()`.
   *
   * The stored attenuation follows the common form:
   * `1.0 / (constant + linear * d + quadratic * d^2)`
   *
   * @param {number} [constant=1] Constant attenuation term.
   * @param {number} [linear=0] Linear attenuation term.
   * @param {number} [quadratic=0] Quadratic attenuation term.
   * @returns {{constant:number, linear:number, quadratic:number}} The applied falloff settings.
   */
  static lightFalloff(constant = 1, linear = 0, quadratic = 0) {
    const next = {
      constant: Math.max(0, Lights.#toFiniteNumber(constant, 1)),
      linear: Math.max(0, Lights.#toFiniteNumber(linear, 0)),
      quadratic: Math.max(0, Lights.#toFiniteNumber(quadratic, 0)),
    };

    Lights.#state.falloff = next;
    Lights.#syncCanvasState();
    return { ...next };
  }

  /**
   * Places an ambient and directional light in the scene.
   *
   * This is a convenience helper that clears any previously registered lights
   * and adds a soft gray ambient light plus a front-facing directional light.
   *
   * @returns {{ambient: object, directional: object}} The created default lights.
   */
  static lights() {
    Lights.noLights();
    const ambient = Lights.ambientLight(128, 128, 128);
    const directional = Lights.directionalLight(128, 128, 128, 0, 0, -1);
    return { ambient, directional };
  }

  /**
   * Removes all lights from the sketch.
   *
   * This clears ambient, directional, point, spot, and image-based lights.
   * Panorama state is preserved because it functions as scene background data
   * rather than an emitted light source.
   *
   * @returns {{ambient: Array<object>, directional: Array<object>, point: Array<object>, spot: Array<object>, image: null}} Snapshot of the cleared light collections.
   */
  static noLights() {
    Lights.#state.ambient = [];
    Lights.#state.directional = [];
    Lights.#state.point = [];
    Lights.#state.spot = [];
    Lights.#state.image = null;
    Lights.#state.enabled = false;
    Lights.#syncCanvasState();
    return {
      ambient: [],
      directional: [],
      point: [],
      spot: [],
      image: null,
    };
  }

  /**
   * Creates an immersive 3D background.
   *
   * The source may be an `HTMLImageElement`, `HTMLCanvasElement`, `ImageBitmap`,
   * `OffscreenCanvas`, a URL string, or any object with a `src` property.
   *
   * @param {HTMLImageElement|HTMLCanvasElement|ImageBitmap|OffscreenCanvas|string|{src:string}} source Panorama or environment source.
   * @param {{rotation?: number, exposure?: number, tint?: any}} [options={}] Optional panorama settings.
   * @param {number} [options.rotation=0] Yaw rotation in radians.
   * @param {number} [options.exposure=1] Exposure multiplier.
   * @param {any} [options.tint=[255,255,255]] Optional tint applied by renderers.
   * @returns {{type:"panorama", source:any, rotation:number, exposure:number, tint:number[], tint01:number[]}} The stored panorama definition.
   */
  static panorama(source, options = {}) {
    const rotation = Lights.#toFiniteNumber(options.rotation, 0);
    const exposure = Lights.#toFiniteNumber(options.exposure, 1);
    const tint = Lights.#toColor(options.tint ?? [255, 255, 255]);
    const panorama = {
      type: "panorama",
      source: Lights.#coerceSource(source),
      rotation,
      exposure,
      tint,
      tint01: Lights.#toUnitColor(tint),
    };

    Lights.#state.panorama = panorama;
    Lights.#syncCanvasState();
    return panorama;
  }

  /**
   * Creates a light that shines from a point in all directions.
   *
   * Supported call patterns:
   * - `pointLight(r, g, b, x, y, z)`
   * - `pointLight(color, x, y, z)`
   * - `pointLight(Color.color(...), x, y, z)`
   * - `pointLight(color, [x, y, z])`
   *
   * The current `lightFalloff()` configuration is copied onto the stored light.
   *
   * @param {...any} args Color and position arguments.
   * @returns {{type:"point", color:number[], color01:number[], position:number[], falloff:{constant:number, linear:number, quadratic:number}}} The stored point-light definition.
   */
  static pointLight(...args) {
    const { colorArgs, vectorArgs } = Lights.#splitColorAndVectorArgs(args, 3, [0, 0, 0]);
    const color = Lights.#toColor(...colorArgs);
    const position = Lights.#toVec3(...vectorArgs);

    const light = {
      type: "point",
      color,
      color01: Lights.#toUnitColor(color),
      position,
      falloff: { ...Lights.#state.falloff },
    };

    Lights.#state.point.push(light);
    Lights.#state.enabled = true;
    Lights.#syncCanvasState();
    return light;
  }

  /**
   * Sets the specular color for lights.
   *
   * Supported call patterns:
   * - `specularColor(gray)`
   * - `specularColor(r, g, b)`
   * - `specularColor([r, g, b])`
   * - `specularColor(Color.color(...))`
   * - `specularColor("#ffffff")`
   *
   * @param {...any} colorArgs Specular color definition.
   * @returns {number[]} The applied RGB color in 0-255 space.
   */
  static specularColor(...colorArgs) {
    const color = Lights.#toColor(...colorArgs);
    Lights.#state.specularColor = color;
    Lights.#syncCanvasState();
    return [...color];
  }

  /**
   * Creates a light that shines from a point in one direction.
   *
   * Supported call patterns:
   * - `spotLight(r, g, b, px, py, pz, dx, dy, dz, angle, concentration)`
   * - `spotLight(color, px, py, pz, dx, dy, dz, angle, concentration)`
   * - `spotLight(Color.color(...), px, py, pz, dx, dy, dz, angle, concentration)`
   * - `spotLight(color, [px, py, pz], [dx, dy, dz], angle, concentration)`
   *
   * Direction vectors are normalized before storage. The current
   * `lightFalloff()` configuration is copied onto the stored light.
   *
   * @param {...any} args Color, position, direction, angle, and concentration arguments.
   * @returns {{type:"spot", color:number[], color01:number[], position:number[], direction:number[], angle:number, concentration:number, falloff:{constant:number, linear:number, quadratic:number}}} The stored spot-light definition.
   */
  static spotLight(...args) {
    const parsed = Lights.#parseSpotLightArgs(args);
    const color = Lights.#toColor(...parsed.colorArgs);
    const position = Lights.#toVec3(...parsed.positionArgs);
    const direction = Lights.#normalizeVec3(Lights.#toVec3(...parsed.directionArgs));
    const angle = Math.max(0, Lights.#toFiniteNumber(parsed.angle, Math.PI / 3));
    const concentration = Math.max(0, Lights.#toFiniteNumber(parsed.concentration, 100));

    const light = {
      type: "spot",
      color,
      color01: Lights.#toUnitColor(color),
      position,
      direction,
      angle,
      concentration,
      falloff: { ...Lights.#state.falloff },
    };

    Lights.#state.spot.push(light);
    Lights.#state.enabled = true;
    Lights.#syncCanvasState();
    return light;
  }

  /**
   * Mirrors the latest light state onto the managed Canvex canvas.
   * @private
   * @returns {void}
   */
  static #syncCanvasState() {
    const canvas = Canvex?.canvas;
    if (!canvas) {
      return;
    }
    canvas.__canvexLights = Lights.state;
  }

  /**
   * Converts a color definition into `[r, g, b]` values in the range 0-255.
   * Supports plain objects, CSS strings, channel arrays, and Color.color(...)
   * output objects with `{ r, g, b, a }`.
   *
   * @private
   * @param {...any} args Color arguments.
   * @returns {number[]}
   */
  static #toColor(...args) {
    const flattened = args.length === 1 ? args[0] : args;

    if (Lights.#isColorObject(flattened)) {
      return [
        Lights.#clamp255(flattened.r),
        Lights.#clamp255(flattened.g),
        Lights.#clamp255(flattened.b),
      ];
    }

    if (Array.isArray(flattened)) {
      if (flattened.length === 0) {
        return [255, 255, 255];
      }

      if (flattened.length === 1) {
        const one = flattened[0];
        if (Lights.#isColorObject(one)) {
          return [
            Lights.#clamp255(one.r),
            Lights.#clamp255(one.g),
            Lights.#clamp255(one.b),
          ];
        }
        const v = Lights.#clamp255(one);
        return [v, v, v];
      }

      if (flattened.length >= 3 && flattened.slice(0, 3).every((value) => typeof value === "number")) {
        return [
          Lights.#clamp255(flattened[0]),
          Lights.#clamp255(flattened[1]),
          Lights.#clamp255(flattened[2]),
        ];
      }
    }

    if (typeof flattened === "number") {
      const v = Lights.#clamp255(flattened);
      return [v, v, v];
    }

    if (typeof flattened === "string") {
      const parsed = Lights.#parseCssColor(flattened);
      if (parsed) {
        return parsed;
      }
    }

    if (flattened && typeof flattened === "object") {
      if ("levels" in flattened && Array.isArray(flattened.levels)) {
        return Lights.#toColor(flattened.levels);
      }

      if ("r" in flattened || "g" in flattened || "b" in flattened) {
        return [
          Lights.#clamp255(flattened.r ?? 0),
          Lights.#clamp255(flattened.g ?? flattened.r ?? 0),
          Lights.#clamp255(flattened.b ?? flattened.r ?? 0),
        ];
      }
    }

    if (args.length >= 1) {
      try {
        const normalized = typeof Color?.color === "function"
          ? Color.color(...args)
          : null;
        if (Lights.#isColorObject(normalized)) {
          return [
            Lights.#clamp255(normalized.r),
            Lights.#clamp255(normalized.g),
            Lights.#clamp255(normalized.b),
          ];
        }
      } catch (error) {
        // Fall through to numeric handling/default color.
      }
    }

    if (args.length >= 3 && args.slice(0, 3).every((value) => typeof value === "number")) {
      return [
        Lights.#clamp255(args[0]),
        Lights.#clamp255(args[1]),
        Lights.#clamp255(args[2]),
      ];
    }

    return [255, 255, 255];
  }

  /**
   * Splits mixed color/vector arguments into separate collections.
   * @private
   * @param {any[]} args Raw user arguments.
   * @param {number} vectorSize Number of vector components expected.
   * @param {number[]} fallbackVector Fallback vector.
   * @returns {{colorArgs:any[], vectorArgs:any[]}}
   */
  static #splitColorAndVectorArgs(args, vectorSize, fallbackVector) {
    if (args.length === 0) {
      return { colorArgs: [[255, 255, 255]], vectorArgs: fallbackVector };
    }

    if (args.length === 2 && (Array.isArray(args[1]) || Lights.#isVecLikeObject(args[1]))) {
      return { colorArgs: [args[0]], vectorArgs: args[1] };
    }

    if (args.length === vectorSize + 1) {
      return { colorArgs: [args[0]], vectorArgs: args.slice(1) };
    }

    if (args.length >= vectorSize + 3 && args.slice(0, 3).every((value) => typeof value === "number")) {
      return { colorArgs: args.slice(0, 3), vectorArgs: args.slice(3, 3 + vectorSize) };
    }

    if (args.length >= vectorSize) {
      return { colorArgs: [args[0]], vectorArgs: args.slice(1, 1 + vectorSize) };
    }

    return { colorArgs: args, vectorArgs: fallbackVector };
  }

  /**
   * Parses spot-light arguments into a consistent structure.
   * @private
   * @param {any[]} args Raw user arguments.
   * @returns {{colorArgs:any[], positionArgs:any, directionArgs:any, angle:any, concentration:any}}
   */
  static #parseSpotLightArgs(args) {
    if (args.length === 0) {
      return {
        colorArgs: [[255, 255, 255]],
        positionArgs: [0, 0, 0],
        directionArgs: [0, 0, -1],
        angle: Math.PI / 3,
        concentration: 100,
      };
    }

    if (
      args.length >= 5 &&
      (Array.isArray(args[1]) || Lights.#isVecLikeObject(args[1])) &&
      (Array.isArray(args[2]) || Lights.#isVecLikeObject(args[2]))
    ) {
      return {
        colorArgs: [args[0]],
        positionArgs: args[1],
        directionArgs: args[2],
        angle: args[3],
        concentration: args[4],
      };
    }

    if (args.length >= 9 && !args.slice(0, 3).every((value) => typeof value === "number")) {
      return {
        colorArgs: [args[0]],
        positionArgs: args.slice(1, 4),
        directionArgs: args.slice(4, 7),
        angle: args[7],
        concentration: args[8],
      };
    }

    if (args.length >= 11 && args.slice(0, 3).every((value) => typeof value === "number")) {
      return {
        colorArgs: args.slice(0, 3),
        positionArgs: args.slice(3, 6),
        directionArgs: args.slice(6, 9),
        angle: args[9],
        concentration: args[10],
      };
    }

    return {
      colorArgs: [args[0]],
      positionArgs: args[1] ?? [0, 0, 0],
      directionArgs: args[2] ?? [0, 0, -1],
      angle: args[3],
      concentration: args[4],
    };
  }

  /**
   * Converts vector-like input into a 3D vector.
   * @private
   * @param {...any} args Vector arguments.
   * @returns {number[]}
   */
  static #toVec3(...args) {
    const flattened = args.length === 1 ? args[0] : args;

    if (Array.isArray(flattened)) {
      return [
        Lights.#toFiniteNumber(flattened[0], 0),
        Lights.#toFiniteNumber(flattened[1], 0),
        Lights.#toFiniteNumber(flattened[2], 0),
      ];
    }

    if (flattened && typeof flattened === "object") {
      return [
        Lights.#toFiniteNumber(flattened.x, 0),
        Lights.#toFiniteNumber(flattened.y, 0),
        Lights.#toFiniteNumber(flattened.z, 0),
      ];
    }

    return [
      Lights.#toFiniteNumber(args[0], 0),
      Lights.#toFiniteNumber(args[1], 0),
      Lights.#toFiniteNumber(args[2], 0),
    ];
  }

  /**
   * Normalizes a 3D vector.
   * @private
   * @param {number[]} vec Vector to normalize.
   * @returns {number[]}
   */
  static #normalizeVec3(vec) {
    const length = Math.hypot(vec[0], vec[1], vec[2]);
    if (length <= 0.000001) {
      return [0, 0, -1];
    }
    return [vec[0] / length, vec[1] / length, vec[2] / length];
  }

  /**
   * Converts a 0-255 RGB color to a 0-1 RGB color.
   * @private
   * @param {number[]} color RGB color in 0-255 space.
   * @returns {number[]}
   */
  static #toUnitColor(color) {
    return [color[0] / 255, color[1] / 255, color[2] / 255];
  }

  /**
   * Returns whether a value looks like a normalized Color.color(...) object.
   * @private
   * @param {any} value Candidate color.
   * @returns {boolean}
   */
  static #isColorObject(value) {
    return Boolean(value)
      && typeof value === "object"
      && !Array.isArray(value)
      && ("r" in value || "g" in value || "b" in value);
  }

  /**
   * Parses CSS color strings into RGB arrays.
   * @private
   * @param {string} value CSS color string.
   * @returns {number[] | null}
   */
  static #parseCssColor(value) {
    if (typeof document === "undefined") {
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }

    ctx.fillStyle = "#000";
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return [data[0], data[1], data[2]];
  }

  /**
   * Converts an arbitrary source into a renderer-friendly image source.
   * @private
   * @param {any} source Image or URL source.
   * @returns {any}
   */
  static #coerceSource(source) {
    if (typeof source === "string") {
      if (typeof Image !== "undefined") {
        const img = new Image();
        img.src = source;
        return img;
      }
      return { src: source };
    }

    if (source && typeof source === "object" && "src" in source) {
      return source;
    }

    return source ?? null;
  }

  /**
   * Returns whether a value looks like a `{x, y, z}` vector object.
   * @private
   * @param {any} value Candidate value.
   * @returns {boolean}
   */
  static #isVecLikeObject(value) {
    return Boolean(value)
      && typeof value === "object"
      && ("x" in value || "y" in value || "z" in value);
  }

  /**
   * Coerces a value to a finite number with fallback.
   * @private
   * @param {any} value Input value.
   * @param {number} fallback Fallback number.
   * @returns {number}
   */
  static #toFiniteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  /**
   * Clamps a channel value to the 0-255 range.
   * @private
   * @param {any} value Channel value.
   * @returns {number}
   */
  static #clamp255(value) {
    return Math.max(0, Math.min(255, Math.round(Lights.#toFiniteNumber(value, 0))));
  }
};
