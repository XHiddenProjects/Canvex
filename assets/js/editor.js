"use strict";
(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const root = document.documentElement;
  const viewport = $('#viewport');

  const ICONS = { camera: '◈', light: '☀', sprite: '◆', mesh: '▰', group: '▾', collider: '⬡', ui: '▣', audio: '♪' };
  const TYPE_LABELS = { camera: 'Camera', light: 'Directional Light', sprite: 'Sprite Object', mesh: 'Mesh Object', group: 'Node Group', collider: 'Collider 2D', ui: 'UI Canvas', audio: 'Audio Source' };
  // Object shapes (including the "attached image" and "selected" look, and
  // the small attachment-count badge) are drawn once, by the canvas renderer
  // further down this file — see drawObject2D/drawObject and drawAttachBadge.
  // There used to be a second, DOM-based copy of this rendering here that
  // drew every object again at a fixed screen position/size, which is why
  // objects appeared doubled in the viewport; it has been removed.

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const state = {
    mode: '2d', tool: 'select', zoom: 1, grid: true, snap: true,
    slug: null, sceneId: 'main', sceneName: 'Main', scenes: [], objects: [], selectedId: null, dirty: false, logs: []
  };
  window.__forgeState = state;

  const toast = msg => { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 1800); };
  const log = (level, message) => {
    state.logs.push({ level, message, time: new Date().toLocaleTimeString([], { hour12: false }) });
    renderConsole();
  };

  function renderConsole() {
    const list = $('#consoleList');
    const badge = $('#consoleBadge');
    badge.textContent = state.logs.filter(l => l.level !== 'info').length;
    list.innerHTML = state.logs.map(l => `<div><span class="${l.level}-icon">${l.level === 'error' ? '×' : l.level === 'warn' ? '!' : 'i'}</span><code>${escapeHtml(l.message)}</code><time>${l.time}</time></div>`).join('');
  }

  function markDirty(isDirty = true) {
    state.dirty = isDirty;
    $('#dirtyDot').style.visibility = isDirty ? 'visible' : 'hidden';
  }

  // ---------------------------------------------------------------
  // Loading the real game + scene from the server
  // ---------------------------------------------------------------

  function slugFromUrl() {
    const parts = location.pathname.split('/').filter(Boolean); // ["editor", "<slug>"]
    return parts.length > 1 ? decodeURIComponent(parts[1]) : null;
  }

  async function api(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.error || `Request failed (${response.status})`), { status: response.status });
    return body;
  }
  window.__forgeApi = api;
  window.__forgeToast = msg => toast(msg);
  window.__forgeLog = (level, message) => log(level, message);
  window.__forgeEscape = escapeHtml;

  async function loadGame() {
    const slug = slugFromUrl();
    if (!slug) { toast('No game selected'); setTimeout(() => location.assign('/'), 1200); return; }
    state.slug = slug;
    try {
      const [{ game }, status] = await Promise.all([
        api(`/api/games/${encodeURIComponent(slug)}`),
        api('/api/account/status').catch(() => null)
      ]);
      if (status?.displayName) $('#userAvatar').textContent = status.displayName.slice(0, 2).toUpperCase();

      document.title = `${game.config.name} · ForgeEngine Editor`;
      $('#projectName').textContent = game.config.name;

      state.scenes = Array.isArray(game.scenes) && game.scenes.length ? game.scenes : [{ id: 'main', name: 'Main' }];
      const initialId = state.scenes[0].id;
      await switchScene(initialId, { skipSave: true });
      renderSceneSwitcher();

      log('info', `Loaded "${game.config.name}" (${game.config.template})`);
      if (state.objects.length === 0) log('warn', 'This scene has no objects yet — use + in the Scene panel to add one.');

      renderTree();
      renderInspector();
      renderViewportObjects();
      markDirty(false);
      loadAssets(slug);
    } catch (error) {
      if (error.status === 401) { location.assign('/'); return; }
      toast(error.message);
      log('error', error.message);
      setTimeout(() => location.assign('/'), 1600);
    }
  }

  function withDefaults(o) {
    const type = ICONS[o.type] ? o.type : 'mesh';
    return {
      ...o,
      id: String(o.id || `object-${Math.random().toString(36).slice(2, 8)}`),
      name: String(o.name || 'Game Object'),
      type,
      icon: o.icon || ICONS[type],
      parent: Boolean(o.parent),
      indent: Number.isFinite(o.indent) ? o.indent : 0,
      position: {
        x: Number.isFinite(o.position?.x) ? o.position.x : 0,
        y: Number.isFinite(o.position?.y) ? o.position.y : 0,
        z: Number.isFinite(o.position?.z) ? o.position.z : 0
      },
      rotation: {
        x: Number.isFinite(o.rotation?.x) ? o.rotation.x : 0,
        y: Number.isFinite(o.rotation?.y) ? o.rotation.y : 0,
        z: Number.isFinite(o.rotation?.z) ? o.rotation.z : 0
      },
      scale: {
        x: Number.isFinite(o.scale?.x) ? o.scale.x : 1,
        y: Number.isFinite(o.scale?.y) ? o.scale.y : 1,
        z: Number.isFinite(o.scale?.z) ? o.scale.z : 1
      },
      enabled: o.enabled !== false,
      visible: o.visible !== false,
      tag: o.tag || 'Untagged',
      layer: o.layer || 'Default',
      // Scripts/assets attached via the context menu or Add Component.
      attachments: Array.isArray(o.attachments) ? o.attachments : [],
      // When an image/pixel-art/model asset is attached, the object's
      // viewport representation switches to that asset (see openAttachPicker).
      spriteUrl: o.spriteUrl || null
    };
  }

  // ---------------------------------------------------------------
  // Scenes / levels: a game can hold several; switching autosaves the one
  // being left, then loads the target scene's objects into the workspace.
  // ---------------------------------------------------------------

  function renderSceneSwitcher() {
    const select = $('#sceneSwitcher');
    if (!select) return;
    select.innerHTML = state.scenes.map(s => `<option value="${escapeHtml(s.id)}"${s.id === state.sceneId ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
  }

  async function switchScene(sceneId, { skipSave = false } = {}) {
    if (!state.slug) return;
    if (!skipSave && state.dirty) await saveScene();
    try {
      const { scene } = await api(`/api/games/${encodeURIComponent(state.slug)}/scenes/${encodeURIComponent(sceneId)}`);
      state.sceneId = scene.id;
      state.sceneName = scene.name || 'Main';
      state.objects = Array.isArray(scene.objects) ? scene.objects.map(withDefaults) : [];
      state.selectedId = state.objects[0]?.id || null;
      $('#sceneNameLabel').textContent = state.sceneName;
      $('#sceneHeaderName').textContent = state.sceneName;
      $('#viewportTabName').textContent = state.sceneName;
      renderTree(); renderInspector(); renderViewportObjects();
      window.forgeRedraw3D?.();
      markDirty(false);
    } catch (error) {
      toast(error.message);
      log('error', `Could not load scene: ${error.message}`);
    }
  }

  $('#sceneSwitcher')?.addEventListener('change', e => switchScene(e.target.value));

  $('#addScene')?.addEventListener('click', async () => {
    if (!state.slug) return;
    const name = window.prompt('New scene / level name', `Level ${state.scenes.length + 1}`);
    if (!name) return;
    try {
      const { scene } = await api(`/api/games/${encodeURIComponent(state.slug)}/scenes`, { method: 'POST', body: JSON.stringify({ name }) });
      state.scenes.push({ id: scene.id, name: scene.name, objectCount: 0 });
      renderSceneSwitcher();
      await switchScene(scene.id, { skipSave: true });
      toast(`Scene "${scene.name}" created`);
      log('info', `Created scene "${scene.name}"`);
    } catch (error) {
      toast(error.message);
    }
  });

  $('#deleteScene')?.addEventListener('click', async () => {
    if (!state.slug || state.scenes.length <= 1) { toast('A game must keep at least one scene'); return; }
    if (!window.confirm(`Delete scene "${state.sceneName}"? This can't be undone.`)) return;
    try {
      await api(`/api/games/${encodeURIComponent(state.slug)}/scenes/${encodeURIComponent(state.sceneId)}`, { method: 'DELETE' });
      state.scenes = state.scenes.filter(s => s.id !== state.sceneId);
      renderSceneSwitcher();
      await switchScene(state.scenes[0].id, { skipSave: true });
      toast('Scene deleted');
    } catch (error) {
      toast(error.message);
    }
  });

  // ---------------------------------------------------------------
  // Hierarchy / inspector / viewport rendering
  // ---------------------------------------------------------------

  function renderTree(filter = '') {
    const list = state.objects.filter(o => o.name.toLowerCase().includes(filter.toLowerCase()));
    $('#objectCount').textContent = `${state.objects.length} object${state.objects.length === 1 ? '' : 's'}`;
    $('#selectionCount').textContent = state.selectedId ? '1 selected' : '0 selected';

    if (state.objects.length === 0) {
      $('#sceneTree').innerHTML = `<p class="muted" style="padding:14px">No objects in this scene yet. Click <strong>+</strong> above to add one.</p>`;
      return;
    }
    $('#sceneTree').innerHTML = list.map(o => `<div class="tree-row ${o.id === state.selectedId ? 'selected' : ''}" data-id="${o.id}" data-type="${o.type}"><span class="indent" style="margin-left:${(o.indent || 0) * 12}px">${o.parent ? '⌄' : ''}</span><span class="node-icon">${o.icon}</span><span>${escapeHtml(o.name)}</span><span class="eye">◉</span></div>`).join('');
    $$('.tree-row').forEach(row => row.addEventListener('click', () => selectObject(row.dataset.id)));
  }

  function selectObject(id) {
    state.selectedId = id;
    renderTree($('#sceneSearch').value);
    renderInspector();
    renderViewportObjects();
    window.__forgeRenderKeyframes?.();
    const o = state.objects.find(x => x.id === id);
    if (o) toast(`${o.name} selected`);
  }

  window.__forgeSelectObject = selectObject;

  function renderInspector() {
    const o = state.objects.find(x => x.id === state.selectedId);
    $('#inspectorEmpty').style.display = o ? 'none' : 'flex';
    $('#inspectorContent').style.display = o ? 'block' : 'none';
    if (!o) return;
    $('#objectName').value = o.name;
    $('#objectType').textContent = TYPE_LABELS[o.type] || 'Game Object';
    $('#objectIcon').textContent = o.icon;
    const vectors = $$('.transform-fields .vector');
    const setVec = (el, v, suffix = '') => { const [x, y, z] = el.querySelectorAll('input'); x.value = v.x + suffix; y.value = v.y + suffix; z.value = v.z + suffix; };
    if (vectors[0]) setVec(vectors[0], o.position);
    if (vectors[1]) setVec(vectors[1], o.rotation, '°');
    if (vectors[2]) setVec(vectors[2], o.scale);
    if ($('#objectEnabled')) $('#objectEnabled').checked = o.enabled !== false;
    if ($('#objectTag')) $('#objectTag').value = o.tag || 'Untagged';
    if ($('#objectLayer')) $('#objectLayer').value = o.layer || 'Default';
    renderAttachments(o);
  }

  // Scripts/assets attached to the selected object, shown as their own
  // inspector component so "Add Component" and the context menu's
  // "Attach…" actions have somewhere real to land.
  function renderAttachments(o) {
    const box = $('#componentExtra');
    if (!box) return;
    const items = o.attachments || [];
    if (items.length === 0) { box.innerHTML = ''; return; }
    box.innerHTML = `<button class="component-head"><span>⌄</span><strong>Scripts &amp; Assets</strong><i>${items.length}</i></button>
      <div class="component-body">${items.map(a => `
        <div class="asset-field" data-attachment="${a.id}">
          <div class="asset-thumb">${CATEGORY_GLYPH[a.category] || '◫'}</div>
          <div><strong>${escapeHtml(a.name)}</strong><small>${a.category === 'script' ? 'Script' : 'Asset'}</small></div>
          <button class="asset-remove" data-remove-attachment="${a.id}" title="Remove">×</button>
        </div>`).join('')}</div>`;
    box.querySelectorAll('[data-remove-attachment]').forEach(btn => btn.addEventListener('click', () => {
      o.attachments = (o.attachments || []).filter(a => a.id !== btn.dataset.removeAttachment);
      markDirty();
      renderAttachments(o);
      toast('Removed from object');
    }));
  }
  window.__forgeRenderAttachments = renderAttachments;

  // NOTE: object shapes themselves are no longer drawn here. They are drawn
  // exactly once, by the canvas-based 2D/3D renderer further down this file
  // (see drawObject2D / drawObject / render()), which already positions each
  // object at its real world position and sizes it to match a full grid cell
  // — scaling correctly with pan/zoom and swapping between the flat 2D shape
  // and the 3D shape depending on the active workspace tab. This function
  // used to *also* render a second copy of every object into #viewportObjects
  // at a fixed screen-percentage position with a fixed pixel size, which is
  // why every object appeared twice (a correctly placed/sized one from the
  // canvas, plus a stray duplicate stuck at the same spot regardless of the
  // object's actual position, zoom, or 2D/3D mode). #viewportObjects is kept
  // around only in case future UI wants a DOM layer over the canvas, but it
  // no longer draws anything, so there is exactly one shape per object.
  function renderViewportObjects() {
    const container = $('#viewportObjects');
    container.innerHTML = '';
    $('#viewportHint').textContent = state.objects.length === 0
      ? 'Scene is empty · use + in the Scene panel to add your first object'
      : (state.mode === '2d' ? 'Gridmap · Drag to pan · Wheel to zoom' : 'Gridmap · WASD to move around · Right-drag to orbit · Wheel to zoom · Drag an object to move it');
    window.forgeRedraw3D?.();
  }

  // ---------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------

  $('#objectName').addEventListener('change', e => {
    const o = state.objects.find(x => x.id === state.selectedId);
    if (!o) return;
    o.name = e.target.value.trim() || 'Game Object';
    renderTree($('#sceneSearch').value);
    renderViewportObjects();
    markDirty();
    toast('Object renamed');
  });

  const VECTOR_PROPS = ['position', 'rotation', 'scale'];
  $$('.transform-fields .vector').forEach((vecEl, vi) => {
    const prop = VECTOR_PROPS[vi];
    vecEl.querySelectorAll('input').forEach((input, i) => {
      const axis = ['x', 'y', 'z'][i];
      input.addEventListener('change', () => {
        const o = state.objects.find(x => x.id === state.selectedId);
        if (!o) return;
        const value = parseFloat(input.value);
        o[prop] ||= prop === 'scale' ? { x: 1, y: 1, z: 1 } : { x: 0, y: 0, z: 0 };
        o[prop][axis] = Number.isFinite(value) ? value : (prop === 'scale' ? 1 : 0);
        markDirty();
        window.forgeRedraw3D?.();
      });
    });
  });

  $('#objectEnabled')?.addEventListener('change', e => {
    const o = state.objects.find(x => x.id === state.selectedId);
    if (!o) return;
    o.enabled = e.target.checked;
    markDirty();
    renderViewportObjects();
    window.forgeRedraw3D?.();
  });
  $('#objectTag')?.addEventListener('change', e => {
    const o = state.objects.find(x => x.id === state.selectedId);
    if (o) { o.tag = e.target.value; markDirty(); }
  });
  $('#objectLayer')?.addEventListener('change', e => {
    const o = state.objects.find(x => x.id === state.selectedId);
    if (o) { o.layer = e.target.value; markDirty(); }
  });

  $('#addObject').onclick = () => {
    const id = `object-${Date.now().toString(36)}`;
    const n = state.objects.length + 1;
    state.objects.push(withDefaults({ id, name: `Game Object ${n}`, type: 'mesh' }));
    markDirty();
    selectObject(id);
    renderTree($('#sceneSearch').value);
    log('info', `Added "Game Object ${n}" to the scene`);
  };

  $('#deleteObject').onclick = () => {
    const o = state.objects.find(x => x.id === state.selectedId);
    if (!o) return;
    state.objects = state.objects.filter(x => x.id !== o.id);
    state.selectedId = state.objects[0]?.id || null;
    markDirty();
    renderTree($('#sceneSearch').value);
    renderInspector();
    renderViewportObjects();
    toast(`${o.name} deleted`);
    log('info', `Deleted "${o.name}"`);
  };

  $('#addComponent').onclick = () => {
    const o = state.objects.find(x => x.id === state.selectedId);
    if (!o) { toast('Select an object first'); return; }
    window.__forgeOpenAttachPicker?.(o.id);
  };

  // ---------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------

  async function saveScene() {
    if (!state.slug) return;
    try {
      const payload = { name: state.sceneName, objects: state.objects };
      await api(`/api/games/${encodeURIComponent(state.slug)}/scenes/${encodeURIComponent(state.sceneId)}`, { method: 'PUT', body: JSON.stringify(payload) });
      const entry = state.scenes.find(s => s.id === state.sceneId);
      if (entry) entry.objectCount = state.objects.length;
      markDirty(false);
      toast('Scene saved');
      log('info', 'Scene saved');
    } catch (error) {
      toast(error.message);
      log('error', `Save failed: ${error.message}`);
    }
  }
  window.__forgeSaveScene = saveScene;

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveScene(); }
  });

  // ---------------------------------------------------------------
  // Assets tab: real per-game assets stored on disk with metadata,
  // organized by category, backed by /api/games/:slug/assets
  // ---------------------------------------------------------------

  const CATEGORY_GLYPH = { image: '◆', audio: '♪', model: '▰', shader: '❖', script: 'JS', font: 'Aa', other: '◫' };
  window.__forgeCategoryGlyph = CATEGORY_GLYPH;
  state.assets = [];
  state.assetCategory = '';

  function fileIcon(category) { return { cls: category === 'image' ? 'sprite' : category === 'script' ? 'script' : '', glyph: CATEGORY_GLYPH[category] || '◫' }; }

  async function loadAssets(slug) {
    if (!slug) return;
    try {
      const { assets } = await api(`/api/games/${encodeURIComponent(slug)}/assets`);
      state.assets = assets;
      renderAssetGrid();
    } catch (error) {
      log('error', `Could not load assets: ${error.message}`);
    }
  }
  window.__forgeLoadAssets = () => loadAssets(state.slug);
  window.__forgeAssets = () => state.assets;

  function renderAssetGrid() {
    const grid = $('#assetGrid');
    if (!grid) return;
    const q = ($('#assetSearch')?.value || '').toLowerCase();
    const list = state.assets.filter(a => (!state.assetCategory || a.category === state.assetCategory) && a.name.toLowerCase().includes(q));
    if (list.length === 0) {
      grid.innerHTML = `<p class="muted" style="padding:6px;grid-column:1/-1">No assets yet. Use ⇧ Upload, or the Pixel Art / Model / Shader / Blocks tabs, to add some.</p>`;
      return;
    }
    grid.innerHTML = list.map(a => {
      const { cls, glyph } = fileIcon(a.category);
      const preview = a.category === 'image' ? `<img src="${a.url}" alt="" style="max-width:100%;max-height:100%;object-fit:contain">` : glyph;
      return `<div class="asset-card ${cls}" data-id="${a.id}" title="${escapeHtml(a.name)} · ${(a.size / 1024).toFixed(1)}KB">
        <button class="asset-delete" data-delete="${a.id}" title="Delete asset">×</button>
        <div class="asset-preview">${preview}</div><span>${escapeHtml(a.name)}</span></div>`;
    }).join('');
  }

  $('#assetSearch')?.addEventListener('input', renderAssetGrid);

  $$('.asset-tree button[data-category]').forEach(btn => btn.addEventListener('click', () => {
    $$('.asset-tree button[data-category]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.assetCategory = btn.dataset.category;
    $('#assetBreadcrumb').textContent = btn.dataset.category ? btn.textContent.trim() : 'Project';
    renderAssetGrid();
  }));

  $('#assetGrid')?.addEventListener('click', async e => {
    const del = e.target.closest('[data-delete]');
    if (del) {
      const id = del.dataset.delete;
      const asset = state.assets.find(a => a.id === id);
      if (!window.confirm(`Delete asset "${asset?.name || id}"?`)) return;
      try {
        await api(`/api/games/${encodeURIComponent(state.slug)}/assets/${encodeURIComponent(id)}`, { method: 'DELETE' });
        state.assets = state.assets.filter(a => a.id !== id);
        renderAssetGrid();
        toast('Asset deleted');
      } catch (error) { toast(error.message); }
      return;
    }
    const card = e.target.closest('.asset-card');
    if (card) toast(`${state.assets.find(a => a.id === card.dataset.id)?.name || 'Asset'} selected`);
  });

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function categoryForMime(mime = '') {
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('font/') || mime.includes('font')) return 'font';
    if (mime === 'text/javascript' || mime.endsWith('/json')) return 'script';
    return 'other';
  }

  async function uploadFiles(files) {
    if (!state.slug || !files.length) return;
    for (const file of files) {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        await api(`/api/games/${encodeURIComponent(state.slug)}/assets`, {
          method: 'POST',
          body: JSON.stringify({ name: file.name, category: categoryForMime(file.type), mime: file.type, dataUrl })
        });
      } catch (error) { toast(`${file.name}: ${error.message}`); log('error', `Upload failed for ${file.name}: ${error.message}`); }
    }
    await loadAssets(state.slug);
    toast(`${files.length} asset(s) imported`);
  }
  window.__forgeUploadFiles = uploadFiles;

  const assetUploadInput = document.createElement('input');
  assetUploadInput.type = 'file'; assetUploadInput.multiple = true; assetUploadInput.style.display = 'none';
  document.body.appendChild(assetUploadInput);
  assetUploadInput.onchange = () => uploadFiles([...assetUploadInput.files]);
  $('#assetUploadBtn')?.addEventListener('click', () => assetUploadInput.click());

  const assetGridEl = $('#assetGrid');
  ['dragover', 'dragenter'].forEach(evt => assetGridEl?.addEventListener(evt, e => { e.preventDefault(); assetGridEl.classList.add('drag-over'); }));
  ['dragleave', 'drop'].forEach(evt => assetGridEl?.addEventListener(evt, e => { e.preventDefault(); assetGridEl.classList.remove('drag-over'); }));
  assetGridEl?.addEventListener('drop', e => uploadFiles([...(e.dataTransfer?.files || [])]));

  // ---------------------------------------------------------------
  // Viewport chrome. Actual grid/camera rendering now lives entirely in the
  // unified viewport engine further down this file — both modes share one
  // canvas (#threeCanvas) and one camera, so there's exactly one grid
  // implementation instead of two drifting out of sync with each other.
  // ---------------------------------------------------------------

  $('#sceneSearch').addEventListener('input', e => renderTree(e.target.value));
  $$('#transformTools .tool').forEach(b => b.onclick = () => { $$('#transformTools .tool').forEach(x => x.classList.remove('active')); b.classList.add('active'); state.tool = b.dataset.tool; toast(`${b.title.split(' ')[0]} tool active`); });
  $$('#viewportModes button').forEach(b => b.onclick = () => { $$('#viewportModes button').forEach(x => x.classList.remove('active')); b.classList.add('active'); state.mode = b.dataset.mode; viewport.dataset.mode = state.mode; viewport.style.cursor = ''; $('#cameraMode').textContent = state.mode === '3d' ? 'Perspective' : 'Orthographic'; renderViewportObjects(); toast(`${b.textContent} workspace active`); window.forgeRedraw3D?.(); });
  $('#gridToggle').onclick = () => { state.grid = !state.grid; window.forgeRedraw3D?.(); toast(`Grid ${state.grid ? 'enabled' : 'disabled'}`); };
  $('#snapToggle').onclick = e => { state.snap = !state.snap; e.currentTarget.classList.toggle('active', state.snap); toast(`Snap ${state.snap ? 'enabled' : 'disabled'}`); };
  $('#playButton').onclick = e => { state.playing = !state.playing; e.currentTarget.classList.toggle('running', state.playing); e.currentTarget.textContent = state.playing ? '■' : '▶'; toast(state.playing ? 'Running game preview' : 'Game preview stopped'); };
  $('#pauseButton').onclick = () => toast('Game preview paused');
  $('#stopButton').onclick = () => { state.playing = false; $('#playButton').classList.remove('running'); $('#playButton').textContent = '▶'; toast('Game preview stopped'); };
  $$('.component-head').forEach(b => b.onclick = () => { const c = b.parentElement; c.classList.toggle('open'); const body = c.querySelector('.component-body'); if (body) body.style.display = c.classList.contains('open') ? 'block' : 'none'; b.querySelector('span').textContent = c.classList.contains('open') ? '⌄' : '›'; });
  const TOOL_MODAL_META = {
    pixel: { icon: '🖌', title: 'Pixel Art Editor', subtitle: 'Draw sprites & tiles, then save them straight to your asset library' },
    model: { icon: '◈', title: '3D Model Editor', subtitle: 'Block out simple meshes and export them as model assets' },
    blocks: { icon: '⌘', title: 'Block Script Editor', subtitle: 'Flowlab-style visual scripting for object behavior' },
    shader: { icon: '✺', title: 'Shader Editor', subtitle: 'Write & live-preview GLSL fragment shaders' },
    animation: { icon: '▶', title: 'Animation Editor', subtitle: 'Keyframe object transforms on a scrubbable timeline' },
    audio: { icon: '♫', title: 'Audio Editor', subtitle: 'Mix tracks, shape waveforms and design sound' }
  };
  const toolModalOverlay = $('#toolModalOverlay');
  function openToolModal(name) {
    const meta = TOOL_MODAL_META[name];
    if (!meta || !toolModalOverlay) return;
    $('#toolModalIcon').textContent = meta.icon;
    $('#toolModalTitle').textContent = meta.title;
    $('#toolModalSubtitle').textContent = meta.subtitle;
    $$('#toolModalBody .bottom-content').forEach(x => x.classList.toggle('active', x.dataset.content === name));
    toolModalOverlay.classList.add('show');
    document.body.classList.add('tool-modal-open');
    window.__forgeActiveToolModal = name;
    window.dispatchEvent(new CustomEvent('forge-tool-modal-open', { detail: { name } }));
    setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
  }
  function closeToolModal() {
    if (!toolModalOverlay) return;
    toolModalOverlay.classList.remove('show');
    document.body.classList.remove('tool-modal-open');
    window.__forgeActiveToolModal = null;
    window.dispatchEvent(new CustomEvent('forge-tool-modal-close'));
  }
  window.__forgeOpenToolModal = openToolModal;
  window.__forgeCloseToolModal = closeToolModal;
  $('#toolModalClose')?.addEventListener('click', closeToolModal);
  toolModalOverlay?.addEventListener('click', e => { if (e.target === toolModalOverlay) closeToolModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && toolModalOverlay?.classList.contains('show')) closeToolModal(); });

  $$('#bottomTabs button[data-bottom]').forEach(b => b.onclick = () => {
    if (b.dataset.toolLaunch) { openToolModal(b.dataset.bottom); return; }
    $$('#bottomTabs button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $$('#bottomPanel > .bottom-content').forEach(x => x.classList.toggle('active', x.dataset.content === b.dataset.bottom));
  });

  const menus = {
    File: [['New Project', 'Ctrl+N'], ['Open Project…', 'Ctrl+O'], ['Save Scene', 'Ctrl+S'], ['---', ''], ['Build Settings…', 'Ctrl+Shift+B'], ['Exit', 'Alt+F4']],
    Edit: [['Undo', 'Ctrl+Z'], ['Redo', 'Ctrl+Y'], ['---', ''], ['Duplicate', 'Ctrl+D'], ['Delete', 'Del'], ['Editor Settings…', '']],
    Assets: [['Import Asset…', ''], ['Create', '›'], ['Reimport All', '']],
    Scene: [['New Scene', ''], ['Save Scene', 'Ctrl+S'], ['Scene Settings…', '']],
    Project: [['Project Settings…', ''], ['Input Map…', ''], ['Package Manager…', '']],
    Build: [['Build Project', 'Ctrl+B'], ['Build & Run', 'Ctrl+Shift+B'], ['Export Templates…', '']],
    Window: [['Scene', ''], ['Inspector', ''], ['Assets', ''], ['Console', ''], ['Profiler', '']],
    Help: [['Documentation', 'F1'], ['Keyboard Shortcuts', ''], ['About ForgeEngine', '']]
  };
  const pop = $('#menuPopover');
  $$('[data-menu]').forEach(btn => btn.onclick = e => {
    const items = menus[btn.dataset.menu];
    pop.innerHTML = items.map(i => i[0] === '---' ? '<hr>' : `<button>${i[0]}<kbd>${i[1]}</kbd></button>`).join('');
    pop.style.left = e.currentTarget.getBoundingClientRect().left + 'px';
    pop.style.top = e.currentTarget.getBoundingClientRect().bottom + 'px';
    pop.classList.add('show');
    $$('[data-menu]').forEach(x => x.classList.toggle('active', x === btn));
  });
  document.addEventListener('click', e => { if (!e.target.closest('[data-menu]') && !e.target.closest('#menuPopover')) { pop.classList.remove('show'); $$('[data-menu]').forEach(x => x.classList.remove('active')); } });

  function splitter(el, type) {
    let start, a, b;
    el.addEventListener('mousedown', e => {
      start = type === 'bottom' ? e.clientY : e.clientX;
      a = parseFloat(getComputedStyle(root).getPropertyValue(type === 'left' ? '--left' : type === 'right' ? '--right' : '--bottom'));
      el.classList.add('dragging');
      // The viewport engine watches #viewport with its own ResizeObserver,
      // so resizing the panels (which resizes #viewport via the CSS vars
      // above) is picked up automatically — no manual resize call needed.
      const move = m => { const delta = (type === 'bottom' ? start - m.clientY : type === 'right' ? start - m.clientX : m.clientX - start); b = Math.max(type === 'bottom' ? 120 : 170, Math.min(type === 'bottom' ? 420 : 460, a + delta)); root.style.setProperty(type === 'left' ? '--left' : type === 'right' ? '--right' : '--bottom', b + 'px'); };
      const up = () => { el.classList.remove('dragging'); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    });
  }
  $$('[data-split]').forEach(el => splitter(el, el.dataset.split));
  $('#layoutReset').onclick = () => { root.style.setProperty('--left', '235px'); root.style.setProperty('--right', '300px'); root.style.setProperty('--bottom', '224px'); toast('Editor layout reset'); };
  $('#closeEditor').onclick = () => { if (state.dirty && !confirm('You have unsaved changes. Leave anyway?')) return; location.assign('/'); };

  loadGame();
})();
/* Forge Editor UI behavior patch: makes remaining chrome controls actionable. */
(() => {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const state = window.__forgeState;
  if (!state) return;
  const viewport = $('#viewport');
  const toast = message => { const e=$('#toast'); e.textContent=message; e.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>e.classList.remove('show'),1400); };
  const click = (sel, fn) => { const e=$(sel); if(e) e.addEventListener('click',fn); };
  const toggle = (button,on) => button?.classList.toggle('active',on);
  state.ui ||= {sun:true,ambient:true,fog:false,gizmos:true,inspectorLocked:false,filter:null,assetView:'grid'};

  // Camera projection button cycles through meaningful camera presets.
  click('#cameraMode', e => {
    const names = state.mode==='2d' ? ['Orthographic'] : ['Perspective','Orthographic','Isometric'];
    const i=(names.indexOf(e.currentTarget.textContent)+1)%names.length;
    e.currentTarget.textContent=names[i];
    state.cameraProjection=names[i].toLowerCase();
    window.dispatchEvent(new Event('resize'));
  });

  // Lighting/fog buttons set renderer state and visibly tint the viewport.
  const applyEnvironment=()=>{
    viewport.classList.toggle('sun-off',!state.ui.sun);
    viewport.classList.toggle('ambient-off',!state.ui.ambient);
    viewport.classList.toggle('fog-on',state.ui.fog);
  };
  [['#lightToggle','sun'],['#ambientToggle','ambient'],['#fogToggle','fog']].forEach(([sel,key])=>click(sel,e=>{state.ui[key]=!state.ui[key];toggle(e.currentTarget,state.ui[key]);applyEnvironment();toast(`${key} ${state.ui[key]?'enabled':'disabled'}`)}));
  applyEnvironment();

  click('#gizmoVisibleToggle',e=>{state.ui.gizmos=!state.ui.gizmos;toggle(e.currentTarget,state.ui.gizmos);viewport.classList.toggle('hide-gizmos',!state.ui.gizmos)});
  click('#lockInspector',e=>{state.ui.inspectorLocked=!state.ui.inspectorLocked;toggle(e.currentTarget,state.ui.inspectorLocked);e.currentTarget.textContent=state.ui.inspectorLocked?'◆':'◇';toast(`Inspector ${state.ui.inspectorLocked?'locked':'unlocked'}`)});
  click('#filterButton',e=>{
    const types=['all','mesh','sprite','camera','light','collider','ui','audio'];
    const cur=state.ui.filter||'all', next=types[(types.indexOf(cur)+1)%types.length]; state.ui.filter=next;
    $$('.tree-row').forEach(row=>row.style.display=next==='all'||row.dataset.type===next?'':'none');
    e.currentTarget.title=`Filter: ${next}`; toast(`Hierarchy filter: ${next}`);
  });

  // Real hierarchy tabs: Scene shows objects; Layers groups rows by object layer.
  $$('#hierarchyTabs [data-tab]').forEach(b=>b.addEventListener('click',()=>{
    $$('#hierarchyTabs [data-tab]').forEach(x=>x.classList.toggle('active',x===b));
    if(b.dataset.tab==='layers'){
      const groups={}; state.objects.forEach(o=>(groups[o.layer||'Default']??=[]).push(o));
      $('#sceneTree').innerHTML=Object.entries(groups).map(([layer,items])=>`<div class="layer-heading">${layer} <small>${items.length}</small></div>${items.map(o=>`<div class="tree-row" data-id="${o.id}" data-type="${o.type}"><span class="node-icon">${o.icon||'◇'}</span><span>${o.name}</span></div>`).join('')}`).join('')||'<div class="placeholder-view" style="display:flex;height:100px">No layers</div>';
      $$('#sceneTree .tree-row').forEach(r=>r.onclick=()=>document.querySelector(`#hierarchyTabs [data-tab="scene"]`).click());
    } else $('#sceneSearch').dispatchEvent(new Event('input'));
  }));

  // Inspector menu performs actual reset/copy operations.
  click('#inspectorMenu',e=>{
    const p=$('#menuPopover'), r=e.currentTarget.getBoundingClientRect();
    p.innerHTML='<button data-i="reset">Reset Transform</button><button data-i="copy">Copy Object JSON</button><button data-i="focus">Focus Selection</button>';
    p.style.left=(r.left-170)+'px';p.style.top=r.bottom+'px';p.classList.add('show');
    p.querySelectorAll('button').forEach(b=>b.onclick=async()=>{const o=state.objects.find(x=>x.id===state.selectedId);p.classList.remove('show');if(!o)return;if(b.dataset.i==='reset'){o.position={x:0,y:0,z:0};o.rotation={x:0,y:0,z:0};o.scale={x:1,y:1,z:1};state.dirty=true;$('#dirtyDot').style.visibility='visible';document.querySelector(`[data-id="${o.id}"]`)?.click()}else if(b.dataset.i==='copy'){await navigator.clipboard?.writeText(JSON.stringify(o,null,2));toast('Object JSON copied')}else{window.forgeResetCamera?.()}});
  });

  // Assets controls and asset activation.
  click('#assetGridView',e=>{$('#assetGrid').classList.remove('list-view');toggle(e.currentTarget,true);toggle($('#assetListView'),false);state.ui.assetView='grid'});
  click('#assetListView',e=>{$('#assetGrid').classList.add('list-view');toggle(e.currentTarget,true);toggle($('#assetGridView'),false);state.ui.assetView='list'});
  // Double-click opens a real preview (image render / metadata) with working
  // Download and "Attach to Selected Object" actions, instead of a toast
  // that just claimed the asset was "opened".
  $('#assetGrid')?.addEventListener('dblclick',e=>{
    const card=e.target.closest('.asset-card');
    if(!card) return;
    const asset=state.assets.find(a=>a.id===card.dataset.id);
    if(!asset || !window.__forgeModal) return;
    const sel=state.objects.find(o=>o.id===state.selectedId);
    const glyphs=window.__forgeCategoryGlyph||{};
    const body=`
      <div class="asset-preview-large">${asset.category==='image' ? `<img src="${asset.url}" alt="">` : `<div class="asset-preview-glyph">${glyphs[asset.category]||'◫'}</div>`}</div>
      <dl class="asset-meta"><dt>Name</dt><dd>${asset.name}</dd><dt>Category</dt><dd>${asset.category}</dd><dt>Size</dt><dd>${(asset.size/1024).toFixed(1)} KB</dd></dl>
      <div class="pkg-actions">
        <button class="primary" data-attach-here>${sel ? `Attach to "${sel.name}"` : 'Select an object first'}</button>
        <a data-download-asset href="${asset.url}" download="${asset.name}"><button>Download</button></a>
      </div>`;
    window.__forgeModal.open(asset.name, body, { onMount: root => {
      const attachBtn=root.querySelector('[data-attach-here]');
      if (!sel) attachBtn.disabled = true;
      attachBtn?.addEventListener('click', () => {
        if (!sel) return;
        sel.attachments ||= [];
        if (sel.attachments.some(a=>a.assetId===asset.id)) { toast(`${asset.name} is already attached`); return; }
        sel.attachments.push({ id:`att-${Date.now().toString(36)}`, assetId: asset.id, name: asset.name, category: asset.category });
        state.dirty = true; $('#dirtyDot').style.visibility = 'visible';
        window.__forgeRenderAttachments?.(sel);
        window.__forgeModal.close();
        toast(`${asset.name} attached to ${sel.name}`);
      });
    }});
  });

  // Bottom panel controls now collapse, close, and restore panel state.
  click('#bottomCollapse', e => { const collapsed=getComputedStyle(document.documentElement).getPropertyValue('--bottom').trim()==='31px'; document.documentElement.style.setProperty('--bottom',collapsed?'224px':'31px'); e.currentTarget.textContent=collapsed?'⌃':'⌄'; setTimeout(()=>window.dispatchEvent(new Event('resize')),0); });
  click('#bottomClose', () => { document.documentElement.style.setProperty('--bottom','0px'); setTimeout(()=>window.dispatchEvent(new Event('resize')),0); });
  // "+" adds a real second tab wired to the same split-preview state that
  // the ▦ button uses, and can be closed again — no fake "was added" toast.
  click('#addViewportTab',()=>{
    if ($('#secondViewportTab')) { toast('A second viewport is already open'); return; }
    const tabsBar = $('#addViewportTab').parentElement;
    const tab = document.createElement('button');
    tab.id = 'secondViewportTab';
    tab.innerHTML = '<span class="tab-dot"></span>Scene (Split) <span class="close">×</span>';
    tabsBar.insertBefore(tab, $('#addViewportTab'));
    viewport.classList.add('split-preview');
    toast('Split viewport added');
    tab.addEventListener('click', e => {
      if (e.target.closest('.close')) { tab.remove(); viewport.classList.remove('split-preview'); toast('Split viewport closed'); return; }
      $$('.viewport-tabs > button.active').forEach(x => x.classList.remove('active'));
      tab.classList.add('active');
    });
  });
  click('#splitViewport',()=>{viewport.classList.toggle('split-preview');toast(viewport.classList.contains('split-preview')?'Comparison overlay enabled':'Comparison overlay disabled')});

  // Window buttons work in browsers where the corresponding capability exists.
  click('#winMinimize',()=>{document.body.classList.toggle('chrome-hidden');toast(document.body.classList.contains('chrome-hidden')?'Editor chrome minimized':'Editor chrome restored')});
  click('#winMaximize',()=>{if(!document.fullscreenElement)document.documentElement.requestFullscreen?.();else document.exitFullscreen?.()});
  click('#notifications',()=>toast(state.dirty?'Unsaved scene changes':'No new notifications'));
  click('#userAvatar',()=>toast('Account menu is managed by the host application'));

  // Profiler stays as a lightweight inline mini-tool in the bottom panel.
  const profilerEl = $('.bottom-content[data-content="profiler"]');
  if (profilerEl) profilerEl.innerHTML = '<div class="mini-tool"><button data-capture>Capture Frame</button><span>Waiting for capture</span></div>';
  $('[data-capture]')?.addEventListener('click',e=>{e.currentTarget.nextElementSibling.textContent=`Captured ${state.objects.length} objects at ${$('#fpsLabel').textContent}`;toast('Profiler frame captured')});

  // Keyframe data model is shared with the fullscreen Animation editor (assets/js/animation-editor.js).
  state.keyframes ||= {}; // objectId -> [{frame, position, rotation, scale}]

  // Keyboard shortcuts for modes and grid/debug.
  document.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;if(e.key==='1')$('#viewportModes [data-mode="2d"]')?.click();if(e.key==='2'||e.key==='3')$('#viewportModes [data-mode="3d"]')?.click();if(e.key.toLowerCase()==='g')$('#gridToggle')?.click();if(e.key.toLowerCase()==='f'&&state.selectedId){const o=state.objects.find(x=>x.id===state.selectedId);if(o)window.forgeFocusCamera?.(o)}});
})();

/* ---------------------------------------------------------------
   Modal system — a single reusable overlay used by the Package
   Manager, Templates browser, and the Attach Script/Asset picker.
--------------------------------------------------------------- */
(() => {
  const $ = s => document.querySelector(s);
  const overlay = $('#modalOverlay');
  const box = $('#modalBox');
  if (!overlay || !box) return;

  function close() {
    overlay.classList.remove('show');
    box.innerHTML = '';
  }

  function open(title, bodyHtml, { onMount } = {}) {
    box.innerHTML = `<div class="modal-head"><strong>${title}</strong><button data-modal-close aria-label="Close">×</button></div><div class="modal-body">${bodyHtml}</div>`;
    overlay.classList.add('show');
    box.querySelector('[data-modal-close]').addEventListener('click', close);
    onMount?.(box);
  }

  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.classList.contains('show')) close(); });

  window.__forgeModal = { open, close };
})();

/* ---------------------------------------------------------------
   Package Manager, Templates, and the Attach Script/Asset picker.
   Packages/templates are bundled with the editor (no server round
   trip needed); "Install" and "Use Template" have real, visible
   effects, and "Download" saves an installable/importable file.
--------------------------------------------------------------- */
(() => {
  const $ = s => document.querySelector(s);
  const state = window.__forgeState;
  const modal = window.__forgeModal;
  if (!state || !modal) return;
  const toast = msg => window.__forgeToast?.(msg);
  const log = (level, msg) => window.__forgeLog?.(level, msg);
  const escapeHtml = window.__forgeEscape || (s => s);

  const PACKAGES_KEY = 'forge:installedPackages';
  const installed = new Set(JSON.parse(localStorage.getItem(PACKAGES_KEY) || '[]'));
  const persistInstalled = () => localStorage.setItem(PACKAGES_KEY, JSON.stringify([...installed]));

  const PACKAGES = [
    { id: 'physics2d', icon: '⬡', name: '2D Physics Toolkit', desc: 'Rigidbody, colliders and simple gravity for platformers and top-down games.' },
    { id: 'input-map', icon: '🎮', name: 'Input Manager Pro', desc: 'Remappable actions for keyboard, mouse, and gamepad input.' },
    { id: 'save-system', icon: '💾', name: 'Save System', desc: 'Slot-based save/load with JSON serialization of scene state.' },
    { id: 'postfx', icon: '✦', name: 'Post-Processing Pack', desc: 'Bloom, vignette and color grading passes for the 3D viewport.' },
    { id: 'audio-mixer', icon: '♪', name: 'Audio Mixer Bus', desc: 'Grouped volume buses (Master/Music/SFX) with fade helpers.' },
    { id: 'ui-toolkit', icon: '▣', name: 'UI Toolkit', desc: 'Anchored panels, buttons and health bars for UI Canvas objects.' }
  ];

  const TEMPLATES = [
    { id: 'blank', icon: '＋', name: 'Blank Canvas', desc: 'Just a camera and a light — start from nothing.', objects: [
      { type: 'camera', name: 'Main Camera' }, { type: 'light', name: 'Sun' }
    ] },
    { id: 'platformer', icon: '▰', name: '2D Platformer', desc: 'Camera, player sprite, and a starter platform.', objects: [
      { type: 'camera', name: 'Main Camera' }, { type: 'light', name: 'Sun' },
      { type: 'sprite', name: 'Player' }, { type: 'mesh', name: 'Ground' }, { type: 'collider', name: 'Ground Collider' }
    ] },
    { id: 'topdown', icon: '◆', name: 'Top Down', desc: 'An exploration-ready scene with a player and floor.', objects: [
      { type: 'camera', name: 'Main Camera' }, { type: 'light', name: 'Ambient' },
      { type: 'sprite', name: 'Player' }, { type: 'mesh', name: 'Floor' }
    ] },
    { id: '3dplayground', icon: '▤', name: '3D Playground', desc: 'A perspective camera, sun, and a few meshes to orbit around.', objects: [
      { type: 'camera', name: 'Main Camera' }, { type: 'light', name: 'Sun' },
      { type: 'mesh', name: 'Cube' }, { type: 'mesh', name: 'Ground Plane' }
    ] }
  ];

  const download = (name, text, type = 'application/json') => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  function packageCard(pkg) {
    const isIn = installed.has(pkg.id);
    return `<div class="pkg-card" data-pkg="${pkg.id}">
      <div class="pkg-icon">${pkg.icon}</div>
      <div class="pkg-body">
        <strong>${escapeHtml(pkg.name)}</strong>
        <p>${escapeHtml(pkg.desc)}</p>
        <div class="pkg-actions">
          <button class="${isIn ? '' : 'primary'}" data-install="${pkg.id}">${isIn ? 'Installed ✓' : 'Install'}</button>
          <button data-download-pkg="${pkg.id}">Download</button>
        </div>
      </div>
    </div>`;
  }

  function openPackageManager() {
    modal.open('Package Manager', `<p class="modal-desc">Install packages into this project, or download them to add to another ForgeEngine project.</p>${PACKAGES.map(packageCard).join('')}`, {
      onMount: root => {
        root.querySelectorAll('[data-install]').forEach(btn => btn.addEventListener('click', () => {
          const id = btn.dataset.install;
          const pkg = PACKAGES.find(p => p.id === id);
          if (installed.has(id)) return;
          installed.add(id);
          persistInstalled();
          btn.textContent = 'Installed ✓';
          btn.classList.remove('primary');
          toast(`${pkg.name} installed`);
          log('info', `Installed package "${pkg.name}"`);
        }));
        root.querySelectorAll('[data-download-pkg]').forEach(btn => btn.addEventListener('click', () => {
          const pkg = PACKAGES.find(p => p.id === btn.dataset.downloadPkg);
          download(`${pkg.id}.forge-package.json`, JSON.stringify({ forgePackage: pkg.id, name: pkg.name, description: pkg.desc, version: '1.0.0' }, null, 2));
          toast(`${pkg.name} downloaded`);
        }));
      }
    });
  }

  function templateCard(tpl) {
    return `<div class="tpl-card" data-tpl="${tpl.id}">
      <div class="tpl-icon">${tpl.icon}</div>
      <div class="tpl-body">
        <strong>${escapeHtml(tpl.name)}</strong>
        <p>${escapeHtml(tpl.desc)}</p>
        <div class="tpl-actions">
          <button class="primary" data-use-tpl="${tpl.id}">Use Template</button>
          <button data-download-tpl="${tpl.id}">Download</button>
        </div>
      </div>
    </div>`;
  }

  function templateToObjects(tpl) {
    const ICONS = { camera: '◈', light: '☀', sprite: '◆', mesh: '▰', group: '▾', collider: '⬡', ui: '▣', audio: '♪' };
    return tpl.objects.map((o, i) => ({
      id: `object-${Date.now().toString(36)}-${i}`,
      name: o.name, type: o.type, icon: ICONS[o.type] || '◇',
      parent: false, indent: 0,
      position: { x: i * 24, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
      enabled: true, visible: true, tag: 'Untagged', layer: 'Default', attachments: []
    }));
  }

  function openTemplates() {
    modal.open('Templates', `<p class="modal-desc">Apply a starter template to the current scene, or download one to import elsewhere.</p>${TEMPLATES.map(templateCard).join('')}`, {
      onMount: root => {
        root.querySelectorAll('[data-use-tpl]').forEach(btn => btn.addEventListener('click', () => {
          const tpl = TEMPLATES.find(t => t.id === btn.dataset.useTpl);
          if (state.objects.length && !confirm(`Replace the ${state.objects.length} object(s) in "${state.sceneName}" with the "${tpl.name}" template?`)) return;
          state.objects = templateToObjects(tpl);
          state.selectedId = state.objects[0]?.id || null;
          state.dirty = true;
          document.getElementById('dirtyDot').style.visibility = 'visible';
          document.getElementById('sceneSearch').dispatchEvent(new Event('input'));
          window.forgeRedraw3D?.();
          modal.close();
          toast(`"${tpl.name}" template applied`);
          log('info', `Applied template "${tpl.name}"`);
        }));
        root.querySelectorAll('[data-download-tpl]').forEach(btn => btn.addEventListener('click', () => {
          const tpl = TEMPLATES.find(t => t.id === btn.dataset.downloadTpl);
          download(`${tpl.id}.forge-template.json`, JSON.stringify({ name: tpl.name, objects: templateToObjects(tpl) }, null, 2));
          toast(`${tpl.name} downloaded`);
        }));
      }
    });
  }

  // Attach Script/Asset picker: lists project assets (scripts first),
  // clicking one attaches it to the target object.
  function openAttachPicker(objectId) {
    const o = state.objects.find(x => x.id === objectId);
    if (!o) return;
    const assets = state.assets || [];
    const rows = assets.length
      ? assets.map(a => `<div class="pick-row" data-asset="${a.id}"><span class="glyph">${a.category === 'script' ? 'JS' : '◆'}</span><span class="name">${escapeHtml(a.name)}</span><span class="muted">${a.category}</span></div>`).join('')
      : `<div class="pick-empty">No assets yet — upload one in the Assets panel first.</div>`;
    modal.open(`Attach to "${o.name}"`, `<p class="modal-desc">Choose a script or asset to attach to this object.</p><div class="pick-list">${rows}</div>`, {
      onMount: root => {
        root.querySelectorAll('[data-asset]').forEach(row => row.addEventListener('click', () => {
          const asset = assets.find(a => a.id === row.dataset.asset);
          if (!asset) return;
          o.attachments ||= [];
          if (o.attachments.some(a => a.assetId === asset.id)) { toast(`${asset.name} is already attached`); return; }
          o.attachments.push({ id: `att-${Date.now().toString(36)}`, assetId: asset.id, name: asset.name, category: asset.category });
          // Image (pixel-art, texture, etc.) and model assets replace the
          // object's placeholder shape with the asset itself — the object
          // now "possesses" that visual, everywhere it's drawn.
          if ((asset.category === 'image' || asset.category === 'model') && asset.url) {
            o.spriteUrl = asset.url;
          }
          state.dirty = true;
          document.getElementById('dirtyDot').style.visibility = 'visible';
          window.__forgeRenderAttachments?.(o);
          // Re-render the tree/inspector/viewport so the swapped-in sprite
          // and the attachment badge show up immediately.
          window.__forgeSelectObject?.(o.id);
          window.forgeRedraw3D?.();
          modal.close();
          toast(`${asset.name} attached to ${o.name}`);
          log('info', `Attached "${asset.name}" to "${o.name}"`);
        }));
      }
    });
  }

  window.__forgeOpenPackageManager = openPackageManager;
  window.__forgeOpenTemplates = openTemplates;
  window.__forgeOpenAttachPicker = openAttachPicker;
})();

/* ---------------------------------------------------------------
   Context menu: right-click (desktop) or long-press (touch/mobile)
   on a hierarchy row or a viewport object. Lets you attach a
   script/asset to that specific object, plus the usual object ops.
--------------------------------------------------------------- */
(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const state = window.__forgeState;
  const menu = $('#contextMenu');
  if (!state || !menu) return;
  const toast = msg => window.__forgeToast?.(msg);
  const escapeHtml = window.__forgeEscape || (s => s);

  let targetId = null;

  function closeMenu() { menu.classList.remove('show'); targetId = null; }

  function itemsFor(o) {
    if (!o) {
      return [
        ['add', '＋', 'Add Object'],
        ['paste', '⎘', 'Paste'],
        '---',
        ['focus-reset', '◎', 'Reset View']
      ];
    }
    return [
      ['select', '↖', 'Select'],
      ['attach-script', 'JS', 'Attach Script…'],
      ['attach-asset', '◆', 'Attach Asset…'],
      '---',
      ['rename', '✎', 'Rename'],
      ['duplicate', '⧉', 'Duplicate'],
      ['focus', '◎', 'Focus'],
      '---',
      ['delete', '✕', 'Delete', 'danger']
    ];
  }

  function openMenu(x, y, objectId) {
    targetId = objectId;
    const o = state.objects.find(v => v.id === objectId) || null;
    const items = itemsFor(o);
    menu.innerHTML = (o ? `<div class="ctx-title">${escapeHtml(o.name)}</div>` : '<div class="ctx-title">Scene</div>') +
      items.map(it => it === '---' ? '<hr>' : `<button data-act="${it[0]}"${it[3] ? ` class="${it[3]}"` : ''}><span class="ctx-icon">${it[1]}</span>${it[2]}</button>`).join('');
    const vw = innerWidth, vh = innerHeight;
    const mw = 210, mh = items.length * 30 + 30;
    menu.style.left = Math.min(x, vw - mw - 8) + 'px';
    menu.style.top = Math.min(y, vh - mh - 8) + 'px';
    menu.classList.add('show');
  }

  menu.addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const o = state.objects.find(v => v.id === targetId);
    closeMenu();
    if (act === 'select' && o) document.querySelector(`.tree-row[data-id="${o.id}"]`)?.click();
    else if (act === 'attach-script' || act === 'attach-asset') { if (o) window.__forgeOpenAttachPicker?.(o.id); }
    else if (act === 'rename' && o) { const name = prompt('Rename object', o.name); if (name) { o.name = name.trim() || o.name; $('#objectName').value = o.name; document.getElementById('sceneSearch').dispatchEvent(new Event('input')); state.dirty = true; $('#dirtyDot').style.visibility = 'visible'; } }
    else if (act === 'duplicate' && o) { const n = JSON.parse(JSON.stringify(o)); n.id = `object-${Date.now().toString(36)}`; n.name += ' Copy'; n.position.x += 16; state.objects.push(n); state.selectedId = n.id; document.getElementById('sceneSearch').dispatchEvent(new Event('input')); window.forgeRedraw3D?.(); state.dirty = true; $('#dirtyDot').style.visibility = 'visible'; toast(`Duplicated "${o.name}"`); }
    else if (act === 'focus' && o) { state.selectedId = o.id; document.querySelector(`.tree-row[data-id="${o.id}"]`)?.click(); window.forgeFocusCamera?.(o); }
    else if (act === 'delete' && o) $('#deleteObject')?.click();
    else if (act === 'add') $('#addObject')?.click();
    else if (act === 'focus-reset') window.forgeResetCamera?.();
    else if (act === 'paste') toast('Clipboard is empty');
  });

  document.addEventListener('click', e => { if (!e.target.closest('#contextMenu')) closeMenu(); });
  document.addEventListener('contextmenu', e => { if (!e.target.closest('#contextMenu')) closeMenu(); });

  // Desktop right-click.
  function wireContextTarget(el, getObjectId) {
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (window.__forgeSuppressContextMenu) { window.__forgeSuppressContextMenu = false; return; }
      openMenu(e.clientX, e.clientY, getObjectId(e));
    });
    // Mobile long-press (works alongside touch drag/orbit elsewhere:
    // this only fires if the finger doesn't move much before the delay).
    let timer = null, sx = 0, sy = 0, moved = false;
    el.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      moved = false;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      timer = setTimeout(() => {
        if (moved) return;
        openMenu(sx, sy, getObjectId({ clientX: sx, clientY: sy, target: e.target }));
        if (navigator.vibrate) navigator.vibrate(15);
      }, 500);
    }, { passive: true });
    el.addEventListener('touchmove', e => {
      if (!timer) return;
      const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
      if (Math.hypot(dx, dy) > 10) { moved = true; clearTimeout(timer); timer = null; }
    }, { passive: true });
    ['touchend', 'touchcancel'].forEach(evt => el.addEventListener(evt, () => { clearTimeout(timer); timer = null; }));
  }

  // Hierarchy rows are re-rendered often, so delegate from the tree container.
  wireContextTarget($('#sceneTree'), e => e.target.closest('.tree-row')?.dataset.id || null);
  // Viewport (both 2D and 3D): hit-tested by the canvas renderer below,
  // which already knows how to hit-test either mode (see forgeHitTest3D).
  // The old separate #viewportObjects DOM hit-target has been removed along
  // with the duplicate shapes it used to draw.
  wireContextTarget($('#threeCanvas'), e => window.forgeHitTest3D?.(e.clientX, e.clientY)?.id || null);
})();

/* ---------------------------------------------------------------
   Unified 3D viewport controller — a gridmap editor (2.5D mode has
   been removed; there's just the flat 2D editor and this one now).
   Single camera, single grid, single render loop, and one
   predictable control scheme (previously LMB-drag orbited the
   camera by default, RMB did an *identical* orbit under a
   different name, and holding RMB also enabled a WASD fly-cam —
   three overlapping ways to move the camera that fought each other
   and made the viewport feel laggy and unpredictable). Now there
   is exactly one way to do each thing, and the left mouse button is
   reserved for objects only — camera movement is arrow keys:

   Controls (also documented in the Debug panel):
     WASD keys              → move around (pan the camera)
     LMB drag an object      → move it, snapped to the grid
                                (the object stays glued to the cursor
                                on the ground plane, so it tracks
                                correctly no matter how the view is
                                rotated — the old version dragged
                                objects by raw screen pixels, which
                                drifted as soon as the camera orbited)
     LMB click empty space    → deselect
     RMB hold + drag          → orbit the view
     MMB drag                 → pan
     Scroll                   → zoom
     Touch: 1 finger drag on empty space → orbit
            1 finger drag on an object   → move it
            2 finger drag                → pan + pinch to zoom

   The hovered-cell highlight now lives only in the flat 2D editor —
   it isn't drawn here.
--------------------------------------------------------------- */
(() => {
  // ---------------------------------------------------------------
  // This used to be a full hand-rolled Canvas2D 3D/2D renderer that
  // called canvas.getContext('2d') on #threeCanvas — which permanently
  // locks that canvas out of ever getting a WebGL context. That's now
  // owned entirely by forge-viewport.js (a real Three.js WebGL scene,
  // camera, gizmos, render loop, resize, and hit-testing). All that's
  // left here is the handful of small UI bindings forge-viewport.js
  // doesn't already cover: the shading-mode cycle button, the pause
  // button, and the command palette popover.
  // ---------------------------------------------------------------
  const $ = s => document.querySelector(s);
  const state = window.__forgeState;
  const viewport = $('#viewport');
  const canvas = $('#threeCanvas');
  if (!state || !viewport || !canvas) return;

  // Defensive default — forge-viewport.js reads/writes state.view2d.x/y/zoom
  // as soon as the user pans or zooms the flat editor.
  state.view2d ||= { x: 0, y: 0, zoom: 1 };

  function refreshEditor() { document.querySelector(`[data-id="${state.selectedId}"]`)?.click(); }

  $('#shadingMode').dataset.mode = 'shaded';
  $('#shadingMode').onclick = e => {
    const modes = ['shaded', 'solid', 'wireframe'];
    const next = modes[(modes.indexOf(e.currentTarget.dataset.mode) + 1) % modes.length];
    e.currentTarget.dataset.mode = next;
    e.currentTarget.textContent = next[0].toUpperCase() + next.slice(1);
  };

  $('#pauseButton').onclick = () => { if (!state.playing) return; state.paused = !state.paused; $('#pauseButton').classList.toggle('active', state.paused); };

  $('#commandPalette').onclick = () => {
    const p = $('#menuPopover');
    p.innerHTML = '<div class="popover-title">Commands</div>' + ['Save Scene', 'Add Mesh', 'Duplicate', 'Delete', 'Toggle Debug', 'Reset Layout', 'Reset View', 'Package Manager…', 'Templates…'].map(x => `<button data-command="${x}">${x}</button>`).join('');
    p.style.left = '8px'; p.style.top = '64px'; p.classList.add('show');
    p.querySelectorAll('button').forEach(b => b.onclick = () => {
      p.classList.remove('show');
      const c = b.dataset.command;
      if (c === 'Save Scene') dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
      else if (c === 'Add Mesh') $('#addObject').click();
      else if (c === 'Delete') $('#deleteObject').click();
      else if (c === 'Toggle Debug') $('#debugToggle').click();
      else if (c === 'Reset Layout') $('#layoutReset').click();
      else if (c === 'Reset View') window.forgeResetCamera?.();
      else if (c === 'Package Manager…') window.__forgeOpenPackageManager?.();
      else if (c === 'Templates…') window.__forgeOpenTemplates?.();
      else if (c === 'Duplicate') {
        const o = state.objects.find(x => x.id === state.selectedId);
        if (o) { const n = JSON.parse(JSON.stringify(o)); n.id = 'object-' + Date.now(); n.name += ' Copy'; n.position.x += 16; state.objects.push(n); state.selectedId = n.id; refreshEditor(); }
      }
    });
  };
})();

/* ---------------------------------------------------------------
   Menu bar (File/Edit/Assets/Scene/Project/Build/Window/Help). A
   single delegated handler — the old code had two competing ones
   that both fired on every click.
--------------------------------------------------------------- */
(() => {
  const $ = s => document.querySelector(s);
  const state = window.__forgeState;
  if (!state) return;
  const toast = msg => window.__forgeToast?.(msg);
  const selectBottom = name => document.querySelector(`#bottomTabs [data-bottom="${name}"]`)?.click();
  const download = (name, text, type = 'application/json') => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.style.display = 'none'; document.body.appendChild(input);
  input.onchange = () => window.__forgeUploadFiles?.([...input.files]);

  function doMenu(label) {
    if (label === 'New Project' || label === 'New Scene') { state.objects = []; state.selectedId = null; state.dirty = true; $('#dirtyDot').style.visibility = 'visible'; $('#sceneSearch').dispatchEvent(new Event('input')); window.forgeRedraw3D?.(); toast('New empty scene created'); }
    else if (label.startsWith('Open Project')) input.click();
    else if (label === 'Save Scene') window.__forgeSaveScene?.();
    else if (label.startsWith('Build Settings')) { selectBottom('profiler'); toast('Build settings opened in Profiler'); }
    else if (label === 'Exit') $('#closeEditor')?.click();
    else if (label === 'Undo') toast('Nothing to undo');
    else if (label === 'Redo') toast('Nothing to redo');
    else if (label === 'Duplicate') { const o = state.objects.find(x => x.id === state.selectedId); if (o) { const n = JSON.parse(JSON.stringify(o)); n.id = 'object-' + Date.now(); n.name += ' Copy'; n.position.x += 16; state.objects.push(n); state.selectedId = n.id; $('#sceneSearch').dispatchEvent(new Event('input')); window.forgeRedraw3D?.(); } else toast('Select an object to duplicate'); }
    else if (label === 'Delete') $('#deleteObject')?.click();
    else if (label.startsWith('Editor Settings')) $('#debugToggle')?.click();
    else if (label.startsWith('Import Asset')) input.click();
    else if (label === 'Create') $('#addObject')?.click();
    else if (label === 'Reimport All') $('#assetSearch')?.dispatchEvent(new Event('input'));
    else if (label.startsWith('Scene Settings')) $('#inspectorMenu')?.click();
    else if (label.startsWith('Project Settings')) $('#debugToggle')?.click();
    else if (label.startsWith('Input Map')) { selectBottom('console'); toast('Input shortcuts are listed in Debug controls'); }
    else if (label.startsWith('Package Manager')) window.__forgeOpenPackageManager?.();
    else if (label === 'Build Project' || label === 'Build & Run') download('forge-scene.json', JSON.stringify({ name: state.sceneName, objects: state.objects }, null, 2));
    else if (label.startsWith('Export Templates')) window.__forgeOpenTemplates?.();
    else if (label === 'Scene') document.querySelector('#hierarchyTabs [data-tab="scene"]')?.click();
    else if (label === 'Inspector') document.querySelector('#inspectorTabs [data-tab="inspector"]')?.click();
    else if (label === 'Assets') selectBottom('assets');
    else if (label === 'Console') selectBottom('console');
    else if (label === 'Profiler') selectBottom('profiler');
    else if (label === 'Documentation') download('forge-editor-help.txt', 'Forge Editor\n1: 2D viewport, 2/3: 3D (gridmap) viewport\nQ/W/E/R: tools\nG: grid\nF: focus selection\nCtrl+S: save\n\nGridmap viewport (3D):\nWASD/Arrow keys - move the camera\nAlt+LMB drag or RMB drag - orbit around selection/pivot\nMMB drag - pan the camera\nScroll - zoom\nLMB drag on object - move it\nLMB click empty space - deselect\nTouch 1 finger empty space - orbit\nTouch 1 finger object - move it\nTouch 2 fingers - pan + pinch to zoom', 'text/plain');
    else if (label === 'Keyboard Shortcuts') { $('#debugPanel').classList.add('show'); toast('Keyboard shortcuts opened'); }
    else if (label === 'About ForgeEngine') toast('ForgeEngine native Canvas editor');
    else toast(`${label} completed`);
  }
  $('#menuPopover')?.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    // The Command Palette (above) renders its buttons into this same
    // #menuPopover element and wires its own per-button onclick. Without
    // this guard, every command-palette click ALSO bubbled into this
    // delegated menu-bar handler and ran a second time — e.g. "Duplicate"
    // would duplicate twice, "Delete" would delete the next object too.
    if (b.dataset.command) return;
    const label = (b.firstChild?.textContent || b.textContent).trim();
    $('#menuPopover').classList.remove('show');
    setTimeout(() => doMenu(label), 0);
  });
})();