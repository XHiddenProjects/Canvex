"use strict";
import * as THREE from './vendor/three/three.module.js';
import { OrbitControls } from './vendor/three/OrbitControls.js';

(() => {
  const mount = document.getElementById('modelPanel');
  const state = window.__forgeState;
  if (!mount || !state) return;
  const api = window.__forgeApi, toast = window.__forgeToast, log = window.__forgeLog, escapeHtml = window.__forgeEscape;

  const PRIMS = { box: '▰', sphere: '◯', cylinder: '▮', cone: '▲', plane: '▭' };
  const model = { name: 'New Model', primitives: [] };
  let selected = null;

  function newPrimitive(type) {
    return { id: `p${Date.now().toString(36)}${Math.floor(Math.random() * 999)}`, type,
      position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#41a6f6' };
  }

  mount.innerHTML = `
    <div class="forge-tool">
      <aside class="forge-tool__rail">
        <div>
          <h4>Add Primitive</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
            ${Object.entries(PRIMS).map(([t, g]) => `<button data-add="${t}">${g} ${t}</button>`).join('')}
          </div>
        </div>
        <div style="flex:1;min-height:0;display:flex;flex-direction:column">
          <h4>Primitives</h4>
          <div id="modelList" style="overflow:auto;flex:1;display:flex;flex-direction:column;gap:4px"></div>
        </div>
      </aside>
      <div class="forge-tool__main">
        <div class="forge-tool__toolbar">
          <input id="modelName" placeholder="model-name" value="${escapeHtml(model.name)}" style="width:160px">
          <button id="modelSave">💾 Save as Asset</button>
          <button id="modelClear">Clear</button>
          <span class="muted" style="margin-left:auto">Drag to orbit · Wheel to zoom · Click to select</span>
        </div>
        <div class="forge-tool__stage"><canvas id="modelCanvas"></canvas></div>
        <div class="forge-tool__panel" id="modelInspector"><span class="muted">Select a primitive to edit its transform.</span></div>
      </div>
    </div>`;

  const canvas = mount.querySelector('#modelCanvas');
  const stage = mount.querySelector('.forge-tool__stage');

  // -----------------------------------------------------------
  // Three.js scene: real WebGL renderer, camera, lights, grid —
  // replaces the previous hand-rolled Canvas2D yaw/pitch projection.
  // -----------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setClearColor(0x14161a, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14161a);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
  camera.position.set(5.5, 4.5, 5.5);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0.5, 0);
  controls.minDistance = 1.5;
  controls.maxDistance = 60;

  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambient);
  const hemi = new THREE.HemisphereLight(0x8fb4ff, 0x14161a, 0.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.15);
  sun.position.set(6, 9, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 40;
  sun.shadow.camera.left = -10; sun.shadow.camera.right = 10;
  sun.shadow.camera.top = 10; sun.shadow.camera.bottom = -10;
  scene.add(sun);

  const grid = new THREE.GridHelper(12, 12, 0x3a4149, 0x232830);
  grid.material.transparent = true;
  grid.material.opacity = 0.85;
  scene.add(grid);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.MeshStandardMaterial({ color: 0x1a1d23, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const selectionOutline = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xff9d58, wireframe: true, depthTest: false })
  );
  selectionOutline.visible = false;
  selectionOutline.renderOrder = 999;
  scene.add(selectionOutline);

  const geometries = {
    box: () => new THREE.BoxGeometry(1, 1, 1),
    sphere: () => new THREE.SphereGeometry(0.6, 32, 24),
    cylinder: () => new THREE.CylinderGeometry(0.55, 0.55, 1, 24),
    cone: () => new THREE.ConeGeometry(0.6, 1.1, 24),
    plane: () => new THREE.PlaneGeometry(1.2, 1.2)
  };

  const meshes = new Map(); // primitive id -> THREE.Mesh

  function meshFor(prim) {
    let mesh = meshes.get(prim.id);
    if (!mesh) {
      const geo = (geometries[prim.type] || geometries.box)();
      const mat = new THREE.MeshStandardMaterial({ color: prim.color, roughness: 0.55, metalness: 0.05 });
      mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.primId = prim.id;
      scene.add(mesh);
      meshes.set(prim.id, mesh);
    }
    mesh.position.set(prim.position.x, prim.position.y, prim.position.z);
    mesh.rotation.set(
      THREE.MathUtils.degToRad(prim.rotation.x || 0),
      THREE.MathUtils.degToRad(prim.rotation.y || 0),
      THREE.MathUtils.degToRad(prim.rotation.z || 0)
    );
    mesh.scale.set(prim.scale.x || 1, prim.scale.y || 1, prim.scale.z || 1);
    mesh.material.color.set(prim.color);
    return mesh;
  }

  function syncMeshes() {
    const liveIds = new Set(model.primitives.map(p => p.id));
    for (const [id, mesh] of [...meshes]) {
      if (!liveIds.has(id)) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); meshes.delete(id); }
    }
    model.primitives.forEach(meshFor);
    const selMesh = selected ? meshes.get(selected) : null;
    if (selMesh) {
      selectionOutline.visible = true;
      selectionOutline.position.copy(selMesh.position);
      selectionOutline.rotation.copy(selMesh.rotation);
      selectionOutline.scale.copy(selMesh.scale).multiplyScalar(1.03);
    } else {
      selectionOutline.visible = false;
    }
  }

  function resize() {
    const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);

  function render() { syncMeshes(); }

  // -----------------------------------------------------------
  // Selection via raycasting (click, not drag — OrbitControls
  // already owns drag-to-orbit on the same canvas).
  // -----------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let downX = 0, downY = 0;

  canvas.addEventListener('pointerdown', e => { downX = e.clientX; downY = e.clientY; });
  canvas.addEventListener('pointerup', e => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return; // was an orbit drag, not a click
    const rect = canvas.getBoundingClientRect();
    pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects([...meshes.values()], false);
    if (hits.length) { selected = hits[0].object.userData.primId; renderList(); renderInspector(); render(); }
    else { selected = null; renderList(); renderInspector(); render(); }
  });

  function renderList() {
    mount.querySelector('#modelList').innerHTML = model.primitives.map(p => `
      <button data-select="${p.id}" style="display:flex;align-items:center;gap:6px;justify-content:space-between;${p.id === selected ? 'background:#30353d' : ''}">
        <span>${PRIMS[p.type]} ${escapeHtml(p.type)}</span><span data-remove="${p.id}" style="color:#9298a1">×</span>
      </button>`).join('') || '<span class="muted">No primitives yet — add one from the left.</span>';
  }

  function renderInspector() {
    const panel = mount.querySelector('#modelInspector');
    const prim = model.primitives.find(p => p.id === selected);
    if (!prim) { panel.innerHTML = '<span class="muted">Select a primitive to edit its transform.</span>'; return; }
    const vec = (label, key) => `<div class="field-row" style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
      <label style="width:60px">${label}</label>
      ${['x', 'y', 'z'].map(ax => `<input data-vec="${key}.${ax}" type="number" step="0.1" value="${prim[key][ax]}" style="width:64px">`).join('')}
    </div>`;
    panel.innerHTML = `
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <div>${vec('Position', 'position')}${vec('Rotation', 'rotation')}${vec('Scale', 'scale')}</div>
        <div><h4>Color</h4><input type="color" value="${prim.color}" id="modelColor"></div>
      </div>`;
    panel.querySelectorAll('[data-vec]').forEach(input => input.addEventListener('input', () => {
      const [key, ax] = input.dataset.vec.split('.');
      prim[key][ax] = Number(input.value) || 0;
      render();
    }));
    panel.querySelector('#modelColor').addEventListener('input', e => { prim.color = e.target.value; render(); });
  }

  mount.querySelectorAll('[data-add]').forEach(btn => btn.addEventListener('click', () => {
    const prim = newPrimitive(btn.dataset.add);
    prim.position = { x: (Math.random() - 0.5) * 2, y: 0.5, z: (Math.random() - 0.5) * 2 };
    model.primitives.push(prim);
    selected = prim.id;
    renderList(); renderInspector(); render();
  }));

  mount.querySelector('#modelList').addEventListener('click', e => {
    const rm = e.target.closest('[data-remove]');
    if (rm) { model.primitives = model.primitives.filter(p => p.id !== rm.dataset.remove); if (selected === rm.dataset.remove) selected = null; renderList(); renderInspector(); render(); return; }
    const sel = e.target.closest('[data-select]');
    if (sel) { selected = sel.dataset.select; renderList(); renderInspector(); render(); }
  });

  mount.querySelector('#modelClear').addEventListener('click', () => {
    if (model.primitives.length && !window.confirm('Clear all primitives?')) return;
    model.primitives = []; selected = null; renderList(); renderInspector(); render();
  });

  mount.querySelector('#modelSave').addEventListener('click', async () => {
    if (!state.slug) return;
    const name = mount.querySelector('#modelName').value.trim() || `model-${Date.now()}`;
    if (!model.primitives.length) { toast('Add at least one primitive first'); return; }
    try {
      const payload = { name: `${name}.model.json`, category: 'model', mime: 'application/json',
        dataUrl: `data:application/json;base64,${btoa(unescape(encodeURIComponent(JSON.stringify({ name, primitives: model.primitives }, null, 2))))}` };
      await api(`/api/games/${encodeURIComponent(state.slug)}/assets`, { method: 'POST', body: JSON.stringify(payload) });
      toast(`Saved model "${name}" to Assets`);
      log('info', `Model saved as asset "${name}" (${model.primitives.length} primitives)`);
      window.__forgeLoadAssets?.();
    } catch (error) { toast(error.message); }
  });

  renderList(); renderInspector();
  resize();

  // Continuous render loop — needed for OrbitControls damping and
  // WebGL (unlike the old Canvas2D version, this can't just redraw on events).
  function loop() {
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(loop);
})();
