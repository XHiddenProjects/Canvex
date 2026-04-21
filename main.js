import { Canvex } from "./libs/canvex.js";
import { Camera } from "./libs/camera.js";

let gl;
let program;

let aPositionLoc;
let uModelLoc;
let uViewLoc;
let uProjLoc;
let uColorLoc;

let cubeBufferInfo;
let gridBufferInfo;

const keys = new Set();
let cubeAngle = 0;
let infoEl = null;

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "Shader compile failed.");
  }

  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "Program link failed.");
  }

  return program;
}

function createLineBuffer(gl, vertices) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  return {
    buffer,
    count: vertices.length / 3
  };
}

function makeCubeLines(size = 60) {
  const s = size / 2;

  return [
    // bottom square
    -s, -s, -s,   s, -s, -s,
     s, -s, -s,   s, -s,  s,
     s, -s,  s,  -s, -s,  s,
    -s, -s,  s,  -s, -s, -s,

    // top square
    -s,  s, -s,   s,  s, -s,
     s,  s, -s,   s,  s,  s,
     s,  s,  s,  -s,  s,  s,
    -s,  s,  s,  -s,  s, -s,

    // verticals
    -s, -s, -s,  -s,  s, -s,
     s, -s, -s,   s,  s, -s,
     s, -s,  s,   s,  s,  s,
    -s, -s,  s,  -s,  s,  s
  ];
}

function makeGridLines(size = 600, step = 40) {
  const half = size / 2;
  const verts = [];

  for (let i = -half; i <= half; i += step) {
    // lines parallel to X axis
    verts.push(-half, 0, i, half, 0, i);

    // lines parallel to Z axis
    verts.push(i, 0, -half, i, 0, half);
  }

  return verts;
}

function identityMatrix() {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ];
}

function modelMatrixYRotation(angle, tx = 0, ty = 0, tz = 0, scale = 1) {
  const c = Math.cos(angle) * scale;
  const s = Math.sin(angle) * scale;

  // Column-major 4x4
  return [
     c, 0, -s, 0,
     0, scale, 0, 0,
     s, 0,  c, 0,
     tx, ty, tz, 1
  ];
}

function setMatrixUniform(location, matrix) {
  gl.uniformMatrix4fv(location, false, new Float32Array(matrix));
}

function drawLines(bufferInfo, modelMatrix, color) {
  gl.bindBuffer(gl.ARRAY_BUFFER, bufferInfo.buffer);
  gl.enableVertexAttribArray(aPositionLoc);
  gl.vertexAttribPointer(aPositionLoc, 3, gl.FLOAT, false, 0, 0);

  setMatrixUniform(uModelLoc, modelMatrix);
  setMatrixUniform(uViewLoc, Camera.viewMatrix);
  setMatrixUniform(uProjLoc, Camera.projectionMatrix);

  gl.uniform4f(uColorLoc, color[0], color[1], color[2], color[3]);
  gl.drawArrays(gl.LINES, 0, bufferInfo.count);
}

function installKeyboard() {
  window.addEventListener("keydown", (event) => {
    keys.add(event.key.toLowerCase());

    if ([
      "arrowleft",
      "arrowright",
      "arrowup",
      "arrowdown",
      " ",
      "w", "a", "s", "d", "q", "e"
    ].includes(event.key.toLowerCase())) {
      event.preventDefault();
    }
  });

  window.addEventListener("keyup", (event) => {
    keys.delete(event.key.toLowerCase());
  });
}

function updateCameraFromInput() {
  const moveSpeed = 4;
  const turnSpeed = 0.03;

  if (keys.has("w")) Camera.move(0, 0,  moveSpeed);
  if (keys.has("s")) Camera.move(0, 0, -moveSpeed);

  if (keys.has("a")) Camera.move(-moveSpeed, 0, 0);
  if (keys.has("d")) Camera.move( moveSpeed, 0, 0);

  if (keys.has("q")) Camera.move(0, -moveSpeed, 0);
  if (keys.has("e")) Camera.move(0,  moveSpeed, 0);

  if (keys.has("arrowleft"))  Camera.pan(-turnSpeed);
  if (keys.has("arrowright")) Camera.pan( turnSpeed);

  if (keys.has("arrowup"))    Camera.tilt(-turnSpeed);
  if (keys.has("arrowdown"))  Camera.tilt( turnSpeed);
}

function updateInfo() {
  if (!infoEl) return;

  infoEl.textContent =
`Camera Demo
W/S = forward/back
A/D = strafe left/right
Q/E = down/up
←/→ = pan
↑/↓ = tilt

eye    : (${Camera.eyeX.toFixed(1)}, ${Camera.eyeY.toFixed(1)}, ${Camera.eyeZ.toFixed(1)})
center : (${Camera.centerX.toFixed(1)}, ${Camera.centerY.toFixed(1)}, ${Camera.centerZ.toFixed(1)})`;
}

window.setup = function () {
  Canvex.createCanvas(0, 0, 800, 500, 'body', Canvex.WEBGL);
  gl = Canvex.ctx;

  const vertexSource = `
    attribute vec3 a_position;

    uniform mat4 u_model;
    uniform mat4 u_view;
    uniform mat4 u_proj;

    void main() {
      gl_Position = u_proj * u_view * u_model * vec4(a_position, 1.0);
    }
  `;

  const fragmentSource = `
    precision mediump float;

    uniform vec4 u_color;

    void main() {
      gl_FragColor = u_color;
    }
  `;

  program = createProgram(gl, vertexSource, fragmentSource);
  gl.useProgram(program);

  aPositionLoc = gl.getAttribLocation(program, "a_position");
  uModelLoc = gl.getUniformLocation(program, "u_model");
  uViewLoc = gl.getUniformLocation(program, "u_view");
  uProjLoc = gl.getUniformLocation(program, "u_proj");
  uColorLoc = gl.getUniformLocation(program, "u_color");

  cubeBufferInfo = createLineBuffer(gl, makeCubeLines(70));
  gridBufferInfo = createLineBuffer(gl, makeGridLines(800, 50));

  gl.enable(gl.DEPTH_TEST);

  // Initial camera
  Camera.camera(
    0, 120, 320,   // eye
    0, 40, 0,      // center
    0, 1, 0        // up
  );

  Camera.perspective(
    Math.PI / 3,
    gl.canvas.width / gl.canvas.height,
    0.1,
    5000
  );

  installKeyboard();

  infoEl = document.createElement("pre");
  infoEl.style.position = "fixed";
  infoEl.style.left = "10px";
  infoEl.style.top = "10px";
  infoEl.style.margin = "0";
  infoEl.style.padding = "10px 12px";
  infoEl.style.background = "rgba(0, 0, 0, 0.65)";
  infoEl.style.color = "#fff";
  infoEl.style.font = "12px/1.4 monospace";
  infoEl.style.pointerEvents = "none";
  infoEl.style.zIndex = "9999";
  document.body.appendChild(infoEl);

  updateInfo();
};

window.draw = function () {
  updateCameraFromInput();

  cubeAngle += 0.015;

  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.clearColor(0.92, 0.92, 0.95, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Ground grid
  drawLines(
    gridBufferInfo,
    identityMatrix(),
    [0.70, 0.70, 0.75, 1.0]
  );

  // Center cube
  drawLines(
    cubeBufferInfo,
    modelMatrixYRotation(cubeAngle, 0, 35, 0, 1),
    [0.10, 0.10, 0.10, 1.0]
  );

  // Offset cube for depth reference
  drawLines(
    cubeBufferInfo,
    modelMatrixYRotation(-cubeAngle * 0.7, 140, 35, -120, 0.75),
    [0.85, 0.25, 0.25, 1.0]
  );

  // Another cube farther away
  drawLines(
    cubeBufferInfo,
    modelMatrixYRotation(cubeAngle * 0.5, -180, 35, 140, 1.2),
    [0.20, 0.45, 0.85, 1.0]
  );

  updateInfo();
};