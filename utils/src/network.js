'use strict';

/**
 * Multiplayer network adapter — connects a running game to
 * `core/multiplayer-hub.js` (over the local network, or over the public
 * tunnel link generated in the editor's Multiplayer panel) and exposes the
 * small adapter interface that `Behaviors.shared/playerCount/playerCheck/
 * sendMessage/mailbox` already expected but had nothing real to call.
 *
 * Zero-config usage in a game script — nothing to copy-paste, ever:
 *
 *   const { Behaviors, connectMultiplayer } = require('@ForgeEngine/utils');
 *   const net = connectMultiplayer({ name: 'Player One' });
 *   const score = Behaviors.shared('score', { adapter: net });
 *   const count = Behaviors.playerCount(net);
 *
 * `slug`, `room` and `url` are all optional. When running under Node
 * (desktop app / editor preview, which is how ForgeEngine games actually
 * run today) they're auto-detected by `autoDetectConnectInfo()` below: it
 * walks up from the calling script to the game's own `game.config.json`,
 * then reads the sibling `.forge/multiplayer.json` that the server writes
 * every time multiplayer settings change or the public tunnel is
 * started/stopped — so the game always connects to whatever is currently
 * reachable (the loca.lt link, or the local network) without the game's
 * author ever hand-editing a URL. You can still override any of
 * `{ url, slug, room, name }` explicitly if you need to.
 *
 * In a plain browser bundle (no filesystem access) auto-detection of
 * `slug`/`room`/`url` isn't possible yet — pass them explicitly there.
 *
 * Works in plain Node (using the `ws` package) and in a browser/Electron
 * renderer (using the built-in `WebSocket` global) without any code
 * changes — it picks whichever is available.
 */

const { EventEmitter } = require('events');

let NodeWebSocket = null;
try { NodeWebSocket = require('ws'); } catch { /* not installed in this environment — fall back to global WebSocket */ }

let fs = null, path = null;
try { fs = require('node:fs'); path = require('node:path'); } catch { /* not available in a browser bundle */ }

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

/**
 * Finds the directory of whichever file *called into this module* (i.e.
 * the game script), by walking the call stack past network.js/behaviors.js
 * themselves. Used so a game never has to tell the engine where it lives.
 */
function callerDir() {
  const original = Error.prepareStackTrace;
  try {
    Error.prepareStackTrace = (_err, stack) => stack;
    const stack = new Error().stack;
    for (const frame of stack) {
      const file = frame.getFileName?.();
      if (file && file !== __filename && !file.includes(`${path.sep}utils${path.sep}src${path.sep}`)) {
        return path.dirname(file);
      }
    }
  } catch { /* fall through */ }
  finally { Error.prepareStackTrace = original; }
  return null;
}

/** Walks upward from `startDir` looking for the game's own `game.config.json`. */
function findGameRoot(startDir) {
  let dir = startDir;
  for (let i = 0; dir && i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'game.config.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Reads `<gameRoot>/.forge/multiplayer.json`, written by the ForgeEngine
 * server (see `src/game-manager.js#writeMultiplayerConnectInfo`) so this
 * always reflects whatever's live right now — the public tunnel link if
 * "Go Public" is on, otherwise the local server.
 */
function autoDetectConnectInfo() {
  if (!fs || !path) return null; // browser bundle — nothing to read from disk
  const dir = callerDir();
  const gameRoot = dir && findGameRoot(dir);
  if (!gameRoot) return null;
  try {
    const raw = fs.readFileSync(path.join(gameRoot, '.forge', 'multiplayer.json'), 'utf8');
    return JSON.parse(raw);
  } catch { return null; }
}

/**
 * Opens a connection to a multiplayer hub for one game/room and returns an
 * adapter object.
 *
 *   connectMultiplayer({ name: 'Player One' })                     // fully automatic
 *   connectMultiplayer('wss://my-game.loca.lt', { slug, room, name }) // explicit (legacy form still supported)
 */
function connectMultiplayer(urlOrOptions = {}, maybeOptions) {
  const usingLegacyForm = typeof urlOrOptions === 'string';
  const options = usingLegacyForm ? (maybeOptions || {}) : (urlOrOptions || {});
  let url = usingLegacyForm ? urlOrOptions : options.url;
  let { slug, room, name = 'Player' } = options;

  if (!url || !slug || !room) {
    const auto = autoDetectConnectInfo();
    url = url || auto?.url;
    slug = slug || auto?.slug;
    room = room || auto?.room || 'main';
  }

  if (!url) throw new Error('connectMultiplayer could not auto-detect a connection URL — pass one explicitly, or make sure the ForgeEngine server is running for this game');
  if (!slug) throw new Error('connectMultiplayer could not auto-detect this game\'s slug — pass one explicitly via { slug }');

  const target = `${String(url).replace(/\/$/, '')}/mp/${encodeURIComponent(slug)}/${encodeURIComponent(room)}?name=${encodeURIComponent(name)}`;

  const emitter = new EventEmitter();
  const sharedCache = new Map();
  let players = [];
  let localId = null;
  let ws = null;
  let closedByUser = false;
  let reconnectDelay = RECONNECT_BASE_MS;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 20;

  function open() {
    const Impl = NodeWebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    if (!Impl) throw new Error('No WebSocket implementation available (install "ws" or run in a browser/Electron renderer)');
    ws = new Impl(target);

    ws.addEventListener ? ws.addEventListener('open', onOpen) : ws.on('open', onOpen);
    ws.addEventListener ? ws.addEventListener('message', onMessage) : ws.on('message', onMessage);
    ws.addEventListener ? ws.addEventListener('close', onClose) : ws.on('close', onClose);
    ws.addEventListener ? ws.addEventListener('error', onError) : ws.on('error', onError);
  }

  function onOpen() { reconnectDelay = RECONNECT_BASE_MS; reconnectAttempts = 0; emitter.emit('_open'); }

  function onMessage(event) {
    let msg;
    try { msg = JSON.parse(event.data ?? event); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'welcome') {
      localId = msg.id;
      players = msg.players || [];
      sharedCache.clear();
      Object.entries(msg.shared || {}).forEach(([k, v]) => sharedCache.set(k, v));
      emitter.emit('_ready');
      emitter.emit('playercount', players.length);
    } else if (msg.type === 'player-joined' || msg.type === 'player-left') {
      players = msg.players || players;
      emitter.emit('playercount', players.length);
    } else if (msg.type === 'shared') {
      sharedCache.set(msg.name, msg.value);
      emitter.emit(`shared:${msg.name}`, msg.value);
    } else if (msg.type === 'message') {
      emitter.emit(`message:${msg.channel}`, msg.payload);
    }
  }

  function onClose() {
    emitter.emit('disconnected');
    if (closedByUser) return;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) { emitter.emit('reconnect-failed'); return; }
    reconnectAttempts += 1;
    setTimeout(() => { if (!closedByUser) open(); }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  function onError() { /* onClose fires right after and handles reconnect */ }

  function send(payload) {
    if (!ws || ws.readyState !== 1 /* OPEN */) return;
    try { ws.send(JSON.stringify(payload)); } catch { /* connection going away */ }
  }

  open();

  return {
    get localId() { return localId; },
    get connected() { return !!ws && ws.readyState === 1; },

    getPlayerCount: () => players.length,
    onPlayerCountChange: cb => { emitter.on('playercount', cb); return () => emitter.off('playercount', cb); },

    isLocalPlayer: object => !object?.ownerId || object.ownerId === localId,

    getShared: name => sharedCache.get(name),
    broadcastShared: (name, value) => send({ type: 'shared', name, value }),
    onSharedUpdate: (name, cb) => { emitter.on(`shared:${name}`, cb); return () => emitter.off(`shared:${name}`, cb); },

    sendMessage: (channel, payload) => send({ type: 'message', channel, payload }),
    onMessage: (channel, cb) => { emitter.on(`message:${channel}`, cb); return () => emitter.off(`message:${channel}`, cb); },

    disconnect: () => { closedByUser = true; try { ws?.close(); } catch { /* already closed */ } }
  };
}

module.exports = { connectMultiplayer };
