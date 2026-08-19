"use strict";
(() => {
  const mount = document.getElementById('shaderPanel');
  const state = window.__forgeState;
  if (!mount || !state) return;
  const api = window.__forgeApi, toast = window.__forgeToast, log = window.__forgeLog, escapeHtml = window.__forgeEscape || (s => String(s));

  const VERTEX_SRC = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

  const DEFAULT_FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 col = 0.5 + 0.5 * cos(u_time + uv.xyx * 6.0 + vec3(0, 2, 4));
  fragColor = vec4(col, 1.0);
}`;

  const PRESETS = {
    'Plasma (default)': DEFAULT_FRAGMENT,
    'Solid Color': `#version 300 es
precision highp float;
uniform vec3 u_color;
out vec4 fragColor;
void main() { fragColor = vec4(u_color, 1.0); }`,
    'UV Gradient': `#version 300 es
precision highp float;
uniform vec2 u_resolution;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  fragColor = vec4(uv, 0.5, 1.0);
}`,
    'Radial Pulse': `#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
out vec4 fragColor;
void main() {
  vec2 uv = (gl_FragCoord.xy / u_resolution) - 0.5;
  float d = length(uv);
  float glow = smoothstep(0.5, 0.0, d) * (0.6 + 0.4 * sin(u_time * 3.0));
  fragColor = vec4(vec3(0.2, 0.6, 1.0) * glow, 1.0);
}`
  };

  // ===========================================================================
  // Visual node graph — a no-code way to build the same fragment shader.
  // Every node's `build()` returns a GLSL expression + the GLSL type it
  // produces; `generateGLSL()` walks the graph back from the Output node and
  // stitches those expressions into a full fragment shader source, which is
  // exactly what runs and what gets saved — code and visual modes always stay
  // in sync because the code textarea *is* the compiled output of the graph.
  // ===========================================================================
  const WIDTH = { float: 1, vec2: 2, vec3: 3 };
  const widest = (a, b) => (WIDTH[a] || 1) >= (WIDTH[b] || 1) ? a : b;
  function fmtNum(n) { n = Number(n); if (!isFinite(n)) n = 0; return Number.isInteger(n) ? `${n}.0` : String(n); }
  function hexToVec3Expr(hex) {
    const n = parseInt(String(hex).replace('#', ''), 16) || 0;
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    return `vec3(${r.toFixed(3)}, ${g.toFixed(3)}, ${b.toFixed(3)})`;
  }
  function promote(expr, from, to) {
    if (from === to) return expr;
    if (to === 'vec3') return from === 'float' ? `vec3(${expr})` : `vec3(${expr}, 0.0)`;
    if (to === 'vec2') return from === 'vec3' ? `(${expr}).xy` : `vec2(${expr})`;
    return `(${expr}).x`; // -> float
  }

  const NODE_DEFS = {
    uv: { label: 'UV Coordinate', icon: '⛶', cat: 'input', color: '#41a6f6',
      inputs: [], outputs: [{ key: 'out', type: 'vec2', label: 'UV' }],
      build: () => ({ expr: '(gl_FragCoord.xy / u_resolution)', type: 'vec2' }) },
    time: { label: 'Time', icon: '⏱', cat: 'input', color: '#41a6f6',
      inputs: [], outputs: [{ key: 'out', type: 'float', label: 'Time' }],
      build: () => ({ expr: 'u_time', type: 'float' }) },
    number: { label: 'Number', icon: '#', cat: 'input', color: '#41a6f6',
      inputs: [], outputs: [{ key: 'out', type: 'float', label: 'Value' }],
      params: [{ key: 'value', kind: 'number', label: 'Value', default: 1, step: 0.05 }],
      build: node => ({ expr: fmtNum(node.params.value), type: 'float' }) },
    color: { label: 'Color', icon: '◆', cat: 'input', color: '#41a6f6',
      inputs: [], outputs: [{ key: 'out', type: 'vec3', label: 'Color' }],
      params: [{ key: 'value', kind: 'color', label: 'Color', default: '#41a6f6' }],
      build: node => ({ expr: hexToVec3Expr(node.params.value), type: 'vec3' }) },
    add: { label: 'Add', icon: '+', cat: 'math', color: '#e4813a',
      inputs: [{ key: 'a', label: 'A', default: 0 }, { key: 'b', label: 'B', default: 0 }],
      outputs: [{ key: 'out', type: 'auto', label: 'A + B' }],
      build: (n, ins) => { const t = widest(ins.a.type, ins.b.type); return { expr: `(${promote(ins.a.expr, ins.a.type, t)} + ${promote(ins.b.expr, ins.b.type, t)})`, type: t }; } },
    subtract: { label: 'Subtract', icon: '−', cat: 'math', color: '#e4813a',
      inputs: [{ key: 'a', label: 'A', default: 0 }, { key: 'b', label: 'B', default: 0 }],
      outputs: [{ key: 'out', type: 'auto', label: 'A − B' }],
      build: (n, ins) => { const t = widest(ins.a.type, ins.b.type); return { expr: `(${promote(ins.a.expr, ins.a.type, t)} - ${promote(ins.b.expr, ins.b.type, t)})`, type: t }; } },
    multiply: { label: 'Multiply', icon: '×', cat: 'math', color: '#e4813a',
      inputs: [{ key: 'a', label: 'A', default: 1 }, { key: 'b', label: 'B', default: 1 }],
      outputs: [{ key: 'out', type: 'auto', label: 'A × B' }],
      build: (n, ins) => { const t = widest(ins.a.type, ins.b.type); return { expr: `(${promote(ins.a.expr, ins.a.type, t)} * ${promote(ins.b.expr, ins.b.type, t)})`, type: t }; } },
    mix: { label: 'Mix (Lerp)', icon: '⇄', cat: 'math', color: '#e4813a',
      inputs: [{ key: 'a', label: 'A', default: 0 }, { key: 'b', label: 'B', default: 1 }, { key: 't', label: 'Amount', default: 0.5 }],
      outputs: [{ key: 'out', type: 'auto', label: 'Mixed' }],
      build: (n, ins) => { const t = widest(ins.a.type, ins.b.type); return { expr: `mix(${promote(ins.a.expr, ins.a.type, t)}, ${promote(ins.b.expr, ins.b.type, t)}, ${promote(ins.t.expr, ins.t.type, 'float')})`, type: t }; } },
    sin: { label: 'Sine', icon: '∿', cat: 'math', color: '#e4813a',
      inputs: [{ key: 'a', label: 'In', default: 0 }], outputs: [{ key: 'out', type: 'auto', label: 'sin(In)' }],
      build: (n, ins) => ({ expr: `sin(${ins.a.expr})`, type: ins.a.type }) },
    length: { label: 'Length', icon: '⟺', cat: 'math', color: '#e4813a',
      inputs: [{ key: 'v', label: 'Vector', default: 0 }], outputs: [{ key: 'out', type: 'float', label: 'Length' }],
      build: (n, ins) => ({ expr: ins.v.type === 'float' ? `abs(${ins.v.expr})` : `length(${ins.v.expr})`, type: 'float' }) },
    smoothstep: { label: 'Smoothstep', icon: '⤳', cat: 'math', color: '#e4813a',
      inputs: [{ key: 'edge0', label: 'Edge 0', default: 0 }, { key: 'edge1', label: 'Edge 1', default: 1 }, { key: 'x', label: 'X', default: 0.5 }],
      outputs: [{ key: 'out', type: 'auto', label: 'Out' }],
      build: (n, ins) => { const t = widest(ins.edge0.type, ins.edge1.type); return { expr: `smoothstep(${promote(ins.edge0.expr, ins.edge0.type, t)}, ${promote(ins.edge1.expr, ins.edge1.type, t)}, ${promote(ins.x.expr, ins.x.type, t)})`, type: t }; } },
    output: { label: 'Fragment Color', icon: '⬤', cat: 'output', color: '#5ecf8f',
      inputs: [{ key: 'color', label: 'Color', default: 1 }], outputs: [],
      build: (n, ins) => ({ expr: promote(ins.color.expr, ins.color.type, 'vec3'), type: 'vec3' }) }
  };
  const NODE_CATS = [
    { key: 'input', label: 'Inputs & Values' },
    { key: 'math', label: 'Math' },
    { key: 'output', label: 'Output' }
  ];

  function freshGraph() {
    return { nodes: [{ id: 'n0', type: 'output', x: 620, y: 160, params: {} }], links: [], seq: 1 };
  }
  const graph = freshGraph();

  function nodeById(id) { return graph.nodes.find(n => n.id === id); }
  function linkInto(nodeId, key) { return graph.links.find(l => l.to === nodeId && l.toKey === key); }

  function generateGLSL() {
    const outNode = graph.nodes.find(n => n.type === 'output');
    if (!outNode) return { error: 'Add a Fragment Color (Output) node to generate a shader.' };
    const visiting = new Set();
    function build(nodeId) {
      if (visiting.has(nodeId)) throw new Error('Cycle detected in node graph');
      visiting.add(nodeId);
      const node = nodeById(nodeId);
      const def = NODE_DEFS[node.type];
      const ins = {};
      for (const input of def.inputs) {
        const link = linkInto(nodeId, input.key);
        if (link) ins[input.key] = build(link.from);
        else ins[input.key] = { expr: fmtNum(input.default), type: 'float' };
      }
      const result = def.build(node, ins);
      visiting.delete(nodeId);
      return result;
    }
    let result;
    try { result = build(outNode.id); }
    catch (e) { return { error: e.message }; }
    const body = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
out vec4 fragColor;

void main() {
  fragColor = vec4(${result.expr}, 1.0);
}`;
    return { source: body };
  }

  // ===========================================================================
  // Markup
  // ===========================================================================
  mount.innerHTML = `
    <div class="forge-tool sh-editor">
      <aside class="forge-tool__rail">
        <div class="sh-mode-toggle" id="shModeToggle">
          <button data-shmode="code" class="active" title="Write GLSL by hand">&lt;/&gt; Code</button>
          <button data-shmode="visual" title="Build a shader visually, no code required">◇ Visual</button>
        </div>
        <div id="shCodeRail">
          <h4>Presets</h4>
          <select id="shPreset" style="width:100%">${Object.keys(PRESETS).map(k => `<option>${k}</option>`).join('')}</select>
          <h4 style="margin-top:10px">Uniforms</h4>
          <div class="field-row" style="display:flex;align-items:center;gap:6px"><label style="width:56px">Color</label><input type="color" id="shColor" value="#41a6f6"></div>
          <div class="muted" style="line-height:1.5;margin-top:8px">GLSL ES 3.00 fragment shader. Available uniforms: <code>u_resolution</code>, <code>u_time</code>, <code>u_color</code>.</div>
        </div>
        <div id="shVisualRail" style="display:none;flex:1;min-height:0;flex-direction:column">
          <h4>Add Node</h4>
          <div id="shNodePalette" style="overflow:auto;flex:1;display:flex;flex-direction:column;gap:10px"></div>
          <div class="muted" style="line-height:1.5;margin-top:6px">Drag a node onto the canvas, drag from a dot on its right edge to a dot on another node's left edge to connect them, then wire the graph into <strong>Fragment Color</strong>.</div>
        </div>
      </aside>
      <div class="forge-tool__main">
        <div class="forge-tool__toolbar">
          <input id="shAssetName" placeholder="shader-name" style="width:160px">
          <button id="shSave">💾 Save as Asset</button>
          <button id="shCompile">▶ Run</button>
          <button id="shGenerate" style="display:none">⇩ Send Graph to Code</button>
          <span class="muted" id="shStatus" style="margin-left:auto">Ready</span>
        </div>
        <div style="flex:1;display:flex;min-height:0;position:relative">
          <div id="shCodeView" class="forge-code-editor" style="flex:1">
            <pre class="forge-code-editor__highlight forge-hljs hljs" id="shHighlight"><code></code></pre>
            <textarea id="shCode" class="forge-code-editor__input" spellcheck="false">${DEFAULT_FRAGMENT}</textarea>
          </div>
          <div id="shVisualView" class="fbe-canvas-wrap" style="display:none;flex:1;min-height:0">
            <div class="fbe-canvas sh-canvas" id="shCanvas">
              <svg class="fbe-wires" id="shWires"></svg>
              <div class="fbe-nodes-layer" id="shNodes"></div>
            </div>
          </div>
          <div style="width:40%;min-width:220px;display:flex;flex-direction:column;background:#0f1013;border-left:1px solid var(--line)">
            <div style="flex:1;display:flex;align-items:center;justify-content:center"><canvas id="shCanvasPreview" width="360" height="360" style="max-width:100%;max-height:100%"></canvas></div>
            <div id="shInspector" class="forge-tool__panel" style="max-height:200px"><span class="muted">Select a node to edit its values.</span></div>
          </div>
        </div>
      </div>
    </div>`;

  const el = sel => mount.querySelector(sel);
  const codeEl = el('#shCode');
  const highlightEl = el('#shHighlight');
  const highlightCode = highlightEl.querySelector('code');
  const canvas = el('#shCanvasPreview');
  const statusEl = el('#shStatus');
  const gl = canvas.getContext('webgl2');

  // ---------------------------------------------------------------
  // Syntax-highlighted code editor: a transparent textarea sits on top of a
  // highlight.js-rendered <pre>, both sharing identical font metrics, so
  // typing/caret/selection are all real while the visible text is colored.
  // ---------------------------------------------------------------
  function refreshHighlight() {
    const src = codeEl.value;
    if (window.hljs && typeof window.hljs.highlight === 'function') {
      try { highlightCode.innerHTML = window.hljs.highlight(src, { language: 'glsl', ignoreIllegals: true }).value; }
      catch { highlightCode.textContent = src; }
    } else {
      highlightCode.textContent = src;
    }
    // A trailing newline keeps the highlight layer's last line visible/aligned.
    if (!src.endsWith('\n')) highlightCode.innerHTML += '\n';
  }
  function syncScroll() { highlightEl.scrollTop = codeEl.scrollTop; highlightEl.scrollLeft = codeEl.scrollLeft; }
  codeEl.addEventListener('input', refreshHighlight);
  codeEl.addEventListener('scroll', syncScroll);
  codeEl.addEventListener('keydown', e => {
    if (e.key === 'Tab') { e.preventDefault(); const s = codeEl.selectionStart, en = codeEl.selectionEnd; codeEl.value = codeEl.value.slice(0, s) + '  ' + codeEl.value.slice(en); codeEl.selectionStart = codeEl.selectionEnd = s + 2; refreshHighlight(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') run();
  });
  refreshHighlight();

  // ===========================================================================
  // Mode toggle (Code <-> Visual)
  // ===========================================================================
  let mode = 'code';
  function setMode(next) {
    mode = next;
    mount.querySelectorAll('[data-shmode]').forEach(b => b.classList.toggle('active', b.dataset.shmode === next));
    el('#shCodeRail').style.display = next === 'code' ? '' : 'none';
    el('#shVisualRail').style.display = next === 'visual' ? 'flex' : 'none';
    el('#shCodeView').style.display = next === 'code' ? '' : 'none';
    el('#shVisualView').style.display = next === 'visual' ? 'flex' : 'none';
    el('#shGenerate').style.display = next === 'visual' ? '' : 'none';
    if (next === 'visual') { renderGraph(); applyGraphToCode(true); }
  }
  mount.querySelectorAll('[data-shmode]').forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.shmode)));

  // ===========================================================================
  // Visual node editor
  // ===========================================================================
  const nodePaletteEl = el('#shNodePalette');
  const nodesLayer = el('#shNodes');
  const shCanvas = el('#shCanvas');
  const wiresSvg = el('#shWires');
  const inspectorEl = el('#shInspector');
  let selectedNodeId = null;
  let dragNode = null;
  let dragWire = null;

  nodePaletteEl.innerHTML = NODE_CATS.map(cat => `
    <div>
      <div class="muted" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">${cat.label}</div>
      <div style="display:flex;flex-direction:column;gap:3px">
        ${Object.entries(NODE_DEFS).filter(([, d]) => d.cat === cat.key).map(([key, d]) => `
          <button class="fbe-item" data-add-node="${key}" style="--cat-color:${d.color};cursor:pointer">
            <span class="fbe-item-icon">${d.icon}</span><span class="fbe-item-label">${escapeHtml(d.label)}</span><span class="fbe-item-add">＋</span>
          </button>`).join('')}
      </div>
    </div>`).join('');

  function addNode(type, x, y) {
    if (type === 'output' && graph.nodes.some(n => n.type === 'output')) { toast('Only one Fragment Color node is allowed'); return null; }
    const def = NODE_DEFS[type];
    const params = {}; (def.params || []).forEach(p => { params[p.key] = p.default; });
    const node = { id: `n${graph.seq++}`, type, x: Math.max(0, x || 40), y: Math.max(0, y || 40), params };
    graph.nodes.push(node);
    renderGraph();
    applyGraphToCode();
    return node;
  }

  nodePaletteEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-add-node]');
    if (!btn) return;
    addNode(btn.dataset.addNode, 40 + Math.random() * 60, 40 + Math.random() * 200);
  });

  function pinEl(nodeId, io, key) { return nodesLayer.querySelector(`.fbe-pin[data-node="${CSS.escape(nodeId)}"][data-io="${io}"][data-key="${CSS.escape(key)}"]`); }
  function pinPos(nodeId, io, key) {
    const pin = pinEl(nodeId, io, key);
    if (!pin) return null;
    const pr = pin.getBoundingClientRect(), cr = shCanvas.getBoundingClientRect();
    return { x: pr.left - cr.left + pr.width / 2 + shCanvas.scrollLeft, y: pr.top - cr.top + pr.height / 2 + shCanvas.scrollTop };
  }
  function bezier(p1, p2) {
    const dx = Math.max(40, Math.abs(p2.x - p1.x) * 0.5);
    return `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`;
  }

  function renderNodeCard(node) {
    const def = NODE_DEFS[node.type];
    const inputsHtml = def.inputs.map(inp => {
      const link = linkInto(node.id, inp.key);
      return `<div class="fbe-pinrow" data-key="${inp.key}">
        <span class="fbe-pin" data-node="${node.id}" data-io="in" data-key="${inp.key}" style="border-color:${def.color}"></span>
        <span class="fbe-pin-label">${escapeHtml(inp.label)}</span>
        ${link ? `<span class="fbe-wired-tag">wired</span>` : `<span class="muted" style="margin-left:auto;font-size:10px">${fmtNum(inp.default)}</span>`}
      </div>`;
    }).join('');
    const outputsHtml = def.outputs.map(out => `
      <div class="fbe-pinrow fbe-pinrow--out" data-key="${out.key}">
        <span class="fbe-pin-label">${escapeHtml(out.label)}</span>
        <span class="fbe-pin fbe-pin--right" data-node="${node.id}" data-io="out" data-key="${out.key}" style="border-color:${def.color}"></span>
      </div>`).join('');
    return `
      <div class="fbe-node${node.id === selectedNodeId ? ' is-selected' : ''}" data-id="${node.id}" style="left:${node.x}px;top:${node.y}px;--cat-color:${def.color}">
        <div class="fbe-node-head">
          <span class="fbe-node-icon">${def.icon}</span><span class="fbe-node-title">${escapeHtml(def.label)}</span>
          ${node.type !== 'output' ? `<span class="fbe-node-close" data-remove-node="${node.id}" title="Delete node">×</span>` : ''}
        </div>
        <div class="fbe-node-body">
          ${def.inputs.length ? `<div class="fbe-io-in">${inputsHtml}</div>` : ''}
          ${def.outputs.length ? `<div class="fbe-io-out">${outputsHtml}</div>` : ''}
        </div>
      </div>`;
  }

  function renderGraph() {
    nodesLayer.innerHTML = graph.nodes.map(renderNodeCard).join('');
    redrawWires();
  }

  function redrawWires() {
    const w = Math.max(1200, ...graph.nodes.map(n => n.x + 260)), h = Math.max(700, ...graph.nodes.map(n => n.y + 180));
    shCanvas.style.minWidth = w + 'px'; shCanvas.style.minHeight = h + 'px';
    wiresSvg.setAttribute('width', w); wiresSvg.setAttribute('height', h);
    let html = '';
    graph.links.forEach(link => {
      const p1 = pinPos(link.from, 'out', link.fromKey), p2 = pinPos(link.to, 'in', link.toKey);
      if (!p1 || !p2) return;
      html += `<path class="fbe-wire fbe-wire--value" data-link="${link.id}" d="${bezier(p1, p2)}"></path>`;
    });
    if (dragWire) {
      const p1 = pinPos(dragWire.fromNode, 'out', dragWire.fromKey);
      if (p1) html += `<path class="fbe-wire fbe-wire--ghost fbe-wire--value" d="${bezier(p1, dragWire)}"></path>`;
    }
    wiresSvg.innerHTML = html;
    wiresSvg.querySelectorAll('[data-link]').forEach(path => path.addEventListener('click', () => {
      graph.links = graph.links.filter(l => l.id !== path.dataset.link);
      renderGraph(); applyGraphToCode();
    }));
  }

  function renderInspector() {
    const node = nodeById(selectedNodeId);
    if (!node) { inspectorEl.innerHTML = '<span class="muted">Select a node to edit its values.</span>'; return; }
    const def = NODE_DEFS[node.type];
    if (!def.params || !def.params.length) { inspectorEl.innerHTML = `<div class="muted">${escapeHtml(def.label)} has no editable values.</div>`; return; }
    inspectorEl.innerHTML = `<h4>${escapeHtml(def.label)}</h4>` + def.params.map(p => {
      if (p.kind === 'color') return `<div class="field-row" style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><label style="width:70px">${escapeHtml(p.label)}</label><input type="color" data-param="${p.key}" value="${node.params[p.key]}"></div>`;
      return `<div class="field-row" style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><label style="width:70px">${escapeHtml(p.label)}</label><input type="number" step="${p.step || 0.1}" data-param="${p.key}" value="${node.params[p.key]}" style="width:90px"></div>`;
    }).join('');
    inspectorEl.querySelectorAll('[data-param]').forEach(input => input.addEventListener('input', () => {
      node.params[input.dataset.param] = input.type === 'number' ? Number(input.value) : input.value;
      applyGraphToCode();
    }));
  }

  nodesLayer.addEventListener('pointerdown', e => {
    const pin = e.target.closest('.fbe-pin');
    if (pin) {
      e.preventDefault(); e.stopPropagation();
      if (pin.dataset.io !== 'out') return;
      const p1 = pinPos(pin.dataset.node, 'out', pin.dataset.key);
      dragWire = { fromNode: pin.dataset.node, fromKey: pin.dataset.key, x: p1.x, y: p1.y };
      redrawWires();
      return;
    }
    const closeBtn = e.target.closest('[data-remove-node]');
    if (closeBtn) {
      graph.nodes = graph.nodes.filter(n => n.id !== closeBtn.dataset.removeNode);
      graph.links = graph.links.filter(l => l.from !== closeBtn.dataset.removeNode && l.to !== closeBtn.dataset.removeNode);
      if (selectedNodeId === closeBtn.dataset.removeNode) selectedNodeId = null;
      renderGraph(); renderInspector(); applyGraphToCode();
      return;
    }
    const head = e.target.closest('.fbe-node-head');
    const card = e.target.closest('.fbe-node');
    if (card) {
      selectedNodeId = card.dataset.id;
      mount.querySelectorAll('.fbe-node').forEach(c => c.classList.toggle('is-selected', c === card));
      renderInspector();
    }
    if (head) {
      const node = nodeById(card.dataset.id);
      const cr = shCanvas.getBoundingClientRect();
      dragNode = { id: node.id, offsetX: e.clientX - cr.left - node.x, offsetY: e.clientY - cr.top - node.y };
    }
  });

  shCanvas.addEventListener('pointerdown', e => {
    if (e.target === shCanvas || e.target === wiresSvg) { selectedNodeId = null; mount.querySelectorAll('.fbe-node').forEach(c => c.classList.remove('is-selected')); renderInspector(); }
  });

  window.addEventListener('pointermove', e => {
    if (dragNode) {
      const node = nodeById(dragNode.id); if (!node) return;
      const cr = shCanvas.getBoundingClientRect();
      node.x = Math.max(0, e.clientX - cr.left - dragNode.offsetX);
      node.y = Math.max(0, e.clientY - cr.top - dragNode.offsetY);
      const cardEl = nodesLayer.querySelector(`.fbe-node[data-id="${node.id}"]`);
      if (cardEl) { cardEl.style.left = node.x + 'px'; cardEl.style.top = node.y + 'px'; }
      redrawWires();
      return;
    }
    if (dragWire) {
      const cr = shCanvas.getBoundingClientRect();
      dragWire.x = e.clientX - cr.left + shCanvas.scrollLeft;
      dragWire.y = e.clientY - cr.top + shCanvas.scrollTop;
      redrawWires();
    }
  });
  window.addEventListener('pointerup', e => {
    if (dragWire) {
      const pin = e.target.closest && e.target.closest('.fbe-pin');
      if (pin && pin.dataset.io === 'in') {
        graph.links = graph.links.filter(l => !(l.to === pin.dataset.node && l.toKey === pin.dataset.key)); // one link per input
        if (!(pin.dataset.node === dragWire.fromNode)) graph.links.push({ id: `l${graph.seq++}`, from: dragWire.fromNode, fromKey: dragWire.fromKey, to: pin.dataset.node, toKey: pin.dataset.key });
        renderGraph(); applyGraphToCode();
      }
      dragWire = null;
      redrawWires();
    }
    dragNode = null;
  });

  function applyGraphToCode(silent) {
    const result = generateGLSL();
    if (result.error) { if (!silent) toast(result.error); return; }
    codeEl.value = result.source;
    refreshHighlight();
    if (mode === 'visual') run();
  }
  el('#shGenerate').addEventListener('click', () => { applyGraphToCode(); setMode('code'); toast('Graph compiled to GLSL — edit freely, or switch back to Visual'); });

  renderGraph();
  renderInspector();

  // ===========================================================================
  // Compile + run (shared by both modes — always compiles codeEl.value)
  // ===========================================================================
  let program = null, buffer = null, raf = null, startTime = performance.now();

  function compile(source, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(info || 'Shader compile error');
    }
    return shader;
  }

  function buildProgram(fragmentSrc) {
    const vs = compile(VERTEX_SRC, gl.VERTEX_SHADER);
    const fs = compile(fragmentSrc, gl.FRAGMENT_SHADER);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error(info || 'Program link error');
    }
    return prog;
  }

  function run() {
    if (!gl) { statusEl.textContent = 'WebGL2 unavailable in this browser'; return; }
    cancelAnimationFrame(raf);
    try {
      program = buildProgram(codeEl.value);
    } catch (error) {
      statusEl.textContent = `Error: ${error.message.split('\n')[0]}`;
      statusEl.style.color = 'var(--danger)';
      log('error', `Shader compile error: ${error.message}`);
      return;
    }
    statusEl.textContent = 'Compiled OK'; statusEl.style.color = '';
    if (!buffer) {
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    }
    gl.useProgram(program);
    const posLoc = gl.getAttribLocation(program, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    const resLoc = gl.getUniformLocation(program, 'u_resolution');
    const timeLoc = gl.getUniformLocation(program, 'u_time');
    const colorLoc = gl.getUniformLocation(program, 'u_color');
    startTime = performance.now();
    const hexToRgb = hex => { const n = parseInt(hex.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

    function frame() {
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (resLoc) gl.uniform2f(resLoc, canvas.width, canvas.height);
      if (timeLoc) gl.uniform1f(timeLoc, (performance.now() - startTime) / 1000);
      if (colorLoc) gl.uniform3fv(colorLoc, hexToRgb(el('#shColor').value));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    }
    frame();
  }

  el('#shCompile').addEventListener('click', run);
  el('#shPreset').addEventListener('change', e => { codeEl.value = PRESETS[e.target.value]; refreshHighlight(); run(); });
  el('#shColor').addEventListener('input', () => {});

  el('#shSave').addEventListener('click', async () => {
    if (!state.slug) return;
    const name = el('#shAssetName').value.trim() || `shader-${Date.now()}`;
    try {
      const { asset } = await api(`/api/games/${encodeURIComponent(state.slug)}/assets`, {
        method: 'POST',
        body: JSON.stringify({ name, category: 'shader', code: codeEl.value })
      });
      toast(asset?.overwritten ? `Saved — overwrote existing shader "${name}"` : `Saved shader "${name}" to Assets`);
      log('info', `Shader saved as asset "${name}"${asset?.overwritten ? ' (overwrote previous version)' : ''}`);
      window.__forgeLoadAssets?.();
    } catch (error) { toast(error.message); }
  });

  // Load an existing shader asset back in for editing — used by the Assets
  // tab's right-click "Edit in Shader Editor" (see editor.js). Saved
  // shaders carry their source directly in the asset's `script` field
  // (see uploadAsset in game-manager.js), so no fetch is needed for those;
  // this still falls back to fetching the file for anything that ended up
  // in the "shader" category some other way (e.g. a dragged-in .glsl file).
  async function loadShaderAsset(asset) {
    let source = asset.script;
    if (typeof source !== 'string') {
      try { source = await (await fetch(asset.url)).text(); } catch { toast(`Could not load "${asset.name}" for editing`); return; }
    }
    codeEl.value = source;
    setMode('code');
    refreshHighlight();
    run();
    const nameField = el('#shAssetName');
    if (nameField) nameField.value = asset.name;
    toast(`Loaded "${asset.name}" for editing`);
  }
  window.__forgeShaderEditorLoad = loadShaderAsset;

  // Only render while this tab is visible/active, to avoid burning GPU in the background.
  const observer = new MutationObserver(() => {
    if (mount.classList.contains('active')) run();
    else cancelAnimationFrame(raf);
  });
  observer.observe(mount, { attributes: true, attributeFilter: ['class'] });

  if (mount.classList.contains('active')) run();
})();
