import { Canvex } from "./canvex.js";

export const Materials = class {
  // ---------------------------------------------------------------------------
  // Public constants
  // ---------------------------------------------------------------------------
  static NORMAL = "normal";
  static IMAGE = "image";

  static CLAMP = "clamp";
  static REPEAT = "repeat";
  static MIRROR = "mirror";

  // ---------------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------------
  static #state = {
    ambient: [1, 1, 1, 1],
    emissive: [0, 0, 0, 1],
    specular: [1, 1, 1, 1],
    metalness: 0,
    shininess: 1,
    materialMode: null,

    texture: null,
    textureMode: 'normal',
    textureWrapS: 'clamp',
    textureWrapT: 'clamp',

    activeShader: null,
    activeImageShader: null,
    activeStrokeShader: null
  };

  static #cssColorCtx = null;
  static #sourceTextureCache = new WeakMap();

  static #defaultFilterVertexSource = `
attribute vec2 aPosition;
attribute vec2 aTexCoord;

varying vec2 vTexCoord;

void main() {
  vTexCoord = aTexCoord;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

  // ---------------------------------------------------------------------------
  // Context helpers
  // ---------------------------------------------------------------------------
  static #ctx() {
    const ctx = Canvex?.ctx ?? null;
    if (!ctx) {
      throw new Error("Materials requires an active Canvex rendering context.");
    }
    if (!this.#isWebGLContext(ctx)) {
      throw new Error("Materials APIs require an active WebGL/WebGL2 context.");
    }
    return ctx;
  }

  static #isWebGLContext(ctx) {
    const isWebGL1 =
      typeof WebGLRenderingContext !== "undefined" &&
      ctx instanceof WebGLRenderingContext;

    const isWebGL2 =
      typeof WebGL2RenderingContext !== "undefined" &&
      ctx instanceof WebGL2RenderingContext;

    return isWebGL1 || isWebGL2;
  }

  static #glEnumForShaderType(gl, type) {
    const normalized = String(type).toLowerCase();
    if (normalized === "vertex" || normalized === "vert") return gl.VERTEX_SHADER;
    if (normalized === "fragment" || normalized === "frag") return gl.FRAGMENT_SHADER;
    throw new TypeError('Shader type must be "vertex" or "fragment".');
  }

  static #compileShader(gl, type, source) {
    if (typeof source !== "string" || !source.trim()) {
      throw new TypeError("Shader source must be a non-empty string.");
    }

    const shaderType = this.#glEnumForShaderType(gl, type);
    const shader = gl.createShader(shaderType);
    if (!shader) {
      throw new Error("Failed to allocate shader.");
    }

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) || "Unknown shader compile error.";
      gl.deleteShader(shader);
      throw new Error(log);
    }

    return shader;
  }

  static #linkProgram(gl, vertexShader, fragmentShader) {
    const program = gl.createProgram();
    if (!program) {
      throw new Error("Failed to allocate shader program.");
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) || "Unknown shader link error.";
      gl.deleteProgram(program);
      throw new Error(log);
    }

    return program;
  }

  static #buildShaderHandle(gl, program, vertexSource, fragmentSource) {
    const shader = {
      gl,
      program,
      vertexSource,
      fragmentSource,

      use() {
        gl.useProgram(program);
        return shader;
      },

      unuse() {
        gl.useProgram(null);
        return shader;
      },

      uniformLocation(name) {
        return gl.getUniformLocation(program, name);
      },

      attribLocation(name) {
        return gl.getAttribLocation(program, name);
      },

      setUniform(name, value) {
        const location = gl.getUniformLocation(program, name);
        if (location == null) return shader;
        Materials.#setUniformValue(gl, location, value);
        return shader;
      },

      destroy() {
        if (gl.isProgram(program)) {
          gl.deleteProgram(program);
        }
      }
    };

    return shader;
  }

  static #setUniformValue(gl, location, value) {
    if (typeof value === "number") {
      if (Number.isInteger(value)) gl.uniform1i(location, value);
      else gl.uniform1f(location, value);
      return;
    }

    if (typeof value === "boolean") {
      gl.uniform1i(location, value ? 1 : 0);
      return;
    }

    if (value instanceof WebGLTexture) {
      // The caller still needs to bind/activate the texture unit explicitly.
      return;
    }

    if (Array.isArray(value) || ArrayBuffer.isView(value)) {
      const length = value.length;

      if (length === 1) {
        gl.uniform1fv(location, value);
        return;
      }
      if (length === 2) {
        gl.uniform2fv(location, value);
        return;
      }
      if (length === 3) {
        gl.uniform3fv(location, value);
        return;
      }
      if (length === 4) {
        gl.uniform4fv(location, value);
        return;
      }
      if (length === 9) {
        gl.uniformMatrix3fv(location, false, value);
        return;
      }
      if (length === 16) {
        gl.uniformMatrix4fv(location, false, value);
        return;
      }
    }

    if (value && typeof value === "object") {
      if ("x" in value && "y" in value && "z" in value && "w" in value) {
        gl.uniform4f(location, value.x, value.y, value.z, value.w);
        return;
      }
      if ("x" in value && "y" in value && "z" in value) {
        gl.uniform3f(location, value.x, value.y, value.z);
        return;
      }
      if ("x" in value && "y" in value) {
        gl.uniform2f(location, value.x, value.y);
        return;
      }
    }

    throw new TypeError("Unsupported uniform value.");
  }

  // ---------------------------------------------------------------------------
  // Color helpers
  // ---------------------------------------------------------------------------
  static #getCssColorContext() {
    if (
      this.#cssColorCtx &&
      typeof CanvasRenderingContext2D !== "undefined" &&
      this.#cssColorCtx instanceof CanvasRenderingContext2D
    ) {
      return this.#cssColorCtx;
    }

    if (typeof document === "undefined") {
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    this.#cssColorCtx = canvas.getContext("2d");
    return this.#cssColorCtx;
  }

  static #clamp01(value) {
    return Math.min(1, Math.max(0, Number(value) || 0));
  }

  static #toUnit(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return n > 1 ? this.#clamp01(n / 255) : this.#clamp01(n);
  }

  static #cssStringToRgba(css) {
    const ctx = this.#getCssColorContext();
    if (!ctx) return [1, 1, 1, 1];

    ctx.fillStyle = "#000";
    ctx.fillStyle = String(css);

    const resolved = String(ctx.fillStyle).trim();

    if (resolved.startsWith("#")) {
      const hex = resolved.slice(1);
      if (hex.length === 3) {
        const r = parseInt(hex[0] + hex[0], 16) / 255;
        const g = parseInt(hex[1] + hex[1], 16) / 255;
        const b = parseInt(hex[2] + hex[2], 16) / 255;
        return [r, g, b, 1];
      }
      if (hex.length === 4) {
        const r = parseInt(hex[0] + hex[0], 16) / 255;
        const g = parseInt(hex[1] + hex[1], 16) / 255;
        const b = parseInt(hex[2] + hex[2], 16) / 255;
        const a = parseInt(hex[3] + hex[3], 16) / 255;
        return [r, g, b, a];
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

    const rgbaMatch = resolved.match(
      /rgba?\(\s*([^\s,]+)\s*,\s*([^\s,]+)\s*,\s*([^\s,]+)(?:\s*,\s*([^\s,)]+))?\s*\)/i
    );

    if (rgbaMatch) {
      const r = this.#toUnit(rgbaMatch[1]);
      const g = this.#toUnit(rgbaMatch[2]);
      const b = this.#toUnit(rgbaMatch[3]);
      const a = rgbaMatch[4] == null ? 1 : this.#clamp01(Number(rgbaMatch[4]));
      return [r, g, b, a];
    }

    return [1, 1, 1, 1];
  }

  static #parseColor(args, fallback = [255, 255, 255, 255]) {
    const values = args.length === 0 ? fallback : args;

    if (values.length === 1) {
      const v = values[0];

      if (Array.isArray(v) || ArrayBuffer.isView(v)) {
        if (v.length === 3) return [this.#toUnit(v[0]), this.#toUnit(v[1]), this.#toUnit(v[2]), 1];
        if (v.length >= 4) return [this.#toUnit(v[0]), this.#toUnit(v[1]), this.#toUnit(v[2]), this.#toUnit(v[3])];
      }

      if (typeof v === "string") {
        return this.#cssStringToRgba(v);
      }

      if (typeof v === "number") {
        const g = this.#toUnit(v);
        return [g, g, g, 1];
      }

      if (v && typeof v === "object") {
        const r = "r" in v ? v.r : ("red" in v ? v.red : 255);
        const g = "g" in v ? v.g : ("green" in v ? v.green : 255);
        const b = "b" in v ? v.b : ("blue" in v ? v.blue : 255);
        const a = "a" in v ? v.a : ("alpha" in v ? v.alpha : 255);
        return [this.#toUnit(r), this.#toUnit(g), this.#toUnit(b), this.#toUnit(a)];
      }
    }

    if (values.length === 2) {
      const g = this.#toUnit(values[0]);
      const a = this.#toUnit(values[1]);
      return [g, g, g, a];
    }

    if (values.length === 3) {
      return [this.#toUnit(values[0]), this.#toUnit(values[1]), this.#toUnit(values[2]), 1];
    }

    return [
      this.#toUnit(values[0]),
      this.#toUnit(values[1]),
      this.#toUnit(values[2]),
      this.#toUnit(values[3])
    ];
  }

  // ---------------------------------------------------------------------------
  // Shader creation / loading
  // ---------------------------------------------------------------------------
  /**
   * Compiles and links a WebGL shader program from vertex and fragment GLSL source.
   *
   * @param {string} vertexSource - The GLSL source for the vertex shader.
   * @param {string} fragmentSource - The GLSL source for the fragment shader.
   * @returns {{
   *   gl: WebGLRenderingContext|WebGL2RenderingContext,
   *   program: WebGLProgram,
   *   vertexSource: string,
   *   fragmentSource: string,
   *   use: () => object,
   *   unuse: () => object,
   *   uniformLocation: (name: string) => WebGLUniformLocation|null,
   *   attribLocation: (name: string) => number,
   *   setUniform: (name: string, value: any) => object,
   *   destroy: () => void
   * }} A shader handle wrapping the linked program and convenience helpers.
   * @throws {TypeError} Thrown when either shader source is not a non-empty string.
   * @throws {Error} Thrown when shader compilation or program linking fails.
   */
  static createShader(vertexSource, fragmentSource) {
    const gl = this.#ctx();

    if (typeof vertexSource !== "string" || typeof fragmentSource !== "string") {
      throw new TypeError("createShader(vertexSource, fragmentSource) requires two GLSL strings.");
    }

    const vertexShader = this.#compileShader(gl, "vertex", vertexSource);
    const fragmentShader = this.#compileShader(gl, "fragment", fragmentSource);

    try {
      const program = this.#linkProgram(gl, vertexShader, fragmentShader);
      return this.#buildShaderHandle(gl, program, vertexSource, fragmentSource);
    } finally {
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
    }
  }
  /**
   * Creates a shader intended for screen-space or post-processing filters.
   *
   * When only one argument is provided, it is treated as the fragment shader source and
   * a built-in fullscreen-quad vertex shader is used automatically.
   *
   * @param {string} vertexSourceOrFragmentSource - The custom vertex shader source, or the fragment shader source when no second argument is provided.
   * @param {string} [maybeFragmentSource] - The fragment shader source when supplying a custom vertex shader.
   * @returns {{
   *   gl: WebGLRenderingContext|WebGL2RenderingContext,
   *   program: WebGLProgram,
   *   vertexSource: string,
   *   fragmentSource: string,
   *   use: () => object,
   *   unuse: () => object,
   *   uniformLocation: (name: string) => WebGLUniformLocation|null,
   *   attribLocation: (name: string) => number,
   *   setUniform: (name: string, value: any) => object,
   *   destroy: () => void
   * }} A shader handle wrapping the linked filter program.
   * @throws {TypeError} Thrown when the fragment shader source is missing or empty.
   */

  static createFilterShader(vertexSourceOrFragmentSource, maybeFragmentSource) {
    const gl = this.#ctx();

    let vertexSource = this.#defaultFilterVertexSource;
    let fragmentSource = maybeFragmentSource;

    if (typeof maybeFragmentSource === "undefined") {
      fragmentSource = vertexSourceOrFragmentSource;
    } else {
      vertexSource = vertexSourceOrFragmentSource;
    }

    if (typeof fragmentSource !== "string" || !fragmentSource.trim()) {
      throw new TypeError("createFilterShader() requires a fragment shader source string.");
    }

    return this.createShader(vertexSource, fragmentSource);
  }
  /**
   * Loads shader source from URLs or raw GLSL strings, then compiles and links the program.
   *
   * If either input already looks like GLSL source, it is used directly instead of being fetched.
   * Optional callbacks mirror the load result before the returned promise resolves or rejects.
   *
   * @param {string} vertexPath - A URL/path to the vertex shader source, or a raw vertex shader GLSL string.
   * @param {string} fragmentPath - A URL/path to the fragment shader source, or a raw fragment shader GLSL string.
   * @param {(shader: object) => void} [successCallback] - Invoked after the shader is created successfully.
   * @param {(error: unknown) => void} [failureCallback] - Invoked if loading, compilation, or linking fails.
   * @returns {Promise<object>} A promise that resolves to the created shader handle.
   * @throws {TypeError} Thrown when a shader path/source argument is empty.
   * @throws {Error} Thrown when fetching, compilation, or linking fails.
   */

  static async loadShader(vertexPath, fragmentPath, successCallback, failureCallback) {
    const loadText = async (source) => {
      if (typeof source !== "string" || !source.trim()) {
        throw new TypeError("Shader path must be a non-empty string.");
      }

      const trimmed = source.trim();
      const looksLikeSource =
        trimmed.includes("\n") ||
        /void\s+main\s*\(/.test(trimmed) ||
        /gl_Position|gl_FragColor|out\s+vec4/i.test(trimmed);

      if (looksLikeSource) return trimmed;

      const response = await fetch(trimmed);
      if (!response.ok) {
        throw new Error(`Failed to load shader: ${trimmed}`);
      }
      return await response.text();
    };

    try {
      const [vertexSource, fragmentSource] = await Promise.all([
        loadText(vertexPath),
        loadText(fragmentPath)
      ]);

      const shader = this.createShader(vertexSource, fragmentSource);
      if (typeof successCallback === "function") successCallback(shader);
      return shader;
    } catch (error) {
      if (typeof failureCallback === "function") failureCallback(error);
      throw error;
    }
  }
  /**
   * Sets the active general-purpose shader program and binds it with useProgram().
   *
   * @param {object} shaderObject - A shader handle previously created by Materials.createShader().
   * @returns {object} The same shader handle that was activated.
   * @throws {TypeError} Thrown when the provided value is not a valid shader handle.
   */

  static shader(shaderObject) {
    const gl = this.#ctx();
    this.#assertShader(shaderObject);
    this.#state.activeShader = shaderObject;
    gl.useProgram(shaderObject.program);
    return shaderObject;
  }
  /**
   * Stores the active shader to be used for image rendering operations.
   *
   * This method updates internal state only and does not call useProgram().
   *
   * @param {object} shaderObject - A shader handle previously created by Materials.createShader().
   * @returns {object} The same shader handle that was assigned.
   * @throws {TypeError} Thrown when the provided value is not a valid shader handle.
   */

  static imageShader(shaderObject) {
    this.#assertShader(shaderObject);
    this.#state.activeImageShader = shaderObject;
    return shaderObject;
  }
  /**
   * Stores the active shader to be used for stroke rendering operations.
   *
   * This method updates internal state only and does not call useProgram().
   *
   * @param {object} shaderObject - A shader handle previously created by Materials.createShader().
   * @returns {object} The same shader handle that was assigned.
   * @throws {TypeError} Thrown when the provided value is not a valid shader handle.
   */

  static strokeShader(shaderObject) {
    this.#assertShader(shaderObject);
    this.#state.activeStrokeShader = shaderObject;
    return shaderObject;
  }
  /**
   * Clears all active shader references and unbinds the current WebGL program.
   *
   * @returns {null} Always returns null after resetting shader state.
   */

  static resetShader() {
    const gl = this.#ctx();
    this.#state.activeShader = null;
    this.#state.activeImageShader = null;
    this.#state.activeStrokeShader = null;
    gl.useProgram(null);
    return null;
  }

  static #assertShader(shaderObject) {
    if (
      !shaderObject ||
      typeof shaderObject !== "object" ||
      !(shaderObject.program instanceof WebGLProgram)
    ) {
      throw new TypeError("Expected a shader object created by Materials.createShader().");
    }
  }

  // ---------------------------------------------------------------------------
  // Material state
  // ---------------------------------------------------------------------------
  /**
   * Sets the current ambient material color.
   *
   * Accepted color formats mirror the internal color parser and include grayscale values,
   * RGB/RGBA channel lists, typed arrays, CSS color strings, and color-like objects.
   *
   * @param {...(number|string|ArrayLike<number>|object)} color - The ambient color value(s) to apply.
   * @returns {number[]} The normalized RGBA ambient color as four unit-range values.
   */
  static ambientMaterial(...color) {
    this.#ctx();
    this.#state.ambient = this.#parseColor(color, [255, 255, 255, 255]);
    this.#state.materialMode = "ambient";
    return [...this.#state.ambient];
  }
  /**
   * Sets the current emissive material color.
   *
   * Accepted color formats mirror the internal color parser and include grayscale values,
   * RGB/RGBA channel lists, typed arrays, CSS color strings, and color-like objects.
   *
   * @param {...(number|string|ArrayLike<number>|object)} color - The emissive color value(s) to apply.
   * @returns {number[]} The normalized RGBA emissive color as four unit-range values.
   */

  static emissiveMaterial(...color) {
    this.#ctx();
    this.#state.emissive = this.#parseColor(color, [0, 0, 0, 255]);
    this.#state.materialMode = "emissive";
    return [...this.#state.emissive];
  }
  /**
   * Sets the current specular material color.
   *
   * Accepted color formats mirror the internal color parser and include grayscale values,
   * RGB/RGBA channel lists, typed arrays, CSS color strings, and color-like objects.
   *
   * @param {...(number|string|ArrayLike<number>|object)} color - The specular color value(s) to apply.
   * @returns {number[]} The normalized RGBA specular color as four unit-range values.
   */

  static specularMaterial(...color) {
    this.#ctx();
    this.#state.specular = this.#parseColor(color, [255, 255, 255, 255]);
    this.#state.materialMode = "specular";
    return [...this.#state.specular];
  }
  /**
   * Gets or sets the current metalness value.
   *
   * When a value is provided, it is clamped to the inclusive range 0..1.
   * Calling this method with no argument returns the current metalness without changing it.
   *
   * @param {number} [value] - The new metalness value to apply.
   * @returns {number} The current metalness value.
   */

  static metalness(value) {
    this.#ctx();
    if (typeof value === "undefined") return this.#state.metalness;
    this.#state.metalness = Math.min(1, Math.max(0, Number(value) || 0));
    return this.#state.metalness;
  }
  /**
   * Gets or sets the current shininess value.
   *
   * When a value is provided, it is clamped to a minimum of 0.
   * Calling this method with no argument returns the current shininess without changing it.
   *
   * @param {number} [value] - The new shininess value to apply.
   * @returns {number} The current shininess value.
   */

  static shininess(value) {
    this.#ctx();
    if (typeof value === "undefined") return this.#state.shininess;
    this.#state.shininess = Math.max(0, Number(value) || 0);
    return this.#state.shininess;
  }
  /**
   * Switches material rendering to normal-visualization mode.
   *
   * @returns {string} The active material mode, always Materials.NORMAL for this call.
   */

  static normalMaterial() {
    this.#ctx();
    this.#state.materialMode = "normal";
    return this.#state.materialMode;
  }

  // ---------------------------------------------------------------------------
  // Texture APIs
  // ---------------------------------------------------------------------------
  /**
   * Creates, caches, or binds a 2D texture from a supported source object.
   *
   * Supported sources include WebGLTexture, image elements, canvas elements, video elements,
   * ImageBitmap, and ImageData. Reusing the same source object returns the cached texture.
   *
   * @param {WebGLTexture|TexImageSource|ImageData} source - The texture source to bind or upload.
   * @returns {WebGLTexture} The active WebGL texture.
   * @throws {TypeError} Thrown when no supported source is provided.
   * @throws {Error} Thrown when the WebGL texture cannot be allocated.
   */
  static texture(source) {
    const gl = this.#ctx();

    if (typeof WebGLTexture !== "undefined" && source instanceof WebGLTexture) {
      this.#state.texture = source;
      gl.bindTexture(gl.TEXTURE_2D, source);
      this.#applyTextureWrap(gl, gl.TEXTURE_2D, source);
      return source;
    }

    if (!source) {
      throw new TypeError("texture() requires an image/canvas/video/ImageBitmap/ImageData/WebGLTexture.");
    }

    if (typeof source === "object" && this.#sourceTextureCache.has(source)) {
      const cached = this.#sourceTextureCache.get(source);
      this.#state.texture = cached;
      gl.bindTexture(gl.TEXTURE_2D, cached);
      this.#applyTextureWrap(gl, gl.TEXTURE_2D, cached, source.width, source.height);
      return cached;
    }

    const texture = gl.createTexture();
    if (!texture) {
      throw new Error("Failed to allocate WebGL texture.");
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    const isImageData =
      typeof ImageData !== "undefined" && source instanceof ImageData;

    if (isImageData) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        source.width,
        source.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source.data
      );
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const width = Number(source?.width ?? source?.videoWidth ?? 1);
    const height = Number(source?.height ?? source?.videoHeight ?? 1);

    this.#applyTextureWrap(gl, gl.TEXTURE_2D, texture, width, height);

    const canGenerateMipmaps = this.#canUseMipmaps(gl, width, height);
    if (canGenerateMipmaps) {
      gl.generateMipmap(gl.TEXTURE_2D);
    }

    this.#state.texture = texture;

    if (typeof source === "object") {
      this.#sourceTextureCache.set(source, texture);
    }

    return texture;
  }
  /**
   * Gets or sets how texture coordinates are interpreted.
   *
   * Supported modes are Materials.NORMAL and Materials.IMAGE.
   * Calling this method with no argument returns the current texture mode.
   *
   * @param {string} [mode] - The texture mode to set.
   * @returns {string} The current texture mode.
   * @throws {TypeError} Thrown when the mode is not "normal" or "image".
   */

  static textureMode(mode) {
    this.#ctx();

    if (typeof mode === "undefined") return this.#state.textureMode;

    const next = String(mode).toLowerCase();
    const normalized =
      next === "image" ? Materials.IMAGE :
      next === "normal" ? Materials.NORMAL :
      next;

    if (![Materials.NORMAL, Materials.IMAGE].includes(normalized)) {
      throw new TypeError('textureMode() must be "normal" or "image".');
    }

    this.#state.textureMode = normalized;
    return this.#state.textureMode;
  }
  /**
   * Sets the wrapping mode used for the active 2D texture.
   *
   * If only one argument is supplied, the same wrapping mode is applied to both axes.
   * Non-power-of-two textures in WebGL 1 are safely forced to clamp mode where required.
   *
   * @param {string} wrapS - The horizontal wrapping mode: "clamp", "repeat", or "mirror".
   * @param {string} [wrapT=wrapS] - The vertical wrapping mode.
   * @returns {{s: string, t: string}} The normalized wrap modes applied to the S and T axes.
   * @throws {TypeError} Thrown when either wrapping mode is invalid.
   */

  static textureWrap(wrapS, wrapT = wrapS) {
    const gl = this.#ctx();

    const nextS = this.#normalizeWrapMode(wrapS);
    const nextT = this.#normalizeWrapMode(wrapT);

    this.#state.textureWrapS = nextS;
    this.#state.textureWrapT = nextT;

    if (this.#state.texture) {
      this.#applyTextureWrap(gl, gl.TEXTURE_2D, this.#state.texture);
    }

    return {
      s: this.#state.textureWrapS,
      t: this.#state.textureWrapT
    };
  }

  static #normalizeWrapMode(mode) {
    const normalized = String(mode ?? "").toLowerCase();

    if ([Materials.CLAMP, "clamp_to_edge", "clamptoedge"].includes(normalized)) {
      return Materials.CLAMP;
    }
    if ([Materials.REPEAT].includes(normalized)) {
      return Materials.REPEAT;
    }
    if ([Materials.MIRROR, "mirrored_repeat", "mirroredrepeat"].includes(normalized)) {
      return Materials.MIRROR;
    }

    throw new TypeError('textureWrap() modes must be "clamp", "repeat", or "mirror".');
  }

  static #wrapEnum(gl, mode) {
    if (mode === Materials.REPEAT) return gl.REPEAT;
    if (mode === Materials.MIRROR) return gl.MIRRORED_REPEAT;
    return gl.CLAMP_TO_EDGE;
  }

  static #isPowerOfTwo(value) {
    return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
  }

  static #canUseMipmaps(gl, width, height) {
    const isWebGL2 =
      typeof WebGL2RenderingContext !== "undefined" &&
      gl instanceof WebGL2RenderingContext;

    return isWebGL2 || (this.#isPowerOfTwo(width) && this.#isPowerOfTwo(height));
  }

  static #applyTextureWrap(gl, target, texture, width = 1, height = 1) {
    gl.bindTexture(target, texture);

    const wantsRepeatS = this.#state.textureWrapS !== Materials.CLAMP;
    const wantsRepeatT = this.#state.textureWrapT !== Materials.CLAMP;

    const isWebGL2 =
      typeof WebGL2RenderingContext !== "undefined" &&
      gl instanceof WebGL2RenderingContext;

    const canRepeat =
      isWebGL2 || (this.#isPowerOfTwo(width) && this.#isPowerOfTwo(height));

    const safeS = wantsRepeatS && !canRepeat ? Materials.CLAMP : this.#state.textureWrapS;
    const safeT = wantsRepeatT && !canRepeat ? Materials.CLAMP : this.#state.textureWrapT;

    gl.texParameteri(target, gl.TEXTURE_WRAP_S, this.#wrapEnum(gl, safeS));
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, this.#wrapEnum(gl, safeT));
  }

  // ---------------------------------------------------------------------------
  // Optional read-only state snapshot (useful for renderer integration)
  // ---------------------------------------------------------------------------
  /**
   * Returns a read-only snapshot of the current material and shader state.
   *
   * Array properties are copied so callers can inspect them without mutating internal state directly.
   * Object references such as textures and shader handles are returned as-is.
   *
   * @returns {{
   *   ambient: number[],
   *   emissive: number[],
   *   specular: number[],
   *   metalness: number,
   *   shininess: number,
   *   materialMode: string|null,
   *   texture: WebGLTexture|null,
   *   textureMode: string,
   *   textureWrapS: string,
   *   textureWrapT: string,
   *   activeShader: object|null,
   *   activeImageShader: object|null,
   *   activeStrokeShader: object|null
   * }} A shallow snapshot of the current state.
   */
  static state() {
    return {
      ambient: [...this.#state.ambient],
      emissive: [...this.#state.emissive],
      specular: [...this.#state.specular],
      metalness: this.#state.metalness,
      shininess: this.#state.shininess,
      materialMode: this.#state.materialMode,
      texture: this.#state.texture,
      textureMode: this.#state.textureMode,
      textureWrapS: this.#state.textureWrapS,
      textureWrapT: this.#state.textureWrapT,
      activeShader: this.#state.activeShader,
      activeImageShader: this.#state.activeImageShader,
      activeStrokeShader: this.#state.activeStrokeShader
    };
  }
};