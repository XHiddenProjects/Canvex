(() => {
  const mount = document.getElementById('blocksPanel');
  const state = window.__forgeState;
  if (!mount || !state) return;
  const api = window.__forgeApi, toast = window.__forgeToast, log = window.__forgeLog, escapeHtml = window.__forgeEscape || (s => String(s));

  // ===========================================================================
  // Catalog — ForgeEngine's `Behaviors` blocks (utils/src/behaviors.js), now
  // described as real node/connector definitions: named data inputs (left,
  // round pins) plus an implicit exec-in ("Run" pin), and named outputs
  // (right) which are either exec pulses (triangular pins — fire a connected
  // node) or a single computed value (round pin). This mirrors the Trigger /
  // Logic & Math / Component / Text & List / GUI / Game Flow grouping from
  // the Flowlab-style docs the Behaviors module was built against.
  // ===========================================================================

  const N = (key, label, def = 0, extra = {}) => ({ key, label, type: 'number', default: def, ...extra });
  const T = (key, label, def = '') => ({ key, label, type: 'text', default: def });
  const B = (key, label, def = false) => ({ key, label, type: 'bool', default: def });
  const S = (key, label, options, def, extra = {}) => ({ key, label, type: 'select', options, default: def ?? options[0], ...extra });
  // `preset: true` on an input marks it config-only (e.g. Number's "Initial"
  // starting value, "Round" mode): it shows up as a plain field with no wire
  // pin at all, since it's read once/used as a fixed setting rather than
  // something another block feeds a live value into.
  const EXEC = (key, label) => ({ key, label, type: 'exec' });
  const VAL = (key, label) => ({ key, label, type: 'value' });
  // OBJ — an "Object Type"/"Object Name"/"Target Object" style field. Renders
  // as a dropdown of the current scene's objects at runtime; default is "None".
  const OBJ = (key, label, def = '') => ({ key, label, type: 'object', default: def });

  // ---------------------------------------------------------------------------
  // Exec-in pins — the docs describe each block's activatable "Inputs" (Set,
  // Get, Start, Reset, Cast, ...), separate from its config "Properties". A
  // block can declare `execIn: [{key,label}, ...]` for these. If it doesn't:
  //   - a root/spontaneous trigger (sim.root) gets NONE — it fires on its own
  //     when the game runs (Once on spawn, Always every frame, Keyboard on a
  //     real keypress, ...), so it can't be "Run" by another block.
  //   - everything else falls back to a single generic "▶ Run" pin.
  // `autoStartKey` lets a block auto-fire one specific exec-in pin when
  // nothing is wired into it (Timer's "Start", matching "if nothing is
  // connected to the start input, the timer will begin running automatically").
  // ---------------------------------------------------------------------------
  function getExecIns(def, node) {
    if (typeof def.execIn === 'function') return def.execIn(node ? node.inputValues : {});
    if (def.execIn) return def.execIn;
    if (def.sim && def.sim.root) return [];
    return [{ key: '__exec', label: 'Run' }];
  }
  function isExecInKey(fn, key, node) {
    const def = defFor(fn);
    if (!def) return false;
    return getExecIns(def, node).some(p => p.key === key);
  }
  // The exec-in keys a given block-fn actually exposes, e.g. ['start','reset']
  // for Timer, [] for a spontaneous root trigger, ['__exec'] for the default
  // single generic "Run" pin. Used everywhere a wire's target needs to be
  // recognized as *an* exec pin without assuming it's always named '__exec'.
  // `node` is optional and only matters for blocks like Expression whose
  // exec-in pins (A-F) depend on a per-node property ("Inputs" count).
  function execKeysFor(fn, node) {
    const def = defFor(fn);
    return def ? getExecIns(def, node).map(p => p.key) : ['__exec'];
  }

  const CATEGORY_META = {
    'Triggers': { icon: '⚡', color: '#e4b73f' },
    'Logic & Math': { icon: '🧮', color: '#5aa9e6' },
    'Components': { icon: '⚙️', color: '#b98af0' },
    'Properties': { icon: '🧬', color: '#7ee0d0' },
    'Text & Lists': { icon: '🔤', color: '#5ecf8f' },
    'GUI': { icon: '🖼️', color: '#f083b0' },
    'Game Flow': { icon: '🚩', color: '#ef8b6b' },
    'Mobile Device': { icon: '📱', color: '#8fd15a' },
    'Multiplayer': { icon: '🌐', color: '#5adde0' },
    'Behavior Bundles': { icon: '🧩', color: '#c9c25a' }
  };

  const FAKE_OBJECTS = {
    player: { x: 120, y: 80, rotation: 0, health: 100 },
    enemy: { x: 300, y: 60, rotation: 180, health: 50 }
  };

  // ---------------------------------------------------------------------------
  // Object references — every "deals with an object" input (Object Type /
  // Object Name / Target Object in the docs) is a dropdown of the current
  // scene's actual objects, defaulting to "None". Blocks that always act on
  // "this object" (Position, Destroyer, Push Motor, ...) don't get a dropdown
  // at all — in Test Mode they resolve to whichever object is selected in the
  // Scene panel, matching the rule that a behavior graph only affects the
  // object it's placed in.
  // ---------------------------------------------------------------------------

  function getSceneObjects() {
    return Array.isArray(state.objects) ? state.objects : [];
  }
  function findSceneObject(id) {
    if (!id) return null;
    return getSceneObjects().find(o => o.id === id) || null;
  }
  function objectDisplayName(id) {
    const o = findSceneObject(id);
    if (o) return o.name || o.id;
    return id; // fall back to the raw value (e.g. a legacy demo bundle string)
  }
  function selfLabel(ctx) {
    if (!ctx || !ctx.selfId) return '(no object selected)';
    return `"${objectDisplayName(ctx.selfId)}"`;
  }
  function objLabel(raw) {
    if (!raw) return 'None';
    return `"${objectDisplayName(raw)}"`;
  }

  // Demo storage backing Global Variable / Object Variable blocks (per-tab session state).
  const GLOBALS = {};
  const OBJECT_VARS = {};
  // Per the docs: "Updating one Global block updates all global blocks with
  // the same name (and evaluates their outputs)" — same for Object Variable
  // blocks that share a name within the same object. Each block's `emit`
  // registers itself here (keyed by Global name, or `${selfId}.${name}` for
  // Object Variable) the first time it runs, so a Set/+ on any one of them
  // re-fires every other block sharing that name/key too.
  const GLOBAL_LISTENERS = {};
  const OBJECT_VAR_LISTENERS = {};

  const FILTER_OPS = { '<': (a, b) => a < b, '>': (a, b) => a > b, '==': (a, b) => a === b, '!=': (a, b) => a !== b, '<=': (a, b) => a <= b, '>=': (a, b) => a >= b };
  const LOGIC_GATES = { AND: (a, b) => a && b, OR: (a, b) => a || b, NAND: (a, b) => !(a && b), NOR: (a, b) => !(a || b), XOR: (a, b) => Boolean(a) !== Boolean(b), XNOR: (a, b) => Boolean(a) === Boolean(b) };

  // ---------------------------------------------------------------------------
  // Expression evaluator — claude.ai/this environment's CSP has no
  // 'unsafe-eval' in script-src, so `new Function(exprString)` throws at
  // runtime. Expression blocks are evaluated with a small hand-rolled
  // recursive-descent parser instead of compiling the string as JS: it only
  // understands the operators and Math.* functions the docs list, plus the
  // A-F variables, so it's both CSP-safe and can't run arbitrary code.
  // ---------------------------------------------------------------------------
  const EXPR_MATH_FNS = {
    'Math.abs': Math.abs, 'Math.acos': Math.acos, 'Math.asin': Math.asin, 'Math.atan': Math.atan,
    'Math.atan2': Math.atan2, 'Math.ceil': Math.ceil, 'Math.cos': Math.cos, 'Math.exp': Math.exp,
    'Math.floor': Math.floor, 'Math.max': Math.max, 'Math.min': Math.min, 'Math.pow': Math.pow,
    'Math.round': Math.round, 'Math.sin': Math.sin, 'Math.sqrt': Math.sqrt, 'Math.tan': Math.tan
  };
  function tokenizeExpr(src) {
    const tokens = [];
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (/[0-9.]/.test(ch)) {
        let j = i + 1;
        while (j < src.length && /[0-9.]/.test(src[j])) j++;
        const raw = src.slice(i, j);
        if (!/^\d+\.?\d*$|^\d*\.\d+$/.test(raw)) throw new Error(`Bad number "${raw}"`);
        tokens.push({ type: 'num', value: parseFloat(raw) });
        i = j; continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        let j = i + 1;
        while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j++;
        tokens.push({ type: 'ident', value: src.slice(i, j) });
        i = j; continue;
      }
      if ('+-*/%(),'.includes(ch)) { tokens.push({ type: ch }); i++; continue; }
      throw new Error(`Unexpected character "${ch}"`);
    }
    return tokens;
  }
  // Grammar: expression := term (('+'|'-') term)*
  //          term       := unary (('*'|'/'|'%') unary)*
  //          unary      := ('+'|'-')? primary
  //          primary     := number | ident['(' args ')'] | '(' expression ')'
  function evalExpression(exprString, vars = {}) {
    const tokens = tokenizeExpr(String(exprString == null ? '' : exprString));
    let pos = 0;
    const peek = () => tokens[pos];
    const next = () => tokens[pos++];

    function parseExpression() {
      let v = parseTerm();
      while (peek() && (peek().type === '+' || peek().type === '-')) {
        const op = next().type;
        const rhs = parseTerm();
        v = op === '+' ? v + rhs : v - rhs;
      }
      return v;
    }
    function parseTerm() {
      let v = parseUnary();
      while (peek() && (peek().type === '*' || peek().type === '/' || peek().type === '%')) {
        const op = next().type;
        const rhs = parseUnary();
        v = op === '*' ? v * rhs : op === '/' ? v / rhs : v % rhs;
      }
      return v;
    }
    function parseUnary() {
      if (peek() && (peek().type === '+' || peek().type === '-')) {
        const op = next().type;
        const v = parseUnary();
        return op === '-' ? -v : v;
      }
      return parsePrimary();
    }
    function parsePrimary() {
      const tok = peek();
      if (!tok) throw new Error('Unexpected end of expression');
      if (tok.type === 'num') { next(); return tok.value; }
      if (tok.type === '(') {
        next();
        const v = parseExpression();
        if (!peek() || peek().type !== ')') throw new Error('Expected ")"');
        next();
        return v;
      }
      if (tok.type === 'ident') {
        next();
        const name = tok.value;
        if (peek() && peek().type === '(') {
          next();
          const args = [];
          if (peek() && peek().type !== ')') {
            args.push(parseExpression());
            while (peek() && peek().type === ',') { next(); args.push(parseExpression()); }
          }
          if (!peek() || peek().type !== ')') throw new Error('Expected ")"');
          next();
          const fn = EXPR_MATH_FNS[name];
          if (!fn) throw new Error(`Unknown function "${name}"`);
          return fn(...args);
        }
        if (name in vars) return Number(vars[name]) || 0;
        throw new Error(`Unknown variable "${name}"`);
      }
      throw new Error(`Unexpected token "${tok.type}"`);
    }

    const result = parseExpression();
    if (pos < tokens.length) throw new Error(`Unexpected token near "${tokens[pos].type}"`);
    return result;
  }

  // Each block: icon, inputs (data pins, rendered as literal fields unless wired),
  // outputs (exec pins that fire downstream nodes, or a single 'value' pin),
  // and `sim` — the in-browser implementation used by Test Mode:
  //   sim.root  = true  -> spontaneously starts on Play (sim.start returns a cleanup fn)
  //   otherwise         -> runs when reached by an incoming exec pulse (sim.run)
  //   sim.pure  = true  -> has no side effects, safe to live-preview while editing
  const CATALOG = {
    'Triggers': [
      { fn: 'once', icon: '1️⃣', inputs: [], outputs: [EXEC('onOut', 'Out')],
        sim: { root: true, start: (node, emit) => { const h = setTimeout(() => emit('onOut', 1), 20); return () => clearTimeout(h); } } },
      { fn: 'always', icon: '🔁', inputs: [], outputs: [EXEC('onOut', 'Out')],
        sim: { root: true, start: (node, emit) => { const iv = setInterval(() => emit('onOut', 1), 1000); return () => clearInterval(iv); } } },
      // Timer — the docs give it three distinct activatable inputs (Delay,
      // Reset, Start), separate from its Delay/Repeat Forever/Repeat
      // properties. It now declares a real execIn list instead of collapsing
      // to one generic "Run" pin: wiring into Start (re)starts the countdown
      // from zero repeats; wiring into Reset stops it and zeroes the repeat
      // count without restarting it (matching "if the Reset input is
      // activated, the timer is stopped, and the next time it starts it will
      // run [the full repeat count] times"). If nothing is wired into Start
      // at all, it still auto-starts on Play when Auto Start is on, via the
      // dedicated seeding pass in startTest().
      { fn: 'timer', icon: '⏱️',
        execIn: [{ key: 'start', label: 'Start' }, { key: 'reset', label: 'Reset' }],
        inputs: [N('delay', 'Delay (x0.1s)', 10), B('repeatForever', 'Repeat Forever', false), N('repeat', 'Repeat', 1), B('autoStart', 'Auto Start', true)],
        outputs: [EXEC('onOut', 'Out'), EXEC('onDone', 'Done')],
        sim: { run: (node, a, emit, ctx, pulse, execKey) => {
          const stop = () => { if (node.__timerStop) { node.__timerStop(); node.__timerStop = null; } };
          if (execKey === 'reset') { stop(); node.__timerCount = 0; return; }
          // Anything else (Start, or the auto-start seed pass) (re)starts the
          // timer fresh — replacing any interval already running for this
          // node instead of stacking a second one on top of it.
          stop();
          let count = 0;
          const iv = setInterval(() => {
            count += 1; emit('onOut', count);
            if (!a.repeatForever && count >= Math.max(1, a.repeat)) { clearInterval(iv); node.__timerStop = null; emit('onDone', count); }
          }, Math.max(1, a.delay) * 100);
          node.__timerStop = () => clearInterval(iv);
          ctx?.own?.(() => node.__timerStop && node.__timerStop());
        } } },
      { fn: 'keyboard', icon: '⌨️', inputs: [T('key', 'Key', 'Space'), B('repeating', 'Repeating', false)], outputs: [EXEC('down', 'Down'), EXEC('up', 'Up')],
        sim: { root: true, start: (node, emit, ctx) => {
          const a = ctx.args(node);
          const want = String(a.key || 'Space');
          const matches = e => e.key === want || e.code === want || e.code === `Key${want.toUpperCase()}` || (want.length === 1 && e.key.toLowerCase() === want.toLowerCase());
          const down = e => { if (matches(e)) { e.preventDefault(); emit('down', 1); } };
          const up = e => { if (matches(e)) emit('up', 1); };
          ctx.stage.addEventListener('keydown', down);
          ctx.stage.addEventListener('keyup', up);
          return () => { ctx.stage.removeEventListener('keydown', down); ctx.stage.removeEventListener('keyup', up); };
        } } },
      { fn: 'mouseClick', icon: '🖱️', inputs: [S('button', 'Button', ['left', 'right'], 'left')], outputs: [EXEC('down', 'Down'), EXEC('up', 'Up'), EXEC('over', 'Over'), EXEC('out', 'Out')],
        sim: { root: true, start: (node, emit, ctx) => {
          const down = () => emit('down', 1), up = () => emit('up', 1), over = () => emit('over', 1), out = () => emit('out', 1);
          ctx.stage.addEventListener('mousedown', down); ctx.stage.addEventListener('mouseup', up);
          ctx.stage.addEventListener('mouseenter', over); ctx.stage.addEventListener('mouseleave', out);
          return () => { ctx.stage.removeEventListener('mousedown', down); ctx.stage.removeEventListener('mouseup', up); ctx.stage.removeEventListener('mouseenter', over); ctx.stage.removeEventListener('mouseleave', out); };
        } } },
      { fn: 'mouseMove', icon: '🧭', inputs: [], outputs: [EXEC('onMove', 'Move')],
        sim: { root: true, start: (node, emit, ctx) => {
          const move = e => { const r = ctx.stage.getBoundingClientRect(); emit('onMove', `${Math.round(e.clientX - r.left)}, ${Math.round(e.clientY - r.top)}`); };
          ctx.stage.addEventListener('mousemove', move);
          return () => ctx.stage.removeEventListener('mousemove', move);
        } } },
      { fn: 'lockedMouse', icon: '🔒', inputs: [], outputs: [EXEC('onMove', 'Delta')],
        sim: { root: true, start: (node, emit, ctx) => {
          const move = e => { if (document.pointerLockElement === ctx.stage) emit('onMove', `${e.movementX || 0}, ${e.movementY || 0}`); };
          const request = () => { if (ctx.stage.requestPointerLock) ctx.stage.requestPointerLock(); };
          ctx.stage.addEventListener('click', request);
          ctx.stage.addEventListener('mousemove', move);
          return () => { ctx.stage.removeEventListener('click', request); ctx.stage.removeEventListener('mousemove', move); if (document.exitPointerLock) document.exitPointerLock(); };
        } } },
      { fn: 'mouseWheel', icon: '🖲️', inputs: [], outputs: [EXEC('onUp', 'Up'), EXEC('onDown', 'Down')],
        sim: { root: true, start: (node, emit, ctx) => {
          const wheel = e => emit(e.deltaY < 0 ? 'onUp' : 'onDown', e.deltaY);
          ctx.stage.addEventListener('wheel', wheel);
          return () => ctx.stage.removeEventListener('wheel', wheel);
        } } },
      { fn: 'gesture', icon: '🤙', inputs: [S('type', 'Type', ['tap', 'swipeLeft', 'swipeRight', 'swipeUp', 'swipeDown', 'pinch'], 'tap')], outputs: [EXEC('onGesture', 'Gesture')],
        sim: { root: true, start: (node, emit, ctx) => {
          const a = ctx.args(node);
          let sx = 0, sy = 0;
          const down = e => { sx = e.clientX; sy = e.clientY; };
          const up = e => {
            const dx = e.clientX - sx, dy = e.clientY - sy;
            let type = 'tap';
            if (Math.abs(dx) > 30 || Math.abs(dy) > 30) type = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'swipeRight' : 'swipeLeft') : (dy > 0 ? 'swipeDown' : 'swipeUp');
            if (type === a.type) emit('onGesture', type);
          };
          ctx.stage.addEventListener('mousedown', down); ctx.stage.addEventListener('mouseup', up);
          return () => { ctx.stage.removeEventListener('mousedown', down); ctx.stage.removeEventListener('mouseup', up); };
        } } },
      { fn: 'controller', icon: '🎮', inputs: [S('button', 'Button', ['A', 'B', 'X', 'Y', 'L', 'R', 'DPadUp', 'DPadDown', 'DPadLeft', 'DPadRight'], 'A')], outputs: [EXEC('onPress', 'Press'), EXEC('onRelease', 'Release')],
        sim: { root: true, start: (node, emit, ctx) => {
          const a = ctx.args(node);
          const idx = { A: 0, B: 1, X: 2, Y: 3, L: 4, R: 5, DPadUp: 12, DPadDown: 13, DPadLeft: 14, DPadRight: 15 }[a.button] ?? 0;
          let wasDown = false, alive = true;
          const poll = () => {
            if (!alive) return;
            const pads = navigator.getGamepads ? navigator.getGamepads() : [];
            const pad = pads && pads[0];
            const isDown = !!(pad && pad.buttons[idx] && pad.buttons[idx].pressed);
            if (isDown && !wasDown) emit('onPress', 1);
            if (!isDown && wasDown) emit('onRelease', 1);
            wasDown = isDown;
            requestAnimationFrame(poll);
          };
          requestAnimationFrame(poll);
          return () => { alive = false; };
        } } },
      { fn: 'collision', icon: '💥', inputs: [OBJ('object', 'Object Type/Name')], outputs: [EXEC('hit', 'Hit')],
        sim: { run: (node, a, emit, ctx) => emit('hit', `${selfLabel(ctx)} × ${objLabel(a.object)} (demo)`) } },
      { fn: 'sensor', icon: '🛰️', inputs: [OBJ('object', 'Object Type/Name'), N('radius', 'Radius', 50)], outputs: [EXEC('onDetect', 'Detect'), EXEC('onLost', 'Lost')],
        sim: { run: (node, a, emit, ctx) => emit('onDetect', `${selfLabel(ctx)} sensed ${objLabel(a.object)} within ${a.radius}px (demo)`) } },
      { fn: 'mailbox', icon: '📬', inputs: [T('name', 'Name', 'ping')], outputs: [EXEC('onOut', 'Out')],
        sim: { root: true, start: (node, emit, ctx) => { const a = ctx.args(node); const h = v => emit('onOut', v); ctx.bus.on(a.name || 'ping', h); return () => ctx.bus.off(a.name || 'ping', h); } } },
      { fn: 'sendMessage', icon: '📤', inputs: [T('name', 'Name', 'ping'), N('value', 'Value', 1)], outputs: [],
        sim: { run: (node, a, emit, ctx) => ctx.bus.emit(a.name || 'ping', a.value) } },
      { fn: 'inView', icon: '👁️', inputs: [], outputs: [EXEC('onEnter', 'Enter'), EXEC('onExit', 'Exit')],
        sim: { root: true, start: (node, emit, ctx) => {
          const io = new IntersectionObserver(entries => entries.forEach(en => emit(en.isIntersecting ? 'onEnter' : 'onExit', selfLabel(ctx))), { root: ctx.stage });
          io.observe(ctx.stage);
          return () => io.disconnect();
        } } }
    ],
    'Logic & Math': [
      // Number — the docs give it three distinct activatable inputs (Set,
      // Get, +) over one stored value, not just a single computed output.
      // Set overwrites the stored value, Get reads it without changing it,
      // + adds to it — and per utils/src/behaviors.js (.set()/.get()/.add()
      // all `return value`), every one of them fires the Value output with
      // the (rounded, per the Rounding property) result, exactly like
      // Global Variable and Object Variable's own Set/Get/+ already do, so
      // a block wired downstream of Number's Value pin runs no matter which
      // of the three pins triggered it. Set and + are the only
      // pins that actually need a live value (the amount to set/add), so
      // rather than a separate "Amount" property field, that value rides
      // along on the same wire that triggers Set/+ (`carriesValue: true` —
      // rendered as a plain blue circle instead of a diamond, and able to
      // accept a wire straight from another block's Value output, e.g.
      // Random). Get is marked the same way for a consistent look across
      // the three pins, even though it ignores whatever rides along with
      // it. Initial and Round are fixed, one-time/config settings (the
      // starting value, and how to round) — not something wired live from
      // another block — so they're `preset: true` and show no wire pin at
      // all. The node's stored value lives on the node itself
      // (node.__numValue) and resets to Initial each time Test Mode
      // restarts.
      { fn: 'number', icon: '#️⃣',
        execIn: [
          { key: 'set', label: 'Set', carriesValue: true },
          { key: 'get', label: 'Get', carriesValue: true },
          { key: 'add', label: '+', carriesValue: true }
        ],
        inputs: [
          N('initial', 'Initial', 0, { preset: true }),
          S('round', 'Round', ['none', 'nearest', 'up', 'down'], 'none', { preset: true })
        ],
        outputs: [VAL('value', 'Value')],
        sim: { pure: true, run: (node, a, emit, ctx, pulse, execKey) => {
          const applyRound = v => a.round === 'nearest' ? Math.round(v) : a.round === 'up' ? Math.ceil(v) : a.round === 'down' ? Math.floor(v) : v;
          if (node.__numValue === undefined) node.__numValue = Number(a.initial) || 0;
          if (execKey === 'set') node.__numValue = applyRound(Number(pulse) || 0);
          else if (execKey === 'add') node.__numValue = applyRound(node.__numValue + (Number(pulse) || 0));
          emit('value', node.__numValue);
        } } },
      // Expression — evaluates an arithmetic string using a CSP-safe parser
      // (see evalExpression) instead of `new Function`/eval. "Inputs" (1-6,
      // structural) controls how many A-F variable pins/properties show, per
      // the docs; A and B are always present (the default is 2), C-F only
      // appear once Inputs is raised — so an expression that only uses A/B
      // works with nothing else configured. Each variable input only *sets*
      // its stored value (see stalefn.run: no emit); the `eval` input is
      // what actually evaluates the expression and fires `out`.
      { fn: 'expression', icon: '∑',
        inputs: a => {
          const n = exprVarCountFor(a);
          const varInputs = EXPR_VAR_NAMES.slice(0, n).map((name, i) => N(name, name, i === 0 ? 4 : i === 1 ? 2 : 0));
          return [N('count', 'Inputs', 2, { structural: true }), ...varInputs, T('exprString', 'Expression', 'A + B')];
        },
        execIn: a => { const n = exprVarCountFor(a); return [...EXPR_VAR_NAMES.slice(0, n).map(name => ({ key: name, label: name })), { key: 'eval', label: 'Eval' }]; },
        outputs: [VAL('out', 'Out')],
        sim: { pure: true, run: (node, a, emit, ctx, pulse, execKey) => {
          const n = exprVarCountFor(a);
          const names = EXPR_VAR_NAMES.slice(0, n);
          node.__exprVars ||= {};
          names.forEach(name => { if (node.__exprVars[name] === undefined) node.__exprVars[name] = Number(a[name]) || 0; });
          if (names.includes(execKey)) { node.__exprVars[execKey] = Number(pulse) || 0; return; } // Set only — no output.
          try {
            const vars = {};
            names.forEach(name => { vars[name] = node.__exprVars[name]; });
            emit('out', evalExpression(a.exprString, vars));
          } catch (err) { emit('out', `Error: ${err.message}`); }
        } } },
      { fn: 'repeater', icon: '🔂', inputs: [N('count', 'Count', 3)], outputs: [EXEC('onOut', 'Out'), EXEC('onDone', 'Done')],
        sim: { run: (node, a, emit) => { const c = Math.max(0, Math.floor(a.count)); for (let i = 1; i <= c; i++) emit('onOut', i); emit('onDone', c); } } },
      { fn: 'random', icon: '🎲', inputs: [N('min', 'Min', 0), N('max', 'Max', 1)], outputs: [VAL('value', 'Value')],
        sim: { pure: true, run: (node, a, emit) => emit('value', Number((a.min + Math.random() * (a.max - a.min)).toFixed(3))) } },
      { fn: 'filter', icon: '🧪', inputs: [N('value', 'Value', 0), S('op', 'Op', ['<', '>', '==', '!=', '<=', '>='], '>'), N('compareTo', 'Compare To', 0)], outputs: [EXEC('pass', 'Pass'), EXEC('fail', 'Fail')],
        sim: { run: (node, a, emit) => { const ok = (FILTER_OPS[a.op] || FILTER_OPS['>'])(a.value, a.compareTo); emit(ok ? 'pass' : 'fail', a.value); } } },
      { fn: 'switchGate', icon: '🔌', inputs: [B('initialOn', 'Initially On', true)], outputs: [EXEC('onOut', 'Out')],
        sim: { run: (node, a, emit, ctx, pulse) => { if (a.initialOn) emit('onOut', pulse ?? 1); } } },
      { fn: 'toggle', icon: '🔀', inputs: [B('loop', 'Loop', true), N('startOn', 'Start On', 1)], outputs: [EXEC('out1', 'Out 1'), EXEC('out2', 'Out 2')],
        sim: { run: (node, a, emit, ctx, pulse) => { node.__t = node.__t === 2 ? 1 : (node.__t || a.startOn || 1); emit(node.__t === 1 ? 'out1' : 'out2', pulse ?? 1); node.__t = node.__t === 1 ? 2 : 1; } } },
      // Router — Select Specific Route / Always Increment Route / Randomize
      // Next Route, matching the docs. "Available Routes" (1-32) controls
      // how many out1..out32 exec-outputs actually show on the node, so
      // `outputs` is a function of the node's current property value
      // instead of a fixed list (see outputsFor). `select` (send a route
      // number) and `in` (send the value to route) are separate exec-in
      // pins per the docs, rather than one generic Run pin.
      { fn: 'router', icon: '🔀',
        inputs: [
          S('mode', 'Routing Method', ['Select Specific Route', 'Always Increment Route', 'Randomize Next Route'], 'Always Increment Route'),
          N('routeCount', 'Available Routes', 2, { structural: true })
        ],
        execIn: [{ key: 'select', label: 'Select' }, { key: 'in', label: 'In' }],
        outputs: a => { const n = routeCountFor(a); return Array.from({ length: n }, (_, i) => EXEC(`out${i + 1}`, `Out ${i + 1}`)); },
        sim: { run: (node, a, emit, ctx, pulse, execKey) => {
          const count = routeCountFor(a);
          if (node.__routerIndex === undefined || node.__routerIndex >= count) node.__routerIndex = 0;
          if (execKey === 'select') {
            const n = Math.floor(Number(pulse)) || 0;
            node.__routerIndex = ((n - 1) % count + count) % count; // route numbers are 1-based (out1..outN)
            return;
          }
          let index = a.mode === 'Randomize Next Route' ? Math.floor(Math.random() * count) : node.__routerIndex;
          emit(`out${index + 1}`, pulse ?? 1);
          node.__routerIndex = a.mode === 'Always Increment Route' ? (index + 1) % count : index;
        } } },
      { fn: 'logicGate', icon: '⛩️', inputs: [S('type', 'Type', ['AND', 'OR', 'NAND', 'NOR', 'XOR', 'XNOR'], 'AND'), N('a', 'A', 1), N('b', 'B', 0)], outputs: [VAL('value', 'Value')],
        sim: { pure: true, run: (node, a, emit) => emit('value', (LOGIC_GATES[a.type] || LOGIC_GATES.AND)(Boolean(a.a), Boolean(a.b)) ? 1 : 0) } },
      { fn: 'ease', icon: '📈', inputs: [N('from', 'From', 0), N('to', 'To', 1), N('seconds', 'Seconds', 1)], outputs: [EXEC('onOut', 'Out'), EXEC('onDone', 'Done')],
        sim: { run: (node, a, emit, ctx) => {
          const dur = Math.max(0.1, a.seconds) * 1000, t0 = performance.now();
          const iv = setInterval(() => {
            if (!ctx.running()) return clearInterval(iv);
            const t = Math.min(1, (performance.now() - t0) / dur);
            emit('onOut', Number((a.from + (a.to - a.from) * t).toFixed(2)));
            if (t >= 1) { clearInterval(iv); emit('onDone', 1); }
          }, 60);
          ctx.own(() => clearInterval(iv));
        } } },
      // Global — Set/Get/+ over a value shared by *every* Global block using
      // the same Name (matching "All Global blocks using the same name will
      // contain the same value. Updating one Global block updates all
      // global blocks with the same name"): Set/+ mutate GLOBALS[name] and
      // then re-fire every registered listener for that name, not just this
      // node's own output.
      { fn: 'globalVariable', icon: '🌐',
        execIn: [
          { key: 'set', label: 'Set', carriesValue: true },
          { key: 'get', label: 'Get', carriesValue: true },
          { key: 'add', label: '+', carriesValue: true }
        ],
        inputs: [T('name', 'Name', 'score'), N('initial', 'Initial', 0, { preset: true })],
        outputs: [VAL('value', 'Value')],
        sim: { pure: true, run: (node, a, emit, ctx, pulse, execKey) => {
          const name = a.name || 'score';
          if (!(name in GLOBALS)) GLOBALS[name] = Number(a.initial) || 0;
          (GLOBAL_LISTENERS[name] ||= new Set()).add(emit);
          if (execKey === 'set') GLOBALS[name] = Number(pulse) || 0;
          else if (execKey === 'add') GLOBALS[name] += Number(pulse) || 0;
          GLOBAL_LISTENERS[name].forEach(fn => fn('value', GLOBALS[name]));
        } } },
      // Object Variable — same Set/Get/+ shape as Global, but scoped to the
      // current object (keyed by selfId+name) rather than shared game-wide,
      // per "unique to a specific object... accessed and updated by other
      // blocks in the same object".
      { fn: 'objectVariable', icon: '📦',
        execIn: [
          { key: 'set', label: 'Set', carriesValue: true },
          { key: 'get', label: 'Get', carriesValue: true },
          { key: 'add', label: '+', carriesValue: true }
        ],
        inputs: [T('name', 'Name', 'health'), N('initial', 'Initial', 100, { preset: true })],
        outputs: [VAL('value', 'Value')],
        sim: { pure: true, run: (node, a, emit, ctx, pulse, execKey) => {
          const key = `${(ctx && ctx.selfId) || 'unbound'}.${a.name || 'health'}`;
          if (!(key in OBJECT_VARS)) OBJECT_VARS[key] = Number(a.initial) || 0;
          (OBJECT_VAR_LISTENERS[key] ||= new Set()).add(emit);
          if (execKey === 'set') OBJECT_VARS[key] = Number(pulse) || 0;
          else if (execKey === 'add') OBJECT_VARS[key] += Number(pulse) || 0;
          OBJECT_VAR_LISTENERS[key].forEach(fn => fn('value', OBJECT_VARS[key]));
        } } },
      { fn: 'customBehavior', icon: '🧩', inputs: [T('name', 'Behavior Name', 'myBehavior')], outputs: [EXEC('onOut', 'Out')],
        sim: { run: (node, a, emit, ctx) => { ctx.toast(`Custom behavior "${a.name}" invoked (demo)`); emit('onOut', a.name); } } }
    ],
    'Components': [
      { fn: 'destroyer', icon: '💣', inputs: [], outputs: [EXEC('onDone', 'Done')],
        sim: { run: (node, a, emit, ctx) => emit('onDone', `destroyed ${selfLabel(ctx)} (demo)`) } },
      { fn: 'sound', icon: '🔊', inputs: [T('name', 'Sound Asset', 'jump.wav'), B('loop', 'Loop', false), N('volume', 'Volume', 100)], outputs: [EXEC('onDone', 'Played')],
        sim: { run: (node, a, emit) => emit('onDone', `♪ ${a.name} @ ${a.volume}% (demo, no audio backend)`) } },
      { fn: 'emit', icon: '💫', inputs: [OBJ('particle', 'Type to Emit'), N('rate', 'Rate', 10), N('seconds', 'Seconds', 1)], outputs: [EXEC('onDone', 'Done')],
        sim: { run: (node, a, emit, ctx) => emit('onDone', `${selfLabel(ctx)} emitting ${objLabel(a.particle)} @ ${a.rate}/s for ${a.seconds}s (demo)`) } },
      { fn: 'spawn', icon: '↗️', inputs: [OBJ('object', 'Type to Spawn'), N('x', 'X', 0), N('y', 'Y', 0)], outputs: [EXEC('onDone', 'Spawned')],
        sim: { run: (node, a, emit) => emit('onDone', `spawned ${objLabel(a.object)} @ (${a.x}, ${a.y}) (demo)`) } },
      { fn: 'attacher', icon: '🧷', inputs: [OBJ('object', 'Type to Attach')], outputs: [EXEC('onDone', 'Attached')],
        sim: { run: (node, a, emit, ctx) => emit('onDone', `attached ${objLabel(a.object)} to ${selfLabel(ctx)} (demo)`) } },
      { fn: 'physicsJoint', icon: '🔗', inputs: [OBJ('object', 'Type to Connect'), S('type', 'Type', ['pin', 'spring', 'rope'], 'pin')], outputs: [EXEC('onDone', 'Joined')],
        sim: { run: (node, a, emit, ctx) => emit('onDone', `${a.type} joint ${selfLabel(ctx)}↔${objLabel(a.object)} (demo)`) } },
      { fn: 'proximity', icon: '📶', inputs: [OBJ('object', 'Object Type/Name'), N('radius', 'Radius', 80)], outputs: [EXEC('near', 'Near'), EXEC('far', 'Far')],
        sim: { run: (node, a, emit, ctx) => emit('near', `${selfLabel(ctx)} within ${a.radius}px of ${objLabel(a.object)} (demo)`) } },
      { fn: 'pushMotor', icon: '🌀', inputs: [N('force', 'Force', 10), N('angle', 'Angle', 0)], outputs: [EXEC('onDone', 'Applied')],
        sim: { run: (node, a, emit, ctx) => emit('onDone', `pushed ${selfLabel(ctx)} force ${a.force} @ ${a.angle}° (demo)`) } },
      { fn: 'spinMotor', icon: '🎡', inputs: [N('torque', 'Torque', 10)], outputs: [EXEC('onDone', 'Applied')],
        sim: { run: (node, a, emit, ctx) => emit('onDone', `spun ${selfLabel(ctx)} torque ${a.torque} (demo)`) } },
      { fn: 'impulse', icon: '💢', inputs: [N('x', 'X', 0), N('y', 'Y', -10)], outputs: [EXEC('onDone', 'Applied')],
        sim: { run: (node, a, emit, ctx) => emit('onDone', `impulse on ${selfLabel(ctx)} (${a.x}, ${a.y}) (demo)`) } },
      { fn: 'pointAt', icon: '👉', inputs: [OBJ('target', 'Point At')], outputs: [EXEC('onDone', 'Pointed')],
        sim: { run: (node, a, emit, ctx) => emit('onDone', `${selfLabel(ctx)} now points at ${objLabel(a.target)} (demo)`) } },
      { fn: 'camera', icon: '🎥', inputs: [OBJ('target', 'Follow Target'), N('zoom', 'Zoom', 1)], outputs: [EXEC('onDone', 'Updated')],
        sim: { run: (node, a, emit) => emit('onDone', `camera follows ${objLabel(a.target)} @ ${a.zoom}x (demo)`) } },
      { fn: 'message', icon: '✉️', inputs: [T('text', 'Text', 'Hello'), N('duration', 'Duration (s)', 2)], outputs: [EXEC('onDone', 'Shown')],
        sim: { run: (node, a, emit, ctx) => { ctx.toast(a.text); emit('onDone', a.text); } } },
      { fn: 'rayCast', icon: '📡', inputs: [N('x1', 'X1', 0), N('y1', 'Y1', 0), N('x2', 'X2', 100), N('y2', 'Y2', 0)], outputs: [EXEC('hit', 'Hit'), EXEC('miss', 'Miss')],
        sim: { run: (node, a, emit) => emit('miss', `ray (${a.x1},${a.y1})→(${a.x2},${a.y2}) hit nothing (demo)`) } },
      { fn: 'calendar', icon: '📅', inputs: [], outputs: [VAL('value', 'Today')],
        sim: { pure: true, run: (node, a, emit) => emit('value', new Date().toDateString()) } },
      { fn: 'clock', icon: '🕐', inputs: [], outputs: [VAL('value', 'Time')],
        sim: { root: true, start: (node, emit) => { const tick = () => emit('value', new Date().toLocaleTimeString()); tick(); const iv = setInterval(tick, 1000); return () => clearInterval(iv); } } }
    ],
    'Properties': [
      { fn: 'position', icon: '📍', inputs: [N('x', 'X', 0), N('y', 'Y', 0)], outputs: [EXEC('onDone', 'Set')],
        sim: { run: (node, a, emit, ctx) => emit('onDone', `${selfLabel(ctx)}.position = (${a.x}, ${a.y}) (demo)`) } },
      { fn: 'rotation', icon: '🔄', inputs: [N('degrees', 'Degrees', 0)], outputs: [EXEC('onDone', 'Set')],
        sim: { run: (node, a, emit, ctx) => emit('onDone', `${selfLabel(ctx)}.rotation = ${a.degrees}° (demo)`) } },
      { fn: 'alpha', icon: '🌫️', inputs: [N('value', 'Alpha', 1)], outputs: [EXEC('onDone', 'Set')],
        sim: { run: (node, a, emit, ctx) => emit('onDone', `${selfLabel(ctx)}.alpha = ${a.value} (demo)`) } },
      { fn: 'size', icon: '📏', inputs: [N('width', 'Width', 32), N('height', 'Height', 32)], outputs: [EXEC('onDone', 'Set')],
        sim: { run: (node, a, emit, ctx) => emit('onDone', `${selfLabel(ctx)}.size = ${a.width}×${a.height} (demo)`) } },
      { fn: 'enabled', icon: '✅', inputs: [B('value', 'Enabled', true)], outputs: [EXEC('onDone', 'Set')],
        sim: { run: (node, a, emit, ctx) => emit('onDone', `${selfLabel(ctx)}.enabled = ${a.value} (demo)`) } },
      { fn: 'animation', icon: '🎞️', inputs: [T('name', 'Animation', 'idle')], outputs: [EXEC('onDone', 'Playing')],
        sim: { run: (node, a, emit, ctx) => emit('onDone', `${selfLabel(ctx)} playing "${a.name}" (demo)`) } },
      { fn: 'velocity', icon: '🏎️', inputs: [N('vx', 'VX', 0), N('vy', 'VY', 0)], outputs: [EXEC('onDone', 'Set')],
        sim: { run: (node, a, emit, ctx) => emit('onDone', `${selfLabel(ctx)}.velocity = (${a.vx}, ${a.vy}) (demo)`) } },
      { fn: 'spin', icon: '🌪️', inputs: [N('speed', 'Speed', 0)], outputs: [EXEC('onDone', 'Set')],
        sim: { run: (node, a, emit, ctx) => emit('onDone', `${selfLabel(ctx)}.spin = ${a.speed} (demo)`) } },
      { fn: 'material', icon: '🪵', inputs: [S('type', 'Type', ['default', 'bouncy', 'ice', 'sticky'], 'default')], outputs: [EXEC('onDone', 'Set')],
        sim: { run: (node, a, emit, ctx) => emit('onDone', `${selfLabel(ctx)}.material = ${a.type} (demo)`) } },
      { fn: 'flip', icon: '🔃', inputs: [B('horizontal', 'Flip X', false), B('vertical', 'Flip Y', false)], outputs: [EXEC('onDone', 'Set')],
        sim: { run: (node, a, emit, ctx) => emit('onDone', `${selfLabel(ctx)}.flip = (${a.horizontal}, ${a.vertical}) (demo)`) } },
      { fn: 'extractor', icon: '🔎', inputs: [OBJ('object', 'Target Object'), T('propertyPath', 'Property', 'x')], outputs: [VAL('value', 'Value')],
        sim: { pure: true, run: (node, a, emit, ctx) => {
          // No object picked (None) means "the current object", per the docs.
          const targetId = a.object || (ctx && ctx.selfId) || '';
          const obj = FAKE_OBJECTS[a.object] || FAKE_OBJECTS[objectDisplayName(targetId)] || (findSceneObject(targetId) ? { x: 0, y: 0, rotation: 0 } : {});
          const v = String(a.propertyPath).split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
          emit('value', v ?? 'undefined');
        } } },
      { fn: 'displayOrder', icon: '🗂️', inputs: [N('order', 'Order', 0)], outputs: [EXEC('onDone', 'Set')],
        sim: { run: (node, a, emit, ctx) => emit('onDone', `${selfLabel(ctx)}.displayOrder = ${a.order} (demo)`) } },
      { fn: 'shader', icon: '🎨', inputs: [S('type', 'Type', ['none', 'blur', 'glow', 'grayscale'], 'none')], outputs: [EXEC('onDone', 'Set')],
        sim: { run: (node, a, emit, ctx) => emit('onDone', `${selfLabel(ctx)}.shader = ${a.type} (demo)`) } },
      { fn: 'blending', icon: '🌈', inputs: [S('mode', 'Mode', ['normal', 'add', 'multiply', 'screen'], 'normal')], outputs: [EXEC('onDone', 'Set')],
        sim: { run: (node, a, emit, ctx) => emit('onDone', `${selfLabel(ctx)}.blending = ${a.mode} (demo)`) } },
      { fn: 'colors', icon: '🟣', inputs: [T('hex', 'Hex Color', '#ffffff')], outputs: [EXEC('onDone', 'Set')],
        sim: { run: (node, a, emit, ctx) => emit('onDone', `${selfLabel(ctx)}.color = ${a.hex} (demo)`) } }
    ],
    'Text & Lists': [
      { fn: 'text', icon: '🔤', inputs: [T('initial', 'Initial', 'hello')], outputs: [VAL('value', 'Value')], sim: { pure: true, run: (node, a, emit) => emit('value', a.initial) } },
      { fn: 'textCase', icon: 'Aa', inputs: [T('value', 'Value', 'Hello'), S('mode', 'Mode', ['upper', 'lower', 'upperFirst'], 'upper')], outputs: [VAL('value', 'Value')],
        sim: { pure: true, run: (node, a, emit) => { const v = String(a.value); emit('value', a.mode === 'upper' ? v.toUpperCase() : a.mode === 'lower' ? v.toLowerCase() : v.charAt(0).toUpperCase() + v.slice(1)); } } },
      { fn: 'textLength', icon: '📏', inputs: [T('value', 'Value', 'Hello')], outputs: [VAL('value', 'Value')], sim: { pure: true, run: (node, a, emit) => emit('value', String(a.value).length) } },
      { fn: 'toNumber', icon: '🔢', inputs: [T('value', 'Value', '42px')], outputs: [VAL('value', 'Value')],
        sim: { pure: true, run: (node, a, emit) => { const m = /-?\d+(\.\d+)?/.exec(String(a.value)); emit('value', m ? parseFloat(m[0]) : NaN); } } },
      { fn: 'textCompare', icon: '⚖️', inputs: [T('a', 'A', 'cat'), T('b', 'B', 'dog'), S('mode', 'Mode', ['equals', 'aContainsB', 'bContainsA', 'aStartsWithB', 'bStartsWithA'], 'equals')], outputs: [EXEC('yes', 'Yes'), EXEC('no', 'No')],
        sim: { run: (node, a, emit) => {
          const table = { equals: a.a === a.b, aContainsB: a.a.includes(a.b), bContainsA: a.b.includes(a.a), aStartsWithB: a.a.startsWith(a.b), bStartsWithA: a.b.startsWith(a.a) };
          emit(table[a.mode] ? 'yes' : 'no', a.b);
        } } },
      { fn: 'textSanitize', icon: '🧹', inputs: [T('value', 'Value', 'Hello!')], outputs: [EXEC('good', 'Good'), EXEC('bad', 'Bad')],
        sim: { run: (node, a, emit) => emit(/^[\x20-\x7E]*$/.test(a.value) ? 'good' : 'bad', a.value) } },
      { fn: 'textList', icon: '📋', inputs: [T('initial', 'Initial (CSV)', 'a,b,c')], outputs: [VAL('value', 'Value')], sim: { pure: true, run: (node, a, emit) => emit('value', a.initial) } },
      { fn: 'numberList', icon: '🔢', inputs: [T('initial', 'Initial (CSV)', '1,2,3')], outputs: [VAL('value', 'Value')], sim: { pure: true, run: (node, a, emit) => emit('value', a.initial) } },
      { fn: 'listModify', icon: '✂️', inputs: [T('items', 'Items (CSV)', '1,2,3'), S('mode', 'Mode', ['insert', 'remove', 'replace'], 'insert'), N('index', 'Index', 1), T('value', 'Value', '9')], outputs: [VAL('value', 'Value')],
        sim: { pure: true, run: (node, a, emit) => {
          const out = String(a.items).split(',').map(s => s.trim()).filter(Boolean);
          const i = Math.max(0, a.index - 1);
          if (a.mode === 'insert') out.splice(i, 0, a.value); else if (a.mode === 'remove') out.splice(i, 1); else out[i] = a.value;
          emit('value', out.join(','));
        } } },
      { fn: 'listOrder', icon: '🔃', inputs: [T('items', 'Items (CSV)', '3,1,2'), S('mode', 'Mode', ['sort', 'reverse', 'shuffle'], 'sort')], outputs: [VAL('value', 'Value')],
        sim: { pure: true, run: (node, a, emit) => {
          let out = String(a.items).split(',').map(s => s.trim()).filter(Boolean);
          if (a.mode === 'sort') out = [...out].sort((x, y) => (parseFloat(x) - parseFloat(y)) || x.localeCompare(y));
          else if (a.mode === 'reverse') out = [...out].reverse();
          else out = [...out].sort(() => Math.random() - 0.5);
          emit('value', out.join(','));
        } } },
      { fn: 'listEach', icon: '🧾', inputs: [T('items', 'Items (CSV)', 'a,b,c'), N('delayMs', 'Delay (ms)', 300)], outputs: [EXEC('onIndex', 'Index'), EXEC('onOut', 'Item'), EXEC('onDone', 'Done')],
        sim: { run: (node, a, emit, ctx) => {
          const items = String(a.items).split(',').map(s => s.trim()).filter(Boolean);
          let i = 0;
          const step = () => {
            if (!ctx.running() || i >= items.length) { if (ctx.running()) emit('onDone', items.length); return; }
            i += 1; emit('onIndex', i); emit('onOut', items[i - 1]);
            const h = setTimeout(step, Math.max(0, a.delayMs));
            ctx.own(() => clearTimeout(h));
          };
          step();
        } } },
      { fn: 'listCount', icon: '🔟', inputs: [T('items', 'Items (CSV)', 'a,b,c')], outputs: [VAL('value', 'Value')], sim: { pure: true, run: (node, a, emit) => emit('value', String(a.items).split(',').map(s => s.trim()).filter(Boolean).length) } }
    ],
    'GUI': [
      { fn: 'alert', icon: '🔔', inputs: [T('title', 'Title', 'Heads up'), T('message', 'Message', 'Something happened'), T('buttonLabel', 'Button', 'OK')], outputs: [EXEC('onClick', 'Clicked')],
        sim: { run: (node, a, emit, ctx) => { ctx.toast(`${a.title}: ${a.message}`); const h = setTimeout(() => emit('onClick', 1), 700); ctx.own(() => clearTimeout(h)); } }, gui: 'alert' },
      { fn: 'bar', icon: '📊', inputs: [N('initial', 'Initial', 50), N('max', 'Max', 100)], outputs: [VAL('value', 'Fraction')], sim: { pure: true, run: (node, a, emit) => emit('value', Number((Math.min(a.initial, a.max) / (a.max || 1)).toFixed(2))) }, gui: 'bar' },
      { fn: 'label', icon: '🏷️', inputs: [T('initial', 'Text', 'Score: 0')], outputs: [VAL('value', 'Value')], sim: { pure: true, run: (node, a, emit) => emit('value', a.initial) }, gui: 'label' },
      { fn: 'cursor', icon: '↖️', inputs: [S('mode', 'Mode', ['default', 'hidden', 'custom'], 'default')], outputs: [EXEC('onDone', 'Set')],
        sim: { run: (node, a, emit) => emit('onDone', `cursor mode = ${a.mode} (demo)`) }, gui: 'cursor' }
    ],
    'Game Flow': [
      { fn: 'pauseGame', icon: '⏸️', inputs: [B('initialPaused', 'Initially Paused', false)], outputs: [VAL('value', 'Paused?')],
        sim: { pure: true, run: (node, a, emit) => emit('value', a.initialPaused ? 'paused' : 'running') } },
      { fn: 'loadLevel', icon: '🚪', inputs: [S('mode', 'Mode', ['next', 'restart', 'useInput'], 'next'), T('explicitTarget', 'Target', '')], outputs: [EXEC('onDone', 'Done')],
        sim: { run: (node, a, emit, ctx) => { ctx.toast(`Load level: ${a.mode}${a.explicitTarget ? ' → ' + a.explicitTarget : ''}`); emit('onDone', a.mode); } } },
      { fn: 'restartGame', icon: '🔄', inputs: [], outputs: [EXEC('onDone', 'Done')], sim: { run: (node, a, emit, ctx) => { ctx.toast('Game restarted (demo)'); emit('onDone', 1); } } },
      { fn: 'fetchURL', icon: '🔗', inputs: [T('url', 'URL', 'https://example.com/api'), S('method', 'Method', ['GET', 'POST'], 'GET')], outputs: [EXEC('onSuccess', 'Success'), EXEC('onError', 'Error')],
        sim: { run: (node, a, emit) => emit('onSuccess', `${a.method} ${a.url} (demo, not actually fetched)`) } },
      { fn: 'saveValue', icon: '💾', inputs: [T('key', 'Key', 'highscore'), T('value', 'Value', '0')], outputs: [EXEC('onDone', 'Saved')],
        sim: { run: (node, a, emit) => emit('onDone', `saved "${a.key}" = "${a.value}" (demo)`) } },
      { fn: 'leaderboard', icon: '🏆', inputs: [T('name', 'Board', 'global'), N('score', 'Score', 0)], outputs: [EXEC('onDone', 'Submitted')],
        sim: { run: (node, a, emit) => emit('onDone', `submitted ${a.score} to "${a.name}" (demo)`) } },
      { fn: 'achievement', icon: '⭐', inputs: [T('id', 'Achievement ID', 'first_win')], outputs: [EXEC('onDone', 'Unlocked')],
        sim: { run: (node, a, emit) => emit('onDone', `unlocked "${a.id}" (demo)`) } },
      { fn: 'levelPhysics', icon: '🍎', inputs: [N('gravity', 'Gravity', 9.8), B('enabled', 'Enabled', true)], outputs: [EXEC('onDone', 'Set')],
        sim: { run: (node, a, emit) => emit('onDone', `gravity = ${a.gravity}, enabled = ${a.enabled} (demo)`) } },
      { fn: 'userInfo', icon: '🧑', inputs: [], outputs: [VAL('value', 'Name')], sim: { pure: true, run: (node, a, emit) => emit('value', 'Player1 (demo)') } },
      { fn: 'clipboard', icon: '📋', inputs: [T('text', 'Text', 'Copied!')], outputs: [EXEC('onDone', 'Copied')],
        sim: { run: (node, a, emit) => emit('onDone', `copied "${a.text}" to clipboard (demo)`) } },
      { fn: 'fullScreen', icon: '🖥️', inputs: [B('enabled', 'Enabled', true)], outputs: [EXEC('onDone', 'Set')],
        sim: { run: (node, a, emit, ctx) => { try { if (a.enabled && ctx.stage.requestFullscreen) ctx.stage.requestFullscreen(); else if (!a.enabled && document.exitFullscreen) document.exitFullscreen(); } catch { /* ignore */ } emit('onDone', a.enabled); } } },
      { fn: 'cloud', icon: '☁️', inputs: [T('key', 'Key', 'progress'), T('value', 'Value', '')], outputs: [EXEC('onDone', 'Synced')],
        sim: { run: (node, a, emit) => emit('onDone', `cloud-synced "${a.key}" (demo)`) } },
      { fn: 'gameSave', icon: '💠', inputs: [T('slot', 'Slot', 'slot1')], outputs: [EXEC('onDone', 'Saved')],
        sim: { run: (node, a, emit) => emit('onDone', `game saved to "${a.slot}" (demo)`) } }
    ],
    'Mobile Device': [
      { fn: 'ad', icon: '📺', inputs: [S('position', 'Position', ['top', 'bottom'], 'bottom'), B('testMode', 'Test Mode', true)], outputs: [EXEC('out', 'Shown')],
        sim: { run: (node, a, emit) => emit('out', `ad shown (${a.position}, demo)`) } },
      { fn: 'accelerometer', icon: '📐', inputs: [], outputs: [VAL('value', 'x, y, z')],
        sim: { root: true, start: (node, emit) => {
          if (!window.DeviceOrientationEvent) { emit('value', '0, 0, 0 (unsupported)'); return () => {}; }
          const h = e => emit('value', `${(e.beta || 0).toFixed(1)}, ${(e.gamma || 0).toFixed(1)}, ${(e.alpha || 0).toFixed(1)}`);
          window.addEventListener('deviceorientation', h);
          return () => window.removeEventListener('deviceorientation', h);
        } } },
      { fn: 'vibrate', icon: '📳', inputs: [N('ms', 'Duration (ms)', 200)], outputs: [EXEC('onDone', 'Done')],
        sim: { run: (node, a, emit) => { if (navigator.vibrate) navigator.vibrate(a.ms); emit('onDone', a.ms); } } },
      { fn: 'iosGameCenter', icon: '🎮', inputs: [S('action', 'Action', ['authenticate', 'showLeaderboard', 'showAchievements'], 'authenticate')], outputs: [EXEC('onDone', 'Done')],
        sim: { run: (node, a, emit) => emit('onDone', `GameCenter.${a.action} (demo)`) } },
      { fn: 'deviceCheck', icon: '📱', inputs: [], outputs: [VAL('value', 'Platform')],
        sim: { pure: true, run: (node, a, emit) => emit('value', /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop') } },
      { fn: 'touchCheck', icon: '👆', inputs: [], outputs: [VAL('value', 'Touch?')],
        sim: { pure: true, run: (node, a, emit) => emit('value', ('ontouchstart' in window) ? 'yes' : 'no') } },
      { fn: 'exitGame', icon: '❌', inputs: [], outputs: [EXEC('onDone', 'Done')],
        sim: { run: (node, a, emit, ctx) => { ctx.toast('Exit game (demo — no-op in browser)'); emit('onDone', 1); } } }
    ],
    'Multiplayer': [
      { fn: 'shared', icon: '🔁', inputs: [T('name', 'Name', 'score'), N('initial', 'Initial', 0)], outputs: [VAL('value', 'Value')],
        sim: { pure: true, run: (node, a, emit) => { const key = `shared.${a.name}`; if (!(key in GLOBALS)) GLOBALS[key] = a.initial; emit('value', GLOBALS[key]); } } },
      { fn: 'playerCount', icon: '👥', inputs: [], outputs: [VAL('value', 'Count')], sim: { pure: true, run: (node, a, emit) => emit('value', 1) } },
      { fn: 'playerCheck', icon: '🧍', inputs: [S('type', 'Type', ['isHost', 'isLocal', 'isRemote'], 'isHost')], outputs: [EXEC('yes', 'Yes'), EXEC('no', 'No')],
        sim: { run: (node, a, emit) => emit(a.type === 'isHost' ? 'yes' : 'no', a.type) } }
    ]
  };

  const BLOCK_INDEX = {};
  Object.entries(CATALOG).forEach(([cat, blocks]) => blocks.forEach(b => { BLOCK_INDEX[b.fn] = { ...b, category: cat }; }));
  const defFor = fn => BLOCK_INDEX[fn];

  // A block's `outputs` is normally a fixed array, but Router's port count
  // ("Available Routes", 1-32) is a per-node property — so `outputs` can
  // instead be a function of that node's current input values, and this
  // helper is what every consumer (rendering, codegen, error handling)
  // should call instead of touching `def.outputs` directly.
  function outputsFor(def, node) {
    return typeof def.outputs === 'function' ? def.outputs(node ? node.inputValues : {}) : def.outputs;
  }
  // Mirror of outputsFor for `inputs` — Expression's variable pins (A-F)
  // depend on its own "Inputs" (1-6) property, so `inputs` can likewise be
  // a function of the node's current input values instead of a fixed list.
  function inputsFor(def, node) {
    return typeof def.inputs === 'function' ? def.inputs(node ? node.inputValues : {}) : def.inputs;
  }
  // Clamp "Available Routes" into the 1-32 range the docs describe, no
  // matter what's currently typed into the property field.
  function routeCountFor(rawInputValues) {
    const n = Math.floor(Number(rawInputValues && rawInputValues.routeCount));
    return Math.min(32, Math.max(1, Number.isFinite(n) ? n : 1));
  }
  // Clamp Expression's "Inputs" (variable count) into the 1-6 range the
  // docs describe (A is always required, B-F fill in as count increases).
  function exprVarCountFor(rawInputValues) {
    const n = Math.floor(Number(rawInputValues && rawInputValues.count));
    return Math.min(6, Math.max(1, Number.isFinite(n) ? n : 2));
  }
  const EXPR_VAR_NAMES = ['A', 'B', 'C', 'D', 'E', 'F'];

  // ===========================================================================
  // Behavior Bundles — a handful of pre-wired node groups you can drop onto
  // the canvas in one click, plus a "New Bundle" action that snapshots the
  // current canvas into a reusable custom bundle for this session.
  // ===========================================================================

  const BUNDLE_PRESETS = [
    { name: 'Run & Jump', icon: '🏃',
      nodes: [
        { fn: 'keyboard', dx: 0, dy: 0, values: { key: 'ArrowRight' } },
        { fn: 'velocity', dx: 260, dy: 0, values: { vx: 120, vy: 0 } },
        { fn: 'keyboard', dx: 0, dy: 140, values: { key: 'Space' } },
        { fn: 'impulse', dx: 260, dy: 140, values: { x: 0, y: -240 } }
      ],
      wires: [{ from: 0, out: 'down', to: 1, in: '__exec' }, { from: 2, out: 'down', to: 3, in: '__exec' }] },
    { name: 'Dangerous', icon: '☠️',
      nodes: [
        { fn: 'collision', dx: 0, dy: 0, values: { object: 'hazard' } },
        { fn: 'destroyer', dx: 260, dy: 0, values: {} }
      ],
      wires: [{ from: 0, out: 'hit', to: 1, in: '__exec' }] },
    { name: 'Ship Controls', icon: '🚀',
      nodes: [
        { fn: 'keyboard', dx: 0, dy: 0, values: { key: 'ArrowUp' } },
        { fn: 'pushMotor', dx: 260, dy: 0, values: { force: 20, angle: 0 } },
        { fn: 'keyboard', dx: 0, dy: 140, values: { key: 'ArrowLeft' } },
        { fn: 'spinMotor', dx: 260, dy: 140, values: { torque: -10 } },
        { fn: 'keyboard', dx: 0, dy: 280, values: { key: 'ArrowRight' } },
        { fn: 'spinMotor', dx: 260, dy: 280, values: { torque: 10 } }
      ],
      wires: [{ from: 0, out: 'down', to: 1, in: '__exec' }, { from: 2, out: 'down', to: 3, in: '__exec' }, { from: 4, out: 'down', to: 5, in: '__exec' }] }
  ];
  const customBundles = []; // { name, icon, nodes, wires } captured via "New Bundle"

  function insertBundle(bundle) {
    const baseX = canvasWrap.scrollLeft + 60 + (idSeq % 4) * 26;
    const baseY = canvasWrap.scrollTop + 40 + (idSeq % 6) * 24;
    const idMap = [];
    bundle.nodes.forEach(spec => {
      const def = defFor(spec.fn);
      if (!def) return;
      const node = addNode(spec.fn, baseX + spec.dx, baseY + spec.dy);
      if (node && spec.values) Object.entries(spec.values).forEach(([k, v]) => { if (k in node.inputValues) node.inputValues[k] = v; });
      idMap.push(node ? node.id : null);
    });
    (bundle.wires || []).forEach(w => {
      const fromId = idMap[w.from], toId = idMap[w.to];
      if (!fromId || !toId) return;
      workspace.connections.push({ id: `c${idSeq++}`, from: { node: fromId, key: w.out }, to: { node: toId, key: w.in } });
    });
    renderNodes(); redrawWires(); updatePreviewCode();
    toast(`Added "${bundle.name}" bundle (${bundle.nodes.length} blocks)`);
  }

  function captureBundleFromCanvas(name) {
    if (!workspace.nodes.length) return null;
    const minX = Math.min(...workspace.nodes.map(n => n.x));
    const minY = Math.min(...workspace.nodes.map(n => n.y));
    const idIndex = new Map(workspace.nodes.map((n, i) => [n.id, i]));
    const nodes = workspace.nodes.map(n => ({ fn: n.fn, dx: n.x - minX, dy: n.y - minY, values: { ...n.inputValues } }));
    const wires = workspace.connections
      .filter(c => idIndex.has(c.from.node) && idIndex.has(c.to.node))
      .map(c => ({ from: idIndex.get(c.from.node), out: c.from.key, to: idIndex.get(c.to.node), in: c.to.key }));
    return { name, icon: '🧩', nodes, wires };
  }

  // ===========================================================================
  // Workspace state
  // ===========================================================================

  const workspace = { nodes: [], connections: [] };
  let idSeq = 0;
  let selectedNodeId = null;
  let collapsed = new Set(["Triggers", "Logic & Math", "Components","Properties","Text & Lists","GUI","Game Flow","Mobile Device","Multiplayer"]);
  let dragNode = null;      // { id, offsetX, offsetY }
  let dragWire = null;      // { fromNode, fromKey, kind: 'exec'|'value', x, y }
  let testRunning = false;
  let testCtx = null;
  let activeCleanups = [];

  function nodeById(id) { return workspace.nodes.find(n => n.id === id); }

  // ===========================================================================
  // Markup
  // ===========================================================================

  mount.innerHTML = `
    <div class="forge-tool fbe">
      <aside class="forge-tool__rail fbe-sidebar" style="width:230px">
        <div class="fbe-sidebar-search"><span>⌕</span><input id="fbeSearch" placeholder="Search blocks…"></div>
        <div id="fbeCatalog"></div>
      </aside>
      <div class="forge-tool__main">
        <div class="forge-tool__toolbar">
          <input id="blkFnName" placeholder="functionName" value="myFunction" style="width:160px">
          <button id="blkCombine">🧩 Combine into Function</button>
          <button id="blkClear">Clear</button>
          <span class="fbe-toolbar-sep"></span>
          <button id="blkPlay" class="fbe-play">▶ Test Mode</button>
          <span class="muted" style="margin-left:auto" id="fbeHint">Drag blocks onto the canvas, then drag from a pin to wire nodes together.</span>
        </div>
        <div class="fbe-canvas-wrap" id="fbeCanvasWrap">
          <div class="fbe-canvas" id="fbeCanvas">
            <svg class="fbe-wires" id="fbeWires"></svg>
            <div id="fbeNodes"></div>
          </div>
        </div>
        <div class="fbe-bottom">
          <div class="fbe-bottom-tabs">
            <button class="active" data-btab="code">Generated Code</button>
            <button data-btab="test">▶ Test Console</button>
          </div>
          <div class="fbe-bottom-body">
            <div class="fbe-bpanel active" data-bpanel="code">
              <pre id="blkPreview" style="white-space:pre-wrap;margin:0;font-family:'SFMono-Regular',Consolas,monospace;font-size:11.5px;color:#c7cad0"></pre>
            </div>
            <div class="fbe-bpanel" data-bpanel="test">
              <div class="fbe-test-grid">
                <div class="fbe-stage-wrap">
                  <div class="fbe-stage" id="fbeStage" tabindex="0">
                    <span class="fbe-stage-hint">Click here, then use your keyboard / mouse<br>to drive Keyboard &amp; Mouse Click blocks</span>
                    <span class="fbe-stage-flash" id="fbeStageFlash"></span>
                    <div class="fbe-gui-layer" id="fbeGuiLayer"></div>
                  </div>
                  <div class="muted" style="margin-top:6px" id="fbeStatus">Press ▶ Test Mode to run the graph live.</div>
                  <div class="muted" style="margin-top:2px" id="fbeGuiHint"></div>
                </div>
                <div class="fbe-watch">
                  <h4>Live Output Values</h4>
                  <div class="fbe-watch-list" id="fbeWatchList"><span class="muted">Nothing has run yet.</span></div>
                </div>
                <div class="fbe-eventlog">
                  <h4>Event Log</h4>
                  <div class="fbe-log-list" id="fbeLog"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  const canvasWrap = mount.querySelector('#fbeCanvasWrap');
  const canvas = mount.querySelector('#fbeCanvas');
  const svg = mount.querySelector('#fbeWires');
  const nodesLayer = mount.querySelector('#fbeNodes');
  const preview = mount.querySelector('#blkPreview');
  const catalogEl = mount.querySelector('#fbeCatalog');
  const watchList = mount.querySelector('#fbeWatchList');
  const logList = mount.querySelector('#fbeLog');
  const stage = mount.querySelector('#fbeStage');
  const stageFlash = mount.querySelector('#fbeStageFlash');
  const guiLayer = mount.querySelector('#fbeGuiLayer');
  const guiHint = mount.querySelector('#fbeGuiHint');
  const statusEl = mount.querySelector('#fbeStatus');
  const playBtn = mount.querySelector('#blkPlay');

  // ===========================================================================
  // Sidebar — collapsible categories with icons + styled list rows
  // ===========================================================================

  function renderSidebar(filter = '') {
    const f = filter.trim().toLowerCase();
    const bundleMeta = CATEGORY_META['Behavior Bundles'];
    const allBundles = [...BUNDLE_PRESETS, ...customBundles];
    const bundleItems = allBundles.filter(bd => !f || bd.name.toLowerCase().includes(f) || 'behavior bundles'.includes(f));
    const bundlesCollapsed = collapsed.has('Behavior Bundles');
    const bundlesHtml = (!f || bundleItems.length || 'behavior bundles'.includes(f)) ? `
        <div class="fbe-cat" data-cat="Behavior Bundles">
          <button class="fbe-cat-head" data-cat-toggle="Behavior Bundles" style="--cat-color:${bundleMeta.color}">
            <span class="fbe-cat-icon">${bundleMeta.icon}</span>
            <span class="fbe-cat-label">Behavior Bundles</span>
            <span class="fbe-cat-count">${bundleItems.length}</span>
            <span class="fbe-cat-chevron${bundlesCollapsed ? ' is-collapsed' : ''}">⌄</span>
          </button>
          <div class="fbe-cat-body${bundlesCollapsed ? ' is-collapsed' : ''}">
            <div class="fbe-item" data-bundle-action="new" style="--cat-color:${bundleMeta.color}">
              <span class="fbe-item-icon">➕</span>
              <span class="fbe-item-label">New Bundle</span>
            </div>
            <div class="fbe-item" data-bundle-action="more" style="--cat-color:${bundleMeta.color}">
              <span class="fbe-item-icon">🔍</span>
              <span class="fbe-item-label">More Bundles</span>
            </div>
            ${bundleItems.map((bd, i) => `
              <div class="fbe-item" data-bundle-insert="${escapeHtml(bd.name)}" title="Drop ${bd.nodes.length} wired blocks onto the canvas" style="--cat-color:${bundleMeta.color}">
                <span class="fbe-item-icon">${bd.icon || '🧩'}</span>
                <span class="fbe-item-label">${escapeHtml(bd.name)}</span>
                <span class="fbe-item-add">＋</span>
              </div>`).join('')}
          </div>
        </div>` : '';

    const catsHtml = Object.entries(CATALOG).map(([cat, blocks]) => {
      const meta = CATEGORY_META[cat] || { icon: '◆', color: '#888' };
      const items = blocks.filter(b => !f || b.fn.toLowerCase().includes(f) || cat.toLowerCase().includes(f));
      if (!items.length) return '';
      const isCollapsed = collapsed.has(cat);
      return `
        <div class="fbe-cat" data-cat="${escapeHtml(cat)}">
          <button class="fbe-cat-head" data-cat-toggle="${escapeHtml(cat)}" style="--cat-color:${meta.color}">
            <span class="fbe-cat-icon">${meta.icon}</span>
            <span class="fbe-cat-label">${escapeHtml(cat)}</span>
            <span class="fbe-cat-count">${items.length}</span>
            <span class="fbe-cat-chevron${isCollapsed ? ' is-collapsed' : ''}">⌄</span>
          </button>
          <div class="fbe-cat-body${isCollapsed ? ' is-collapsed' : ''}">
            ${items.map(b => `
              <div class="fbe-item" draggable="true" data-fn="${b.fn}" title="Behaviors.${b.fn}(${inputsFor(b, null).map(i => i.key).join(', ')})" style="--cat-color:${meta.color}">
                <span class="fbe-item-icon">${b.icon || '◆'}</span>
                <span class="fbe-item-label">${b.fn}</span>
                <span class="fbe-item-add">＋</span>
              </div>`).join('')}
          </div>
        </div>`;
    }).join('');

    catalogEl.innerHTML = (catsHtml + bundlesHtml) || '<div class="muted" style="padding:10px">No blocks match "' + escapeHtml(filter) + '"</div>';

    catalogEl.querySelectorAll('[data-cat-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = btn.dataset.catToggle;
        collapsed.has(cat) ? collapsed.delete(cat) : collapsed.add(cat);
        renderSidebar(mount.querySelector('#fbeSearch').value);
      });
    });
    catalogEl.querySelectorAll('.fbe-item[data-fn]').forEach(item => {
      item.addEventListener('click', () => addNodeNearView(item.dataset.fn));
      item.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', JSON.stringify({ fn: item.dataset.fn })));
    });
    catalogEl.querySelectorAll('[data-bundle-insert]').forEach(item => {
      const bundle = allBundles.find(bd => bd.name === item.dataset.bundleInsert);
      if (!bundle) return;
      item.addEventListener('click', () => insertBundle(bundle));
    });
    const newBtn = catalogEl.querySelector('[data-bundle-action="new"]');
    if (newBtn) newBtn.addEventListener('click', () => {
      if (!workspace.nodes.length) { toast('Add some blocks to the canvas first, then save them as a bundle'); return; }
      const name = window.prompt('Name this bundle:', 'My Bundle');
      if (!name) return;
      const bundle = captureBundleFromCanvas(name.trim() || 'My Bundle');
      if (bundle) { customBundles.push(bundle); toast(`Saved "${bundle.name}" as a Behavior Bundle`); renderSidebar(mount.querySelector('#fbeSearch').value); }
    });
    const moreBtn = catalogEl.querySelector('[data-bundle-action="more"]');
    if (moreBtn) moreBtn.addEventListener('click', () => toast('Browse community bundles — coming soon'));
  }

  mount.querySelector('#fbeSearch').addEventListener('input', e => renderSidebar(e.target.value));

  // ===========================================================================
  // Node CRUD
  // ===========================================================================

  function addNode(fn, x, y) {
    const def = defFor(fn);
    if (!def) return null;
    const inputValues = {};
    inputsFor(def, { inputValues }).forEach(inp => { inputValues[inp.key] = inp.default; });
    const node = { id: `n${idSeq++}`, fn, x, y, inputValues, outputsLive: {} };
    workspace.nodes.push(node);
    renderNodes();
    redrawWires();
    if (def.sim.pure) previewNode(node);
    updatePreviewCode();
    if (testRunning && def.gui) buildGuiOverlay();
    return node;
  }

  function addNodeNearView(fn) {
    const x = canvasWrap.scrollLeft + 60 + (idSeq % 4) * 26;
    const y = canvasWrap.scrollTop + 40 + (idSeq % 6) * 24;
    addNode(fn, x, y);
  }

  function deleteNode(id) {
    workspace.nodes = workspace.nodes.filter(n => n.id !== id);
    workspace.connections = workspace.connections.filter(c => c.from.node !== id && c.to.node !== id);
    if (selectedNodeId === id) selectedNodeId = null;
    renderNodes(); redrawWires(); updatePreviewCode();
    if (testRunning) buildGuiOverlay();
  }

  // A structural property change (Router's "Available Routes", Expression's
  // "Inputs") can make pins that had wires on them disappear — e.g.
  // shrinking Available Routes from 5 to 2 removes out3-out5. Drop any
  // connection that no longer points at a pin the node actually has, so
  // Test Mode and codegen don't try to reach a wire hanging off thin air.
  function pruneStaleConnections() {
    const before = workspace.connections.length;
    workspace.connections = workspace.connections.filter(c => {
      const fromNode = nodeById(c.from.node), toNode = nodeById(c.to.node);
      if (!fromNode || !toNode) return false;
      const fromDef = defFor(fromNode.fn), toDef = defFor(toNode.fn);
      if (!fromDef || !toDef) return false;
      const fromOk = outputsFor(fromDef, fromNode).some(o => o.key === c.from.key);
      // `preset` inputs (Number's Initial/Round, ...) have no wire pin at
      // all, so a wire that still targets one is stale and gets dropped.
      const toOk = execKeysFor(toNode.fn, toNode).includes(c.to.key) || inputsFor(toDef, toNode).some(i => i.key === c.to.key && !i.preset);
      return fromOk && toOk;
    });
    return workspace.connections.length !== before;
  }

  mount.querySelector('#blkClear').addEventListener('click', () => {
    if (workspace.nodes.length && !window.confirm('Clear all blocks?')) return;
    workspace.nodes = []; workspace.connections = []; selectedNodeId = null;
    renderNodes(); redrawWires(); updatePreviewCode();
  });

  function blocksPanelVisible() {
    const overlay = document.getElementById('toolModalOverlay');
    return !!overlay && overlay.classList.contains('show') && mount.classList.contains('active');
  }

  document.addEventListener('keydown', e => {
    if (!mount.isConnected || !blocksPanelVisible()) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA')) return;
      if (selectedNodeId) deleteNode(selectedNodeId);
    }
  });

  // Drag-drop from sidebar onto canvas
  canvas.addEventListener('dragover', e => { e.preventDefault(); canvas.classList.add('drag-over'); });
  canvas.addEventListener('dragleave', () => canvas.classList.remove('drag-over'));
  canvas.addEventListener('drop', e => {
    e.preventDefault(); canvas.classList.remove('drag-over');
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      const rect = canvas.getBoundingClientRect();
      addNode(data.fn, e.clientX - rect.left, e.clientY - rect.top);
    } catch { /* ignore non-block drops */ }
  });

  // ===========================================================================
  // Node rendering
  // ===========================================================================

  function fieldControl(node, inp) {
    const val = node.inputValues[inp.key];
    const wired = workspace.connections.some(c => c.to.node === node.id && c.to.key === inp.key);
    if (wired) return `<span class="fbe-wired-tag">● wired</span>`;
    if (inp.type === 'bool') return `<input type="checkbox" data-input-key="${inp.key}" ${val ? 'checked' : ''}>`;
    if (inp.type === 'select') return `<select data-input-key="${inp.key}">${inp.options.map(o => `<option value="${escapeHtml(o)}" ${o === val ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select>`;
    if (inp.type === 'object') {
      const objs = getSceneObjects();
      const options = [`<option value=""${val ? '' : ' selected'}>None</option>`]
        .concat(objs.map(o => `<option value="${escapeHtml(o.id)}"${o.id === val ? ' selected' : ''}>${escapeHtml(o.name || o.id)}</option>`));
      return `<select data-input-key="${inp.key}" class="fbe-object-select">${options.join('')}</select>`;
    }
    if (inp.type === 'number') return `<input type="number" data-input-key="${inp.key}" value="${escapeHtml(val)}" step="any">`;
    return `<input type="text" data-input-key="${inp.key}" value="${escapeHtml(val)}">`;
  }

  function renderNodes() {
    nodesLayer.innerHTML = workspace.nodes.map(node => {
      const def = defFor(node.fn);
      const meta = CATEGORY_META[def.category] || { icon: '◆', color: '#888' };
      // Real per-block exec-in pins (see getExecIns): a plain block gets one
      // generic "▶ Run" pin, a block like Timer that the docs describe as
      // having several distinct activatable inputs (Start, Reset, ...) gets
      // one pin per input, and a spontaneous root trigger (Once, Always,
      // Keyboard, Mailbox, ...) gets none at all — it fires on its own when
      // the game runs, so there's nothing to wire into it. That last case is
      // called out explicitly in the node so it's clear it's intentional
      // rather than a missing pin.
      const execIns = getExecIns(def, node);
      return `
      <div class="fbe-node ${selectedNodeId === node.id ? 'is-selected' : ''}" data-id="${node.id}" style="left:${node.x}px;top:${node.y}px;--cat-color:${meta.color}">
        <div class="fbe-node-head">
          <span class="fbe-node-icon">${def.icon || meta.icon}</span>
          <span class="fbe-node-title">${def.fn}</span>
          <span class="fbe-node-cat">${escapeHtml(def.category)}</span>
          <button class="fbe-node-close" data-close="${node.id}" title="Delete">×</button>
        </div>
        <div class="fbe-node-body">
          <div class="fbe-io-in">
            ${execIns.length ? execIns.map(p => `
            <div class="fbe-pinrow fbe-pinrow--exec">
              <span class="fbe-pin ${p.carriesValue ? 'fbe-pin--value' : 'fbe-pin--exec'}" data-node="${node.id}" data-io="in" data-key="${p.key}" data-kind="exec" ${p.carriesValue ? 'data-carries="1"' : ''}></span>
              <span class="fbe-pin-label">▶ ${escapeHtml(p.label)}</span>
            </div>`).join('') : `
            <div class="fbe-pinrow muted" style="padding:4px 6px;font-size:11px;font-style:italic">⚡ Runs automatically on Play</div>`}
            ${inputsFor(def, node).map(inp => `
            <div class="fbe-pinrow">
              ${inp.preset ? '<span class="fbe-pin-spacer"></span>' : `<span class="fbe-pin fbe-pin--value" data-node="${node.id}" data-io="in" data-key="${inp.key}"></span>`}
              <span class="fbe-pin-label">${escapeHtml(inp.label)}</span>
              ${fieldControl(node, inp)}
            </div>`).join('')}
          </div>
          <div class="fbe-io-out">
            ${outputsFor(def, node).map(out => `
            <div class="fbe-pinrow fbe-pinrow--out">
              <span class="fbe-pin-label">${escapeHtml(out.label)}</span>
              <span class="fbe-badge" data-badge="${node.id}:${out.key}">${node.outputsLive[out.key] ? formatVal(node.outputsLive[out.key].value) : '—'}</span>
              <span class="fbe-pin fbe-pin--right ${out.type === 'exec' ? 'fbe-pin--exec' : 'fbe-pin--value'}" data-node="${node.id}" data-io="out" data-key="${out.key}"></span>
            </div>`).join('') || '<div class="muted" style="padding:4px 6px">no outputs</div>'}
          </div>
        </div>
      </div>`;
    }).join('') || '<div class="fbe-empty muted">Empty canvas — drag or click blocks from the left to add nodes, then drag from a pin to wire them together.</div>';
  }

  function formatVal(v) {
    if (v === undefined) return 'undefined';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3);
    return String(v);
  }

  // Node selection / drag / literal edits / delete — delegated on nodesLayer
  nodesLayer.addEventListener('pointerdown', e => {
    const closeBtn = e.target.closest('[data-close]');
    if (closeBtn) { deleteNode(closeBtn.dataset.close); return; }
    if (e.target.closest('.fbe-pin')) return; // handled by pin listeners below
    const head = e.target.closest('.fbe-node-head');
    const nodeEl = e.target.closest('.fbe-node');
    if (!nodeEl) return;
    selectedNodeId = nodeEl.dataset.id;
    nodesLayer.querySelectorAll('.fbe-node').forEach(n => n.classList.toggle('is-selected', n.dataset.id === selectedNodeId));
    if (!head) return;
    const node = nodeById(selectedNodeId);
    const rect = canvas.getBoundingClientRect();
    dragNode = { id: node.id, offsetX: e.clientX - rect.left - node.x, offsetY: e.clientY - rect.top - node.y };
    e.preventDefault();
  });

  nodesLayer.addEventListener('input', e => {
    const input = e.target.closest('[data-input-key]');
    if (!input) return;
    const nodeEl = e.target.closest('.fbe-node');
    const node = nodeById(nodeEl.dataset.id);
    const def = defFor(node.fn);
    const inp = inputsFor(def, node).find(i => i.key === input.dataset.inputKey);
    node.inputValues[inp.key] = inp.type === 'bool' ? input.checked : input.value;
    updatePreviewCode();
    if (def.sim.pure) { previewNode(node); propagatePreview(node.id); }
    // `structural` properties (Router's "Available Routes", Expression's
    // "Inputs") change how many pins the node has — backfill defaults for
    // any newly-appeared pins, drop wires into/out of pins that no longer
    // exist, and redraw so the node actually shows the new pin count.
    if (inp.structural) {
      inputsFor(def, node).forEach(i => { if (!(i.key in node.inputValues)) node.inputValues[i.key] = i.default; });
      pruneStaleConnections();
      renderNodes();
      redrawWires();
    }
  });

  canvas.addEventListener('pointerdown', e => { if (e.target === canvas || e.target === svg) { selectedNodeId = null; nodesLayer.querySelectorAll('.fbe-node').forEach(n => n.classList.remove('is-selected')); } });

  window.addEventListener('pointermove', e => {
    if (!dragNode) return;
    const node = nodeById(dragNode.id);
    if (!node) return;
    const rect = canvas.getBoundingClientRect();
    node.x = Math.max(0, e.clientX - rect.left - dragNode.offsetX);
    node.y = Math.max(0, e.clientY - rect.top - dragNode.offsetY);
    const el = nodesLayer.querySelector(`.fbe-node[data-id="${node.id}"]`);
    if (el) { el.style.left = node.x + 'px'; el.style.top = node.y + 'px'; }
    redrawWires();
  });
  window.addEventListener('pointerup', () => { dragNode = null; });

  // ===========================================================================
  // Wiring (connectors)
  // ===========================================================================

  function pinEl(nodeId, io, key) {
    return nodesLayer.querySelector(`.fbe-pin[data-node="${CSS.escape(nodeId)}"][data-io="${io}"][data-key="${CSS.escape(key)}"]`);
  }
  function pinPos(nodeId, io, key) {
    const el = pinEl(nodeId, io, key);
    if (!el) return null;
    const er = el.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
    return { x: er.left - cr.left + er.width / 2 + canvas.scrollLeft, y: er.top - cr.top + er.height / 2 + canvas.scrollTop };
  }

  function bezier(p1, p2) {
    const dx = Math.max(40, Math.abs(p2.x - p1.x) * 0.5);
    return `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`;
  }

  function redrawWires() {
    canvas.style.width = Math.max(1600, ...workspace.nodes.map(n => n.x + 320)) + 'px';
    canvas.style.height = Math.max(900, ...workspace.nodes.map(n => n.y + 220)) + 'px';
    svg.setAttribute('width', canvas.style.width);
    svg.setAttribute('height', canvas.style.height);
    let html = '';
    workspace.connections.forEach(c => {
      const p1 = pinPos(c.from.node, 'out', c.from.key), p2 = pinPos(c.to.node, 'in', c.to.key);
      if (!p1 || !p2) return;
      // Color by what the *source* pin actually is, not just whether the
      // target key happens to be an exec-in. A value output (e.g. Random's
      // Value) wired into a carriesValue exec-in (e.g. Number's +) is
      // genuinely carrying data, so it should read as a value wire even
      // though it also triggers execution.
      const fromNode = nodeById(c.from.node);
      const fromDef = fromNode && defFor(fromNode.fn);
      const fromOut = fromDef && outputsFor(fromDef, fromNode).find(o => o.key === c.from.key);
      const isExec = fromOut ? fromOut.type === 'exec' : false;
      html += `<path class="fbe-wire ${isExec ? 'fbe-wire--exec' : 'fbe-wire--value'}" data-conn="${c.id}" d="${bezier(p1, p2)}"></path>`;
    });
    if (dragWire) {
      const p1 = pinPos(dragWire.fromNode, 'out', dragWire.fromKey);
      if (p1) html += `<path class="fbe-wire fbe-wire--ghost ${dragWire.kind === 'exec' ? 'fbe-wire--exec' : 'fbe-wire--value'}" d="${bezier(p1, dragWire)}"></path>`;
    }
    svg.innerHTML = html;
    svg.querySelectorAll('[data-conn]').forEach(path => {
      path.addEventListener('click', () => {
        workspace.connections = workspace.connections.filter(c => c.id !== path.dataset.conn);
        renderNodes(); redrawWires(); updatePreviewCode();
      });
    });
  }

  nodesLayer.addEventListener('pointerdown', e => {
    const pin = e.target.closest('.fbe-pin');
    if (!pin || pin.dataset.io !== 'out') return;
    e.preventDefault(); e.stopPropagation();
    const kind = pin.classList.contains('fbe-pin--exec') ? 'exec' : 'value';
    const p1 = pinPos(pin.dataset.node, 'out', pin.dataset.key);
    dragWire = { fromNode: pin.dataset.node, fromKey: pin.dataset.key, kind, x: p1.x, y: p1.y };
    redrawWires();
  });

  window.addEventListener('pointermove', e => {
    if (!dragWire) return;
    const rect = canvas.getBoundingClientRect();
    dragWire.x = e.clientX - rect.left + canvas.scrollLeft;
    dragWire.y = e.clientY - rect.top + canvas.scrollTop;
    redrawWires();
  });

  window.addEventListener('pointerup', e => {
    if (!dragWire) return;
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const pin = target && target.closest && target.closest('.fbe-pin');
    if (pin && pin.dataset.io === 'in' && pin.dataset.node !== dragWire.fromNode) {
      // Exec-in pins are functionally identified by data-kind (set on every
      // exec-in span, regardless of how it's styled), not by the diamond
      // CSS class — some exec-in pins (Number/Global/Object Variable's
      // Set/Get/+) are deliberately styled as plain blue circles
      // (data-carries="1") because the value that would otherwise need its
      // own "Amount" property rides along on the same wire that triggers
      // them. Those pins accept both an exec wire (trigger only, no value)
      // and a value wire (trigger + the wired value as `pulse`).
      const isExecTarget = pin.dataset.kind === 'exec';
      const carriesValue = pin.dataset.carries === '1';
      const kindOk = (dragWire.kind === 'exec' && isExecTarget) || (dragWire.kind === 'value' && (!isExecTarget || carriesValue));
      if (kindOk) {
        workspace.connections = workspace.connections.filter(c => !(c.to.node === pin.dataset.node && c.to.key === pin.dataset.key));
        workspace.connections.push({ id: `c${idSeq++}`, from: { node: dragWire.fromNode, key: dragWire.fromKey }, to: { node: pin.dataset.node, key: pin.dataset.key } });
        renderNodes();
        if (defFor(nodeById(pin.dataset.node).fn).sim.pure) { previewNode(nodeById(pin.dataset.node)); propagatePreview(pin.dataset.node); }
        updatePreviewCode();
      } else {
        toast(dragWire.kind === 'exec' ? 'Exec pins only connect to another block\'s ▶ Run pin' : 'Value pins only connect to a data input pin');
      }
    }
    dragWire = null;
    redrawWires();
  });

  // ===========================================================================
  // Live preview for pure (side-effect-free) nodes — updates while editing,
  // independent of Test Mode, so value blocks always show what they return.
  // ===========================================================================

  function resolveArgs(node) {
    const def = defFor(node.fn);
    const args = {};
    inputsFor(def, node).forEach(inp => {
      const wire = workspace.connections.find(c => c.to.node === node.id && c.to.key === inp.key);
      if (wire) {
        const src = nodeById(wire.from.node);
        args[inp.key] = src && src.outputsLive[wire.from.key] ? src.outputsLive[wire.from.key].value : inp.default;
      } else {
        args[inp.key] = castValue(inp, node.inputValues[inp.key]);
      }
    });
    return args;
  }

  function castValue(inp, raw) {
    if (inp.type === 'number') { const n = parseFloat(raw); return Number.isNaN(n) ? (inp.default ?? 0) : n; }
    if (inp.type === 'bool') return raw === true || raw === 'true';
    if (inp.type === 'select') return raw || inp.default;
    if (inp.type === 'object') return raw || inp.default || '';
    return raw ?? inp.default ?? '';
  }

  function setBadge(nodeId, key, value) {
    const node = nodeById(nodeId);
    if (node) node.outputsLive[key] = { value, t: performance.now() };
    const badge = nodesLayer.querySelector(`[data-badge="${CSS.escape(nodeId)}:${CSS.escape(key)}"]`);
    if (badge) { badge.textContent = formatVal(value); badge.classList.remove('fbe-flash'); void badge.offsetWidth; badge.classList.add('fbe-flash'); }
    const pinOut = pinEl(nodeId, 'out', key);
    if (pinOut) { pinOut.classList.remove('fbe-flash'); void pinOut.offsetWidth; pinOut.classList.add('fbe-flash'); }
    if (testRunning) updateWatchRow(nodeId, key, value);
    updateGuiOverlayValue(nodeId, key, value);
  }

  // ===========================================================================
  // GUI overlay — Bar / Alert / Label / Cursor blocks render as real, movable,
  // editable elements on top of the Test Mode stage (not just log rows) while
  // their block exists on the canvas and Test Mode is running.
  // ===========================================================================

  const guiState = new Map(); // nodeId -> overlay element

  function guiDefaultPos(index) {
    return { x: 12 + (index % 3) * 96, y: 12 + Math.floor(index / 3) * 50 };
  }

  function makeGuiElementDraggable(el, node) {
    let drag = null;
    el.addEventListener('pointerdown', e => {
      if (e.target.closest('[data-gui-nodrag]')) return;
      const r = guiLayer.getBoundingClientRect();
      drag = { offsetX: e.clientX - r.left - node.guiX, offsetY: e.clientY - r.top - node.guiY };
      el.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });
    el.addEventListener('pointermove', e => {
      if (!drag) return;
      const r = guiLayer.getBoundingClientRect();
      node.guiX = Math.max(0, Math.min(Math.max(0, r.width - el.offsetWidth), e.clientX - r.left - drag.offsetX));
      node.guiY = Math.max(0, Math.min(Math.max(0, r.height - el.offsetHeight), e.clientY - r.top - drag.offsetY));
      el.style.left = node.guiX + 'px'; el.style.top = node.guiY + 'px';
    });
    el.addEventListener('pointerup', () => { drag = null; });
  }

  function buildGuiOverlay() {
    guiLayer.innerHTML = '';
    guiState.clear();
    stage.style.cursor = '';
    const guiNodes = workspace.nodes.filter(n => defFor(n.fn) && defFor(n.fn).gui);
    guiHint.textContent = guiNodes.length ? 'GUI blocks are live on the stage above — drag to reposition, double-click text to edit it.' : '';
    guiNodes.forEach((node, i) => {
      const def = defFor(node.fn);
      const args = resolveArgs(node);
      if (node.guiX === undefined) { const p = guiDefaultPos(i); node.guiX = p.x; node.guiY = p.y; }
      const el = document.createElement('div');
      el.className = `fbe-gui-el fbe-gui-el--${def.gui}`;
      el.style.left = node.guiX + 'px'; el.style.top = node.guiY + 'px';
      if (def.gui === 'label') {
        el.innerHTML = `<span class="fbe-gui-text" contenteditable="true" data-gui-nodrag>${escapeHtml(String(args.initial ?? ''))}</span>`;
        el.querySelector('[contenteditable]').addEventListener('blur', e => {
          node.inputValues.initial = e.target.textContent;
          updatePreviewCode();
          if (def.sim.pure) previewNode(node);
        });
      } else if (def.gui === 'bar') {
        const frac = Math.min(1, Math.max(0, (args.initial || 0) / (args.max || 1)));
        el.innerHTML = `<div class="fbe-gui-bar-track" data-gui-nodrag><div class="fbe-gui-bar-fill" style="width:${Math.round(frac * 100)}%"></div></div>`;
        el.querySelector('.fbe-gui-bar-track').addEventListener('click', e => {
          const rect = e.currentTarget.getBoundingClientRect();
          const frac2 = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
          node.inputValues.initial = Math.round(frac2 * (args.max || 100));
          updatePreviewCode();
          if (def.sim.pure) previewNode(node);
          buildGuiOverlay();
        });
      } else if (def.gui === 'alert') {
        el.innerHTML = `
          <div class="fbe-gui-alert-title" contenteditable="true" data-gui-nodrag>${escapeHtml(String(args.title ?? ''))}</div>
          <div class="fbe-gui-alert-msg" contenteditable="true" data-gui-nodrag>${escapeHtml(String(args.message ?? ''))}</div>
          <button class="fbe-gui-alert-btn" data-gui-nodrag>${escapeHtml(String(args.buttonLabel ?? 'OK'))}</button>`;
        el.querySelector('.fbe-gui-alert-title').addEventListener('blur', e => { node.inputValues.title = e.target.textContent; updatePreviewCode(); });
        el.querySelector('.fbe-gui-alert-msg').addEventListener('blur', e => { node.inputValues.message = e.target.textContent; updatePreviewCode(); });
        el.querySelector('.fbe-gui-alert-btn').addEventListener('click', () => { if (testRunning) makeEmit(node, true)('onClick', 1); });
      } else if (def.gui === 'cursor') {
        el.innerHTML = `<span class="fbe-gui-cursor-tag" data-gui-nodrag>↖ cursor: ${escapeHtml(String(args.mode ?? 'default'))}</span>`;
        if (args.mode === 'hidden') stage.style.cursor = 'none';
      }
      guiLayer.appendChild(el);
      makeGuiElementDraggable(el, node);
      guiState.set(node.id, el);
    });
  }

  function teardownGuiOverlay() {
    guiLayer.innerHTML = '';
    guiState.clear();
    guiHint.textContent = '';
    stage.style.cursor = '';
  }

  function updateGuiOverlayValue(nodeId, key, value) {
    const node = nodeById(nodeId);
    if (!node) return;
    const def = defFor(node.fn);
    if (!def || !def.gui) return;
    const el = guiState.get(nodeId);
    if (!el) return;
    if (def.gui === 'label' && key === 'value') {
      const span = el.querySelector('.fbe-gui-text');
      if (span && document.activeElement !== span) span.textContent = String(value);
    } else if (def.gui === 'bar' && key === 'value') {
      const fill = el.querySelector('.fbe-gui-bar-fill');
      if (fill) fill.style.width = Math.round(Math.min(1, Math.max(0, value)) * 100) + '%';
    } else if (def.gui === 'alert') {
      el.classList.remove('fbe-flash'); void el.offsetWidth; el.classList.add('fbe-flash');
    }
  }

  // Live edit-time preview doesn't actually "run" the graph like Test Mode
  // does — it just recomputes a pure node's output from its current wiring
  // so the badges shown while building match reality. For most pure blocks
  // that's simply resolveArgs() over ordinary data-input pins. But blocks
  // like Number/Global/Object Variable only produce a value in response to
  // one of their exec-in pins (Set/Get/+) firing — this finds whichever of
  // those pins is actually wired to something with a live value and treats
  // it as the pulse that would trigger the preview, so wiring e.g. Random's
  // Value straight into Number's + shows a real, updating number instead of
  // a dead 0. If more than one exec-in pin happens to be wired, the first
  // one wins — Test Mode (which fires pins for real, in order) is the
  // source of truth for actual execution order, this is just a preview.
  function previewPulseFor(node) {
    const execKeys = execKeysFor(node.fn, node);
    for (const key of execKeys) {
      const wire = workspace.connections.find(c => c.to.node === node.id && c.to.key === key);
      if (!wire) continue;
      const src = nodeById(wire.from.node);
      const live = src && src.outputsLive[wire.from.key];
      if (live) return { pulse: live.value, execKey: key };
    }
    return {};
  }

  function previewNode(node, pulse, execKey) {
    const def = defFor(node.fn);
    if (!def.sim.run) return;
    const args = resolveArgs(node);
    if (pulse === undefined && execKey === undefined) ({ pulse, execKey } = previewPulseFor(node));
    try { def.sim.run(node, args, (key, value) => setBadge(node.id, key, value), undefined, pulse, execKey); }
    catch (err) { outputsFor(def, node).forEach(o => setBadge(node.id, o.key, `Error: ${err.message}`)); }
  }

  // Cascades a pure node's freshly-computed output(s) to whatever's wired
  // downstream. A connection landing on a plain data-input pin just feeds
  // that property as before; one landing on an exec-in pin (Number's
  // Set/Get/+, Expression's A-F, ...) is previewed as a pulse carrying the
  // source's current value, mirroring what a real exec pulse does at
  // runtime.
  function propagatePreview(nodeId) {
    const node = nodeById(nodeId);
    if (!node) return;
    workspace.connections.filter(c => c.from.node === nodeId).forEach(c => {
      const target = nodeById(c.to.node);
      if (!target || !defFor(target.fn).sim.pure) return;
      const live = node.outputsLive[c.from.key];
      const isExecTarget = execKeysFor(target.fn, target).includes(c.to.key);
      previewNode(target, isExecTarget ? live?.value : undefined, isExecTarget ? c.to.key : undefined);
      propagatePreview(target.id);
    });
  }

  // ===========================================================================
  // Code generation — reflects the visual graph structure. Exec-out pins
  // become handler callbacks that hold the wired downstream calls; value
  // pins become a captured const, referenced by anything wired to it.
  // ===========================================================================

  function literalJs(inp, raw) {
    const v = castValue(inp, raw);
    if (inp.type === 'number' || inp.type === 'bool') return JSON.stringify(v);
    return JSON.stringify(String(v));
  }

  function generateCode() {
    const fnName = (mount.querySelector('#blkFnName').value.trim() || 'myFunction').replace(/[^A-Za-z0-9_$]/g, '') || 'myFunction';
    const visited = new Set();
    // Handle-style blocks (Number/Global/Object Variable) get constructed
    // once via Behaviors.<fn>(...) but then reused across every Set/Get/+
    // call — declaredHandles tracks that separately from `visited`, since
    // (unlike a plain block) each exec-in firing is a distinct, meaningful
    // call rather than a duplicate to skip.
    const declaredHandles = new Set();

    function varName(node, key) { return `v_${node.id}_${key.replace(/[^A-Za-z0-9_]/g, '')}`; }

    function argExpr(node, inp) {
      const wire = workspace.connections.find(c => c.to.node === node.id && c.to.key === inp.key);
      if (wire) return varName({ id: wire.from.node }, wire.from.key) + ` /* from ${nodeById(wire.from.node)?.fn}.${wire.from.key} */`;
      return literalJs(inp, node.inputValues[inp.key]);
    }

    // Every exec-out pin's connections, paired with the JS expression (if
    // any) that should ride along as that call's argument — a `value`-type
    // source pin passes its captured const through, an `exec`-type source
    // pin (a plain trigger with nothing meaningful attached) passes nothing.
    function downstreamCalls(node, def, fromKey, indent, depth) {
      const fromOut = outputsFor(def, node).find(o => o.key === fromKey);
      const pulseExpr = fromOut && fromOut.type === 'value' ? varName(node, fromKey) : undefined;
      const conns = workspace.connections.filter(c => { const tn = nodeById(c.to.node); return c.from.node === node.id && c.from.key === fromKey && tn && execKeysFor(tn.fn, tn).includes(c.to.key); });
      return conns.map(c => renderNode(nodeById(c.to.node), indent, c.to.key, pulseExpr, depth + 1)).join('');
    }

    function renderNode(node, indent, execKey, pulseExpr, depth = 0) {
      const def = defFor(node.fn);
      if (depth > 48) return `${indent}// (stopped — graph too deep or cyclic)\n`;
      const nodeInputs = inputsFor(def, node);
      const optsObj = nodeInputs.length ? `{ ${nodeInputs.map(inp => `${inp.key}: ${argExpr(node, inp)}`).join(', ')} }` : '';

      if (def.codegenHandle) {
        // Set/Get/+ over a stored value: the real API (utils/src/behaviors.js)
        // returns a handle object with .set(v)/.get()/.add(v) methods, so
        // unlike a plain block this isn't "one call" — it's one shared
        // handle plus a method call per exec-in pin that's actually fired,
        // each with whatever value rode in on that pulse.
        const handle = varName(node, '__handle');
        let out = '';
        if (!declaredHandles.has(node.id)) {
          declaredHandles.add(node.id);
          out += `${indent}const ${handle} = Behaviors.${node.fn}(${optsObj}); // Set/Get/+ handle, shared across calls below\n`;
        }
        const key = execKey || 'get';
        const arg = pulseExpr ?? '0 /* nothing wired in — defaults to 0 */';
        // Set/Get/+ all return the resulting value (see utils/src/behaviors.js
        // — .set(), .get(), and .add() each `return value`), so every one of
        // them captures a const and cascades to whatever's wired downstream.
        out += key === 'set' ? `${indent}const ${varName(node, 'value')} = ${handle}.set(${arg});\n`
          : key === 'add' ? `${indent}const ${varName(node, 'value')} = ${handle}.add(${arg});\n`
          : `${indent}const ${varName(node, 'value')} = ${handle}.get();\n`;
        return out + downstreamCalls(node, def, 'value', indent, depth);
      }

      if (visited.has(node.id)) return `${indent}// Behaviors.${node.fn} ("${node.id}") already invoked above\n`;
      visited.add(node.id);
      const nodeOutputs = outputsFor(def, node);
      if (!nodeOutputs.length) {
        return `${indent}Behaviors.${node.fn}(${optsObj});\n`;
      }
      const execOutputs = nodeOutputs.filter(o => o.type === 'exec');
      if (!execOutputs.length) {
        // Pure/value block: capture the result, keep going at the same indent.
        const line = `${indent}const ${varName(node, nodeOutputs[0].key)} = Behaviors.${node.fn}(${optsObj});\n`;
        return line + downstreamCalls(node, def, nodeOutputs[0].key, indent, depth);
      }
      const handlers = execOutputs.map(o => {
        const body = downstreamCalls(node, def, o.key, indent + '    ', depth) || `${indent}    // (nothing wired to ${o.key})\n`;
        return `${indent}  ${o.key}: (${varName(node, o.key)}) => {\n${body}${indent}  }`;
      }).join(',\n');
      return `${indent}Behaviors.${node.fn}(${optsObj ? optsObj + ', ' : ''}{\n${handlers}\n${indent}});\n`;
    }

    const roots = workspace.nodes.filter(n => !workspace.connections.some(c => c.to.node === n.id && execKeysFor(n.fn, n).includes(c.to.key)));
    const body = roots.map(n => renderNode(n, '  ')).join('') || '  // add blocks and wire them together to build a sequence\n';
    return `"use strict";\n\n// Generated by ForgeEngine's visual node editor — combines Behaviors blocks\n// (utils/src/behaviors.js) following the wiring you built on the canvas.\n// Exec pins (▶) become nested handler callbacks; value pins become captured\n// consts. This is a starting scaffold — adjust argument shapes to taste.\nconst { Behaviors } = require("@ForgeEngine/utils");\n\nfunction ${fnName}() {\n${body}}\n\nmodule.exports = { ${fnName} };\n`;
  }

  // Syntax-highlight the Generated Code tab with the vendored highlight.js
  // build (assets/js/vendor/highlight/highlight.min.js, loaded before this
  // script — see editor.html). hljs.highlight() escapes the source itself,
  // so this is safe even though generateCode() splices in node names/ids.
  // Falls back to plain text if the vendor script somehow didn't load.
  function updatePreviewCode() {
    const code = generateCode();
    if (window.hljs && typeof window.hljs.highlight === 'function') {
      preview.innerHTML = window.hljs.highlight(code, { language: 'javascript', ignoreIllegals: true }).value;
      preview.classList.add('hljs');
    } else {
      preview.textContent = code;
    }
  }

  mount.querySelector('#blkFnName').addEventListener('input', updatePreviewCode);

  mount.querySelector('#blkCombine').addEventListener('click', async () => {
    if (!state.slug) return;
    if (!workspace.nodes.length) { toast('Add at least one block first'); return; }
    const fnName = mount.querySelector('#blkFnName').value.trim() || 'myFunction';
    try {
      await api(`/api/games/${encodeURIComponent(state.slug)}/assets`, {
        method: 'POST',
        body: JSON.stringify({ name: fnName, category: 'script', code: generateCode() })
      });
      toast(`Saved function "${fnName}" as a script asset`);
      log('info', `Block editor: combined ${workspace.nodes.length} node(s) into "${fnName}"`);
      window.__forgeLoadAssets?.();
    } catch (error) { toast(error.message); }
  });

  // ===========================================================================
  // Test / Game Mode — actually runs the graph in the browser: trigger blocks
  // fire for real (timers, keyboard, mouse), pulses cascade along exec wires,
  // and every output pin shows the live value it just returned.
  // ===========================================================================

  function makeBus() {
    const map = new Map();
    return {
      on(name, fn) { if (!map.has(name)) map.set(name, new Set()); map.get(name).add(fn); },
      off(name, fn) { map.get(name)?.delete(fn); },
      emit(name, val) { map.get(name)?.forEach(fn => fn(val)); }
    };
  }

  function logEvent(node, key, value) {
    const def = defFor(node.fn);
    const meta = CATEGORY_META[def.category] || { color: '#888' };
    const row = document.createElement('div');
    row.className = 'fbe-log-row';
    row.innerHTML = `<span class="fbe-log-dot" style="background:${meta.color}"></span><span class="fbe-log-time">${new Date().toLocaleTimeString()}</span><span class="fbe-log-msg"><strong>${escapeHtml(def.icon || '')} ${escapeHtml(node.fn)}</strong>.${escapeHtml(key)} → <code>${escapeHtml(formatVal(value))}</code></span>`;
    logList.appendChild(row);
    logList.scrollTop = logList.scrollHeight;
    while (logList.children.length > 250) logList.removeChild(logList.firstChild);
  }

  function updateWatchRow(nodeId, key, value) {
    const node = nodeById(nodeId);
    if (!node) return;
    const def = defFor(node.fn);
    const id = `watch-${nodeId}-${key}`;
    let row = watchList.querySelector(`#${CSS.escape(id)}`);
    if (!row) {
      if (watchList.querySelector('.muted')) watchList.innerHTML = '';
      row = document.createElement('div');
      row.className = 'fbe-watch-row';
      row.id = id;
      row.innerHTML = `<span class="fbe-watch-name">${escapeHtml(def.icon || '')} ${escapeHtml(node.fn)}.${escapeHtml(key)}</span><span class="fbe-watch-val"></span>`;
      watchList.appendChild(row);
    }
    row.querySelector('.fbe-watch-val').textContent = formatVal(value);
    row.classList.remove('fbe-flash'); void row.offsetWidth; row.classList.add('fbe-flash');
  }

  function makeEmit(node, cascade, depth = 0) {
    return (key, value) => {
      setBadge(node.id, key, value);
      if (!cascade) return;
      logEvent(node, key, value);
      if (depth > 48) return; // guard against runaway/cyclic graphs
      workspace.connections
        .filter(c => { const tn = nodeById(c.to.node); return c.from.node === node.id && c.from.key === key && execKeysFor(tn?.fn, tn).includes(c.to.key); })
        .forEach(c => { const target = nodeById(c.to.node); if (target) runTestNode(target, value, depth + 1, c.to.key); });
    };
  }

  // `execKey` identifies *which* of the target block's exec-in pins fired
  // (e.g. Timer's 'start' vs 'reset') so sim.run can branch on it — it
  // defaults to '__exec' for the plain single-pin case.
  function runTestNode(node, pulse, depth = 0, execKey = '__exec') {
    const def = defFor(node.fn);
    if (!def.sim.run) return;
    const args = resolveArgs(node);
    const emit = makeEmit(node, true, depth);
    try { def.sim.run(node, args, emit, testCtx, pulse, execKey); }
    catch (err) { outputsFor(def, node).forEach(o => emit(o.key, `Error: ${err.message}`)); }
  }

  function buildCtx() {
    // selfId is captured once per Test Mode run: whichever object is selected
    // in the Scene panel *right now* is "the object this graph is placed in".
    // Every block that acts on "this object" (Position, Destroyer, Push
    // Motor, ...) resolves against selfId — never against some other object —
    // so a test run only ever affects that one object.
    const selfId = state.selectedId || null;
    return {
      bus: makeBus(),
      toast: msg => toast(msg),
      stage,
      running: () => testRunning,
      own: cleanupFn => activeCleanups.push(cleanupFn),
      args: node => resolveArgs(node),
      selfId
    };
  }

  function startTest() {
    if (testRunning) return;
    testRunning = true;
    testCtx = buildCtx();
    logList.innerHTML = '';
    watchList.innerHTML = '<span class="muted">Nothing has run yet.</span>';
    workspace.nodes.forEach(n => { n.outputsLive = {}; delete n.__t; delete n.__i; delete n.__routerIndex; delete n.__timerStop; delete n.__timerCount; delete n.__numValue; delete n.__exprVars; });
    playBtn.textContent = '■ Stop';
    playBtn.classList.add('is-live');
    statusEl.textContent = testCtx.selfId
      ? `Running — scoped to ${selfLabel(testCtx)}. Trigger blocks are live. Click the stage to focus it for keyboard/mouse blocks.`
      : 'Running — no object selected in the Scene panel, so blocks acting on "this object" have no target. Select an object and re-run to scope them. Click the stage to focus it for keyboard/mouse blocks.';
    mount.querySelectorAll('[data-btab]').forEach(b => b.classList.toggle('active', b.dataset.btab === 'test'));
    mount.querySelectorAll('.fbe-bpanel').forEach(p => p.classList.toggle('active', p.dataset.bpanel === 'test'));
    nodesLayer.classList.add('is-live');
    buildGuiOverlay();

    workspace.nodes.forEach(node => {
      const def = defFor(node.fn);
      if (!def.sim.root) return;
      const emit = makeEmit(node, true, 0);
      const cleanup = def.sim.start(node, emit, testCtx);
      if (typeof cleanup === 'function') activeCleanups.push(cleanup);
    });
    // Non-root, non-pure blocks (Collision, Sound, Position, Filter, ...)
    // are NOT spontaneous — per the docs they only "run when reached by an
    // incoming exec pulse". Auto-firing them here just because nothing
    // happened to be wired into their Run pin made every unconnected block
    // fire once on Play/window-load, defeating the whole point of the Run
    // pin. Two kinds of block are the exception, and still get seeded once
    // at start if their Run pin is unwired:
    //   - `sim.pure` value providers (Number, Random, Expression, ...): no
    //     side effects, and other nodes read their value output directly
    //     rather than via an exec pulse, so they need seeding to have a
    //     value at all.
    //   - Timer, when its own "Auto Start" property is on: matches "if
    //     nothing is connected to the start input, the timer will begin
    //     running automatically" from the docs.
    workspace.nodes.forEach(node => {
      const def = defFor(node.fn);
      if (def.sim.root) return;
      const isPure = def.sim.pure;
      const isAutoStartTimer = node.fn === 'timer' && resolveArgs(node).autoStart;
      if (!isPure && !isAutoStartTimer) return;
      const hasIncomingExec = workspace.connections.some(c => c.to.node === node.id && execKeysFor(node.fn, node).includes(c.to.key));
      if (!hasIncomingExec) runTestNode(node, 1, 0, isAutoStartTimer ? 'start' : '__exec');
    });
  }

  function stopTest() {
    if (!testRunning) return;
    testRunning = false;
    activeCleanups.forEach(fn => { try { fn(); } catch { /* ignore */ } });
    activeCleanups = [];
    testCtx = null;
    playBtn.textContent = '▶ Test Mode';
    playBtn.classList.remove('is-live');
    statusEl.textContent = 'Stopped. Press ▶ Test Mode to run the graph again.';
    nodesLayer.classList.remove('is-live');
    teardownGuiOverlay();
  }

  playBtn.addEventListener('click', () => (testRunning ? stopTest() : startTest()));

  stage.addEventListener('click', () => {
    stage.focus();
    stageFlash.classList.remove('fbe-flash'); void stageFlash.offsetWidth; stageFlash.classList.add('fbe-flash');
  });
  stage.addEventListener('keydown', e => { statusEl.textContent = `Key "${e.key}" pressed on stage.`; });

  mount.querySelectorAll('[data-btab]').forEach(btn => {
    btn.addEventListener('click', () => {
      mount.querySelectorAll('[data-btab]').forEach(b => b.classList.toggle('active', b === btn));
      mount.querySelectorAll('.fbe-bpanel').forEach(p => p.classList.toggle('active', p.dataset.bpanel === btn.dataset.btab));
    });
  });

  // Stop the live simulation if the tool modal is closed, so timers don't leak.
  document.getElementById('toolModalClose')?.addEventListener('click', stopTest);
  document.getElementById('toolModalOverlay')?.addEventListener('click', e => { if (e.target.id === 'toolModalOverlay') stopTest(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && testRunning) stopTest(); });

  // ===========================================================================
  // Init
  // ===========================================================================

  renderSidebar();
  renderNodes();
  redrawWires();
  updatePreviewCode();
  window.addEventListener('resize', redrawWires);
})();