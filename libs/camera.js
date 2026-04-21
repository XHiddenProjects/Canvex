import { Canvex } from "./canvex.js";
import { math } from "./math.js";

/**
 * Camera helpers for Canvex.
 *
 * This class stores a single active camera state and exposes static methods for
 * positioning, orienting, and projecting that camera. The camera is renderer-
 * agnostic: Canvas 2D can ignore the z axis while WebGL/WebGL2 can use the
 * generated matrices and 3D values directly.
 */
export const Camera = class {
  static #eye = { x: 0, y: 0, z: 800 };
  static #center = { x: 0, y: 0, z: 0 };
  static #up = { x: 0, y: 1, z: 0 };

  static #projection = {
    type: "perspective",
    fovy: Math.PI / 3,
    aspect: 1,
    near: 0.1,
    far: 10000,
    left: -1,
    right: 1,
    bottom: -1,
    top: 1
  };

  static #viewMatrix = this.#identity();
  static #projectionMatrix = this.#identity();

  // ---------------------------------------------------------------------------
  // Math helpers
  // ---------------------------------------------------------------------------
  static #identity() {
    return [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ];
  }

  static #vec3(x = 0, y = 0, z = 0) {
    return { x: Number(x), y: Number(y), z: Number(z) };
  }

  static #cloneVec3(v) {
    return { x: v.x, y: v.y, z: v.z };
  }

  static #assertFinite(label, values) {
    for (const value of values) {
      if (!Number.isFinite(value)) {
        throw new TypeError(`${label} must be finite numbers`);
      }
    }
  }

  static #add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
  }

  static #sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  }

  static #scale(v, s) {
    return { x: v.x * s, y: v.y * s, z: v.z * s };
  }

  static #dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  static #cross(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  }

  static #length(v) {
    return Math.hypot(v.x, v.y, v.z);
  }

  static #normalize(v) {
    const len = this.#length(v);
    if (len === 0) return { x: 0, y: 0, z: 0 };
    return { x: v.x / len, y: v.y / len, z: v.z / len };
  }


  static #lerpVec(a, b, t) {
    return {
      x: math.lerp(a.x, b.x, t),
      y: math.lerp(a.y, b.y, t),
      z: math.lerp(a.z, b.z, t)
    };
  }

  static #rotateAroundAxis(v, axis, angle) {
    const k = this.#normalize(axis);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const term1 = this.#scale(v, cos);
    const term2 = this.#scale(this.#cross(k, v), sin);
    const term3 = this.#scale(k, this.#dot(k, v) * (1 - cos));
    return this.#add(this.#add(term1, term2), term3);
  }

  static #basis() {
    const forward = this.#normalize(this.#sub(this.#center, this.#eye));
    let right = this.#cross(forward, this.#up);
    if (this.#length(right) === 0) {
      right = this.#cross(forward, { x: 0, y: 0, z: 1 });
      if (this.#length(right) === 0) right = { x: 1, y: 0, z: 0 };
    }
    right = this.#normalize(right);
    const up = this.#normalize(this.#cross(right, forward));
    return { forward, right, up };
  }

  static #defaultAspect() {
    const width = Number(Canvex?.canvas?.width ?? Canvex?.WIDTH ?? 1);
    const height = Number(Canvex?.canvas?.height ?? Canvex?.HEIGHT ?? 1);
    return height === 0 ? 1 : width / height;
  }

  static #lookAtMatrix(eye, center, up) {
    const forward = this.#normalize(this.#sub(center, eye));
    let right = this.#cross(forward, up);
    if (this.#length(right) === 0) {
      right = this.#cross(forward, { x: 0, y: 0, z: 1 });
      if (this.#length(right) === 0) right = { x: 1, y: 0, z: 0 };
    }
    right = this.#normalize(right);
    const trueUp = this.#normalize(this.#cross(right, forward));
    const back = this.#scale(forward, -1);

    return [
      right.x, trueUp.x, back.x, 0,
      right.y, trueUp.y, back.y, 0,
      right.z, trueUp.z, back.z, 0,
      -this.#dot(right, eye), -this.#dot(trueUp, eye), -this.#dot(back, eye), 1
    ];
  }

  static #perspectiveMatrix(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    return [
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) / (near - far), -1,
      0, 0, (2 * far * near) / (near - far), 0
    ];
  }

  static #frustumMatrix(left, right, bottom, top, near, far) {
    return [
      (2 * near) / (right - left), 0, 0, 0,
      0, (2 * near) / (top - bottom), 0, 0,
      (right + left) / (right - left), (top + bottom) / (top - bottom), -(far + near) / (far - near), -1,
      0, 0, (-2 * far * near) / (far - near), 0
    ];
  }

  static #orthoMatrix(left, right, bottom, top, near, far) {
    return [
      2 / (right - left), 0, 0, 0,
      0, 2 / (top - bottom), 0, 0,
      0, 0, -2 / (far - near), 0,
      -(right + left) / (right - left), -(top + bottom) / (top - bottom), -(far + near) / (far - near), 1
    ];
  }

  static #normalizeQuaternion(q) {
    const len = Math.hypot(q.x, q.y, q.z, q.w);
    if (len === 0) return { x: 0, y: 0, z: 0, w: 1 };
    return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
  }

  static #quaternionFromBasis(right, up, forward) {
    const back = this.#scale(forward, -1);
    const m00 = right.x, m01 = up.x, m02 = back.x;
    const m10 = right.y, m11 = up.y, m12 = back.y;
    const m20 = right.z, m21 = up.z, m22 = back.z;

    const trace = m00 + m11 + m22;
    let x, y, z, w;

    if (trace > 0) {
      const s = Math.sqrt(trace + 1) * 2;
      w = 0.25 * s;
      x = (m21 - m12) / s;
      y = (m02 - m20) / s;
      z = (m10 - m01) / s;
    } else if (m00 > m11 && m00 > m22) {
      const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
      w = (m21 - m12) / s;
      x = 0.25 * s;
      y = (m01 + m10) / s;
      z = (m02 + m20) / s;
    } else if (m11 > m22) {
      const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
      w = (m02 - m20) / s;
      x = (m01 + m10) / s;
      y = 0.25 * s;
      z = (m12 + m21) / s;
    } else {
      const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
      w = (m10 - m01) / s;
      x = (m02 + m20) / s;
      y = (m12 + m21) / s;
      z = 0.25 * s;
    }

    return this.#normalizeQuaternion({ x, y, z, w });
  }

  static #rotateVectorByQuaternion(v, q) {
    const u = { x: q.x, y: q.y, z: q.z };
    const s = q.w;
    const term1 = this.#scale(u, 2 * this.#dot(u, v));
    const term2 = this.#scale(v, s * s - this.#dot(u, u));
    const term3 = this.#scale(this.#cross(u, v), 2 * s);
    return this.#add(this.#add(term1, term2), term3);
  }

  static #quaternionSlerp(a, b, t) {
    let q1 = this.#normalizeQuaternion(a);
    let q2 = this.#normalizeQuaternion(b);
    let dot = q1.x * q2.x + q1.y * q2.y + q1.z * q2.z + q1.w * q2.w;

    if (dot < 0) {
      q2 = { x: -q2.x, y: -q2.y, z: -q2.z, w: -q2.w };
      dot = -dot;
    }

    if (dot > 0.9995) {
      return this.#normalizeQuaternion({
        x: math.lerp(q1.x, q2.x, t),
        y: math.lerp(q1.y, q2.y, t),
        z: math.lerp(q1.z, q2.z, t),
        w: math.lerp(q1.w, q2.w, t)
      });
    }

    const theta0 = Math.acos(Math.max(-1, Math.min(1, dot)));
    const theta = theta0 * t;
    const sinTheta = Math.sin(theta);
    const sinTheta0 = Math.sin(theta0);
    const s0 = Math.cos(theta) - dot * sinTheta / sinTheta0;
    const s1 = sinTheta / sinTheta0;

    return {
      x: s0 * q1.x + s1 * q2.x,
      y: s0 * q1.y + s1 * q2.y,
      z: s0 * q1.z + s1 * q2.z,
      w: s0 * q1.w + s1 * q2.w
    };
  }

  static #cameraStateFromInput(cameraLike) {
    if (cameraLike === Camera) return this.snapshot();
    if (!cameraLike || typeof cameraLike !== "object") {
      throw new TypeError("cameraLike must be an object or Camera");
    }

    const source = typeof cameraLike.snapshot === "function"
      ? cameraLike.snapshot()
      : cameraLike;

    const eye = this.#vec3(
      source.eyeX ?? source.eye?.x ?? 0,
      source.eyeY ?? source.eye?.y ?? 0,
      source.eyeZ ?? source.eye?.z ?? 0
    );
    const center = this.#vec3(
      source.centerX ?? source.center?.x ?? 0,
      source.centerY ?? source.center?.y ?? 0,
      source.centerZ ?? source.center?.z ?? 0
    );
    const up = this.#vec3(
      source.upX ?? source.up?.x ?? 0,
      source.upY ?? source.up?.y ?? 1,
      source.upZ ?? source.up?.z ?? 0
    );

    this.#assertFinite("Camera state", [
      eye.x, eye.y, eye.z,
      center.x, center.y, center.z,
      up.x, up.y, up.z
    ]);

    const projection = {
      ...this.#projection,
      ...(source.projection ?? {})
    };

    return { eye, center, up, projection };
  }

  static #applyView() {
    this.#viewMatrix = this.#lookAtMatrix(this.#eye, this.#center, this.#up);
    return this.#viewMatrix;
  }

  static #applyProjection() {
    const p = this.#projection;

    if (p.type === "perspective") {
      this.#projectionMatrix = this.#perspectiveMatrix(p.fovy, p.aspect, p.near, p.far);
      return this.#projectionMatrix;
    }

    if (p.type === "frustum") {
      this.#projectionMatrix = this.#frustumMatrix(p.left, p.right, p.bottom, p.top, p.near, p.far);
      return this.#projectionMatrix;
    }

    if (p.type === "ortho") {
      this.#projectionMatrix = this.#orthoMatrix(p.left, p.right, p.bottom, p.top, p.near, p.far);
      return this.#projectionMatrix;
    }

    this.#projectionMatrix = this.#identity();
    return this.#projectionMatrix;
  }

  // ---------------------------------------------------------------------------
  // Camera state getters
  // ---------------------------------------------------------------------------
  static get centerX() { return this.#center.x; }
  static get centerY() { return this.#center.y; }
  static get centerZ() { return this.#center.z; }

  static get eyeX() { return this.#eye.x; }
  static get eyeY() { return this.#eye.y; }
  static get eyeZ() { return this.#eye.z; }

  static get upX() { return this.#up.x; }
  static get upY() { return this.#up.y; }
  static get upZ() { return this.#up.z; }

  static get viewMatrix() { return [...this.#viewMatrix]; }
  static get projectionMatrix() { return [...this.#projectionMatrix]; }
  static get projection() { return { ...this.#projection }; }

  /** Returns a plain snapshot of the current camera state. */
  static snapshot() {
    return {
      eyeX: this.eyeX,
      eyeY: this.eyeY,
      eyeZ: this.eyeZ,
      centerX: this.centerX,
      centerY: this.centerY,
      centerZ: this.centerZ,
      upX: this.upX,
      upY: this.upY,
      upZ: this.upZ,
      eye: this.#cloneVec3(this.#eye),
      center: this.#cloneVec3(this.#center),
      up: this.#cloneVec3(this.#up),
      projection: { ...this.#projection },
      viewMatrix: [...this.#viewMatrix],
      projectionMatrix: [...this.#projectionMatrix]
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Sets the position and orientation of the camera.
   */
  static camera(
    eyeX = this.eyeX,
    eyeY = this.eyeY,
    eyeZ = this.eyeZ,
    centerX = this.centerX,
    centerY = this.centerY,
    centerZ = this.centerZ,
    upX = this.upX,
    upY = this.upY,
    upZ = this.upZ
  ) {
    this.#assertFinite("Camera values", [eyeX, eyeY, eyeZ, centerX, centerY, centerZ, upX, upY, upZ]);
    this.#eye = this.#vec3(eyeX, eyeY, eyeZ);
    this.#center = this.#vec3(centerX, centerY, centerZ);
    this.#up = this.#normalize(this.#vec3(upX, upY, upZ));
    if (this.#length(this.#up) === 0) this.#up = { x: 0, y: 1, z: 0 };
    this.#applyView();
    return this.snapshot();
  }

  /**
   * Sets a perspective projection for the camera.
   */
  static perspective(fovy = Math.PI / 3, aspect = this.#defaultAspect(), near = 0.1, far = 10000) {
    this.#assertFinite("Perspective values", [fovy, aspect, near, far]);
    if (aspect === 0) throw new RangeError("aspect must not be 0");
    if (near <= 0 || far <= 0 || near === far) {
      throw new RangeError("near and far must be positive and different");
    }

    this.#projection = {
      type: "perspective",
      fovy: Number(fovy),
      aspect: Number(aspect),
      near: Number(near),
      far: Number(far),
      left: this.#projection.left,
      right: this.#projection.right,
      bottom: this.#projection.bottom,
      top: this.#projection.top
    };
    this.#applyProjection();
    return this.snapshot();
  }

  /**
   * Sets the camera's frustum.
   */
  static frustum(left, right, bottom, top, near, far) {
    this.#assertFinite("Frustum values", [left, right, bottom, top, near, far]);
    if (left === right || bottom === top || near === far) {
      throw new RangeError("frustum planes must define a non-zero volume");
    }

    this.#projection = {
      type: "frustum",
      fovy: this.#projection.fovy,
      aspect: this.#projection.aspect,
      near: Number(near),
      far: Number(far),
      left: Number(left),
      right: Number(right),
      bottom: Number(bottom),
      top: Number(top)
    };
    this.#applyProjection();
    return this.snapshot();
  }

  /**
   * Sets an orthographic projection for the camera.
   */
  static ortho(left, right, bottom, top, near = -1000, far = 1000) {
    this.#assertFinite("Ortho values", [left, right, bottom, top, near, far]);
    if (left === right || bottom === top || near === far) {
      throw new RangeError("ortho planes must define a non-zero volume");
    }

    this.#projection = {
      type: "ortho",
      fovy: this.#projection.fovy,
      aspect: this.#projection.aspect,
      near: Number(near),
      far: Number(far),
      left: Number(left),
      right: Number(right),
      bottom: Number(bottom),
      top: Number(top)
    };
    this.#applyProjection();
    return this.snapshot();
  }

  /**
   * Points the camera at a location.
   */
  static lookAt(centerX, centerY, centerZ) {
    this.#assertFinite("LookAt values", [centerX, centerY, centerZ]);
    this.#center = this.#vec3(centerX, centerY, centerZ);
    this.#applyView();
    return this.snapshot();
  }

  /**
   * Moves the camera along its local axes without changing its orientation.
   * Positive z moves the camera toward its current look direction.
   */
  static move(x = 0, y = 0, z = 0) {
    this.#assertFinite("Move values", [x, y, z]);
    const { forward, right, up } = this.#basis();
    const delta = this.#add(
      this.#add(this.#scale(right, x), this.#scale(up, y)),
      this.#scale(forward, z)
    );
    this.#eye = this.#add(this.#eye, delta);
    this.#center = this.#add(this.#center, delta);
    this.#applyView();
    return this.snapshot();
  }

  /**
   * Rotates the camera left and right around its local up axis.
   */
  static pan(angle) {
    this.#assertFinite("Pan angle", [angle]);
    const { forward } = this.#basis();
    const distance = this.#length(this.#sub(this.#center, this.#eye));
    const rotatedForward = this.#normalize(this.#rotateAroundAxis(forward, this.#up, angle));
    this.#center = this.#add(this.#eye, this.#scale(rotatedForward, distance));
    this.#applyView();
    return this.snapshot();
  }

  /**
   * Rotates the camera up and down around its local right axis.
   */
  static tilt(angle) {
    this.#assertFinite("Tilt angle", [angle]);
    const { forward, right, up } = this.#basis();
    const distance = this.#length(this.#sub(this.#center, this.#eye));
    const rotatedForward = this.#normalize(this.#rotateAroundAxis(forward, right, angle));
    const rotatedUp = this.#normalize(this.#rotateAroundAxis(up, right, angle));
    this.#center = this.#add(this.#eye, this.#scale(rotatedForward, distance));
    this.#up = rotatedUp;
    this.#applyView();
    return this.snapshot();
  }

  /**
   * Sets the camera's position in world space without changing its orientation.
   */
  static setPosition(eyeX, eyeY, eyeZ) {
    this.#assertFinite("Camera position", [eyeX, eyeY, eyeZ]);
    const direction = this.#sub(this.#center, this.#eye);
    this.#eye = this.#vec3(eyeX, eyeY, eyeZ);
    this.#center = this.#add(this.#eye, direction);
    this.#applyView();
    return this.snapshot();
  }

  /**
   * Sets the camera’s position, orientation, and projection by copying another camera-like object.
   */
  static set(cameraLike) {
    const state = this.#cameraStateFromInput(cameraLike);
    this.#eye = this.#cloneVec3(state.eye);
    this.#center = this.#cloneVec3(state.center);
    this.#up = this.#normalize(state.up);
    if (this.#length(this.#up) === 0) this.#up = { x: 0, y: 1, z: 0 };
    this.#projection = { ...this.#projection, ...state.projection };
    this.#applyView();
    this.#applyProjection();
    return this.snapshot();
  }

  /**
   * Sets the camera’s position and orientation to values in-between two other camera-like objects.
   */
  static slerp(cameraA, cameraB, amt = 0.5) {
    this.#assertFinite("Slerp amount", [amt]);
    const t = Math.max(0, Math.min(1, Number(amt)));

    const a = this.#cameraStateFromInput(cameraA);
    const b = this.#cameraStateFromInput(cameraB);

    const aForward = this.#normalize(this.#sub(a.center, a.eye));
    const aRight = this.#normalize(this.#cross(aForward, a.up));
    const aUp = this.#normalize(this.#cross(aRight, aForward));

    const bForward = this.#normalize(this.#sub(b.center, b.eye));
    const bRight = this.#normalize(this.#cross(bForward, b.up));
    const bUp = this.#normalize(this.#cross(bRight, bForward));

    const qa = this.#quaternionFromBasis(aRight, aUp, aForward);
    const qb = this.#quaternionFromBasis(bRight, bUp, bForward);
    const q = this.#normalizeQuaternion(this.#quaternionSlerp(qa, qb, t));

    const eye = this.#lerpVec(a.eye, b.eye, t);
    const up = this.#normalize(this.#rotateVectorByQuaternion({ x: 0, y: 1, z: 0 }, q));
    const forward = this.#normalize(this.#rotateVectorByQuaternion({ x: 0, y: 0, z: -1 }, q));

    const distanceA = this.#length(this.#sub(a.center, a.eye));
    const distanceB = this.#length(this.#sub(b.center, b.eye));
    const distance = math.lerp(distanceA, distanceB, t);
    const center = this.#add(eye, this.#scale(forward, distance));

    this.#eye = eye;
    this.#center = center;
    this.#up = up;
    this.#projection = {
      ...this.#projection,
      type: t < 0.5 ? a.projection.type : b.projection.type,
      fovy: math.lerp(a.projection.fovy ?? this.#projection.fovy, b.projection.fovy ?? this.#projection.fovy, t),
      aspect: math.lerp(a.projection.aspect ?? this.#defaultAspect(), b.projection.aspect ?? this.#defaultAspect(), t),
      near: math.lerp(a.projection.near ?? 0.1, b.projection.near ?? 0.1, t),
      far: math.lerp(a.projection.far ?? 10000, b.projection.far ?? 10000, t),
      left: math.lerp(a.projection.left ?? -1, b.projection.left ?? -1, t),
      right: math.lerp(a.projection.right ?? 1, b.projection.right ?? 1, t),
      bottom: math.lerp(a.projection.bottom ?? -1, b.projection.bottom ?? -1, t),
      top: math.lerp(a.projection.top ?? 1, b.projection.top ?? 1, t)
    };
    this.#applyView();
    this.#applyProjection();
    return this.snapshot();
  }
};

Camera.camera();
Camera.perspective();