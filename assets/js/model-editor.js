"use strict";
import * as THREE from './vendor/three/three.module.js';
import { OrbitControls } from './vendor/three/OrbitControls.js';
import { TransformControls } from './vendor/three/TransformControls.js';
import { OBJExporter } from './vendor/three/OBJExporter.js';
import { OBJLoader } from './vendor/three/OBJLoader.js';
import { MTLLoader } from './vendor/three/MTLLoader.js';

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
          <div class="tool-group" id="modelTransformTools">
            <button class="tool active" data-mtool="select" title="Select (Q)">↖</button><button class="tool" data-mtool="move" title="Move (W)">✣</button><button class="tool" data-mtool="rotate" title="Rotate (E)">↻</button><button class="tool" data-mtool="scale" title="Scale (R)">⤢</button>
          </div>
          <button class="text-tool active" id="modelSpaceToggle" title="Toggle world/local gizmo space">Global</button>
          <input id="modelName" placeholder="model-name" value="${escapeHtml(model.name)}" style="width:160px">
          <button id="modelSave">💾 Save as Asset</button>
          <button id="modelClear">Clear</button>
          <span class="muted" style="margin-left:auto">Drag gizmo to transform · RMB drag to orbit · Wheel to zoom · Click to select</span>
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
  // LMB is reserved for selecting/dragging the transform gizmo (matches the
  // main scene editor's convention); orbit moves to RMB, pan to MMB.
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

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

  // A wireframe Mesh (BoxGeometry + wireframe material) renders every
  // triangle edge, including the diagonal that splits each face into two
  // triangles — that's the stray criss-crossing lines across each face.
  // EdgesGeometry + LineSegments instead draws only the 12 real edges of
  // the box, which is what a selection outline should look like.
  const selectionOutline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    new THREE.LineBasicMaterial({ color: 0xff9d58, depthTest: false })
  );
  selectionOutline.visible = false;
  selectionOutline.renderOrder = 999;
  scene.add(selectionOutline);

  // -----------------------------------------------------------
  // Transform gizmo (move / rotate / scale) — the same draggable-axis
  // gizmo lines used in the main scene editor, so a selected primitive
  // here can be moved/rotated/scaled directly in the viewport instead of
  // only through the numeric inspector fields below.
  // -----------------------------------------------------------
  let mtool = 'select';
  const transformControls = new TransformControls(camera, renderer.domElement);
  transformControls.setSize(0.9);
  scene.add(transformControls.getHelper());
  transformControls.addEventListener('dragging-changed', e => { controls.enabled = !e.value; });
  transformControls.addEventListener('objectChange', () => {
    const prim = model.primitives.find(p => p.id === selected);
    const mesh = selected ? meshes.get(selected) : null;
    if (!prim || !mesh) return;
    const round = n => Math.round(n * 1000) / 1000;
    prim.position.x = round(mesh.position.x); prim.position.y = round(mesh.position.y); prim.position.z = round(mesh.position.z);
    prim.rotation.x = round(THREE.MathUtils.radToDeg(mesh.rotation.x));
    prim.rotation.y = round(THREE.MathUtils.radToDeg(mesh.rotation.y));
    prim.rotation.z = round(THREE.MathUtils.radToDeg(mesh.rotation.z));
    prim.scale.x = round(mesh.scale.x); prim.scale.y = round(mesh.scale.y); prim.scale.z = round(mesh.scale.z);
    renderInspector();
  });

  function applyMTool() {
    // Same fix as the main scene editor: don't hide the gizmo just because
    // "Select" is the active tool — show a draggable gizmo (translate by
    // default) the moment something is selected, so dragging works without
    // an extra click and without falling back to typing numbers.
    if (!selected || !meshes.get(selected)) {
      transformControls.enabled = false;
      transformControls.visible = false;
      return;
    }
    transformControls.enabled = true;
    transformControls.visible = true;
    transformControls.setMode(mtool === 'rotate' ? 'rotate' : mtool === 'scale' ? 'scale' : 'translate');
  }

  function attachGizmo() {
    const mesh = selected ? meshes.get(selected) : null;
    if (mesh) transformControls.attach(mesh); else transformControls.detach();
    applyMTool();
  }

  mount.querySelectorAll('[data-mtool]').forEach(btn => btn.addEventListener('click', () => {
    mount.querySelectorAll('[data-mtool]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    mtool = btn.dataset.mtool;
    applyMTool();
    toast?.(`${btn.title.split(' ')[0]} tool active`);
  }));

  mount.querySelector('#modelSpaceToggle').addEventListener('click', e => {
    const next = e.currentTarget.textContent.trim() === 'Global' ? 'Local' : 'Global';
    e.currentTarget.textContent = next;
    transformControls.setSpace(next === 'Global' ? 'world' : 'local');
    toast?.(`${next} space`);
  });

  document.addEventListener('keydown', e => {
    if (!mount.classList.contains('active') || !mount.offsetParent || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    const map = { q: 'select', w: 'move', e: 'rotate', r: 'scale' };
    const key = e.key.toLowerCase();
    if (map[key]) mount.querySelector(`[data-mtool="${map[key]}"]`)?.click();
  });

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
    if (hits.length) { selected = hits[0].object.userData.primId; renderList(); renderInspector(); attachGizmo(); render(); }
    else { selected = null; renderList(); renderInspector(); attachGizmo(); render(); }
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
    renderList(); renderInspector(); attachGizmo(); render();
  }));

  mount.querySelector('#modelList').addEventListener('click', e => {
    const rm = e.target.closest('[data-remove]');
    if (rm) { model.primitives = model.primitives.filter(p => p.id !== rm.dataset.remove); if (selected === rm.dataset.remove) selected = null; renderList(); renderInspector(); attachGizmo(); render(); return; }
    const sel = e.target.closest('[data-select]');
    if (sel) { selected = sel.dataset.select; renderList(); renderInspector(); attachGizmo(); render(); }
  });

  mount.querySelector('#modelClear').addEventListener('click', async () => {
    if (model.primitives.length && !(await window.forgeConfirm('Clear all primitives?', { danger: true, confirmText: 'Clear' }))) return;
    model.primitives = []; selected = null; renderList(); renderInspector(); attachGizmo(); render();
  });

  mount.querySelector('#modelSave').addEventListener('click', async () => {
    if (!state.slug) return;
    const name = mount.querySelector('#modelName').value.trim() || `model-${Date.now()}`;
    if (!model.primitives.length) { toast('Add at least one primitive first'); return; }
    try {
      // Export real Wavefront .obj geometry (not the old custom JSON blob)
      // so the file is an actual OBJ model — the same one the main editor's
      // viewport (forge-viewport.js) loads and displays when this asset is
      // attached to a game object. Cloning the live, already-positioned
      // meshes means the exported geometry matches exactly what's on screen.
      //
      // OBJExporter only writes geometry — it explicitly doesn't emit
      // material data — so each primitive's color would otherwise be lost
      // on export. To keep it, give each cloned mesh's material a unique
      // name before exporting (OBJExporter then writes a matching `usemtl`
      // line for it) and hand-build the companion .mtl file ourselves,
      // one `newmtl` block per primitive color, referenced by `mtllib` at
      // the top of the .obj — the standard OBJ/MTL pairing.
      const mtlName = `${name}.mtl`;
      const exportGroup = new THREE.Group();
      const mtlBlocks = [];
      model.primitives.forEach((prim, i) => {
        const mesh = meshes.get(prim.id);
        if (!mesh) return;
        const clone = mesh.clone();
        const matName = `mat_${i}_${prim.type}`;
        clone.material = mesh.material.clone();
        clone.material.name = matName;
        clone.name = `${prim.type}_${i}`;
        exportGroup.add(clone);
        const c = new THREE.Color(prim.color);
        mtlBlocks.push(
          `newmtl ${matName}\nKa 0.0 0.0 0.0\nKd ${c.r.toFixed(4)} ${c.g.toFixed(4)} ${c.b.toFixed(4)}\nKs 0.1 0.1 0.1\nNs 40.0\nd 1.0\nillum 2`
        );
      });
      const objBody = new OBJExporter().parse(exportGroup);
      const objText = `mtllib ${mtlName}\n${objBody}`;
      const mtlText = mtlBlocks.join('\n\n') + '\n';

      const objPayload = { name: `${name}.obj`, category: 'model', mime: 'model/obj',
        dataUrl: `data:model/obj;base64,${btoa(unescape(encodeURIComponent(objText)))}` };
      const mtlPayload = { name: mtlName, category: 'model', mime: 'model/mtl',
        dataUrl: `data:model/mtl;base64,${btoa(unescape(encodeURIComponent(mtlText)))}` };

      const [{ asset: objAsset }, { asset: mtlAsset }] = await Promise.all([
        api(`/api/games/${encodeURIComponent(state.slug)}/assets`, { method: 'POST', body: JSON.stringify(objPayload) }),
        api(`/api/games/${encodeURIComponent(state.slug)}/assets`, { method: 'POST', body: JSON.stringify(mtlPayload) })
      ]);
      const anyOverwritten = objAsset?.overwritten || mtlAsset?.overwritten;
      toast(anyOverwritten ? `Saved — overwrote existing "${name}.obj" + "${mtlName}"` : `Saved "${name}.obj" + "${mtlName}" to Assets`);
      log('info', `Model exported as "${name}.obj" with companion "${mtlName}" (${model.primitives.length} primitives)${anyOverwritten ? ' — overwrote previous version' : ''}`);
      window.__forgeLoadAssets?.();
    } catch (error) { toast(error.message); }
  });

  renderList(); renderInspector();
  resize();

  // -----------------------------------------------------------
  // Load an existing .obj model asset back in for editing — used by the
  // Assets tab's right-click "Edit in Model Editor" (see editor.js).
  //
  // This can only faithfully reconstruct models that were *saved by this
  // same Model Editor* (see #modelSave above): it recognizes each
  // primitive by the "<type>_<index>" object name and "mat_<index>_<type>"
  // material name that export writes, and recovers each primitive's color
  // straight from the loaded MTL material. Position and scale are derived
  // from each part's world-space bounding box; rotation is NOT
  // reconstructed (there's no reliable way to recover an arbitrary
  // rotation from a baked bounding box), so a re-imported primitive that
  // was rotated will come back axis-aligned with a larger bounding-box
  // scale instead. A model from anywhere else (no recognizable primitive
  // names) still loads, just as best-effort boxes, with a clear heads-up
  // either way.
  // -----------------------------------------------------------
  const BASE_SIZE = { box: [1, 1, 1], sphere: [1.2, 1.2, 1.2], cylinder: [1.1, 1, 1.1], cone: [1.2, 1.1, 1.2], plane: [1.2, 1.2, 0.001] };

  function findSiblingMtlUrl(objAsset) {
    const base = objAsset.name.replace(/\.obj$/i, '').toLowerCase();
    const mtl = (state.assets || []).find(a => a.category === 'model' && a.name.toLowerCase() === `${base}.mtl`);
    return mtl?.url || null;
  }

  async function loadModelAsset(asset) {
    if (!/\.obj$/i.test(asset.name)) { toast(`"${asset.name}" isn't a .obj model file`); return; }
    try {
      const mtlUrl = findSiblingMtlUrl(asset);
      const materials = mtlUrl ? await new Promise(resolve => {
        new MTLLoader().load(mtlUrl, m => { m.preload(); resolve(m); }, undefined, () => resolve(null));
      }) : null;
      const objLoader = new OBJLoader();
      objLoader.setMaterials(materials);
      const obj = await new Promise((resolve, reject) => objLoader.load(asset.url, resolve, undefined, reject));

      const newPrimitives = [];
      let hadUnknown = false;
      let i = 0;
      obj.traverse(child => {
        if (!child.isMesh) return;
        const geo = child.geometry;
        geo.computeBoundingBox();
        const box = geo.boundingBox;
        const center = new THREE.Vector3(); box.getCenter(center);
        const size = new THREE.Vector3(); box.getSize(size);
        const typeMatch = /^(box|sphere|cylinder|cone|plane)_/.exec(child.name || '');
        const type = typeMatch ? typeMatch[1] : 'box';
        if (!typeMatch) hadUnknown = true;
        const base = BASE_SIZE[type];
        const color = materials && child.material?.color ? `#${child.material.color.getHexString()}` : '#8a8f9c';
        newPrimitives.push({
          id: `p${Date.now().toString(36)}${i++}`,
          type,
          color,
          position: { x: round3(center.x), y: round3(center.y), z: round3(center.z) },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: round3(Math.max(size.x, 1e-3) / base[0]), y: round3(Math.max(size.y, 1e-3) / base[1]), z: round3(Math.max(size.z, 1e-3) / base[2]) }
        });
      });
      if (!newPrimitives.length) { toast(`"${asset.name}" has no readable geometry`); return; }

      model.primitives = newPrimitives;
      selected = null;
      renderList(); renderInspector(); attachGizmo(); render();
      const nameField = mount.querySelector('#modelName');
      if (nameField) nameField.value = asset.name.replace(/\.obj$/i, '');
      toast(hadUnknown || !materials
        ? `Loaded "${asset.name}" — reconstructed from its geometry (rotation isn't preserved on reimport)`
        : `Loaded "${asset.name}" for editing (rotation isn't preserved on reimport)`);
      log('info', `Loaded model asset "${asset.name}" into the Model Editor (${newPrimitives.length} primitive${newPrimitives.length === 1 ? '' : 's'})`);
    } catch (error) {
      toast(`Could not load "${asset.name}" for editing`);
    }
  }
  function round3(n) { return Math.round(n * 1000) / 1000; }
  window.__forgeModelEditorLoad = loadModelAsset;

  // Continuous render loop — needed for OrbitControls damping and
  // WebGL (unlike the old Canvas2D version, this can't just redraw on events).
  function loop() {
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(loop);
})();