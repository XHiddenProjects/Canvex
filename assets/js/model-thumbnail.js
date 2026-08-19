/* ---------------------------------------------------------------
 * Model asset thumbnails
 * ---------------------------------------------------------------
 * editor.js's asset grid (renderAssetGrid) shows a real preview image for
 * "image" category assets, but "model" assets (.obj / .mtl) just fell back
 * to a static glyph — you couldn't tell what a model actually looked like
 * without dragging it into a scene. This renders a small offscreen
 * snapshot (using the same OBJLoader/MTLLoader as the main viewport) and
 * hands editor.js a data URL it can drop straight into an <img>.
 *
 * editor.js is a classic (non-module) script, so this is exposed as a
 * plain global rather than an export.
 * ------------------------------------------------------------- */
import * as THREE from './vendor/three/three.module.js';
import { OBJLoader } from './vendor/three/OBJLoader.js';
import { MTLLoader } from './vendor/three/MTLLoader.js';

const SIZE = 160;
const objLoader = new OBJLoader();
const mtlLoader = new MTLLoader();
const cache = new Map(); // "objUrl|mtlUrl" -> Promise<string dataURL>

let renderer = null;
function getRenderer() {
  if (renderer) return renderer;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

function loadMtl(mtlUrl) {
  if (!mtlUrl) return Promise.resolve(null);
  return new Promise(resolve => {
    mtlLoader.load(mtlUrl, materials => { materials.preload(); resolve(materials); }, undefined, () => resolve(null));
  });
}

async function renderThumbnail(objUrl, mtlUrl) {
  const materials = await loadMtl(mtlUrl);
  objLoader.setMaterials(materials);
  const obj = await new Promise((resolve, reject) => objLoader.load(objUrl, resolve, undefined, reject));
  if (!materials) {
    obj.traverse(child => { if (child.isMesh) child.material = new THREE.MeshStandardMaterial({ color: 0xc7ccd4, roughness: 0.7, metalness: 0.05 }); });
  }

  // Frame the whole model: center it, then back the camera off by its
  // radius so it fills most of the thumbnail regardless of the model's
  // actual size.
  const box = new THREE.Box3().setFromObject(obj);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);
  const radius = Math.max(size.length() * 0.5, 1e-3);
  obj.position.sub(center);

  const scene = new THREE.Scene();
  scene.add(obj);
  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(radius * 2, radius * 3, radius * 2.5);
  scene.add(key);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, radius * 20);
  const dist = radius / Math.sin(THREE.MathUtils.degToRad(35 / 2)) * 1.15;
  camera.position.set(dist * 0.6, dist * 0.55, dist * 0.6);
  camera.lookAt(0, 0, 0);

  const r = getRenderer();
  r.render(scene, camera);
  const dataUrl = r.domElement.toDataURL('image/png');

  // The scene/obj/materials aren't kept around — only the raster result is
  // cached — so dispose the GPU resources now rather than leaking them.
  obj.traverse(child => {
    if (!child.isMesh) return;
    child.geometry?.dispose?.();
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    mats.forEach(m => m?.dispose?.());
  });

  return dataUrl;
}

window.__forgeModelThumbnail = (objUrl, mtlUrl) => {
  if (!objUrl) return Promise.resolve(null);
  const key = `${objUrl}|${mtlUrl || ''}`;
  if (cache.has(key)) return cache.get(key);
  const promise = renderThumbnail(objUrl, mtlUrl).catch(err => {
    console.error('Model thumbnail failed', objUrl, err);
    return null;
  });
  cache.set(key, promise);
  return promise;
};
