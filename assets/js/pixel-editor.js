"use strict";
(() => {
  const mount = document.getElementById('pixelPanel');
  const state = window.__forgeState;
  if (!mount || !state) return;
  const api = window.__forgeApi, toast = window.__forgeToast, log = window.__forgeLog;

  // ===========================================================================
  // Professional block/grid pixel editor. Everything is edited cell-by-cell on
  // a fixed grid ("block edit") — no freehand vector strokes. Adds layers,
  // shape tools, symmetry, a movable selection, resize-preserving canvas
  // changes, a custom palette, and a zoom control on top of the original
  // single-layer pencil/eraser/fill/eyedropper tool.
  // ===========================================================================

  const SIZES = [8, 16, 24, 32, 48, 64, 96, 128];
  const DEFAULT_PALETTE = ['#000000', '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764',
    '#257179', '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86'];

  function blank(w, h) { return new Array(w * h).fill(null); }
  function newLayer(w, h, name) {
    return { id: `l${Date.now().toString(36)}${Math.floor(Math.random() * 999)}`, name, visible: true, opacity: 1, data: blank(w, h) };
  }

  const px = {
    w: 16, h: 16, zoom: 20, tool: 'pencil', color: DEFAULT_PALETTE[13], secondaryColor: '#00000000',
    brush: 1, grid: true, mirrorX: false, mirrorY: false,
    layers: [], active: 0,
    customColors: [], recentColors: [],
    selection: null, // {x,y,w,h}
    history: [], future: [],
  };
  px.layers.push(newLayer(px.w, px.h, 'Layer 1'));

  mount.innerHTML = `
    <div class="forge-tool">
      <aside class="forge-tool__rail">
        <div>
          <h4>Canvas</h4>
          <select id="pxSize">${SIZES.map(s => `<option value="${s}" ${s === 16 ? 'selected' : ''}>${s}×${s}</option>`).join('')}</select>
          <div style="display:flex;gap:4px;margin-top:6px">
            <button id="pxNew" style="flex:1" title="Start a fresh blank canvas at this size">New</button>
            <button id="pxResize" style="flex:1" title="Change canvas size, keeping existing art anchored top-left">Resize</button>
          </div>
        </div>
        <div>
          <h4>Tools</h4>
          <div class="tool-group" style="display:flex;gap:4px;flex-wrap:wrap">
            <button data-tool="pencil" class="tool active" title="Pencil (B)">✏</button>
            <button data-tool="eraser" class="tool" title="Eraser (E)">▭</button>
            <button data-tool="fill" class="tool" title="Fill bucket (G)">▨</button>
            <button data-tool="eyedropper" class="tool" title="Eyedropper (I)">◎</button>
            <button data-tool="line" class="tool" title="Line (L)">╱</button>
            <button data-tool="rect" class="tool" title="Rectangle (R) — hold Shift to fill">▢</button>
            <button data-tool="ellipse" class="tool" title="Ellipse (O) — hold Shift to fill">◯</button>
            <button data-tool="select" class="tool" title="Select / Move (M)">⬚</button>
          </div>
          <label class="muted" style="display:block;margin-top:8px">Brush size <input id="pxBrush" type="number" min="1" max="8" value="1" style="width:44px"></label>
          <div style="display:flex;gap:10px;margin-top:6px">
            <label class="muted" style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="pxMirrorX">Mirror X</label>
            <label class="muted" style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="pxMirrorY">Mirror Y</label>
          </div>
        </div>
        <div>
          <h4>Palette</h4>
          <div id="pxPalette" style="display:grid;grid-template-columns:repeat(8,1fr);gap:4px"></div>
          <div style="display:flex;gap:4px;margin-top:6px;align-items:center">
            <input id="pxColor" type="color" value="${px.color}" style="flex:1;height:26px">
            <button id="pxAddCustom" title="Add current color to your palette">+</button>
          </div>
          <div id="pxCustomPalette" style="display:grid;grid-template-columns:repeat(8,1fr);gap:4px;margin-top:6px"></div>
          <div class="muted" style="margin-top:6px;font-size:10.5px">Recent</div>
          <div id="pxRecentPalette" style="display:grid;grid-template-columns:repeat(8,1fr);gap:4px;margin-top:4px"></div>
        </div>
        <div style="flex:1;min-height:0;display:flex;flex-direction:column">
          <h4>Layers</h4>
          <div style="display:flex;gap:4px;margin-bottom:6px">
            <button id="pxLayerAdd" style="flex:1" title="Add layer">+ Layer</button>
            <button id="pxLayerDup" style="flex:1" title="Duplicate layer">⧉</button>
            <button id="pxLayerDel" style="flex:1" title="Delete layer">🗑</button>
          </div>
          <div id="pxLayerList" style="overflow:auto;flex:1;display:flex;flex-direction:column-reverse;gap:4px"></div>
        </div>
        <div>
          <h4>History</h4>
          <div style="display:flex;gap:4px">
            <button id="pxUndo" style="flex:1">Undo</button>
            <button id="pxRedo" style="flex:1">Redo</button>
          </div>
        </div>
      </aside>
      <div class="forge-tool__main">
        <div class="forge-tool__toolbar">
          <input id="pxAssetName" placeholder="sprite-name.png" style="width:180px">
          <button id="pxSave">💾 Save as Asset</button>
          <button id="pxExport">⇩ Export PNG</button>
          <label class="muted" style="display:flex;align-items:center;gap:4px;margin-left:8px"><input type="checkbox" id="pxGridToggle" checked>Grid</label>
          <label class="muted" style="display:flex;align-items:center;gap:4px">Zoom <input id="pxZoom" type="range" min="4" max="48" value="20" style="width:100px"></label>
          <span class="muted" style="margin-left:auto" id="pxZoomLabel">Zoom 20px/cell · 16×16</span>
        </div>
        <div class="forge-tool__stage">
          <canvas id="pxCanvas" style="image-rendering:pixelated;border:1px solid #3a3f47;background:#fff repeating-conic-gradient(#c9cdd4 0% 25%, #ffffff 0% 50%) 50% / 16px 16px;"></canvas>
        </div>
      </div>
    </div>`;

  const canvas = mount.querySelector('#pxCanvas');
  const ctx = canvas.getContext('2d');
  const paletteEl = mount.querySelector('#pxPalette');
  const customPaletteEl = mount.querySelector('#pxCustomPalette');
  const recentPaletteEl = mount.querySelector('#pxRecentPalette');
  const colorInput = mount.querySelector('#pxColor');
  const layerListEl = mount.querySelector('#pxLayerList');
  const brushInput = mount.querySelector('#pxBrush');
  const zoomInput = mount.querySelector('#pxZoom');
  const zoomLabel = mount.querySelector('#pxZoomLabel');
  const gridToggle = mount.querySelector('#pxGridToggle');

  function activeLayer() { return px.layers[px.active]; }

  function renderPalette() {
    paletteEl.innerHTML = DEFAULT_PALETTE.map(c => `<button class="forge-swatch${c === px.color ? ' active' : ''}" style="background:${c}" data-color="${c}"></button>`).join('');
    customPaletteEl.innerHTML = px.customColors.map(c => `<button class="forge-swatch${c === px.color ? ' active' : ''}" style="background:${c}" data-color="${c}" data-custom="1" title="Right-click to remove"></button>`).join('');
    recentPaletteEl.innerHTML = px.recentColors.map(c => `<button class="forge-swatch${c === px.color ? ' active' : ''}" style="background:${c}" data-color="${c}"></button>`).join('');
  }
  renderPalette();

  function pushRecent(c) {
    px.recentColors = [c, ...px.recentColors.filter(x => x !== c)].slice(0, 16);
  }

  function renderLayers() {
    layerListEl.innerHTML = px.layers.map((l, i) => `
      <div class="px-layer${i === px.active ? ' active' : ''}" data-idx="${i}" style="display:flex;align-items:center;gap:6px;padding:5px 6px;border:1px solid ${i === px.active ? 'var(--accent,#e4813a)' : 'var(--line)'};border-radius:5px;cursor:pointer;background:#14161a">
        <span data-vis="${i}" title="Toggle visibility" style="cursor:pointer">${l.visible ? '👁' : '🚫'}</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px">${l.name}</span>
        <input data-opacity="${i}" type="range" min="0" max="1" step="0.05" value="${l.opacity}" style="width:44px" title="Layer opacity">
      </div>`).join('');
    layerListEl.querySelectorAll('.px-layer').forEach(node => {
      node.addEventListener('click', e => {
        if (e.target.closest('[data-vis]') || e.target.closest('[data-opacity]')) return;
        px.active = Number(node.dataset.idx);
        renderLayers();
      });
    });
    layerListEl.querySelectorAll('[data-vis]').forEach(el => el.addEventListener('click', e => {
      e.stopPropagation();
      const i = Number(el.dataset.vis);
      px.layers[i].visible = !px.layers[i].visible;
      renderLayers(); draw();
    }));
    layerListEl.querySelectorAll('[data-opacity]').forEach(el => el.addEventListener('input', e => {
      const i = Number(el.dataset.opacity);
      px.layers[i].opacity = Number(el.value);
      draw();
    }));
  }
  renderLayers();

  function resizeCanvas() {
    canvas.width = px.w * px.zoom;
    canvas.height = px.h * px.zoom;
    zoomLabel.textContent = `Zoom ${px.zoom}px/cell · ${px.w}×${px.h}`;
    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    px.layers.forEach(layer => {
      if (!layer.visible || layer.opacity <= 0) return;
      ctx.globalAlpha = layer.opacity;
      for (let y = 0; y < px.h; y++) {
        for (let x = 0; x < px.w; x++) {
          const c = layer.data[y * px.w + x];
          if (!c) continue;
          ctx.fillStyle = c;
          ctx.fillRect(x * px.zoom, y * px.zoom, px.zoom, px.zoom);
        }
      }
    });
    ctx.globalAlpha = 1;
    if (px.grid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      for (let x = 0; x <= px.w; x++) { ctx.beginPath(); ctx.moveTo(x * px.zoom, 0); ctx.lineTo(x * px.zoom, canvas.height); ctx.stroke(); }
      for (let y = 0; y <= px.h; y++) { ctx.beginPath(); ctx.moveTo(0, y * px.zoom); ctx.lineTo(canvas.width, y * px.zoom); ctx.stroke(); }
    }
    if (px.selection) {
      const s = px.selection;
      ctx.save();
      ctx.strokeStyle = '#41a6f6'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.strokeRect(s.x * px.zoom, s.y * px.zoom, s.w * px.zoom, s.h * px.zoom);
      ctx.restore();
    }
    if (previewShape) drawPreviewOverlay();
  }

  function drawPreviewOverlay() {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = px.color;
    previewShape.forEach(([x, y]) => {
      if (x < 0 || y < 0 || x >= px.w || y >= px.h) return;
      ctx.fillRect(x * px.zoom, y * px.zoom, px.zoom, px.zoom);
    });
    ctx.restore();
  }

  function pushHistory() {
    px.history.push({ w: px.w, h: px.h, layers: px.layers.map(l => ({ ...l, data: l.data.slice() })), active: px.active });
    if (px.history.length > 60) px.history.shift();
    px.future.length = 0;
  }

  function cellAt(e) {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / (r.width / px.w));
    const y = Math.floor((e.clientY - r.top) / (r.height / px.h));
    if (x < 0 || y < 0 || x >= px.w || y >= px.h) return null;
    return { x, y };
  }

  function floodFill(data, x0, y0, target, replacement) {
    if (target === replacement) return;
    const stack = [[x0, y0]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= px.w || y >= px.h) continue;
      const i = y * px.w + x;
      if (data[i] !== target) continue;
      data[i] = replacement;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }

  function mirrorPoints(x, y) {
    const pts = [[x, y]];
    if (px.mirrorX) pts.push([px.w - 1 - x, y]);
    if (px.mirrorY) pts.push([x, px.h - 1 - y]);
    if (px.mirrorX && px.mirrorY) pts.push([px.w - 1 - x, px.h - 1 - y]);
    return pts;
  }

  function setCell(data, x, y, color) {
    if (x < 0 || y < 0 || x >= px.w || y >= px.h) return;
    data[y * px.w + x] = color;
  }

  function paintAt(cell, colorOverride) {
    const data = activeLayer().data;
    const color = colorOverride !== undefined ? colorOverride : (px.tool === 'eraser' ? null : px.color);
    const b = Math.max(1, Number(brushInput.value) || 1);
    const half = Math.floor(b / 2);
    for (let dy = 0; dy < b; dy++) for (let dx = 0; dx < b; dx++) {
      const x = cell.x - half + dx, y = cell.y - half + dy;
      mirrorPoints(x, y).forEach(([mx, my]) => setCell(data, mx, my, color));
    }
  }

  function lineCells(x0, y0, x1, y1) {
    const pts = []; let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
    while (true) {
      pts.push([x0, y0]);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return pts;
  }
  function rectCells(x0, y0, x1, y1, filled) {
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1), minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    const pts = [];
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      if (filled || x === minX || x === maxX || y === minY || y === maxY) pts.push([x, y]);
    }
    return pts;
  }
  function ellipseCells(x0, y0, x1, y1, filled) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const rx = Math.max(0.5, Math.abs(x1 - x0) / 2), ry = Math.max(0.5, Math.abs(y1 - y0) / 2);
    const pts = [];
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1), minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
      const d = nx * nx + ny * ny;
      if (filled ? d <= 1 : Math.abs(d - 1) < 0.35) pts.push([x, y]);
    }
    return pts;
  }

  let painting = false, dragStart = null, previewShape = null, moveSnapshot = null;

  function applyStroke(cell) {
    if (px.tool === 'pencil') paintAt(cell);
    else if (px.tool === 'eraser') paintAt(cell, null);
    else if (px.tool === 'fill') {
      const data = activeLayer().data;
      const target = data[cell.y * px.w + cell.x];
      floodFill(data, cell.x, cell.y, target, px.color);
    } else if (px.tool === 'eyedropper') {
      const c = activeLayer().data[cell.y * px.w + cell.x];
      if (c) { px.color = c; colorInput.value = c; pushRecent(c); renderPalette(); }
    }
    draw();
  }

  canvas.addEventListener('mousedown', e => {
    const cell = cellAt(e);
    if (!cell) return;
    if (px.tool === 'select') {
      dragStart = cell;
      if (px.selection && cell.x >= px.selection.x && cell.x < px.selection.x + px.selection.w &&
          cell.y >= px.selection.y && cell.y < px.selection.y + px.selection.h) {
        pushHistory();
        moveSnapshot = { data: activeLayer().data.slice(), sel: { ...px.selection }, start: cell };
      } else {
        px.selection = { x: cell.x, y: cell.y, w: 1, h: 1 };
        moveSnapshot = null;
      }
      painting = true;
      draw();
      return;
    }
    if (px.tool === 'fill' || px.tool === 'eyedropper') { pushHistory(); applyStroke(cell); return; }
    if (px.tool === 'line' || px.tool === 'rect' || px.tool === 'ellipse') {
      dragStart = cell; painting = true; previewShape = [[cell.x, cell.y]]; draw(); return;
    }
    pushHistory();
    painting = true;
    applyStroke(cell);
  });

  window.addEventListener('mousemove', e => {
    if (!painting) return;
    const cell = cellAt(e);
    if (!cell) return;
    if (px.tool === 'select') {
      if (moveSnapshot) {
        const dx = cell.x - moveSnapshot.start.x, dy = cell.y - moveSnapshot.start.y;
        const src = moveSnapshot.data, sel = moveSnapshot.sel;
        const out = new Array(px.w * px.h).fill(null);
        for (let y = 0; y < px.h; y++) for (let x = 0; x < px.w; x++) {
          const inSel = x >= sel.x && x < sel.x + sel.w && y >= sel.y && y < sel.y + sel.h;
          if (!inSel) out[y * px.w + x] = src[y * px.w + x];
        }
        for (let y = sel.y; y < sel.y + sel.h; y++) for (let x = sel.x; x < sel.x + sel.w; x++) {
          const v = src[y * px.w + x];
          const nx = x + dx, ny = y + dy;
          if (v && nx >= 0 && ny >= 0 && nx < px.w && ny < px.h) out[ny * px.w + nx] = v;
        }
        activeLayer().data = out;
        px.selection = { x: sel.x + dx, y: sel.y + dy, w: sel.w, h: sel.h };
      } else if (dragStart) {
        px.selection = { x: Math.min(dragStart.x, cell.x), y: Math.min(dragStart.y, cell.y),
          w: Math.abs(cell.x - dragStart.x) + 1, h: Math.abs(cell.y - dragStart.y) + 1 };
      }
      draw();
      return;
    }
    if (px.tool === 'line') { previewShape = lineCells(dragStart.x, dragStart.y, cell.x, cell.y); draw(); return; }
    if (px.tool === 'rect') { previewShape = rectCells(dragStart.x, dragStart.y, cell.x, cell.y, e.shiftKey); draw(); return; }
    if (px.tool === 'ellipse') { previewShape = ellipseCells(dragStart.x, dragStart.y, cell.x, cell.y, e.shiftKey); draw(); return; }
    if (px.tool === 'pencil' || px.tool === 'eraser') applyStroke(cell);
  });

  window.addEventListener('mouseup', e => {
    if (!painting) return;
    painting = false;
    if ((px.tool === 'line' || px.tool === 'rect' || px.tool === 'ellipse') && previewShape) {
      pushHistory();
      const data = activeLayer().data;
      const color = px.tool === 'eraser' ? null : px.color;
      previewShape.forEach(([x, y]) => mirrorPoints(x, y).forEach(([mx, my]) => setCell(data, mx, my, color)));
      previewShape = null;
      draw();
    }
    dragStart = null;
    moveSnapshot = null;
  });

  window.addEventListener('keydown', e => {
    if (!mount.classList.contains('active') || !mount.offsetParent) return;
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && px.selection) {
      pushHistory();
      const data = activeLayer().data, sel = px.selection;
      for (let y = sel.y; y < sel.y + sel.h; y++) for (let x = sel.x; x < sel.x + sel.w; x++) setCell(data, x, y, null);
      draw();
    }
    if (e.key === 'Escape') { px.selection = null; draw(); }
  });

  mount.querySelectorAll('[data-tool]').forEach(btn => btn.addEventListener('click', () => {
    mount.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    px.tool = btn.dataset.tool;
    if (px.tool !== 'select') px.selection = null;
    canvas.style.cursor = px.tool === 'eyedropper' ? 'copy' : px.tool === 'select' ? 'move' : 'crosshair';
    draw();
  }));

  function pickFromSwatch(e) {
    const sw = e.target.closest('[data-color]');
    if (!sw) return;
    px.color = sw.dataset.color;
    colorInput.value = px.color.length === 7 ? px.color : '#000000';
    pushRecent(px.color);
    renderPalette();
  }
  paletteEl.addEventListener('click', pickFromSwatch);
  recentPaletteEl.addEventListener('click', pickFromSwatch);
  customPaletteEl.addEventListener('click', pickFromSwatch);
  customPaletteEl.addEventListener('contextmenu', e => {
    const sw = e.target.closest('[data-color]');
    if (!sw) return;
    e.preventDefault();
    px.customColors = px.customColors.filter(c => c !== sw.dataset.color);
    renderPalette();
  });
  mount.querySelector('#pxAddCustom').addEventListener('click', () => {
    if (!px.customColors.includes(px.color)) px.customColors.push(px.color);
    renderPalette();
  });
  colorInput.addEventListener('input', () => { px.color = colorInput.value; renderPalette(); });

  mount.querySelector('#pxUndo').addEventListener('click', () => {
    if (!px.history.length) return;
    px.future.push({ w: px.w, h: px.h, layers: px.layers.map(l => ({ ...l, data: l.data.slice() })), active: px.active });
    const snap = px.history.pop();
    px.w = snap.w; px.h = snap.h; px.layers = snap.layers; px.active = snap.active;
    resizeCanvas(); renderLayers();
  });
  mount.querySelector('#pxRedo').addEventListener('click', () => {
    if (!px.future.length) return;
    px.history.push({ w: px.w, h: px.h, layers: px.layers.map(l => ({ ...l, data: l.data.slice() })), active: px.active });
    const snap = px.future.pop();
    px.w = snap.w; px.h = snap.h; px.layers = snap.layers; px.active = snap.active;
    resizeCanvas(); renderLayers();
  });

  mount.querySelector('#pxNew').addEventListener('click', async () => {
    const size = Number(mount.querySelector('#pxSize').value);
    if (px.layers.some(l => l.data.some(Boolean)) && !(await window.forgeConfirm('Start a new canvas? Unsaved pixels will be lost.', { danger: true, confirmText: 'Start New' }))) return;
    px.w = px.h = size;
    px.layers = [newLayer(size, size, 'Layer 1')];
    px.active = 0; px.selection = null;
    px.history = []; px.future = [];
    resizeCanvas(); renderLayers();
  });

  mount.querySelector('#pxResize').addEventListener('click', () => {
    const size = Number(mount.querySelector('#pxSize').value);
    pushHistory();
    px.layers.forEach(l => {
      const out = blank(size, size);
      for (let y = 0; y < Math.min(px.h, size); y++) for (let x = 0; x < Math.min(px.w, size); x++) out[y * size + x] = l.data[y * px.w + x];
      l.data = out;
    });
    px.w = size; px.h = size; px.selection = null;
    resizeCanvas();
    toast(`Canvas resized to ${size}×${size}`);
  });

  mount.querySelector('#pxGridToggle').addEventListener('change', () => { px.grid = gridToggle.checked; draw(); });
  zoomInput.addEventListener('input', () => { px.zoom = Number(zoomInput.value); resizeCanvas(); });
  mount.querySelector('#pxMirrorX').addEventListener('change', e => px.mirrorX = e.target.checked);
  mount.querySelector('#pxMirrorY').addEventListener('change', e => px.mirrorY = e.target.checked);

  mount.querySelector('#pxLayerAdd').addEventListener('click', () => {
    pushHistory();
    px.layers.push(newLayer(px.w, px.h, `Layer ${px.layers.length + 1}`));
    px.active = px.layers.length - 1;
    renderLayers(); draw();
  });
  mount.querySelector('#pxLayerDup').addEventListener('click', () => {
    pushHistory();
    const l = activeLayer();
    const copy = { ...l, id: `l${Date.now().toString(36)}`, name: `${l.name} copy`, data: l.data.slice() };
    px.layers.splice(px.active + 1, 0, copy);
    px.active += 1;
    renderLayers(); draw();
  });
  mount.querySelector('#pxLayerDel').addEventListener('click', () => {
    if (px.layers.length <= 1) { toast('At least one layer is required'); return; }
    pushHistory();
    px.layers.splice(px.active, 1);
    px.active = Math.max(0, px.active - 1);
    renderLayers(); draw();
  });

  function flatten() {
    const out = document.createElement('canvas');
    out.width = px.w; out.height = px.h;
    const octx = out.getContext('2d');
    px.layers.forEach(layer => {
      if (!layer.visible || layer.opacity <= 0) return;
      octx.globalAlpha = layer.opacity;
      for (let y = 0; y < px.h; y++) for (let x = 0; x < px.w; x++) {
        const c = layer.data[y * px.w + x];
        if (c) { octx.fillStyle = c; octx.fillRect(x, y, 1, 1); }
      }
    });
    octx.globalAlpha = 1;
    return out.toDataURL('image/png');
  }

  mount.querySelector('#pxExport').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = flatten();
    a.download = (mount.querySelector('#pxAssetName').value || 'sprite') + '.png';
    a.click();
  });

  mount.querySelector('#pxSave').addEventListener('click', async () => {
    if (!state.slug) return;
    const name = mount.querySelector('#pxAssetName').value.trim() || `sprite-${Date.now()}.png`;
    try {
      const { asset } = await api(`/api/games/${encodeURIComponent(state.slug)}/assets`, {
        method: 'POST',
        body: JSON.stringify({ name: name.endsWith('.png') ? name : `${name}.png`, category: 'image', mime: 'image/png', dataUrl: flatten() })
      });
      toast(asset?.overwritten ? `Saved — overwrote existing "${name}"` : `Saved "${name}" to Assets`);
      log('info', `Pixel art saved as asset "${name}"${asset?.overwritten ? ' (overwrote previous version)' : ''}`);
      window.__forgeLoadAssets?.();
    } catch (error) { toast(error.message); }
  });

  // Load an existing image asset back in for editing — used by the Assets
  // tab's right-click "Edit in Pixel Art" (see editor.js). Decodes the PNG
  // into a single new layer at its native resolution; the name field is
  // pre-filled with the asset's own name so hitting Save overwrites it
  // in place instead of creating a duplicate.
  async function loadImageAsset(asset) {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('image failed to load')); img.src = asset.url; });
      const w = Math.max(1, Math.min(img.naturalWidth || 16, 256));
      const h = Math.max(1, Math.min(img.naturalHeight || 16, 256));
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const octx = off.getContext('2d');
      octx.drawImage(img, 0, 0, w, h);
      const pixels = octx.getImageData(0, 0, w, h).data;
      const hex = n => n.toString(16).padStart(2, '0');
      const data = new Array(w * h).fill(null);
      for (let i = 0; i < w * h; i++) {
        const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2], a = pixels[i * 4 + 3];
        if (a === 0) continue;
        data[i] = a === 255 ? `#${hex(r)}${hex(g)}${hex(b)}` : `#${hex(r)}${hex(g)}${hex(b)}${hex(a)}`;
      }
      px.w = w; px.h = h;
      px.layers = [{ id: `l${Date.now().toString(36)}`, name: 'Layer 1', visible: true, opacity: 1, data }];
      px.active = 0; px.selection = null; px.history = []; px.future = [];
      const nameField = mount.querySelector('#pxAssetName');
      if (nameField) nameField.value = asset.name.replace(/\.png$/i, '');
      resizeCanvas(); renderLayers(); renderPalette();
      toast(`Loaded "${asset.name}" for editing`);
    } catch (error) { toast(`Could not load "${asset.name}" for editing`); }
  }
  window.__forgePixelEditorLoad = loadImageAsset;

  document.addEventListener('keydown', e => {
    if (!mount.classList.contains('active') || !mount.offsetParent || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    const map = { b: 'pencil', e: 'eraser', g: 'fill', i: 'eyedropper', l: 'line', r: 'rect', o: 'ellipse', m: 'select' };
    const tool = map[e.key.toLowerCase()];
    if (tool) mount.querySelector(`[data-tool="${tool}"]`)?.click();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); mount.querySelector(e.shiftKey ? '#pxRedo' : '#pxUndo').click(); }
  });

  resizeCanvas();
})();
