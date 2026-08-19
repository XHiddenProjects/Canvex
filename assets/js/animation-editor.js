"use strict";
import * as THREE from './vendor/three/three.module.js';
import { OrbitControls } from './vendor/three/OrbitControls.js';

(() => {
  const mount = document.getElementById('animationPanel');
  const state = window.__forgeState;
  if (!mount || !state) return;
  const api = window.__forgeApi, toast = window.__forgeToast, log = window.__forgeLog, escapeHtml = window.__forgeEscape || (s => String(s));

  // ===========================================================================
  // Professional block/grid animation editor. Replaces the old hand-drawn PNG
  // flipbook (exported as an animated SVG) with real "block edit" frames — a
  // sparse map of painted grid cells — stored and exported as a plain JSON
  // object. Supports two clip types per object:
  //   - '2d': a flat pixel-grid flipbook (cells keyed "x,y" -> hex color)
  //   - '3d': a voxel flipbook (voxels keyed "x,y,z" -> hex color), edited one
  //     Y-layer at a time on a 2D grid while a live Three.js viewport shows
  //     the assembled model with orbit controls.
  // ===========================================================================

  state.animClips ||= {}; // objId -> clip (see defaultClip)

  const PALETTE = ['#000000', '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764',
    '#257179', '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86'];
  const TYPE_COLOR = {
    light: '#e2b44f', camera: '#6d9de6', sprite: '#e47b35', audio: '#9b7fe0',
    collider: '#63c9c9', ui: '#7fa0ae', group: '#89929d', mesh: '#8a94a3'
  };
  const CELL_PX = 18;      // 2D grid cell size on screen
  const LAYER_CELL_PX = 18; // 3D layer-grid cell size on screen

  function defaultClip(type) {
    return type === '3d'
      ? { type: '3d', sizeX: 8, sizeY: 8, sizeZ: 8, fps: 8, loop: true, frames: [{ voxels: {} }] }
      : { type: '2d', width: 16, height: 16, fps: 8, loop: true, frames: [{ cells: {} }] };
  }
  function clipFor(objId) { return (state.animClips[objId] ||= defaultClip('2d')); }

  mount.innerHTML = `
    <div class="anim-editor">
      <div class="anim-toolbar">
        <label class="muted">Object <select id="animObjSelect"></select></label>
        <div class="tool-group" id="animTypeToggle">
          <button class="text-tool active" data-type="2d" title="2D pixel-grid flipbook">2D</button>
          <button class="text-tool" data-type="3d" title="3D voxel flipbook">3D</button>
        </div>
        <span class="grow"></span>
        <label class="muted">FPS <input type="number" id="animFps" value="8" min="1" max="30" style="width:52px"></label>
        <label class="muted">Loop <input type="checkbox" id="animLoop" checked></label>
        <input id="animAssetName" placeholder="clip-name" style="width:130px">
        <button id="animPreviewJson" title="Preview this animation in a new tab">👁 Preview</button>
        <button id="animSave">💾 Export Animation JSON</button>
      </div>
      <div class="anim-toolbar" id="animDimsRow">
        <span id="animDims2d" style="display:flex;gap:8px;align-items:center">
          <label class="muted">W <input type="number" id="anim2dW" min="2" max="128" value="16" style="width:56px"></label>
          <label class="muted">H <input type="number" id="anim2dH" min="2" max="128" value="16" style="width:56px"></label>
        </span>
        <span id="animDims3d" style="display:none;gap:8px;align-items:center">
          <label class="muted">X <input type="number" id="anim3dX" min="1" max="24" value="8" style="width:48px"></label>
          <label class="muted">Y <input type="number" id="anim3dY" min="1" max="24" value="8" style="width:48px"></label>
          <label class="muted">Z <input type="number" id="anim3dZ" min="1" max="24" value="8" style="width:48px"></label>
          <label class="muted">Layer <input type="number" id="animLayer" min="0" max="7" value="0" style="width:48px"></label>
          <input type="range" id="animLayerSlider" min="0" max="7" value="0" style="width:120px">
        </span>
        <button id="animApplyDims" title="Resize grid (keeps in-range voxels/cells)">Resize Grid</button>
      </div>
      <div class="anim-body">
        <div class="anim-draw-tools">
          <button class="anim-tool active" data-tool="pencil" title="Pencil">✏️</button>
          <button class="anim-tool" data-tool="eraser" title="Eraser">🧹</button>
          <button class="anim-tool" data-tool="fill" title="Fill bucket">🪣</button>
          <button class="anim-tool" data-tool="eyedrop" title="Pick color from grid">💧</button>
          <div id="animPalette" style="display:grid;grid-template-columns:repeat(2,1fr);gap:3px"></div>
          <input type="color" id="animColor" value="#e5e7eb" title="Color">
          <button id="animClearFrame" title="Clear this frame">🗑</button>
          <label class="toggle"><input type="checkbox" id="animOnion" checked>Onion<br>skin</label>
          <label class="toggle" id="animRefWrap"><input type="checkbox" id="animRef" checked>Show<br>ref</label>
        </div>
        <div class="anim-canvas-wrap">
          <div id="anim2dStage" class="anim-canvas-stack" style="width:${16 * CELL_PX}px;height:${16 * CELL_PX}px">
            <canvas class="anim-canvas-layer" id="animRefCanvas"></canvas>
            <canvas class="anim-canvas-layer" id="animOnionCanvas"></canvas>
            <canvas class="anim-canvas-layer anim-draw-surface" id="animDrawCanvas"></canvas>
          </div>
          <div id="anim3dStage" style="display:none;width:100%;height:100%;gap:0">
            <div class="anim-canvas-stack" id="anim3dLayerStage" style="position:relative"><canvas id="animLayerCanvas"></canvas></div>
            <div style="flex:1;min-width:0;height:100%;position:relative"><canvas id="anim3dCanvas" style="width:100%;height:100%;display:block"></canvas>
              <div class="muted" style="position:absolute;left:8px;bottom:6px;font-size:10.5px;background:rgba(0,0,0,.4);padding:3px 7px;border-radius:5px">RMB drag to orbit · wheel to zoom</div>
            </div>
          </div>
          <div class="anim-stage-hint" id="animStageHint"></div>
        </div>
      </div>
      <div class="anim-frame-strip-wrap">
        <div class="anim-playback">
          <button id="animPlayBtn" title="Play (Space)">▶ Play</button>
          <span class="muted" id="animFrameLabel">Frame 1 / 1</span>
        </div>
        <div class="anim-frame-strip" id="animFrameStrip"></div>
        <div class="anim-playback">
          <button id="animDupFrame" title="Duplicate current frame">⎘ Add Frame</button>
          <button id="animDelFrame" title="Delete current frame">✕ Delete</button>
        </div>
      </div>
      <div class="anim-help">
        <strong>How this works:</strong> pick an object, choose <strong>2D</strong> (flat pixel grid) or <strong>3D</strong> (voxel grid, one Y-layer at a time — orbit the right-hand viewport to check it from any angle), draw a pose, click <strong>Add Frame</strong> (starts as a copy so you're nudging, not restarting), repeat, then <strong>Play</strong>. Onion skin shows the previous frame faintly. Animations are stored and exported as a plain <strong>JSON object</strong> (a sparse map of painted cells/voxels per frame) rather than an image — <strong>Export Animation JSON</strong> writes it to your assets.
      </div>
    </div>`;

  const el = sel => mount.querySelector(sel);
  const objectSelect = el('#animObjSelect');
  const fpsInput = el('#animFps');
  const loopInput = el('#animLoop');
  const nameInput = el('#animAssetName');
  const colorInput = el('#animColor');
  const onionToggle = el('#animOnion');
  const refToggle = el('#animRef');
  const stageHint = el('#animStageHint');
  const frameLabel = el('#animFrameLabel');
  const frameStrip = el('#animFrameStrip');
  const playBtn = el('#animPlayBtn');

  const stage2d = el('#anim2dStage');
  const refCanvas = el('#animRefCanvas'), refCtx = refCanvas.getContext('2d');
  const onionCanvas = el('#animOnionCanvas'), onionCtx = onionCanvas.getContext('2d');
  const drawCanvas = el('#animDrawCanvas'), drawCtx = drawCanvas.getContext('2d');

  const stage3d = el('#anim3dStage');
  const layerCanvas = el('#animLayerCanvas'), layerCtx = layerCanvas.getContext('2d');
  const three3dCanvas = el('#anim3dCanvas');

  el('#animPalette').innerHTML = PALETTE.map(c => `<button class="forge-swatch" style="width:16px;height:16px;background:${c};" data-color="${c}"></button>`).join('');
  el('#animPalette').addEventListener('click', e => {
    const sw = e.target.closest('[data-color]');
    if (!sw) return;
    colorInput.value = sw.dataset.color;
  });

  let tool = 'pencil';
  let curFrameIdx = 0;
  let painting = false;
  let playing = false, playTimer = null, playIdx = 0;
  let lastRefObjId = null;

  function currentObject() { return state.objects.find(o => o.id === objectSelect.value) || null; }
  function currentClip() { const obj = currentObject(); return obj ? clipFor(obj.id) : null; }
  function currentFrame() {
    const clip = currentClip();
    if (!clip) return null;
    if (curFrameIdx >= clip.frames.length) curFrameIdx = clip.frames.length - 1;
    if (curFrameIdx < 0) curFrameIdx = 0;
    return clip.frames[curFrameIdx];
  }

  function refreshObjectList() {
    const prev = objectSelect.value;
    objectSelect.innerHTML = state.objects.length
      ? state.objects.map(o => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')
      : '<option value="">No objects in scene</option>';
    if (state.objects.some(o => o.id === state.selectedId)) objectSelect.value = state.selectedId;
    else if (state.objects.some(o => o.id === prev)) objectSelect.value = prev;
  }

  // ---- type toggle ----
  mount.querySelectorAll('#animTypeToggle [data-type]').forEach(btn => btn.addEventListener('click', async () => {
    const obj = currentObject();
    if (!obj) { toast('Select an object first'); return; }
    const clip = clipFor(obj.id);
    const wantType = btn.dataset.type;
    if (clip.type === wantType) return;
    const hasArt = clip.frames.some(f => (f.cells && Object.keys(f.cells).length) || (f.voxels && Object.keys(f.voxels).length));
    if (hasArt && !(await window.forgeConfirm(`Switch to ${wantType.toUpperCase()}? This resets the clip's frames (dimensions are incompatible).`, { danger: true, confirmText: 'Switch' }))) return;
    state.animClips[obj.id] = defaultClip(wantType);
    state.animClips[obj.id].fps = clip.fps; state.animClips[obj.id].loop = clip.loop;
    curFrameIdx = 0;
    syncTypeUI();
    onObjectChanged();
  }));

  function syncTypeUI() {
    const clip = currentClip() || defaultClip('2d');
    mount.querySelectorAll('#animTypeToggle [data-type]').forEach(b => b.classList.toggle('active', b.dataset.type === clip.type));
    const is3d = clip.type === '3d';
    stage2d.style.display = is3d ? 'none' : '';
    stage3d.style.display = is3d ? 'flex' : 'none';
    el('#animDims2d').style.display = is3d ? 'none' : 'flex';
    el('#animDims3d').style.display = is3d ? 'flex' : 'none';
    el('#animRefWrap').style.display = is3d ? 'none' : 'flex';
    if (is3d) {
      el('#anim3dX').value = clip.sizeX; el('#anim3dY').value = clip.sizeY; el('#anim3dZ').value = clip.sizeZ;
      el('#animLayer').max = el('#animLayerSlider').max = Math.max(0, clip.sizeY - 1);
      if (Number(el('#animLayer').value) >= clip.sizeY) { el('#animLayer').value = 0; el('#animLayerSlider').value = 0; }
      ensureThree();
    } else {
      el('#anim2dW').value = clip.width; el('#anim2dH').value = clip.height;
    }
    fpsInput.value = clip.fps; loopInput.checked = clip.loop;
  }

  el('#animApplyDims').addEventListener('click', () => {
    const clip = currentClip();
    if (!clip) { toast('Select an object first'); return; }
    if (clip.type === '2d') {
      const w = Math.max(2, Math.min(128, Number(el('#anim2dW').value) || clip.width));
      const h = Math.max(2, Math.min(128, Number(el('#anim2dH').value) || clip.height));
      clip.frames.forEach(f => { for (const k of Object.keys(f.cells)) { const [x, y] = k.split(',').map(Number); if (x >= w || y >= h) delete f.cells[k]; } });
      clip.width = w; clip.height = h;
    } else {
      const x = Math.max(1, Math.min(24, Number(el('#anim3dX').value) || clip.sizeX));
      const y = Math.max(1, Math.min(24, Number(el('#anim3dY').value) || clip.sizeY));
      const z = Math.max(1, Math.min(24, Number(el('#anim3dZ').value) || clip.sizeZ));
      clip.frames.forEach(f => { for (const k of Object.keys(f.voxels)) { const [vx, vy, vz] = k.split(',').map(Number); if (vx >= x || vy >= y || vz >= z) delete f.voxels[k]; } });
      clip.sizeX = x; clip.sizeY = y; clip.sizeZ = z;
      el('#animLayer').max = el('#animLayerSlider').max = Math.max(0, y - 1);
    }
    toast('Grid resized');
    onObjectChanged();
  });
  el('#animLayer').addEventListener('input', () => { el('#animLayerSlider').value = el('#animLayer').value; drawLayerGrid(); update3dScene(); });
  el('#animLayerSlider').addEventListener('input', () => { el('#animLayer').value = el('#animLayerSlider').value; drawLayerGrid(); update3dScene(); });

  fpsInput.addEventListener('change', () => { const c = currentClip(); if (c) c.fps = Math.max(1, parseInt(fpsInput.value, 10) || 8); });
  loopInput.addEventListener('change', () => { const c = currentClip(); if (c) c.loop = loopInput.checked; });

  // ---- 2D reference silhouette ----
  function loadReference(obj) {
    refCtx.clearRect(0, 0, refCanvas.width, refCanvas.height);
    if (!obj) return;
    const W = refCanvas.width, H = refCanvas.height;
    if (obj.spriteUrl) {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => {
        refCtx.save(); refCtx.globalAlpha = 0.28;
        const scale = Math.min(W / img.width, H / img.height) * 0.8;
        const w = img.width * scale, h = img.height * scale;
        refCtx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
        refCtx.restore();
      };
      img.src = obj.spriteUrl;
      return;
    }
    refCtx.save(); refCtx.globalAlpha = 0.22; refCtx.fillStyle = TYPE_COLOR[obj.type] || TYPE_COLOR.mesh;
    if (obj.type === 'light' || obj.type === 'audio') { refCtx.beginPath(); refCtx.arc(W / 2, H / 2, Math.min(W, H) * 0.26, 0, Math.PI * 2); refCtx.fill(); }
    else if (obj.type === 'camera') { refCtx.beginPath(); refCtx.moveTo(W / 2, H * 0.26); refCtx.lineTo(W * 0.74, H * 0.74); refCtx.lineTo(W * 0.26, H * 0.74); refCtx.closePath(); refCtx.fill(); }
    else { const s = Math.min(W, H) * 0.5; refCtx.fillRect(W / 2 - s / 2, H / 2 - s / 2, s, s); }
    refCtx.restore();
  }

  // ---- 2D grid drawing ----
  function sizeCanvases2d() {
    const clip = currentClip() || defaultClip('2d');
    const w = clip.width * CELL_PX, h = clip.height * CELL_PX;
    [refCanvas, onionCanvas, drawCanvas].forEach(c => { c.width = w; c.height = h; });
    stage2d.style.width = w + 'px'; stage2d.style.height = h + 'px';
  }
  function drawGridLines(ctx, w, h) {
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
    for (let x = 0; x <= w; x++) { ctx.beginPath(); ctx.moveTo(x * CELL_PX, 0); ctx.lineTo(x * CELL_PX, h * CELL_PX); ctx.stroke(); }
    for (let y = 0; y <= h; y++) { ctx.beginPath(); ctx.moveTo(0, y * CELL_PX); ctx.lineTo(w * CELL_PX, y * CELL_PX); ctx.stroke(); }
    ctx.restore();
  }
  function paintCells(ctx, cells, alpha) {
    ctx.save(); ctx.globalAlpha = alpha;
    for (const [k, color] of Object.entries(cells)) {
      const [x, y] = k.split(',').map(Number);
      ctx.fillStyle = color; ctx.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX);
    }
    ctx.restore();
  }
  function loadOnionSkin() {
    onionCtx.clearRect(0, 0, onionCanvas.width, onionCanvas.height);
    if (!onionToggle.checked) return;
    const clip = currentClip();
    if (!clip) return;
    const prev = clip.frames[curFrameIdx - 1];
    if (prev) paintCells(onionCtx, prev.cells, 0.35);
  }
  function loadCurrentFrame2d() {
    const clip = currentClip(); const f = currentFrame();
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    if (f) paintCells(drawCtx, f.cells, 1);
    drawGridLines(drawCtx, clip.width, clip.height);
    loadOnionSkin();
    updateFrameLabel();
  }
  function cellAt2d(e) {
    const clip = currentClip();
    const r = drawCanvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / (r.width / clip.width));
    const y = Math.floor((e.clientY - r.top) / (r.height / clip.height));
    if (x < 0 || y < 0 || x >= clip.width || y >= clip.height) return null;
    return { x, y };
  }
  function applyCell2d(cell) {
    const f = currentFrame(); if (!f) return;
    const key = `${cell.x},${cell.y}`;
    if (tool === 'pencil') f.cells[key] = colorInput.value;
    else if (tool === 'eraser') delete f.cells[key];
    else if (tool === 'fill') floodFill2d(cell, f.cells);
    else if (tool === 'eyedrop') { if (f.cells[key]) { colorInput.value = f.cells[key]; setTool('pencil'); } }
    loadCurrentFrame2d(); renderFrameStrip();
  }
  function floodFill2d(cell, cells) {
    const clip = currentClip();
    const target = cells[`${cell.x},${cell.y}`] || null;
    const fill = colorInput.value;
    if (target === fill) return;
    const stack = [[cell.x, cell.y]], seen = new Set();
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= clip.width || y >= clip.height) continue;
      const k = `${x},${y}`;
      if (seen.has(k)) continue; seen.add(k);
      const v = cells[k] || null;
      if (v !== target) continue;
      if (fill) cells[k] = fill; else delete cells[k];
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }
  drawCanvas.addEventListener('pointerdown', e => {
    if (!currentObject() || playing) return;
    const cell = cellAt2d(e); if (!cell) return;
    painting = true; applyCell2d(cell); e.preventDefault();
  });
  window.addEventListener('pointermove', e => {
    if (!painting || currentClip()?.type !== '2d' || tool === 'fill' || tool === 'eyedrop') return;
    const cell = cellAt2d(e); if (cell) applyCell2d(cell);
  });
  window.addEventListener('pointerup', () => { painting = false; });

  // ---- 3D layer grid drawing ----
  function sizeCanvases3d() {
    const clip = currentClip(); if (!clip || clip.type !== '3d') return;
    layerCanvas.width = clip.sizeX * LAYER_CELL_PX;
    layerCanvas.height = clip.sizeZ * LAYER_CELL_PX;
  }
  function drawLayerGrid() {
    const clip = currentClip(); if (!clip || clip.type !== '3d') return;
    const layer = Number(el('#animLayer').value) || 0;
    const f = currentFrame();
    layerCtx.clearRect(0, 0, layerCanvas.width, layerCanvas.height);
    layerCtx.save(); layerCtx.globalAlpha = 0.9;
    if (f) for (const [k, color] of Object.entries(f.voxels)) {
      const [x, y, z] = k.split(',').map(Number);
      if (y !== layer) continue;
      layerCtx.fillStyle = color; layerCtx.fillRect(x * LAYER_CELL_PX, z * LAYER_CELL_PX, LAYER_CELL_PX, LAYER_CELL_PX);
    }
    layerCtx.restore();
    drawGridLinesCustom(layerCtx, clip.sizeX, clip.sizeZ, LAYER_CELL_PX);
    updateFrameLabel();
  }
  function drawGridLinesCustom(ctx, w, h, px) {
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
    for (let x = 0; x <= w; x++) { ctx.beginPath(); ctx.moveTo(x * px, 0); ctx.lineTo(x * px, h * px); ctx.stroke(); }
    for (let y = 0; y <= h; y++) { ctx.beginPath(); ctx.moveTo(0, y * px); ctx.lineTo(w * px, y * px); ctx.stroke(); }
    ctx.restore();
  }
  function cellAt3d(e) {
    const clip = currentClip();
    const r = layerCanvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / (r.width / clip.sizeX));
    const z = Math.floor((e.clientY - r.top) / (r.height / clip.sizeZ));
    if (x < 0 || z < 0 || x >= clip.sizeX || z >= clip.sizeZ) return null;
    return { x, y: Number(el('#animLayer').value) || 0, z };
  }
  function applyVoxel(cell) {
    const f = currentFrame(); if (!f) return;
    const key = `${cell.x},${cell.y},${cell.z}`;
    if (tool === 'pencil') f.voxels[key] = colorInput.value;
    else if (tool === 'eraser') delete f.voxels[key];
    else if (tool === 'fill') floodFill3d(cell, f.voxels);
    else if (tool === 'eyedrop') { if (f.voxels[key]) { colorInput.value = f.voxels[key]; setTool('pencil'); } }
    drawLayerGrid(); update3dScene(); renderFrameStrip();
  }
  function floodFill3d(cell, voxels) {
    const clip = currentClip();
    const layer = cell.y;
    const target = voxels[`${cell.x},${layer},${cell.z}`] || null;
    const fill = colorInput.value;
    if (target === fill) return;
    const stack = [[cell.x, cell.z]], seen = new Set();
    while (stack.length) {
      const [x, z] = stack.pop();
      if (x < 0 || z < 0 || x >= clip.sizeX || z >= clip.sizeZ) continue;
      const k = `${x},${z}`;
      if (seen.has(k)) continue; seen.add(k);
      const vk = `${x},${layer},${z}`;
      const v = voxels[vk] || null;
      if (v !== target) continue;
      if (fill) voxels[vk] = fill; else delete voxels[vk];
      stack.push([x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]);
    }
  }
  layerCanvas.addEventListener('pointerdown', e => {
    if (!currentObject() || playing) return;
    const cell = cellAt3d(e); if (!cell) return;
    painting = true; applyVoxel(cell); e.preventDefault();
  });
  window.addEventListener('pointermove', e => {
    if (!painting || currentClip()?.type !== '3d' || tool === 'fill' || tool === 'eyedrop') return;
    const cell = cellAt3d(e); if (cell) applyVoxel(cell);
  });

  // ---- Three.js live voxel preview ----
  let renderer, scene, camera, controls, voxelGroup, onionGroup, layerPlane, threeReady = false;
  function ensureThree() {
    if (threeReady) { resizeThree(); return; }
    threeReady = true;
    renderer = new THREE.WebGLRenderer({ canvas: three3dCanvas, antialias: true });
    renderer.setClearColor(0x14161a, 1);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
    camera.position.set(10, 9, 10);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1); sun.position.set(6, 9, 4); scene.add(sun);
    scene.add(new THREE.GridHelper(24, 24, 0x3a4149, 0x232830));
    voxelGroup = new THREE.Group(); scene.add(voxelGroup);
    onionGroup = new THREE.Group(); scene.add(onionGroup);
    layerPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x41a6f6, transparent: true, opacity: 0.12, side: THREE.DoubleSide }));
    layerPlane.rotation.x = -Math.PI / 2;
    scene.add(layerPlane);
    new ResizeObserver(resizeThree).observe(three3dCanvas.parentElement);
    resizeThree();
    (function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();
  }
  function resizeThree() {
    if (!threeReady) return;
    const w = Math.max(1, three3dCanvas.parentElement.clientWidth), h = Math.max(1, three3dCanvas.parentElement.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const voxelBoxGeo = new THREE.BoxGeometry(0.94, 0.94, 0.94);
  const matCache = new Map();
  function matFor(hex, opacity) {
    const key = hex + '@' + opacity;
    if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), transparent: opacity < 1, opacity }));
    return matCache.get(key);
  }
  function buildVoxelGroup(group, voxels, cx, cz, opacity) {
    while (group.children.length) group.remove(group.children[0]);
    for (const [k, color] of Object.entries(voxels)) {
      const [x, y, z] = k.split(',').map(Number);
      const mesh = new THREE.Mesh(voxelBoxGeo, matFor(color, opacity));
      mesh.position.set(x - cx, y + 0.5, z - cz);
      group.add(mesh);
    }
  }
  function update3dScene() {
    if (!threeReady) return;
    const clip = currentClip(); const f = currentFrame();
    if (!clip || clip.type !== '3d' || !f) { buildVoxelGroup(voxelGroup, {}, 0, 0, 1); buildVoxelGroup(onionGroup, {}, 0, 0, 1); layerPlane.visible = false; return; }
    const cx = clip.sizeX / 2 - 0.5, cz = clip.sizeZ / 2 - 0.5;
    buildVoxelGroup(voxelGroup, f.voxels, cx, cz, 1);
    const prev = onionToggle.checked ? clip.frames[curFrameIdx - 1] : null;
    buildVoxelGroup(onionGroup, prev ? prev.voxels : {}, cx, cz, 0.25);
    const layer = Number(el('#animLayer').value) || 0;
    layerPlane.visible = true;
    layerPlane.scale.set(clip.sizeX, clip.sizeZ, 1);
    layerPlane.position.set(0, layer + 0.02, 0);
  }

  // ---- shared tools ----
  function setTool(t) {
    tool = t;
    mount.querySelectorAll('.anim-tool').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
    const cur = tool === 'eyedrop' ? 'copy' : tool === 'fill' ? 'cell' : 'crosshair';
    drawCanvas.style.cursor = cur; layerCanvas.style.cursor = cur;
  }
  mount.querySelectorAll('.anim-tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
  el('#animClearFrame').addEventListener('click', () => {
    const f = currentFrame(); if (!f) return;
    if (f.cells) f.cells = {}; if (f.voxels) f.voxels = {};
    loadCurrentFrame2d(); drawLayerGrid(); update3dScene(); renderFrameStrip();
  });
  onionToggle.addEventListener('change', () => { loadOnionSkin(); update3dScene(); });
  refToggle.addEventListener('change', () => { refCanvas.style.display = refToggle.checked ? 'block' : 'none'; });
  el('#animDupFrame').addEventListener('click', addFrame);
  el('#animDelFrame').addEventListener('click', () => deleteFrame(curFrameIdx));

  objectSelect.addEventListener('change', () => { stopPlayback(); curFrameIdx = 0; syncTypeUI(); onObjectChanged(); });

  function onObjectChanged() {
    const obj = currentObject();
    if (!obj) {
      stageHint.style.display = 'block';
      stageHint.textContent = state.objects.length ? 'Pick an object above to animate it.' : 'Add an object to the scene first.';
      refCtx.clearRect(0, 0, refCanvas.width, refCanvas.height);
      drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
      onionCtx.clearRect(0, 0, onionCanvas.width, onionCanvas.height);
      updateFrameLabel(); renderFrameStrip();
      return;
    }
    stageHint.style.display = 'none';
    const clip = clipFor(obj.id);
    if (clip.type === '2d') {
      sizeCanvases2d();
      if (lastRefObjId !== obj.id) { loadReference(obj); lastRefObjId = obj.id; }
      loadCurrentFrame2d();
    } else {
      sizeCanvases3d();
      drawLayerGrid();
      ensureThree();
      update3dScene();
    }
    renderFrameStrip();
  }

  // ---- thumbnails ----
  function renderThumb2d(frame, clip) {
    const c = document.createElement('canvas'); c.width = 48; c.height = 48;
    const cx = c.getContext('2d');
    const px = Math.min(48 / clip.width, 48 / clip.height);
    for (const [k, color] of Object.entries(frame.cells)) {
      const [x, y] = k.split(',').map(Number);
      cx.fillStyle = color; cx.fillRect(x * px, y * px, Math.ceil(px), Math.ceil(px));
    }
    return c.toDataURL();
  }
  // Lightweight isometric painter's-algorithm renderer — used for frame-strip
  // thumbnails and re-implemented standalone inside the exported preview
  // player (see standalonePreviewHtml) so the exported JSON+HTML preview
  // never depends on Three.js.
  function renderThumb3d(frame, clip) {
    const c = document.createElement('canvas'); c.width = 48; c.height = 48;
    const cx = c.getContext('2d');
    drawIso(cx, frame.voxels, clip.sizeX, clip.sizeY, clip.sizeZ, 48, 48);
    return c.toDataURL();
  }
  function drawIso(cx, voxels, sx, sy, sz, W, H) {
    const cell = Math.max(2, Math.min(W / (sx + sz), H / (sy + (sx + sz) / 2)) * 0.9);
    const originX = W / 2, originY = H * 0.14;
    const entries = Object.entries(voxels).map(([k, color]) => {
      const [x, y, z] = k.split(',').map(Number);
      return { x, y, z, color, depth: x + z - y };
    }).sort((a, b) => a.depth - b.depth);
    entries.forEach(v => {
      const sx2 = originX + (v.x - v.z) * cell * 0.866;
      const sy2 = originY + (v.x + v.z) * cell * 0.5 - v.y * cell;
      cx.fillStyle = v.color;
      cx.beginPath();
      cx.moveTo(sx2, sy2 - cell * 0.5);
      cx.lineTo(sx2 + cell * 0.866, sy2 - cell * 0.5 + cell * 0.5);
      cx.lineTo(sx2, sy2 + cell * 0.5);
      cx.lineTo(sx2 - cell * 0.866, sy2 - cell * 0.5 + cell * 0.5);
      cx.closePath(); cx.fill();
      cx.strokeStyle = 'rgba(0,0,0,0.25)'; cx.stroke();
    });
  }

  function updateFrameLabel() {
    const clip = currentClip();
    const total = clip ? clip.frames.length : 1;
    frameLabel.textContent = `Frame ${curFrameIdx + 1} / ${total}`;
  }
  function renderFrameStrip() {
    const clip = currentClip();
    if (!clip) { frameStrip.innerHTML = ''; return; }
    frameStrip.innerHTML = clip.frames.map((f, i) => `
      <div class="anim-frame-thumb${i === curFrameIdx ? ' active' : ''}" data-idx="${i}">
        <img src="${clip.type === '2d' ? renderThumb2d(f, clip) : renderThumb3d(f, clip)}" alt="">
        <span class="fnum">${i + 1}</span>
        <span class="fdel" data-del="${i}" title="Delete frame">✕</span>
      </div>`).join('');
    frameStrip.querySelectorAll('.anim-frame-thumb').forEach(node => {
      node.addEventListener('click', e => { if (!e.target.closest('.fdel')) selectFrame(parseInt(node.dataset.idx, 10)); });
    });
    frameStrip.querySelectorAll('.fdel').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); deleteFrame(parseInt(btn.dataset.del, 10)); }));
    frameStrip.querySelector('.anim-frame-thumb.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function selectFrame(idx) {
    stopPlayback(); curFrameIdx = idx;
    refreshFrameView(); renderFrameStrip();
  }
  function refreshFrameView() {
    const clip = currentClip(); if (!clip) return;
    if (clip.type === '2d') loadCurrentFrame2d(); else { drawLayerGrid(); update3dScene(); }
  }
  function addFrame() {
    const clip = currentClip(); if (!clip) { toast('Select an object first'); return; }
    stopPlayback();
    const src = clip.frames[curFrameIdx];
    const copy = clip.type === '2d' ? { cells: { ...src.cells } } : { voxels: { ...src.voxels } };
    clip.frames.splice(curFrameIdx + 1, 0, copy);
    curFrameIdx++;
    refreshFrameView(); renderFrameStrip();
  }
  function deleteFrame(idx) {
    const clip = currentClip(); if (!clip) return;
    stopPlayback();
    if (clip.frames.length <= 1) { clip.frames[0] = clip.type === '2d' ? { cells: {} } : { voxels: {} }; curFrameIdx = 0; }
    else { clip.frames.splice(idx, 1); if (curFrameIdx >= clip.frames.length) curFrameIdx = clip.frames.length - 1; }
    refreshFrameView(); renderFrameStrip();
  }

  // ---- playback ----
  function updatePlayButton() { playBtn.textContent = playing ? '■ Stop' : '▶ Play'; }
  function play() {
    const clip = currentClip();
    if (!clip) { toast('Select an object first'); return; }
    if (clip.frames.length < 2) { toast('Add at least 2 frames to preview playback'); return; }
    playing = true; playIdx = 0; updatePlayButton();
    const fps = Math.max(1, parseInt(fpsInput.value, 10) || 8);
    clearInterval(playTimer);
    playTimer = setInterval(() => {
      curFrameIdx = playIdx % clip.frames.length;
      refreshFrameView(); renderFrameStrip();
      playIdx++;
      if (playIdx >= clip.frames.length && !loopInput.checked) stopPlayback();
    }, 1000 / fps);
  }
  function stopPlayback() {
    if (!playing) return;
    playing = false; clearInterval(playTimer); playTimer = null; updatePlayButton();
  }
  playBtn.addEventListener('click', () => { playing ? stopPlayback() : play(); });
  window.addEventListener('keydown', e => {
    if (!document.body.classList.contains('tool-modal-open')) return;
    if (e.key === ' ') { if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return; e.preventDefault(); playing ? stopPlayback() : play(); }
  });

  // ---- export as JSON (not SVG) ----
  function buildClipJson() {
    const obj = currentObject();
    if (!obj) { toast('Select an object first'); return null; }
    const clip = currentClip();
    const hasArt = clip.frames.some(f => Object.keys(f.cells || f.voxels).length);
    if (!hasArt) { toast('Draw at least one frame first'); return null; }
    const name = nameInput.value.trim() || `${obj.name.replace(/\s+/g, '-').toLowerCase()}-anim`;
    const json = { forgeAnimation: 1, name, type: clip.type, fps: Math.max(1, parseInt(fpsInput.value, 10) || 8), loop: loopInput.checked,
      ...(clip.type === '2d' ? { width: clip.width, height: clip.height } : { sizeX: clip.sizeX, sizeY: clip.sizeY, sizeZ: clip.sizeZ }),
      frames: clip.frames.map(f => clip.type === '2d' ? { cells: { ...f.cells } } : { voxels: { ...f.voxels } }) };
    return { obj, clip, name, json };
  }

  function standalonePreviewHtml(json) {
    const data = JSON.stringify(json).replace(/</g, '\\u003c');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(json.name)} — ForgeEngine animation preview</title>
<style>html,body{margin:0;height:100%;background:#14161a;display:flex;align-items:center;justify-content:center;font-family:sans-serif;color:#c7cad0}canvas{background:repeating-conic-gradient(#22262c 0% 25%,#1a1c20 0% 50%) 50%/22px 22px;border-radius:8px}#wrap{text-align:center}#lbl{margin-top:8px;font-size:12px;opacity:.7}</style>
</head><body><div id="wrap"><canvas id="c" width="480" height="480"></canvas><div id="lbl"></div></div>
<script>
const clip = ${data};
const cv = document.getElementById('c'), ctx = cv.getContext('2d'), lbl = document.getElementById('lbl');
function drawIso(voxels, sx, sy, sz, W, H) {
  ctx.clearRect(0,0,W,H);
  const cell = Math.max(2, Math.min(W/(sx+sz), H/(sy+(sx+sz)/2)) * 0.85);
  const ox = W/2, oy = H*0.12;
  Object.entries(voxels).map(([k,color]) => { const [x,y,z]=k.split(',').map(Number); return {x,y,z,color,depth:x+z-y}; })
    .sort((a,b)=>a.depth-b.depth).forEach(v => {
      const sx2 = ox + (v.x - v.z) * cell * 0.866;
      const sy2 = oy + (v.x + v.z) * cell * 0.5 - v.y * cell;
      ctx.fillStyle = v.color; ctx.beginPath();
      ctx.moveTo(sx2, sy2 - cell*0.5); ctx.lineTo(sx2+cell*0.866, sy2-cell*0.5+cell*0.5);
      ctx.lineTo(sx2, sy2+cell*0.5); ctx.lineTo(sx2-cell*0.866, sy2-cell*0.5+cell*0.5);
      ctx.closePath(); ctx.fill(); ctx.strokeStyle='rgba(0,0,0,.25)'; ctx.stroke();
    });
}
function drawGrid(cells, w, h) {
  ctx.clearRect(0,0,cv.width,cv.height);
  const px = Math.min(cv.width/w, cv.height/h);
  Object.entries(cells).forEach(([k,color]) => { const [x,y]=k.split(',').map(Number); ctx.fillStyle=color; ctx.fillRect(x*px,y*px,Math.ceil(px),Math.ceil(px)); });
}
let i = 0;
function tick() {
  const f = clip.frames[i % clip.frames.length];
  if (clip.type === '2d') drawGrid(f.cells, clip.width, clip.height); else drawIso(f.voxels, clip.sizeX, clip.sizeY, clip.sizeZ, cv.width, cv.height);
  lbl.textContent = clip.name + ' — frame ' + ((i % clip.frames.length) + 1) + '/' + clip.frames.length + ' @ ' + clip.fps + ' fps';
  i++;
  if (i >= clip.frames.length && !clip.loop) return;
  setTimeout(tick, 1000 / clip.fps);
}
tick();
<\/script></body></html>`;
  }

  el('#animPreviewJson').addEventListener('click', () => {
    const out = buildClipJson(); if (!out) return;
    const blob = new Blob([standalonePreviewHtml(out.json)], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
  });

  el('#animSave').addEventListener('click', async () => {
    if (!state.slug) return;
    const out = buildClipJson(); if (!out) return;
    const { name, json } = out;
    try {
      const payload = { name: `${name}.anim.json`, category: 'animation', mime: 'application/json',
        dataUrl: `data:application/json;base64,${btoa(unescape(encodeURIComponent(JSON.stringify(json, null, 2))))}` };
      const { asset } = await api(`/api/games/${encodeURIComponent(state.slug)}/assets`, { method: 'POST', body: JSON.stringify(payload) });
      toast(asset?.overwritten ? `Exported — overwrote existing "${name}.anim.json"` : `Exported animation "${name}.anim.json" to Assets`);
      log('info', `Animation: exported "${name}.anim.json" (${json.frames.length} frames, ${json.type})${asset?.overwritten ? ' — overwrote previous version' : ''}`);
      window.__forgeLoadAssets?.();
    } catch (error) { toast(error.message); }
  });

  // ---- mount lifecycle ----
  function render() { refreshObjectList(); syncTypeUI(); onObjectChanged(); }
  window.addEventListener('forge-tool-modal-open', e => { if (e.detail?.name === 'animation') { render(); resizeThree(); } });
  window.addEventListener('forge-tool-modal-close', stopPlayback);
  window.__forgeRenderKeyframes = render; // kept for compatibility with editor.js's selection-changed hook

  render();
})();
