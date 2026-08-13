'use strict';

/**
 * Behaviors — a Flowlab-style block library, implemented on top of the
 * lower-level primitives already in utils/src (math.js, data.js, events.js,
 * io.js, sound.js, dom.js). Nothing in here reinvents math, randomness,
 * input handling, text/list plumbing, etc. from scratch — each Behavior is a
 * thin, named wrapper that composes the existing utils functions/classes
 * into the higher-level block described in the Flowlab-style docs (Once,
 * Always, Timer, Number, Expression, Filter, Sound, Text, List Each, ...).
 *
 * This exists so the Block Editor (and any hand-written game script) calls
 * `Behaviors.timer(...)`, `Behaviors.filter(...)`, etc. instead of reaching
 * into utils/src/*.js directly — the raw utils modules are an implementation
 * detail behind this file, not something block scripts should import on
 * their own.
 *
 * Every export below is grouped to match the block palette categories:
 * Triggers, Logic & Math, Components, Text & Lists, GUI, Game Flow.
 */

const { EventEmitter } = require('events');
const math = require('./math.js');
const data = require('./data.js');
const { Keyboard, Pointer } = require('./events.js');

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

/**
 * Once — fires `onOut(1)` a single time. Mirrors the "Once" trigger, which
 * activates only when the object spawns (or, with resetOnLevelStart, again
 * on level restart).
 */
function once(onOut) {
  let fired = false;
  const fire = () => { if (fired) return; fired = true; onOut?.(1); };
  return { fire, reset: () => { fired = false; } };
}

/**
 * Always — calls `onOut(1)` every time `tick()` is invoked by the game
 * loop, matching the "Always" trigger's once-per-frame behavior.
 */
function always(onOut) {
  return { tick: () => onOut?.(1) };
}

/**
 * Timer — delay is given in tenths of a second, exactly like the Timer
 * trigger's Delay property. Supports a fixed repeat count or Repeat Forever,
 * plus start/reset inputs and an out/done pair of outputs.
 */
function timer({ delay = 10, repeatForever = false, repeat = 1, autoStart = true } = {}, onOut, onDone) {
  let handle = null;
  let firedCount = 0;
  const intervalMs = () => Math.max(0, delay) * 100;

  function stop() {
    if (handle) { clearInterval(handle); handle = null; }
  }

  function tick() {
    firedCount += 1;
    onOut?.(1);
    if (!repeatForever && firedCount >= repeat) {
      stop();
      onDone?.(1);
    }
  }

  function start() {
    stop();
    firedCount = 0;
    handle = setInterval(tick, intervalMs());
  }

  function reset() {
    stop();
    firedCount = 0;
  }

  if (autoStart) start();
  return { start, reset, stop, setDelay: v => { delay = v; } };
}

/**
 * MouseClick — wraps utils/src/events.js's `Pointer` class, matching the
 * Mouse Click trigger's Down/Up/Over/Out outputs. `capture: true` mirrors
 * "Capture Clicks Anywhere".
 */
function mouseClick({ pointer = new Pointer(), button = 'left', captureAnywhere = false } = {}, handlers = {}) {
  const evt = button === 'right' ? 'pointerdown' : 'pointerdown';
  if (handlers.down) pointer.on('pointerdown', p => handlers.down(p));
  if (handlers.up) pointer.on('pointerup', p => handlers.up(p));
  if (handlers.over) pointer.on('pointerover', p => handlers.over(p));
  if (handlers.out) pointer.on('pointerout', p => handlers.out(p));
  return pointer;
}

/**
 * MouseMove — same idea as MouseClick, exposing x/y like the Mouse Move
 * trigger's outputs. `get()` mirrors the "get" input (fetch position now).
 */
function mouseMove({ pointer = new Pointer() } = {}, onMove) {
  pointer.on('pointermove', p => onMove?.(p.x, p.y));
  return { get: () => onMove?.(pointer.x ?? 0, pointer.y ?? 0), pointer };
}

/**
 * Keyboard — wraps utils/src/events.js's `Keyboard` class. `repeating`
 * mirrors the Repeating property (held-key auto-repeat).
 */
function keyboard(key, { repeating = false, repeatDelayMs = 120, anyKey = false } = {}, handlers = {}) {
  const kb = new Keyboard();
  let repeatHandle = null;
  kb.on('keydown', e => {
    if (!anyKey && e.key !== key) return;
    handlers.down?.(anyKey ? e.key : 1);
    if (repeating && !repeatHandle) {
      repeatHandle = setInterval(() => handlers.down?.(anyKey ? e.key : 1), repeatDelayMs);
    }
  });
  kb.on('keyup', e => {
    if (!anyKey && e.key !== key) return;
    handlers.up?.(anyKey ? e.key : 1);
    if (repeatHandle) { clearInterval(repeatHandle); repeatHandle = null; }
  });
  return kb;
}

/**
 * Collision — a lightweight stand-in for the Collision trigger: given two
 * axis-aligned boxes ({x,y,w,h}), reports whether (and from which side)
 * they overlap, restricted to an optional objectType filter and/or a
 * specific side, exactly like the trigger's properties.
 */
function collision(a, b, { sides = null } = {}) {
  const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  if (!overlap) return { hit: false };
  if (!sides) return { hit: true };
  const fromTop = a.y + a.h - b.y, fromBottom = b.y + b.h - a.y, fromLeft = a.x + a.w - b.x, fromRight = b.x + b.w - a.x;
  const min = Math.min(fromTop, fromBottom, fromLeft, fromRight);
  const side = min === fromTop ? 'top' : min === fromBottom ? 'bottom' : min === fromLeft ? 'left' : 'right';
  return { hit: sides.includes(side), side };
}

/**
 * Mouse Wheel — reports scroll direction/amount via a plain DOM/host
 * `wheel` listener target, matching the trigger's single `out` output.
 */
function mouseWheel(target, onOut) {
  const handler = e => onOut?.(e.deltaY);
  target.addEventListener?.('wheel', handler, { passive: true });
  return { stop: () => target.removeEventListener?.('wheel', handler) };
}

/**
 * Gesture — Drag/Rotate/Pinch touch gestures. `source` is a host-supplied
 * touch tracker exposing `on(event, cb)` for 'drag'|'rotate'|'pinch'|'done'.
 */
function gesture(source, mode = 'drag', handlers = {}) {
  if (mode === 'drag' && handlers.move) source.on('drag', p => handlers.move(p.x, p.y));
  if (mode === 'rotate' && handlers.rotate) source.on('rotate', a => handlers.rotate(a));
  if (mode === 'pinch' && handlers.pinch) source.on('pinch', pct => handlers.pinch(pct));
  if (handlers.done) source.on('done', () => handlers.done(1));
  return source;
}

/**
 * LockedMouse — pointer-lock style relative mouse motion. `target` is the
 * element to lock; `pointer` supplies real movementX/movementY when locked.
 */
function lockedMouse(target, { onLock, onUnlock, onMove } = {}) {
  const moveHandler = e => onMove?.(e.movementX, e.movementY);
  const lockChange = () => {
    if (document.pointerLockElement === target) { onLock?.(1); document.addEventListener('mousemove', moveHandler); }
    else { onUnlock?.(1); document.removeEventListener('mousemove', moveHandler); }
  };
  document.addEventListener('pointerlockchange', lockChange);
  return {
    on: () => target.requestPointerLock?.(),
    off: () => document.exitPointerLock?.(),
    stop: () => { document.removeEventListener('pointerlockchange', lockChange); document.removeEventListener('mousemove', moveHandler); }
  };
}

/**
 * Controller — wraps the Gamepad API. `index` selects which pad (0-based),
 * matching "Controller 1/2/...". `poll()` should be called once per frame;
 * `binding` selects which button/axis index to report.
 */
function controller(index, binding, { repeating = false } = {}, onOut) {
  let wasDown = false;
  function poll() {
    const pad = navigator.getGamepads?.()[index];
    if (!pad) return;
    if (typeof binding === 'number' && pad.buttons[binding]) {
      const down = pad.buttons[binding].pressed;
      if (down && (!wasDown || repeating)) onOut?.(1);
      wasDown = down;
    } else if (binding?.axis !== undefined) {
      onOut?.(Math.round(Math.abs(pad.axes[binding.axis]) * 100));
    }
  }
  return { poll };
}

/**
 * In View — reports when a world-space box enters/exits the given viewport
 * rectangle, with an optional buffer (View Buffer Pixels).
 */
function inView(box, viewport, { buffer = 0 } = {}) {
  const inside = box.x + box.w >= viewport.x - buffer && box.x <= viewport.x + viewport.w + buffer &&
    box.y + box.h >= viewport.y - buffer && box.y <= viewport.y + viewport.h + buffer;
  return { inside };
}

/**
 * Sensor — event-driven proximity region (circle/box) around `center`.
 * Call `check(objects)` whenever the object list changes; it diffs against
 * the previous frame to fire enter/leave exactly once per transition.
 */
function sensor(center, { shape = 'circle', radius = 64, w = 64, h = 64, objectType = null } = {}) {
  let inside = new Set();
  function contains(o) {
    if (objectType && o.type !== objectType) return false;
    if (shape === 'circle') return math.dist(center.x, center.y, o.x, o.y) <= radius;
    return Math.abs(o.x - center.x) <= w / 2 && Math.abs(o.y - center.y) <= h / 2;
  }
  return {
    check(objects, onEnter, onLeave) {
      const now = new Set(objects.filter(contains).map(o => o.id));
      for (const id of now) if (!inside.has(id)) onEnter?.(id);
      for (const id of inside) if (!now.has(id)) onLeave?.(id);
      inside = now;
      return now.size;
    }
  };
}

/**
 * Mailbox/Message — a named pub-sub channel, matching the Message/Mailbox
 * pair. `send(name, value)` delivers to every mailbox listening on `name`.
 */
const mailboxBus = new EventEmitter();
function mailbox(name, onOut) {
  const handler = value => onOut?.(value);
  mailboxBus.on(name, handler);
  return { stop: () => mailboxBus.off(name, handler) };
}
function sendMessage(name, value) { mailboxBus.emit(name, value); }
function message(targetResolver, name, onDone) {
  return {
    send: value => {
      const target = typeof targetResolver === 'function' ? targetResolver() : targetResolver;
      if (target?.id) mailboxBus.emit(`${target.id}:${name}`, value);
      onDone?.(1);
    }
  };
}
const sharedStore = new Map();
const sharedBus = new EventEmitter();
function shared(name, { type = 'number' } = {}) {
  if (!sharedStore.has(name)) sharedStore.set(name, type === 'number' ? 0 : type.endsWith('List') ? [] : '');
  return {
    set: v => { sharedStore.set(name, v); sharedBus.emit(name, v); return v; },
    get: () => sharedStore.get(name),
    add: v => { const nv = sharedStore.get(name) + v; sharedStore.set(name, nv); sharedBus.emit(name, nv); return nv; },
    onChange: cb => sharedBus.on(name, cb)
  };
}
function playerCount(adapter = null) {
  return {
    get: () => adapter?.getPlayerCount?.() ?? 0,
    onChange: cb => adapter?.onPlayerCountChange?.(cb)
  };
}
function playerCheck(object, adapter = null) {
  return {
    isLocal: () => adapter?.isLocalPlayer?.(object) ?? true,
    isRemote: () => adapter?.isLocalPlayer?.(object) === false
  };
}

// ---------------------------------------------------------------------------
// Logic & Math
// ---------------------------------------------------------------------------

/** Number — a stored value with Set/Get/+ inputs, like the Number block. */
function number(initial = 0, { round: roundMode = null } = {}) {
  let value = initial;
  const applyRound = v => {
    if (roundMode === 'nearest') return math.round(v);
    if (roundMode === 'up') return math.ceil(v);
    if (roundMode === 'down') return math.floor(v);
    
    return v;
  };
  return {
    set: v => { value = applyRound(v); return value; },
    get: () => value,
    add: v => { value = applyRound(value + v); return value; }
  };
}

/**
 * Expression — evaluates a Flowlab-style expression string using up to six
 * named variables (A-F) and the same Math.* helpers the docs list, all of
 * which already exist in utils/src/math.js.
 */
const EXPRESSION_SCOPE = {
  abs: math.abs, acos: math.acos, asin: math.asin, atan: math.atan, atan2: math.atan2,
  ceil: math.ceil, cos: math.cos, exp: math.exp, floor: math.floor, max: math.max,
  min: math.min, pow: math.pow, round: math.round, sin: math.sin, sqrt: math.sqrt, tan: math.tan
};
function expression(exprString, vars = {}) {
  const names = Object.keys(vars);
  const MathShim = new Proxy({}, { get: (_, k) => EXPRESSION_SCOPE[k] });
  // eslint-disable-next-line no-new-func
  const fn = new Function('Math', ...names, `"use strict"; return (${exprString});`);
  return fn(MathShim, ...names.map(n => vars[n]));
}

/** Repeater — fires onOut `count` times, then onDone once, like the block. */
function repeater(count, onOut, onDone) {
  let cancelled = false;
  for (let i = 0; i < count && !cancelled; i++) onOut?.(1);
  if (!cancelled) onDone?.(1);
  return { cancel: () => { cancelled = true; } };
}

/** Random — thin wrapper over utils/src/math.js's `random`. */
function random(min = 0, max = 1) { return math.random(min, max); }

const FILTER_OPS = {
  '<': (a, b) => a < b, '>': (a, b) => a > b, '==': (a, b) => a === b,
  '!=': (a, b) => a !== b, '<=': (a, b) => a <= b, '>=': (a, b) => a >= b
};
/** Filter — routes a value to pass/fail based on a comparison, like the block. */
function filter(value, op, compareTo) {
  const test = FILTER_OPS[op];
  if (!test) throw new Error(`Unknown Filter expression "${op}"`);
  return test(value, compareTo) ? { pass: value } : { fail: value };
}

/** Switch — forwards `in` to `out` only while on, like the block. */
function switchGate(initialOn = true) {
  let on = initialOn;
  return {
    turnOn: () => { on = true; }, turnOff: () => { on = false; },
    send: (value, onOut) => { if (on) onOut?.(value); },
    isOn: () => on
  };
}

/** Toggle — alternates between two outputs on each `next()`. */
function toggle({ loop = true, startOn = 1 } = {}) {
  let active = startOn;
  return {
    next: () => { if (active === 2 && !loop) return; active = active === 1 ? 2 : 1; },
    send: (value, out1, out2) => (active === 1 ? out1 : out2)?.(value),
    current: () => active
  };
}

/**
 * Router — Select Specific Route ('specific') / Always Increment Route
 * ('increment') / Randomize Next Route ('random'). `routeCount` ("Available
 * Routes") is clamped to 1-32, matching the up-to-32 out1..out32 outputs
 * described by the docs. `select` takes a 1-based route number (out1 = 1),
 * same numbering as the outN outputs it targets.
 */
function router({ mode = 'increment', routeCount = 2 } = {}) {
  const count = Math.min(32, Math.max(1, Math.floor(routeCount) || 1));
  let index = 0;
  return {
    select: n => { const i = Math.floor(n) || 0; index = ((i - 1) % count + count) % count; },
    send: (value, outs) => {
      if (mode === 'random') index = math.floor(random(0, count));
      outs[index]?.(value);
      if (mode === 'increment') index = (index + 1) % count;
    }
  };
}

const LOGIC_GATES = {
  AND: (a, b) => a && b, OR: (a, b) => a || b, NAND: (a, b) => !(a && b),
  NOR: (a, b) => !(a || b), XOR: (a, b) => Boolean(a) !== Boolean(b), XNOR: (a, b) => Boolean(a) === Boolean(b)
};
/** Logic Gate — AND/OR/NAND/NOR/XOR/XNOR, "active" meaning any nonzero input. */
function logicGate(type, a, b) {
  const gate = LOGIC_GATES[type];
  if (!gate) throw new Error(`Unknown Logic Gate type "${type}"`);
  return gate(Boolean(a), Boolean(b)) ? 1 : 0;
}

/**
 * Code — the Custom Behavior block. Runs host-supplied source against a
 * fixed set of typed inputs, printing via `print()` like the docs describe.
 */
function customCode(source, inputs = {}, { print = console.log } = {}) {
  // eslint-disable-next-line no-new-func
  const fn = new Function('inputs', 'print', `"use strict"; const {${Object.keys(inputs).join(',') || ''}} = inputs; ${source}`);
  return fn(inputs, print);
}

/** Global — a single named value shared by every Global block using that name. */
const globalStore = new Map();
const globalBus = new EventEmitter();
function global(name, { type = 'number' } = {}) {
  if (!globalStore.has(name)) globalStore.set(name, type === 'number' ? 0 : type.endsWith('List') ? [] : '');
  return {
    set: v => { globalStore.set(name, v); globalBus.emit(name, v); return v; },
    get: () => globalStore.get(name),
    add: v => { const nv = globalStore.get(name) + v; globalStore.set(name, nv); globalBus.emit(name, nv); return nv; },
    onChange: cb => globalBus.on(name, cb)
  };
}

/** Object Variable — a named value scoped to a single object instance. */
function objectVariable(object, name, { type = 'number' } = {}) {
  object.__vars ||= {};
  if (!(name in object.__vars)) object.__vars[name] = type === 'number' ? 0 : type.endsWith('List') ? [] : '';
  return {
    set: v => { object.__vars[name] = v; },
    get: () => object.__vars[name],
    add: v => (object.__vars[name] += v)
  };
}

// ---------------------------------------------------------------------------
// Components (subset — object/scene-facing blocks)
// ---------------------------------------------------------------------------

/** Ease — interpolates From→To over Seconds using utils/src/math.js's `lerp`, driven by an external tick(). */
const EASE_FUNCTIONS = {
  linear: t => t,
  quad: t => t * t,
  cubic: t => t * t * t,
  sine: t => 1 - math.cos((t * Math.PI) / 2)
};
function ease({ from = 0, to = 1, seconds = 1, fn = 'linear', mode = 'in' } = {}, onOut, onDone) {
  let elapsed = 0;
  let running = false;
  const shape = EASE_FUNCTIONS[fn] || EASE_FUNCTIONS.linear;
  function tick(dt) {
    if (!running) return;
    elapsed += dt;
    let t = math.constrain(elapsed / Math.max(0.0001, seconds), 0, 1);
    if (mode === 'out') t = 1 - shape(1 - t);
    else if (mode === 'inout') t = t < 0.5 ? shape(t * 2) / 2 : 1 - shape((1 - t) * 2) / 2;
    else t = shape(t);
    onOut?.(math.lerp(from, to, t));
    if (elapsed >= seconds) { running = false; onDone?.(1); }
  }
  return {
    start: () => { elapsed = 0; running = true; },
    reverse: () => { elapsed = 0; running = true; [from, to] = [to, from]; },
    pause: () => { running = !running; },
    tick
  };
}

/**
 * Extractor — reads a named property off a plain object, matching the
 * block's Extract Property selector (X, Y, Rotation, an Object Variable, ...).
 */
function extractor(object, propertyPath) {
  return propertyPath.split('.').reduce((v, key) => (v == null ? v : v[key]), object);
}

/** Destroyer — invokes a supplied removal callback, passing the input value through. */
function destroyer(object, removeFn) {
  removeFn?.(object);
  return object;
}

/**
 * Sound — thin control surface over an injected audio backend (the browser
 * `Audio`/`AudioContext`, or utils/src/sound.js's virtual nodes when running
 * headless). ForgeEngine supplies `backend`; this just maps Flowlab's
 * play/pause/stop/vol/pan/pitch inputs onto it.
 */
function sound(backend, { loop = false, volume = 100, pan = 0, pitch = 100 } = {}) {
  backend.loop = loop;
  return {
    play: () => backend.play?.(),
    pause: () => backend.pause?.(),
    stop: () => backend.stop?.(),
    setVolume: v => backend.setVolume?.(v),
    setPan: v => backend.setPan?.(v),
    setPitch: v => backend.setPitch?.(v)
  };
}

/** Ad — placeholder Ad Mob block for exported mobile apps. */
function ad({
  iosBannerId = '', iosInterstitialId = '', androidBannerId = '', androidInterstitialId = '',
  position = 'bottom', testMode = false
} = {}, handlers = {}) {
  const state = { bannerVisible: false };
  function log(action, value) {
    if (typeof console !== 'undefined') console.log('[Ad]', action, value, { position, testMode });
  }
  return {
    banner: value => {
      state.bannerVisible = true;
      handlers.out?.(value);
      log('banner shown', value);
      return value;
    },
    full: value => {
      handlers.close?.(1);
      log('interstitial shown', value);
      return value;
    },
    hide: value => {
      state.bannerVisible = false;
      handlers.out?.(value);
      log('banner hidden', value);
      return value;
    },
    reward: value => {
      handlers.reward?.(1);
      log('reward ad complete', value);
      return value;
    },
    config: { iosBannerId, iosInterstitialId, androidBannerId, androidInterstitialId, position, testMode }
  };
}

/** Emit — spawns a short-lived object moving at `angle`/`force`, via a host-supplied `spawnFn`. */
function emit(spawnFn, origin, { angle = 0, force = 0, expireAfterFrames = 30, rotateObject = false } = {}) {
  const rad = math.radians(angle);
  const velocity = { x: math.cos(angle) * force, y: math.sin(angle) * force };
  const obj = spawnFn({ x: origin.x, y: origin.y, velocity, rotation: rotateObject ? math.degrees(rad) : 0 });
  if (Number.isFinite(expireAfterFrames)) obj.__expireIn = expireAfterFrames;
  return obj;
}

/** Spawn — creates an object of `type` at (x, y), via a host-supplied `spawnFn`. */
function spawn(spawnFn, type, x, y) { return spawnFn(type, x, y); }

/** Attacher — attaches/detaches a decoration object at a fixed offset, via host `attachFn`/`detachFn`. */
function attacher(attachFn, detachFn, type, offset = { x: 0, y: 0 }) {
  let attached = null;
  return {
    on: () => { attached = attachFn(type, offset); return attached; },
    off: () => { if (attached) detachFn(attached); attached = null; }
  };
}

/** Physics Joint — spinning/welded/string joint between two objects, via a host physics adapter. */
function physicsJoint(physics, type, a, b, { fragility = 0, flexible = false, springiness = 0.5, stiffness = 0.5, minDistance = 0, maxDistance = 100 } = {}) {
  const joint = physics.createJoint(type, a, b, { fragility, flexible, springiness, stiffness, minDistance, maxDistance });
  return { off: () => physics.destroyJoint(joint), break: () => physics.breakJoint(joint), joint };
}

/** Proximity — polling-based "how close is the nearest matching object" check (see Sensor for the event-driven version). */
function proximity(center, objects, { distance = 100, shape = 'circle', objectType = null, search = 'closest' } = {}) {
  const matches = objects.filter(o => (!objectType || o.type === objectType) &&
    (shape === 'circle' ? math.dist(center.x, center.y, o.x, o.y) <= distance : Math.abs(o.x - center.x) <= distance && Math.abs(o.y - center.y) <= distance));
  if (!matches.length) return { miss: true };
  if (search === 'first') return { x: matches[0].x, y: matches[0].y };
  if (search === 'all') return { all: matches.map(o => ({ x: o.x, y: o.y })) };
  const closest = matches.reduce((best, o) => math.dist(center.x, center.y, o.x, o.y) < math.dist(center.x, center.y, best.x, best.y) ? o : best);
  return { x: closest.x, y: closest.y };
}

/** Push Motor — applies a growing force via a host physics adapter's `applyForce`. */
function pushMotor(physics, object, { x = 0, y = 0, forward = 0 } = {}) { return physics.applyForce(object, { x, y, forward }); }

/** Spin Motor — applies angular force via a host physics adapter's `applyTorque`. */
function spinMotor(physics, object, force) { return physics.applyTorque(object, force); }

/** Impulse — applies an instant velocity change via a host physics adapter's `applyImpulse`. */
function impulse(physics, object, { x = 0, y = 0, forward = 0 } = {}) { return physics.applyImpulse(object, { x, y, forward }); }

/** Point At — rotates `object` to face (x, y), returning the new rotation in degrees. */
function pointAt(object, x, y) {
  const rot = math.degrees(math.atan2(y - object.y, x - object.x));
  object.rotation = rot;
  return rot;
}

/** Camera — scrolls a host-supplied viewport rectangle; also handles zoom/rotate. */
function camera(viewport, { autoscrollX = false, autoscrollY = false } = {}) {
  return {
    setX: v => { if (!autoscrollX) viewport.x = v; return viewport.x; },
    setY: v => { if (!autoscrollY) viewport.y = v; return viewport.y; },
    moveX: v => { viewport.x += v; return viewport.x; },
    moveY: v => { viewport.y += v; return viewport.y; },
    zoom: pct => { viewport.zoom = pct; return pct; },
    rotate: deg => { viewport.rotation = deg; return deg; }
  };
}

/** Message — routes a value to a target object's mailbox by name/strategy, reusing the mailbox bus. */
function sendMessageTo(targetResolver, name, value, onDone) {
  const target = targetResolver();
  if (target?.id) mailboxBus.emit(`${target.id}:${name}`, value);
  onDone?.(1);
}

/** RayCast — casts a ray from `origin` at `angle` for `length`, testing against `objects` (AABBs). */
function rayCast(origin, angle, length, objects, { objectType = null, stopAtFirst = true } = {}) {
  const dx = math.cos(angle), dy = math.sin(angle);
  const hits = [];
  for (const o of objects) {
    if (objectType && o.type !== objectType) continue;
    for (let t = 0; t <= length; t += 4) {
      const x = origin.x + dx * t, y = origin.y + dy * t;
      if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) { hits.push({ object: o, t }); break; }
    }
  }
  if (!hits.length) return { miss: true };
  hits.sort((a, b) => a.t - b.t);
  return { hit: stopAtFirst ? hits[0].object : hits.map(h => h.object) };
}

/** Calendar — reads year/month/date/day-of-week from `now` or a given UNIX timestamp. */
function calendar(timestampSeconds = Date.now() / 1000) {
  const d = new Date(timestampSeconds * 1000);
  return { year: d.getFullYear(), month: d.getMonth() + 1, date: d.getDate(), day: d.getDay() + 1 };
}

/** Clock — reads hour/min/sec/stamp from `now` or a given UNIX timestamp. */
function clock(timestampSeconds = Date.now() / 1000) {
  const d = new Date(timestampSeconds * 1000);
  return { hour: d.getHours(), min: d.getMinutes(), sec: d.getSeconds(), stamp: Math.floor(timestampSeconds) };
}

// ---------------------------------------------------------------------------
// Properties (per-object transform/render state)
// ---------------------------------------------------------------------------

/** Position — sets/increments an object's x/y, in pixel or grid coordinates. */
function position(object, { gridSize = 32, coordinateSystem = 'pixel' } = {}) {
  const toPixels = v => (coordinateSystem === 'grid' ? v * gridSize : v);
  return {
    setX: v => { object.x = toPixels(v); return object.x; },
    setY: v => { object.y = toPixels(v); return object.y; },
    addX: v => (object.x += toPixels(v)),
    addY: v => (object.y += toPixels(v))
  };
}

/** Rotation — sets or adds to an object's rotation, in degrees. */
function rotation(object) {
  return { set: v => { object.rotation = v; return v; }, add: v => (object.rotation = (object.rotation || 0) + v) };
}

/** Alpha — sets an object's transparency (0-100). */
function alpha(object) { return { set: v => { object.alpha = math.constrain(v, 0, 100); return object.alpha; } }; }

/** Size — sets an object's uniform or per-axis scale (percent of default). */
function size(object) {
  return {
    setPercent: v => { object.scale = { x: v / 100, y: v / 100 }; return object.scale; },
    setX: v => { object.scale = { ...object.scale, x: v / 100 }; return object.scale; },
    setY: v => { object.scale = { ...object.scale, y: v / 100 }; return object.scale; }
  };
}

/** Enabled — toggles an object's physics participation without stopping its behaviors. */
function enabled(object) { return { setTrue: () => { object.enabled = true; }, setFalse: () => { object.enabled = false; } }; }

/** Animation — start/stop/goto for a named sprite animation, via a host-supplied `player` adapter. */
function animation(player, name, { loop = false, priority = 0, stayOnLastFrame = false } = {}) {
  return {
    start: () => player.play(name, { loop, priority, stayOnLastFrame }),
    stop: () => player.stop(name),
    goTo: frame => player.goTo(name, frame)
  };
}

/** Velocity — sets an object's velocity components directly. */
function velocity(object) {
  return {
    setX: v => { object.velocity ||= { x: 0, y: 0 }; object.velocity.x = v; },
    setY: v => { object.velocity ||= { x: 0, y: 0 }; object.velocity.y = v; },
    setForward: v => { object.forwardSpeed = v; }
  };
}

/** Spin — sets an object's angular velocity, in rotations per second. */
function spin(object) { return { set: v => { object.spinSpeed = v; return v; } }; }

/** Material — sets friction/bounce/density on a host physics adapter. */
function material(physics, object) {
  return {
    setFriction: v => physics.setFriction(object, v),
    setBounce: v => physics.setBounce(object, v),
    setDensity: v => physics.setDensity(object, v)
  };
}

/** Flip — flips an object's sprite/forward direction horizontally or vertically. */
function flip(object, { vertical = false, onlyUpdateSprite = false } = {}) {
  const axis = vertical ? 'flippedY' : 'flippedX';
  return {
    flip: () => { object[axis] = true; if (!onlyUpdateSprite) object.rotation = (object.rotation || 0) + 180; },
    back: () => { object[axis] = false; },
    toggle: () => { object[axis] = !object[axis]; if (!onlyUpdateSprite) object.rotation = (object.rotation || 0) + 180; }
  };
}

/** Display Order — sets an object's render order (1-1000; higher draws on top). */
function displayOrder(object) { return { set: v => { object.displayOrder = math.constrain(v, 1, 1000); return object.displayOrder; } }; }

const BLEND_MODES = ['normal', 'add', 'subtract', 'multiply', 'screen'];
/** Blending — sets an object's sprite blend mode by index (0-4, matching the docs). */
function blending(object) { return { set: mode => { object.blendMode = BLEND_MODES[mode] || 'normal'; return object.blendMode; } }; }

/** Colors — multiplies an object's RGBA channels by percentages (0-100). */
function colors(object) {
  object.colorMultiply ||= { r: 100, g: 100, b: 100, a: 100 };
  return {
    setRed: v => (object.colorMultiply.r = v), setGreen: v => (object.colorMultiply.g = v),
    setBlue: v => (object.colorMultiply.b = v), setAlpha: v => (object.colorMultiply.a = v)
  };
}

/** Shader — turns a named post-processing shader on/off on a host renderer adapter. */
function shader(renderer, type, { mode = 'everything' } = {}) {
  return { on: () => renderer.enableShader(type, mode), off: () => renderer.disableShader(type, mode) };
}

// ---------------------------------------------------------------------------
// Text & Lists
// ---------------------------------------------------------------------------

/** Text — Set/Get/+ (append)/char/split, exactly like the Text block. */
function text(initial = '') {
  let value = String(initial);
  return {
    set: v => { value = String(v); },
    get: () => value,
    append: v => { value += String(v); return value; },
    char: i => value[i - 1] ?? '',
    split: delim => data.splitTokens(value, delim === '' ? '' : delim)
  };
}

/** Text Case — Uppercase / Lowercase / Uppercase first letter. */
function textCase(value, mode) {
  if (mode === 'upper') return value.toUpperCase();
  if (mode === 'lower') return value.toLowerCase();
  if (mode === 'upperFirst') return value.charAt(0).toUpperCase() + value.slice(1);
  throw new Error(`Unknown Text Case mode "${mode}"`);
}

/** Text Length. */
function textLength(value) { return value.length; }

/** To Number — parses a leading numeric value out of text, via utils' `float`. */
function toNumber(value) {
  const match = /-?\d+(\.\d+)?/.exec(value);
  return match ? data.float(match[0]) : NaN;
}

/** Text Compare — Equal/Contains/Starts-with in either direction. */
function textCompare(a, b, mode) {
  const table = {
    equals: a === b,
    aContainsB: a.includes(b),
    bContainsA: b.includes(a),
    aStartsWithB: a.startsWith(b),
    bStartsWithA: b.startsWith(a)
  };
  if (!(mode in table)) throw new Error(`Unknown Text Compare mode "${mode}"`);
  return table[mode] ? { yes: b } : { no: b };
}

/** Text Sanitize — splits input into the printable-ASCII and non-printable parts. */
function textSanitize(value) {
  return /^[\x20-\x7E]*$/.test(value) ? { good: value } : { bad: value };
}

/** List (Text List / Number List) — set/push/all/one/pop/join/find, shared by both block types. */
function list(initial = []) {
  let items = [...initial];
  return {
    set: v => { items = [...v]; },
    push: v => { items.push(v); return items.length; },
    all: () => items,
    one: i => items[i - 1],
    pop: () => items.pop(),
    join: delim => items.join(delim),
    find: v => { const i = items.indexOf(v); return i === -1 ? 0 : i + 1; }
  };
}

/** List Modify — Insert/Remove/Replace at a 1-based index. */
function listModify(items, mode, index, value) {
  const out = [...items];
  const i = index - 1;
  if (mode === 'insert') out.splice(i, 0, value);
  else if (mode === 'remove') out.splice(i, 1);
  else if (mode === 'replace') out[i] = value;
  else throw new Error(`Unknown List Modify mode "${mode}"`);
  return out;
}

/** List Order — Sort/Reverse/Shuffle, using utils' `shuffle` for the random case. */
function listOrder(items, mode, { asNumbers = false } = {}) {
  if (mode === 'sort') {
    const out = [...items];
    out.sort(asNumbers ? (a, b) => parseFloat(a) - parseFloat(b) : undefined);
    return out;
  }
  if (mode === 'reverse') return [...items].reverse();
  if (mode === 'shuffle') return data.shuffle(items, false);
  throw new Error(`Unknown List Order mode "${mode}"`);
}

/** List Each — outputs one item at a time, optionally spaced by `delayMs`. */
function listEach(items, { delayMs = 0 } = {}, onIndex, onOut, onDone) {
  let cancelled = false;
  let i = 0;
  function step() {
    if (cancelled || i >= items.length) { if (!cancelled) onDone?.(1); return; }
    i += 1;
    onIndex?.(i);
    onOut?.(items[i - 1]);
    if (delayMs > 0) setTimeout(step, delayMs); else step();
  }
  step();
  return { reset: () => { cancelled = true; } };
}

/** List Count. */
function listCount(items) { return items.length; }

// ---------------------------------------------------------------------------
// GUI (subset)
// ---------------------------------------------------------------------------

/** Alert — a show/hide dialog surface; `ui` is supplied by the host (DOM/editor). */
function alert(ui, { title = '', message = '', buttonLabel = 'OK' } = {}, onClick) {
  return {
    show: () => ui.showAlert?.({ title, message, buttonLabel, onClick: () => { ui.hideAlert?.(); onClick?.(1); } }),
    hide: () => { ui.hideAlert?.(); onClick?.(1); }
  };
}

/** Bar — a min/max progress value, reported as a 0-1 fraction for the renderer. */
function bar(initial = 0, max = 1) {
  let value = initial;
  return { set: v => { value = math.constrain(v, 0, max); return value / max; }, get: () => value };
}

/** Label — a plain text/style holder; the renderer reads `.text`/`.alpha`/etc. */
function label(initial = { text: '', alpha: 100, x: 0, y: 0 }) {
  const state = { ...initial };
  return {
    setText: v => { state.text = v; return state.text; },
    setAlpha: v => { state.alpha = v; return state.alpha; },
    setX: v => { state.x = v; return state.x; },
    setY: v => { state.y = v; return state.y; },
    get: () => ({ ...state })
  };
}

// ---------------------------------------------------------------------------
// Game Flow (subset)
// ---------------------------------------------------------------------------

/** Pause Game — a shared on/off flag other systems can read each frame. */
function pauseGame(initialPaused = false) {
  let paused = initialPaused;
  return { pause: () => { paused = true; }, play: () => { paused = false; }, isPaused: () => paused };
}

/** Load Level — delegates to a host-supplied `loader(target)`, matching the block's Pick Level options. */
function loadLevel(loader, mode = 'next', explicitTarget = null) {
  const target = mode === 'useInput' || mode === 'selected' ? explicitTarget : mode;
  return loader(target);
}

/** Restart Game — delegates to a host-supplied `restart()` callback. */
function restartGame(restart) { return restart(); }

/** Full Screen — toggles fullscreen mode and reports screen dimensions. */
function fullScreen() {
  const el = typeof document !== 'undefined' ? document.documentElement : null;
  return {
    on: () => el?.requestFullscreen?.(),
    off: () => document?.exitFullscreen?.(),
    toggle: () => { if (typeof document !== 'undefined' && document.fullscreenElement) document.exitFullscreen?.(); else el?.requestFullscreen?.(); },
    width: () => (typeof window !== 'undefined' ? window.innerWidth : 0),
    height: () => (typeof window !== 'undefined' ? window.innerHeight : 0)
  };
}

/** Cursor — show or hide the system mouse pointer. */
function cursor() {
  return {
    on: () => { if (typeof document !== 'undefined') document.body.style.cursor = 'auto'; },
    off: () => { if (typeof document !== 'undefined') document.body.style.cursor = 'none'; }
  };
}

/** Fetch URL — opens or loads a URL. */
function fetchURL(url, { mode = 'open' } = {}) {
  return {
    fetch: async input => {
      const target = input ? `${url}${input}` : url;
      if (mode === 'open') {
        typeof window !== 'undefined' && window.open?.(target, '_blank');
        return target;
      }
      const response = await fetch(target);
      if (!response.ok) throw new Error(response.statusText || 'Fetch failed');
      if (mode === 'text') return await response.text();
      if (mode === 'image') return URL.createObjectURL(await response.blob());
      return await response.text();
    }
  };
}

const SAVE_PREFIX = 'forge-save:';
function save(name, { type = 'number' } = {}) {
  const key = `${SAVE_PREFIX}${name}`;
  return {
    save: value => { try { localStorage.setItem(key, JSON.stringify(value)); return value; } catch { return null; } },
    read: () => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } }
  };
}

function gameSave(prefix = 'forge-game-save') {
  const slotsKey = `${prefix}:slots`;
  const readSlots = () => { try { return JSON.parse(localStorage.getItem(slotsKey) || '[]'); } catch { return []; } };
  const writeSlots = slots => localStorage.setItem(slotsKey, JSON.stringify(slots));
  return {
    list: () => readSlots(),
    save: (slot, state) => { const slots = readSlots(); slots[slot - 1] = Date.now(); writeSlots(slots); localStorage.setItem(`${prefix}:slot:${slot}`, JSON.stringify(state)); return slot; },
    load: slot => { try { return JSON.parse(localStorage.getItem(`${prefix}:slot:${slot}`) || 'null'); } catch { return null; } },
    image: slot => localStorage.getItem(`${prefix}:slot:${slot}:image`) || null,
    delete: slot => { const slots = readSlots(); slots[slot - 1] = 0; writeSlots(slots); localStorage.removeItem(`${prefix}:slot:${slot}`); localStorage.removeItem(`${prefix}:slot:${slot}:image`); return slot; }
  };
}

function leaderboard({ lowestFirst = false, theme = 'default', transparent = false, maxPerPage = 10 } = {}) {
  return {
    score: value => value,
    get: () => [],
    show: value => value,
    hide: value => value,
    failed: () => false
  };
}

function achievement({ name = '', theme = 'default' } = {}) {
  const granted = new Set();
  return {
    grant: value => { granted.add(name); return value; },
    out: value => value
  };
}

const CLOUD_PREFIX = 'forge-cloud:';
function cloud(name, { type = 'number' } = {}) {
  const key = `${CLOUD_PREFIX}${name}`;
  return {
    set: value => { try { localStorage.setItem(key, JSON.stringify(value)); return value; } catch { return null; } },
    get: () => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } },
    clear: () => { localStorage.removeItem(key); return null; }
  };
}

function clipboard() {
  return {
    copy: async value => {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(String(value)); return value; }
      return null;
    }
  };
}

function deviceCheck() {
  return {
    check: () => {
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
      const isDesktop = /Windows|Macintosh|Linux/.test(ua);
      return { Browser: !isMobile && typeof window !== 'undefined', Mobile: isMobile, Desktop: isDesktop };
    }
  };
}

function touchCheck() {
  return {
    check: () => {
      const hasTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
      return { Touch: hasTouch, Mouse: !hasTouch };
    }
  };
}

function shake({ threshold = 15, timeout = 1000 } = {}) {
  let last = { x: 0, y: 0, z: 0 };
  let timer = null;
  return {
    onShake: callback => {
      const handler = event => {
        const acc = event.accelerationIncludingGravity || event.acceleration || {};
        const dx = Math.abs((acc.x || 0) - last.x);
        const dy = Math.abs((acc.y || 0) - last.y);
        const dz = Math.abs((acc.z || 0) - last.z);
        last = { x: acc.x || 0, y: acc.y || 0, z: acc.z || 0 };
        if (dx + dy + dz > threshold) {
          callback?.(1);
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => { timer = null; }, timeout);
        }
      };
      typeof window !== 'undefined' && window.addEventListener?.('devicemotion', handler);
      return () => typeof window !== 'undefined' && window.removeEventListener?.('devicemotion', handler);
    }
  };
}

function accelerometer() {
  let callback = null;
  const handler = event => {
    const acc = event.accelerationIncludingGravity || event.acceleration || {};
    callback?.({ x: acc.x || 0, y: acc.y || 0, z: acc.z || 0 });
  };
  return {
    on: cb => { callback = cb; typeof window !== 'undefined' && window.addEventListener?.('devicemotion', handler); },
    off: () => { typeof window !== 'undefined' && window.removeEventListener?.('devicemotion', handler); callback = null; }
  };
}

function gameCenter({ leaderboardId = '' } = {}) {
  return {
    score: value => value,
    display: value => value
  };
}

function userInfo() {
  const state = { id: 0, name: '' };
  return {
    get: () => ({ ...state }),
    set: value => { state.id = value?.id || state.id; state.name = value?.name || state.name; return { ...state }; }
  };
}

function levelPhysics(physics) {
  return {
    speed: value => physics?.setSpeed?.(value),
    drag: value => physics?.setDrag?.(value),
    gravity: value => physics?.setGravity?.(value)
  };
}

function vibrate(seconds = 1) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(seconds * 1000);
  }
  return seconds;
}

function exit() {
  if (typeof window !== 'undefined') window.close?.();
}

module.exports = {
  // Triggers
  once, always, timer, mouseClick, mouseMove, mouseWheel, gesture, lockedMouse, keyboard, controller, collision, inView, sensor, mailbox, sendMessage,
  // Logic & Math
  number, expression, customCode, global, objectVariable, repeater, random, filter, switchGate, toggle, router, logicGate,
  // Components
  ease, extractor, destroyer, sound, ad, emit, spawn, attacher, physicsJoint, proximity, pushMotor, spinMotor, impulse, pointAt, camera,
  position, rotation, alpha, size, enabled, animation, velocity, spin, material, flip, displayOrder, blending, colors, shader,
  // Text & Lists
  text, textCase, textLength, toNumber, textCompare, textSanitize, list, listModify, listOrder, listEach, listCount,
  // GUI
  alert, bar, label, cursor, fullScreen,
  // Game Flow
  pauseGame, loadLevel, restartGame, fetchURL, save, gameSave, leaderboard, achievement, levelPhysics, userInfo, clipboard, cloud, shake, vibrate, accelerometer, gameCenter, deviceCheck, touchCheck, exit,
  // Multiplayer / Shared
  shared, playerCount, playerCheck
};