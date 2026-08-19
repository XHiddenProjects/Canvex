"use strict";
/* ---------------------------------------------------------------
   Profiler panel — docked in the bottom panel next to Assets/Console.
   Reads live renderer stats exposed by forge-viewport.js
   (window.__forgeViewportStats) and Chrome's performance.memory when
   available, draws a rolling FPS graph, and keeps a small capture log
   so a person can compare a few moments side by side.
--------------------------------------------------------------- */
(() => {
  const mount = document.querySelector('.bottom-content[data-content="profiler"]');
  if (!mount) return;
  const toast = msg => window.__forgeToast?.(msg);

  const HISTORY_LEN = 120;
  const fpsHistory = new Array(HISTORY_LEN).fill(null);
  const frameTimeHistory = new Array(HISTORY_LEN).fill(null);
  const captures = [];

  mount.innerHTML = `
    <div class="profiler">
      <div class="profiler-toolbar">
        <button id="profCapture" class="primary">⏺ Capture Frame</button>
        <button id="profClear">Clear Log</button>
        <span class="muted" id="profHint" style="margin-left:auto">Live while this tab is open</span>
      </div>
      <div class="profiler-body">
        <div class="profiler-graph-card">
          <div class="profiler-graph-head"><h4>Frame Rate</h4><span id="profFpsNow" class="stat-good">— FPS</span></div>
          <canvas id="profGraph" width="640" height="120"></canvas>
          <div class="profiler-graph-legend"><span><i class="dot good"></i>&ge;50 fps</span><span><i class="dot warn"></i>25–50 fps</span><span><i class="dot bad"></i>&lt;25 fps</span></div>
        </div>
        <div class="profiler-stats" id="profStats"></div>
      </div>
      <div class="profiler-log">
        <h4>Captured Frames</h4>
        <div id="profLog" class="profiler-log-list"><span class="muted" style="padding:8px 4px;display:block">No frames captured yet — click "Capture Frame" while the viewport is active.</span></div>
      </div>
    </div>`;

  const graph = mount.querySelector('#profGraph');
  const gctx = graph.getContext('2d');
  const statsEl = mount.querySelector('#profStats');
  const fpsNowEl = mount.querySelector('#profFpsNow');
  const logEl = mount.querySelector('#profLog');
  const hintEl = mount.querySelector('#profHint');

  function fmtBytes(n) {
    if (n == null) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function currentStats() {
    const viewport = window.__forgeViewportStats?.();
    const mem = performance.memory ? {
      usedJSHeap: performance.memory.usedJSHeapSize,
      totalJSHeap: performance.memory.totalJSHeapSize
    } : null;
    return { ...viewport, mem, t: performance.now() };
  }

  function fpsClass(fps) { return fps >= 50 ? 'stat-good' : fps >= 25 ? 'stat-warn' : 'stat-bad'; }

  function renderStats(s) {
    if (!s || s.fps == null) {
      statsEl.innerHTML = '<span class="muted" style="padding:8px 4px">Open the Scene/Model viewport to see live renderer stats here.</span>';
      fpsNowEl.textContent = '— FPS';
      fpsNowEl.className = 'stat-good';
      return;
    }
    fpsNowEl.textContent = `${s.fps} FPS`;
    fpsNowEl.className = fpsClass(s.fps);
    const row = (label, value) => `<span>${label}</span><span>${value}</span>`;
    statsEl.innerHTML =
      row('Mode', s.mode === '2d' ? '2D' : '3D') +
      row('Camera', s.camera) +
      row('Objects', s.objects) +
      row('Selected', s.selected || 'none') +
      row('Draw calls', s.drawCalls) +
      row('Triangles', s.triangles) +
      row('Geometries', s.geometries) +
      row('Textures', s.textures) +
      row('Shader programs', s.programs) +
      (s.mem ? row('JS Heap', `${fmtBytes(s.mem.usedJSHeap)} / ${fmtBytes(s.mem.totalJSHeap)}`) : '');
  }

  function pushHistory(fps) {
    fpsHistory.push(fps); fpsHistory.shift();
    frameTimeHistory.push(fps ? 1000 / fps : null); frameTimeHistory.shift();
  }

  function drawGraph() {
    const w = graph.width, h = graph.height;
    gctx.clearRect(0, 0, w, h);
    gctx.fillStyle = '#0f1013';
    gctx.fillRect(0, 0, w, h);
    // gridlines at 30/60 fps
    gctx.strokeStyle = 'rgba(255,255,255,0.08)';
    gctx.lineWidth = 1;
    [30, 60].forEach(mark => {
      const y = h - (mark / 90) * h;
      gctx.beginPath(); gctx.moveTo(0, y); gctx.lineTo(w, y); gctx.stroke();
    });
    const step = w / (HISTORY_LEN - 1);
    gctx.beginPath();
    let started = false;
    fpsHistory.forEach((fps, i) => {
      if (fps == null) return;
      const x = i * step;
      const y = h - Math.min(1, fps / 90) * h;
      if (!started) { gctx.moveTo(x, y); started = true; } else { gctx.lineTo(x, y); }
    });
    gctx.strokeStyle = '#41a6f6';
    gctx.lineWidth = 1.5;
    gctx.stroke();
    // fill under the curve
    if (started) {
      gctx.lineTo(w, h); gctx.lineTo(0, h); gctx.closePath();
      gctx.fillStyle = 'rgba(65,166,246,0.12)';
      gctx.fill();
    }
  }

  function renderLog() {
    if (!captures.length) {
      logEl.innerHTML = '<span class="muted" style="padding:8px 4px;display:block">No frames captured yet — click "Capture Frame" while the viewport is active.</span>';
      return;
    }
    logEl.innerHTML = captures.map((c, i) => `
      <div class="profiler-log-row">
        <span class="${fpsClass(c.fps)}">#${captures.length - i}</span>
        <span>${c.fps} fps</span>
        <span>${c.drawCalls} draws</span>
        <span>${c.triangles} tris</span>
        <span>${c.objects} objs</span>
        <span class="muted">${c.time}</span>
      </div>`).join('');
  }

  mount.querySelector('#profCapture').addEventListener('click', () => {
    const s = currentStats();
    if (s.fps == null) { toast?.('Open the viewport first — nothing to capture yet'); return; }
    captures.unshift({ ...s, time: new Date().toLocaleTimeString([], { hour12: false }) });
    if (captures.length > 30) captures.pop();
    renderLog();
    toast?.(`Captured frame — ${s.fps} FPS, ${s.drawCalls} draw calls`);
  });
  mount.querySelector('#profClear').addEventListener('click', () => { captures.length = 0; renderLog(); });

  // Only poll while the Profiler tab is actually visible, to avoid doing
  // work in the background (same pattern as the Shader Editor's WebGL loop).
  let timer = null;
  function tick() {
    const s = currentStats();
    renderStats(s);
    pushHistory(s.fps ?? null);
    drawGraph();
    hintEl.textContent = s.fps == null ? 'Open the viewport to see live stats' : 'Live while this tab is open';
  }
  function start() { if (timer) return; tick(); timer = setInterval(tick, 250); }
  function stop() { clearInterval(timer); timer = null; }

  const observer = new MutationObserver(() => { mount.classList.contains('active') ? start() : stop(); });
  observer.observe(mount, { attributes: true, attributeFilter: ['class'] });
  if (mount.classList.contains('active')) start();

  renderStats(null);
  renderLog();
})();