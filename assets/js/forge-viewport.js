"use strict";
/* ---------------------------------------------------------------
   ForgeEngine viewport — real Three.js renderer for both the flat
   2D editor and the 3D (gridmap) editor. Replaces the previous
   hand-rolled Canvas2D projection math with an actual WebGL scene,
   real cameras, real lights, and Three.js's own OrbitControls /
   TransformControls for camera navigation and object gizmos.

   Controls:
     Click an object            -> select it
     Drag a gizmo handle        -> move / rotate / scale it
                                    (gizmo mode follows the active
                                    toolbar tool: select/move/rotate/scale)
     Click empty space          -> deselect
     RMB drag  (3D)             -> orbit the camera
     MMB drag                  -> pan the camera
     Wheel                      -> zoom / dolly
     WASD / Arrow keys (3D)     -> fly the camera around
     F                          -> focus the selected object
--------------------------------------------------------------- */
import * as THREE from './vendor/three/three.module.js';
import { OrbitControls } from './vendor/three/OrbitControls.js';
import { TransformControls } from './vendor/three/TransformControls.js';
import { CSS2DRenderer, CSS2DObject } from './vendor/three/CSS2DRenderer.js';
import { OBJLoader } from './vendor/three/OBJLoader.js';
import { MTLLoader } from './vendor/three/MTLLoader.js';

const BASE_DISTANCE = 42; // default 3D orbit distance, mirrors the old CAMERA_DISTANCE
const BASE_HALF_HEIGHT_3D = 16; // orthographic (3D) half-height in world units at zoom=1
const BASE_HALF_HEIGHT_2D = 12; // orthographic (2D) half-height in world units at zoom=1

const TYPE_COLOR = {
  light: 0xe2b44f, camera: 0x6d9de6, sprite: 0xe47b35, audio: 0x9b7fe0,
  collider: 0x63c9c9, ui: 0x7fa0ae, group: 0x89929d, mesh: 0x8a94a3
};

export function initForgeViewport() {
  const $ = s => document.querySelector(s);
  const state = window.__forgeState;
  const viewport = $('#viewport');
  const canvas = $('#threeCanvas');
  if (!state || !viewport || !canvas) return;
  const toast = msg => window.__forgeToast?.(msg);

  // -----------------------------------------------------------
  // Renderer + label overlay
  // -----------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(0x14161a, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.inset = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  const labelHost = $('#viewportObjects');
  if (labelHost) { labelHost.innerHTML = ''; labelHost.style.position = 'absolute'; labelHost.style.inset = '0'; labelHost.appendChild(labelRenderer.domElement); }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14161a);
  const fogColor = 0x171a1f;
  const fog = new THREE.Fog(fogColor, 26, 150);

  // -----------------------------------------------------------
  // Lights
  // -----------------------------------------------------------
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambientLight);
  const hemiLight = new THREE.HemisphereLight(0x8fb4ff, 0x14161a, 0.35);
  scene.add(hemiLight);
  const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
  sunLight.position.set(16, 24, 12);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 120;
  sunLight.shadow.camera.left = -40; sunLight.shadow.camera.right = 40;
  sunLight.shadow.camera.top = 40; sunLight.shadow.camera.bottom = -40;
  sunLight.shadow.bias = -0.0015;
  scene.add(sunLight, sunLight.target);

  // -----------------------------------------------------------
  // Grids + origin axes (separate sets for the 3D ground plane
  // and the flat 2D XY plane so both modes get their own colored
  // origin lines without fighting over one shared grid).
  // -----------------------------------------------------------
  function makeGrid(rotateToXY) {
    const grid = new THREE.GridHelper(400, 400, 0x3a4149, 0x232830);
    grid.material.transparent = true;
    grid.material.opacity = 0.85;
    if (rotateToXY) grid.rotation.x = Math.PI / 2;
    return grid;
  }
  function makeAxisLine(color, from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({ color });
    return new THREE.Line(geo, mat);
  }

  const grid3D = makeGrid(false);
  const xAxis3D = makeAxisLine(0xe06060, new THREE.Vector3(-200, 0, 0), new THREE.Vector3(200, 0, 0));
  const zAxis3D = makeAxisLine(0x6098df, new THREE.Vector3(0, 0, -200), new THREE.Vector3(0, 0, 200));
  const yAxis3D = makeAxisLine(0x62c987, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 12, 0));
  scene.add(grid3D, xAxis3D, zAxis3D, yAxis3D);

  const grid2D = makeGrid(true);
  // The grid used to be nudged by half a cell so a freshly-added object at
  // 0,0,0 would sit flush inside one square instead of straddling the four
  // cells meeting at the origin — but the red/blue origin lines below are
  // drawn at the true, unshifted 0,0, so that nudge made the grid (and any
  // object snapped to it) visibly drift away from the origin lines. Left
  // unshifted, the grid now matches the 3D ground grid exactly (same math,
  // same snapping), and the origin lines pass through the actual 0,0 point.
  const xAxis2D = makeAxisLine(0xe06060, new THREE.Vector3(-200, 0, 0), new THREE.Vector3(200, 0, 0));
  const yAxis2D = makeAxisLine(0x6098df, new THREE.Vector3(0, -200, 0), new THREE.Vector3(0, 200, 0));
  scene.add(grid2D, xAxis2D, yAxis2D);

  // -----------------------------------------------------------
  // Cameras. Perspective + orthographic share the 3D orbit; the
  // flat 2D editor gets its own dedicated orthographic camera
  // that only ever looks straight down -Z.
  // -----------------------------------------------------------
  const camPersp = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
  const camOrtho3D = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
  const cam2D = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
  cam2D.up.set(0, 1, 0);

  const ISO = { azimuth: Math.PI / 4, polar: Math.acos(1 / Math.sqrt(3)) };
  function sphericalPosition(target, azimuth, polar, distance) {
    return new THREE.Vector3(
      target.x + distance * Math.sin(polar) * Math.sin(azimuth),
      target.y + distance * Math.cos(polar),
      target.z + distance * Math.sin(polar) * Math.cos(azimuth)
    );
  }

  let controls3D = null;
  let cam3D = camPersp;
  const orbitTarget = new THREE.Vector3(0, 0, 0);

  function makeControls3D(camera) {
    const c = new OrbitControls(camera, canvas);
    c.enableDamping = true;
    c.dampingFactor = 0.09;
    c.screenSpacePanning = true;
    c.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    c.minDistance = 2; c.maxDistance = 400;
    c.minZoom = 0.15; c.maxZoom = 8;
    c.target.copy(orbitTarget);
    c.addEventListener('change', () => { markDirty(); });
    return c;
  }

  function switchTo3DCamera(kind) {
    const prevAz = controls3D ? controls3D.getAzimuthalAngle() : ISO.azimuth;
    const prevPolar = controls3D ? controls3D.getPolarAngle() : (Math.PI / 2 - 0.52);
    const prevDist = controls3D ? controls3D.getDistance() : BASE_DISTANCE;
    const prevZoom = cam3D.zoom || 1;
    if (controls3D) controls3D.dispose();
    cam3D = kind === 'perspective' ? camPersp : camOrtho3D;
    const azimuth = kind === 'isometric' ? ISO.azimuth : prevAz;
    const polar = kind === 'isometric' ? ISO.polar : prevPolar;
    cam3D.position.copy(sphericalPosition(orbitTarget, azimuth, polar, prevDist));
    cam3D.zoom = kind === 'perspective' ? 1 : prevZoom;
    cam3D.up.set(0, 1, 0);
    cam3D.lookAt(orbitTarget);
    cam3D.updateProjectionMatrix();
    controls3D = makeControls3D(cam3D);
    resizeCameraFrustums();
    controls3D.update();
    if (transformControls) transformControls.camera = cam3D;
  }

  // -----------------------------------------------------------
  // Transform gizmo (move / rotate / scale)
  // -----------------------------------------------------------
  const transformControls = new TransformControls(camPersp, canvas);
  transformControls.setSize(0.9);
  scene.add(transformControls.getHelper());
  transformControls.addEventListener('dragging-changed', e => {
    if (controls3D) controls3D.enabled = !e.value;
    if (!e.value && state.selectedId) window.__forgeSelectObject?.(state.selectedId);
  });
  transformControls.addEventListener('objectChange', () => {
    const o = state.objects.find(x => x.id === state.selectedId);
    const wrapper = state.selectedId ? visuals.get(state.selectedId)?.wrapper : null;
    if (!o || !wrapper) return;
    const round = n => Math.round(n * 1000) / 1000;
    o.position.x = round(wrapper.position.x);
    o.position.y = round(wrapper.position.y);
    if (state.mode === '3d') o.position.z = round(wrapper.position.z);
    o.rotation.x = round(THREE.MathUtils.radToDeg(wrapper.rotation.x));
    o.rotation.y = round(THREE.MathUtils.radToDeg(wrapper.rotation.y));
    o.rotation.z = round(THREE.MathUtils.radToDeg(wrapper.rotation.z));
    o.scale.x = round(wrapper.scale.x);
    o.scale.y = round(wrapper.scale.y);
    if (state.mode === '3d') o.scale.z = round(wrapper.scale.z);
    state.dirty = true;
    const dot = $('#dirtyDot'); if (dot) dot.style.visibility = 'visible';
    window.__forgeRenderInspector?.();
    markDirty();
  });

  // -----------------------------------------------------------
  // Selection outline
  // -----------------------------------------------------------
  const selectionBox = new THREE.BoxHelper(new THREE.Object3D(), 0xff9d58);
  selectionBox.visible = false;
  scene.add(selectionBox);

  // -----------------------------------------------------------
  // Per-object visuals. One wrapper Object3D per scene object; the
  // same geometry is reused for both 2D and 3D (an orthographic
  // straight-on 2D camera makes a box read as a flat rect, and a
  // Sprite is camera-facing in either mode), so nothing needs to
  // be rebuilt when the mode is toggled.
  // -----------------------------------------------------------
  const visuals = new Map(); // id -> { wrapper, pickMesh, litMat, unlitMat, label, isSprite, modelUrl, modelNode }
  const textureLoader = new THREE.TextureLoader();
  const textureCache = new Map();

  function getTexture(url) {
    if (!url) return null;
    if (textureCache.has(url)) return textureCache.get(url);
    const tex = textureLoader.load(url, () => markDirty());
    tex.colorSpace = THREE.SRGBColorSpace;
    textureCache.set(url, tex);
    return tex;
  }

  // -----------------------------------------------------------
  // OBJ models — an attached asset whose file is a Wavefront .obj (the
  // model editor's "Save as Asset" now exports real .obj geometry, not a
  // custom JSON blob) gets loaded here and shown in place of the object's
  // placeholder box, in both the 2D and 3D viewport and in Play mode.
  // -----------------------------------------------------------
  const objLoader = new OBJLoader();
  const mtlLoader = new MTLLoader();
  const modelCache = new Map(); // "objUrl|mtlUrl" -> Promise<THREE.Group> (a template, never added to the scene itself)
  const isObjUrl = url => typeof url === 'string' && /\.obj(?:[?#]|$)/i.test(url);

  // A companion .mtl is looked up fresh every sync rather than only once at
  // attach time (see attachAssetToObject in editor.js), so a model that was
  // attached *before* its .mtl existed — e.g. attach grass.obj, then go
  // back into the Model Editor and re-save "grass" with colors added —
  // still picks the .mtl up on the very next sync instead of staying stuck
  // on the flat gray fallback until it's re-attached.
  //
  // This also re-derives the .obj URL itself from the attachment records'
  // actual file names rather than trusting `o.modelUrl` blindly — both the
  // .obj and its .mtl are "model" category assets, so an object that had
  // its .mtl attached *after* its .obj could end up with `modelUrl`
  // clobbered to point at the .mtl file instead (an older bug). Attachment
  // names always carry the real extension, so use those as the source of
  // truth whenever they're available.
  function resolveModelUrls(o) {
    const atts = o.attachments || [];
    const objAtt = atts.find(a => a.category === 'model' && /\.obj$/i.test(a.name || ''));
    const mtlAtt = atts.find(a => a.category === 'model' && /\.mtl$/i.test(a.name || ''));
    const modelUrl = objAtt?.url || (isObjUrl(o.spriteUrl) ? o.spriteUrl : null) || o.modelUrl || null;
    if (!modelUrl) return { modelUrl: null, mtlUrl: null };
    let mtlUrl = mtlAtt?.url || o.mtlUrl || null;
    if (!mtlUrl) {
      const assets = state.assets || [];
      const objAsset = objAtt || assets.find(a => a.category === 'model' && a.url === modelUrl);
      const base = objAsset?.name?.replace(/\.obj$/i, '');
      if (base) mtlUrl = assets.find(a => a.category === 'model' && a.name.toLowerCase() === `${base}.mtl`.toLowerCase())?.url || null;
    }
    return { modelUrl, mtlUrl };
  }

  function loadMtl(mtlUrl) {
    if (!mtlUrl) return Promise.resolve(null);
    return new Promise(resolve => {
      mtlLoader.load(mtlUrl, materials => { materials.preload(); resolve(materials); }, undefined, () => resolve(null));
    });
  }

  function loadModelTemplate(url, mtlUrl) {
    const key = `${url}|${mtlUrl || ''}`;
    if (modelCache.has(key)) return modelCache.get(key);
    const promise = loadMtl(mtlUrl).then(materials => new Promise((resolve, reject) => {
      // A companion .mtl (see model-editor.js's "Save as Asset", and
      // attachAssetToObject in editor.js which links it) gives each
      // primitive its real color back; without one, OBJLoader falls back
      // to a plain default material and applyModelToVisual below recolors
      // the whole model with a single neutral gray.
      objLoader.setMaterials(materials);
      objLoader.load(url, obj => resolve({ obj, hasMaterials: Boolean(materials) }), undefined, err => reject(err));
    })).then(({ obj, hasMaterials }) => {
      // Normalize to a unit cube centered on the origin so a model behaves
      // like every other 1×1×1 placeholder — the object's own position/
      // rotation/scale (applied to `wrapper`) then work exactly the same
      // whether it's showing a box or a loaded model.
      const box = new THREE.Box3().setFromObject(obj);
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);
      const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
      const scale = 1 / maxDim;
      obj.position.sub(center.multiplyScalar(scale));
      obj.scale.setScalar(scale);
      const wrap = new THREE.Group();
      wrap.userData.hasMtlMaterials = hasMaterials;
      wrap.add(obj);
      return wrap;
    }).catch(err => { modelCache.delete(key); throw err; });
    modelCache.set(key, promise);
    return promise;
  }

  function applyModelToVisual(v, o, template) {
    const hasMtl = Boolean(template.userData.hasMtlMaterials);
    v.modelNode.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow = o.type === 'mesh';
      child.receiveShadow = o.type === 'mesh';
      // With a real .mtl, keep the per-primitive materials OBJLoader/MTLLoader
      // built (cloned along with the mesh) so each part's actual color shows.
      // Without one, fall back to a single neutral material — pickMesh's
      // material can't be reused here (see setModelForVisual: it has to stay
      // fully transparent while a model is showing).
      if (hasMtl && child.material) child.material = child.material.clone();
      else child.material = v.modelMat;
    });
  }

  function setModelForVisual(o, v, url, mtlUrl) {
    const key = `${url || ''}|${mtlUrl || ''}`;
    if (v.modelKey === key) return;
    v.modelKey = key;
    v.modelUrl = url;
    if (v.modelNode) { v.wrapper.remove(v.modelNode); v.modelNode = null; }
    if (!url) { v.pickMesh.visible = true; return; }
    loadModelTemplate(url, mtlUrl).then(template => {
      if (v.modelKey !== key) return; // swapped again (or removed) before this resolved
      const node = template.clone(true);
      v.modelNode = node;
      applyModelToVisual(v, o, template);
      v.wrapper.add(node);
      // Keep pickMesh in the scene (it stays the raycast target for
      // selection) but invisible-in-render so the loaded model is what's
      // actually seen.
      v.pickMesh.visible = true;
      markDirty();
    }).catch(err => {
      v.modelKey = null;
      v.modelUrl = null;
      v.pickMesh.visible = true;
      console.error('Failed to load OBJ model', url, err);
      toast(`Couldn't load model: ${o.name}`);
    });
  }

  function geometryFor(type) {
    switch (type) {
      case 'light': return new THREE.SphereGeometry(0.35, 16, 12);
      case 'camera': return new THREE.ConeGeometry(0.32, 0.6, 4);
      case 'audio': return new THREE.IcosahedronGeometry(0.32, 0);
      case 'ui': return new THREE.PlaneGeometry(1, 1);
      default: return new THREE.BoxGeometry(1, 1, 1); // mesh, collider, group
    }
  }

  function buildVisual(o) {
    const color = TYPE_COLOR[o.type] || TYPE_COLOR.mesh;
    const wrapper = new THREE.Group();
    wrapper.userData.objectId = o.id;

    const litMat = new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.08 });
    const unlitMat = new THREE.MeshBasicMaterial({ color });
    // Dedicated material for a loaded .obj model, kept separate from
    // litMat/unlitMat/pickMesh's material (see applyModelToVisual).
    const modelMat = new THREE.MeshStandardMaterial({ color: 0xc7ccd4, roughness: 0.7, metalness: 0.05 });
    let pickMesh;
    let isSprite = false;

    if (o.type === 'sprite') {
      const spriteMat = new THREE.SpriteMaterial({ color: o.spriteUrl ? 0xffffff : color });
      pickMesh = new THREE.Sprite(spriteMat);
      pickMesh.scale.set(1, 1, 1);
      isSprite = true;
    } else if (o.type === 'collider') {
      pickMesh = new THREE.Mesh(geometryFor(o.type), new THREE.MeshBasicMaterial({ color, wireframe: true }));
    } else {
      pickMesh = new THREE.Mesh(geometryFor(o.type), litMat);
      pickMesh.castShadow = o.type === 'mesh';
      pickMesh.receiveShadow = o.type === 'mesh';
    }
    pickMesh.userData.objectId = o.id;
    wrapper.add(pickMesh);

    const labelEl = document.createElement('div');
    labelEl.className = 'forge-3d-label';
    labelEl.textContent = o.name;
    const label = new CSS2DObject(labelEl);
    label.position.set(0, 0.85, 0);
    wrapper.add(label);

    scene.add(wrapper);
    return { wrapper, pickMesh, litMat, unlitMat, modelMat, label, labelEl, isSprite, modelUrl: null, modelKey: null, modelNode: null };
  }

  function disposeVisual(v) {
    scene.remove(v.wrapper);
    v.pickMesh.geometry?.dispose?.();
    v.litMat?.dispose?.();
    v.unlitMat?.dispose?.();
    v.modelMat?.dispose?.();
    v.pickMesh.material?.dispose?.();
    if (v.modelNode) v.modelNode.traverse(child => { if (child.isMesh) child.geometry?.dispose?.(); });
    v.labelEl.remove();
  }

  function shadingMode() { return $('#shadingMode')?.dataset.mode || 'shaded'; }

  function syncVisual(o, v) {
    const { wrapper, pickMesh } = v;
    wrapper.position.set(o.position.x || 0, o.position.y || 0, state.mode === '3d' ? (o.position.z || 0) : 0);
    if (state.mode === '3d') {
      wrapper.rotation.set(
        THREE.MathUtils.degToRad(o.rotation?.x || 0),
        THREE.MathUtils.degToRad(o.rotation?.y || 0),
        THREE.MathUtils.degToRad(o.rotation?.z || 0)
      );
      wrapper.scale.set(Math.max(0.05, o.scale?.x ?? 1), Math.max(0.05, o.scale?.y ?? 1), Math.max(0.05, o.scale?.z ?? 1));
    } else {
      wrapper.rotation.set(0, 0, THREE.MathUtils.degToRad(o.rotation?.z || 0));
      wrapper.scale.set(Math.max(0.05, o.scale?.x ?? 1), Math.max(0.05, o.scale?.y ?? 1), 1);
    }
    wrapper.visible = o.visible !== false;
    const enabled = o.enabled !== false;

    // An attached .obj model asset replaces the placeholder box with the
    // real loaded geometry (see setModelForVisual and resolveModelUrls,
    // which resolves the real .obj/.mtl URLs from the attachment records).
    const { modelUrl, mtlUrl } = !v.isSprite ? resolveModelUrls(o) : { modelUrl: null, mtlUrl: null };
    if (v.modelKey !== `${modelUrl || ''}|${mtlUrl || ''}`) setModelForVisual(o, v, modelUrl, mtlUrl);
    if (v.modelNode) v.modelNode.visible = enabled;

    // Any object rendered with an image texture (sprite, or a mesh/UI/etc.
    // with an image assigned as its map) needs `transparent: true`, or the
    // PNG's alpha channel is ignored and fully-transparent pixels render as
    // opaque black instead of see-through.
    const hasTexture = Boolean(o.spriteUrl) && !modelUrl;
    pickMesh.material && (pickMesh.material.transparent = !enabled || v.isSprite || hasTexture || Boolean(v.modelNode));
    if (pickMesh.material) pickMesh.material.opacity = v.modelNode ? 0 : (enabled ? 1 : 0.35);
    // alphaTest discards near-fully-transparent texels outright rather than
    // just blending them, which avoids dark halos/z-fighting around cutout
    // pixel art at grazing angles or when overlapping other transparent objects.
    if (pickMesh.material) pickMesh.material.alphaTest = hasTexture ? 0.05 : 0;

    if (v.isSprite) {
      const tex = getTexture(o.spriteUrl);
      pickMesh.material.map = tex || null;
      pickMesh.material.color.set(tex ? 0xffffff : (TYPE_COLOR.sprite));
      pickMesh.material.needsUpdate = true;
    } else {
      const tex = getTexture(hasTexture ? o.spriteUrl : null);
      const mode = shadingMode();
      const useLit = mode !== 'solid';
      const activeMat = useLit ? v.litMat : v.unlitMat;
      activeMat.wireframe = mode === 'wireframe';
      activeMat.map = tex || null;
      // Bug: this used to only check `!enabled || hasTexture`, so whenever
      // a model was showing (hasTexture is false in that case — see above)
      // it reset transparent back to false here, right after the placeholder
      // box was deliberately made fully transparent a few lines up. That
      // turned the "invisible" box solid opaque again, so it fully covered
      // the model behind it — every shading mode except wireframe (which
      // only draws edges, letting the model peek through the gaps) hid the
      // model completely. Folding `Boolean(v.modelNode)` in here keeps the
      // box actually invisible in every mode, not just wireframe.
      activeMat.transparent = !enabled || hasTexture || Boolean(v.modelNode);
      activeMat.alphaTest = hasTexture ? 0.05 : 0;
      // Also stop the invisible box from writing to the depth buffer while
      // a model is showing — it and the model occupy almost the exact same
      // volume, so even at opacity 0 it could still depth-fight with (and
      // partially poke through) the model's own surfaces otherwise.
      activeMat.depthWrite = !v.modelNode;
      activeMat.needsUpdate = true;
      if (pickMesh.material !== activeMat) pickMesh.material = activeMat;
    }
    if (v.modelNode) {
      const mode = shadingMode();
      v.modelMat.wireframe = mode === 'wireframe';
      v.modelMat.needsUpdate = true;
    }

    v.labelEl.textContent = o.attachments?.length ? `${o.name}  ·${o.attachments.length}` : o.name;
    v.labelEl.classList.toggle('selected', o.id === state.selectedId);
    v.label.visible = state.ui?.gizmos !== false;
  }

  function updateVisuals() {
    const seen = new Set();
    for (const o of state.objects) {
      seen.add(o.id);
      let v = visuals.get(o.id);
      if (!v) { v = buildVisual(o); visuals.set(o.id, v); }
      syncVisual(o, v);
    }
    for (const [id, v] of visuals) {
      if (!seen.has(id)) { disposeVisual(v); visuals.delete(id); }
    }
  }

  // -----------------------------------------------------------
  // Picking (also used by the right-click context menu)
  // -----------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const pointerNDC = new THREE.Vector2();
  function activeCamera() { return state.mode === '2d' ? cam2D : cam3D; }

  function pickObjectAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    pointerNDC.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointerNDC, activeCamera());
    const targets = [...visuals.values()].filter(v => v.wrapper.visible).map(v => v.pickMesh);
    const hits = raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;
    const id = hits[0].object.userData.objectId;
    return state.objects.find(o => o.id === id) || null;
  }
  window.forgeHitTest3D = (clientX, clientY) => pickObjectAt(clientX, clientY);

  function select(id) {
    state.selectedId = id;
    const o = state.objects.find(x => x.id === id);
    if (o && visuals.has(id)) {
      transformControls.attach(visuals.get(id).wrapper);
      applyToolToGizmo();
    } else {
      transformControls.detach();
    }
    window.__forgeSelectObject?.(id);
    markDirty();
  }

  function applyToolToGizmo() {
    const tool = state.tool || 'select';
    // The "Select" tool used to hide the gizmo entirely, so clicking an
    // object showed nothing draggable — you had to also click Move/Rotate/
    // Scale before you could touch it, which pushed people toward typing
    // numbers into the inspector instead. Now selecting an object always
    // shows a draggable gizmo (translate by default); Move/Rotate/Scale
    // just pick which handles you get.
    if (!state.selectedId) { transformControls.enabled = false; transformControls.visible = false; return; }
    transformControls.enabled = state.ui?.gizmos !== false;
    transformControls.visible = state.ui?.gizmos !== false;
    transformControls.setMode(tool === 'rotate' ? 'rotate' : tool === 'scale' ? 'scale' : 'translate');
    transformControls.showX = true; transformControls.showY = true; transformControls.showZ = true;
    if (state.mode === '2d') {
      if (tool === 'rotate') { transformControls.showX = false; transformControls.showY = false; transformControls.showZ = true; }
      else { transformControls.showZ = false; }
    }
    const snap = state.snap !== false;
    const snapSize = state.snapSize || 1;
    transformControls.setTranslationSnap(snap ? snapSize : null);
    transformControls.setRotationSnap(snap ? THREE.MathUtils.degToRad(15) : null);
    transformControls.setScaleSnap(snap ? 0.25 : null);
  }


  // -----------------------------------------------------------
  // Pointer handling: LMB = select (gizmo handles its own drag),
  // RMB/MMB handled by OrbitControls in 3D; 2D gets its own light
  // pan/zoom controller since it never rotates.
  // -----------------------------------------------------------
  let rmbDown = null;
  canvas.addEventListener('pointerdown', e => {
    if (e.button === 2) rmbDown = { x: e.clientX, y: e.clientY, moved: false };
    if (e.button !== 0) return;
    if (transformControls.dragging) return;
    const hit = pickObjectAt(e.clientX, e.clientY);
    select(hit ? hit.id : null);
  });
  addEventListener('pointermove', e => {
    if (rmbDown && (Math.abs(e.clientX - rmbDown.x) > 4 || Math.abs(e.clientY - rmbDown.y) > 4)) rmbDown.moved = true;
    const r = canvas.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) updateCursorReadout(e.clientX, e.clientY);
  });
  addEventListener('pointerup', e => {
    if (e.button === 2) {
      if (rmbDown?.moved) window.__forgeSuppressContextMenu = true;
      rmbDown = null;
    }
  });
  canvas.oncontextmenu = e => e.preventDefault();

  function updateCursorReadout(clientX, clientY) {
    const el = $('#cursorPosition');
    if (!el) return;
    if (state.mode === '2d') {
      const p = screenTo2DWorld(clientX, clientY);
      el.textContent = `X ${Math.round(p.x)}  Y ${Math.round(p.y)}`;
    } else {
      const p = screenToGroundPoint(clientX, clientY);
      el.textContent = p ? `X ${Math.round(p.x)}  Y ${Math.round(p.z)}` : 'X —  Y —';
    }
  }

  function screenTo2DWorld(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1;
    const ny = -((clientY - r.top) / r.height) * 2 + 1;
    const v = new THREE.Vector3(nx, ny, 0).unproject(cam2D);
    return { x: v.x, y: v.y };
  }

  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function screenToGroundPoint(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    pointerNDC.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointerNDC, cam3D);
    const out = new THREE.Vector3();
    return raycaster.ray.intersectPlane(groundPlane, out) ? out : null;
  }

  // 2D pan (MMB/RMB drag) + zoom (wheel) — deliberately simple since the
  // flat editor never rotates.
  let pan2D = null;
  canvas.addEventListener('pointerdown', e => {
    if (state.mode !== '2d' || (e.button !== 1 && e.button !== 2)) return;
    pan2D = { x: e.clientX, y: e.clientY, camX: cam2D.position.x, camY: cam2D.position.y };
  });
  addEventListener('pointermove', e => {
    if (!pan2D) return;
    const scale = BASE_HALF_HEIGHT_2D / (cam2D.zoom * (viewport.clientHeight / 2 || 1));
    cam2D.position.x = pan2D.camX - (e.clientX - pan2D.x) * scale;
    cam2D.position.y = pan2D.camY + (e.clientY - pan2D.y) * scale;
    state.view2d.x = cam2D.position.x; state.view2d.y = cam2D.position.y;
    markDirty();
  });
  addEventListener('pointerup', () => { pan2D = null; });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    if (state.mode === '2d') {
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      cam2D.zoom = Math.max(0.2, Math.min(6, cam2D.zoom * factor));
      cam2D.updateProjectionMatrix();
      state.view2d.zoom = cam2D.zoom;
      $('#zoomValue').textContent = `${Math.round(cam2D.zoom * 100)}%`;
      markDirty();
    } else {
      $('#zoomValue').textContent = zoomLabel();
    }
  }, { passive: false });

  // -----------------------------------------------------------
  // WASD / arrow-key fly pan (3D only), camera-relative on the
  // horizontal plane, matching the previous control scheme.
  // -----------------------------------------------------------
  const moveKeys = new Set();
  const moveKeySet = new Set(['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  addEventListener('keydown', e => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (moveKeySet.has(key)) { moveKeys.add(key); e.preventDefault(); }
    if (key.toLowerCase() === 'f' && state.selectedId) { const o = state.objects.find(x => x.id === state.selectedId); if (o) window.forgeFocusCamera?.(o); }
  });
  addEventListener('keyup', e => { const key = e.key.length === 1 ? e.key.toLowerCase() : e.key; moveKeys.delete(key); });
  addEventListener('blur', () => moveKeys.clear());

  function applyArrowPan(dt) {
    if (state.mode === '2d' || moveKeys.size === 0 || !controls3D) return;
    const speed = 16 * dt / Math.max(0.25, cam3D.zoom || 1) * (BASE_DISTANCE / Math.max(4, controls3D.getDistance()));
    const az = controls3D.getAzimuthalAngle();
    const fwd = { x: Math.sin(az), z: Math.cos(az) };
    const right = { x: Math.cos(az), z: -Math.sin(az) };
    let mx = 0, mz = 0;
    if (moveKeys.has('w') || moveKeys.has('ArrowUp')) { mx += fwd.x; mz += fwd.z; }
    if (moveKeys.has('s') || moveKeys.has('ArrowDown')) { mx -= fwd.x; mz -= fwd.z; }
    if (moveKeys.has('a') || moveKeys.has('ArrowLeft')) { mx -= right.x; mz -= right.z; }
    if (moveKeys.has('d') || moveKeys.has('ArrowRight')) { mx += right.x; mz += right.z; }
    if (mx || mz) {
      const delta = new THREE.Vector3(mx * speed, 0, mz * speed);
      cam3D.position.add(delta);
      controls3D.target.add(delta);
      orbitTarget.copy(controls3D.target);
      markDirty();
    }
  }

  // -----------------------------------------------------------
  // Public hooks other editor.js modules call into
  // -----------------------------------------------------------
  window.forgeResetCamera = () => {
    state.view2d = { x: 0, y: 0, zoom: 1 };
    cam2D.position.set(0, 0, 40); cam2D.zoom = 1; cam2D.updateProjectionMatrix();
    orbitTarget.set(0, 0, 0);
    if (controls3D) { controls3D.target.set(0, 0, 0); cam3D.position.copy(sphericalPosition(orbitTarget, ISO.azimuth, Math.PI / 2 - 0.52, BASE_DISTANCE)); cam3D.zoom = 1; cam3D.updateProjectionMatrix(); controls3D.update(); }
    $('#zoomValue').textContent = '100%';
    markDirty();
  };
  window.forgeFocusCamera = o => {
    if (state.mode === '2d') {
      cam2D.position.x = o.position?.x || 0; cam2D.position.y = o.position?.y || 0;
      state.view2d.x = cam2D.position.x; state.view2d.y = cam2D.position.y;
    } else if (controls3D) {
      const p = new THREE.Vector3(o.position.x || 0, o.position.y || 0, o.position.z || 0);
      const delta = p.clone().sub(controls3D.target);
      controls3D.target.copy(p);
      cam3D.position.add(delta);
      orbitTarget.copy(p);
      controls3D.update();
    }
    markDirty();
  };
  window.forgeRedraw3D = () => markDirty();

  // -----------------------------------------------------------
  // Live stats for the Profiler panel (assets/js/profiler.js). Reads
  // straight off the renderer/state each call so it's always current,
  // not just a snapshot taken when the profiler tab was opened.
  // -----------------------------------------------------------
  window.__forgeViewportStats = () => ({
    fps,
    mode: state.mode,
    camera: state.mode === '2d' ? 'orthographic-2d' : (state.cameraProjection || 'perspective'),
    objects: state.objects.length,
    selected: state.objects.find(o => o.id === state.selectedId)?.name || null,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    points: renderer.info.render.points,
    lines: renderer.info.render.lines,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    programs: renderer.info.programs?.length ?? 0
  });

  // -----------------------------------------------------------
  // Toolbar wiring specific to the viewport (space toggle, snap
  // cycle) — these buttons existed in the markup but previously
  // had no handler.
  // -----------------------------------------------------------
  let dirty = true;
  function markDirty() { dirty = true; }

  $('#spaceToggle')?.addEventListener('click', e => {
    const next = e.currentTarget.textContent.trim() === 'Global' ? 'Local' : 'Global';
    e.currentTarget.textContent = next;
    transformControls.setSpace(next === 'Global' ? 'world' : 'local');
    toast(`${next} space`);
  });
  state.snapSize = state.snapSize || 1;
  const snapSteps = [1, 0.5, 0.25, 2, 4];
  $('#snapCycle')?.addEventListener('click', e => {
    const idx = (snapSteps.indexOf(state.snapSize) + 1) % snapSteps.length;
    state.snapSize = snapSteps[idx];
    e.currentTarget.textContent = `Snap: ${state.snapSize}`;
    applyToolToGizmo();
    toast(`Move snap: ${state.snapSize} units`);
  });

  // -----------------------------------------------------------
  // Resize
  // -----------------------------------------------------------
  function resizeCameraFrustums() {
    const w = Math.max(1, viewport.clientWidth), h = Math.max(1, viewport.clientHeight);
    const aspect = w / h;
    camPersp.aspect = aspect; camPersp.updateProjectionMatrix();
    const h3 = BASE_HALF_HEIGHT_3D, w3 = h3 * aspect;
    camOrtho3D.left = -w3; camOrtho3D.right = w3; camOrtho3D.top = h3; camOrtho3D.bottom = -h3;
    camOrtho3D.updateProjectionMatrix();
    const h2 = BASE_HALF_HEIGHT_2D, w2 = h2 * aspect;
    cam2D.left = -w2; cam2D.right = w2; cam2D.top = h2; cam2D.bottom = -h2;
    cam2D.updateProjectionMatrix();
  }

  function resize() {
    const w = Math.max(1, viewport.clientWidth), h = Math.max(1, viewport.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    labelRenderer.setSize(w, h);
    resizeCameraFrustums();
    markDirty();
  }
  new ResizeObserver(resize).observe(viewport);
  addEventListener('resize', resize);

  // -----------------------------------------------------------
  // Frame-rate independent "sync from DOM/state" pass — cheap
  // property reads/writes so every toolbar toggle (grid, snap,
  // env, mode, camera projection, shading, gizmo tool) is picked
  // up automatically regardless of which button fired it.
  // -----------------------------------------------------------
  let lastMode = state.mode, lastProjection = null, lastTool = null;
  function syncFromState() {
    // grid + axis visibility, per active mode
    const showGrid = state.grid !== false;
    grid3D.visible = showGrid && state.mode === '3d';
    xAxis3D.visible = zAxis3D.visible = yAxis3D.visible = showGrid && state.mode === '3d';
    grid2D.visible = showGrid && state.mode === '2d';
    xAxis2D.visible = yAxis2D.visible = showGrid && state.mode === '2d';

    // environment
    const ui = state.ui || {};
    sunLight.visible = ui.sun !== false;
    ambientLight.visible = ui.ambient !== false;
    hemiLight.visible = ui.ambient !== false;
    scene.fog = ui.fog ? fog : null;

    // gizmo visibility master switch
    transformControls.getHelper().visible = (ui.gizmos !== false) && !!state.selectedId && state.tool !== 'select';
    selectionBox.visible = !!state.selectedId && visuals.has(state.selectedId);
    if (selectionBox.visible) selectionBox.setFromObject(visuals.get(state.selectedId).wrapper);

    // mode switch (2d <-> 3d)
    if (state.mode !== lastMode) {
      lastMode = state.mode;
      viewport.dataset.mode = state.mode;
      applyToolToGizmo();
      $('#cameraMode').textContent = state.mode === '2d' ? 'Orthographic' : (state.cameraProjection || 'perspective')[0].toUpperCase() + (state.cameraProjection || 'perspective').slice(1);
      markDirty();
    }

    // camera projection switch (3D: perspective/orthographic/isometric)
    const projection = state.cameraProjection || 'perspective';
    if (state.mode === '3d' && projection !== lastProjection) {
      lastProjection = projection;
      switchTo3DCamera(projection === 'perspective' ? 'perspective' : projection);
    }

    // tool switch
    if (state.tool !== lastTool) { lastTool = state.tool; applyToolToGizmo(); }

    // Keep the move/rotate/scale gizmo pointed at whichever camera is
    // actually rendering the scene right now. It used to only get
    // re-pointed inside switchTo3DCamera(), which never runs for the
    // flat 2D editor's dedicated camera (cam2D) — so dragging a gizmo
    // handle in 2D mode (or right after a 2D<->3D switch) computed its
    // drag math against a stale/mismatched camera, making the handles
    // visually detach from the object and move it to the wrong place.
    const cam = activeCamera();
    if (transformControls.camera !== cam) transformControls.camera = cam;
  }

  function zoomLabel() {
    if (state.mode === '2d') return `${Math.round(cam2D.zoom * 100)}%`;
    if (cam3D.isOrthographicCamera) return `${Math.round(cam3D.zoom * 100)}%`;
    const d = controls3D ? controls3D.getDistance() : BASE_DISTANCE;
    return `${Math.round((BASE_DISTANCE / Math.max(1, d)) * 100)}%`;
  }

  // -----------------------------------------------------------
  // Debug panel
  // -----------------------------------------------------------
  function renderDebug() {
    const panel = $('#debugPanel');
    if (!panel?.classList.contains('show')) return;
    const o = state.objects.find(x => x.id === state.selectedId);
    const info = renderer.info;
    $('#debugStats').innerHTML =
      `<span>Renderer</span><span>WebGL · Three.js r${THREE.REVISION}</span>` +
      `<span>Mode</span><span>${state.mode}</span>` +
      `<span>Camera</span><span>${state.mode === '2d' ? 'Orthographic (2D)' : (state.cameraProjection || 'perspective')}</span>` +
      `<span>Objects</span><span>${state.objects.length}</span>` +
      `<span>Selected</span><span>${o?.name || 'none'}</span>` +
      `<span>Draw calls</span><span>${info.render.calls}</span>` +
      `<span>Triangles</span><span>${info.render.triangles}</span>` +
      `<span>FPS</span><span class="stat-good">${fps}</span>`;
  }

  // -----------------------------------------------------------
  // Render loop
  // -----------------------------------------------------------
  let frames = 0, lastFpsTime = performance.now(), fps = 60, lastFrameTime = performance.now();
  function loop(t) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (t - lastFrameTime) / 1000);
    lastFrameTime = t;
    syncFromState();
    applyArrowPan(dt);
    updateVisuals();
    if (controls3D && state.mode === '3d') controls3D.update();
    frames++;
    if (t - lastFpsTime >= 1000) {
      fps = frames; frames = 0; lastFpsTime = t;
      const fpsLabel = $('#fpsLabel'); if (fpsLabel) fpsLabel.textContent = fps + ' FPS';
      const zoomLabelEl = $('#zoomValue'); if (zoomLabelEl) zoomLabelEl.textContent = zoomLabel();
      if (panel_visible()) markDirty();
    }
    renderer.render(scene, activeCamera());
    labelRenderer.render(scene, activeCamera());
    renderDebug();
    dirty = false;
  }
  function panel_visible() { return $('#debugPanel')?.classList.contains('show'); }

  $('#debugToggle')?.addEventListener('click', () => { $('#debugPanel')?.classList.toggle('show'); markDirty(); });
  $('#debugClose')?.addEventListener('click', () => $('#debugPanel')?.classList.remove('show'));

  // Initial setup
  cam2D.position.set(0, 0, 40);
  cam2D.zoom = state.view2d?.zoom || 1;
  switchTo3DCamera('perspective');
  resize();
  requestAnimationFrame(loop);
}