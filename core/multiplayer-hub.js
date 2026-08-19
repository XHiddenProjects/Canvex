"use strict";

/**
 * Multiplayer hub — a lightweight WebSocket relay that lets players
 * connect to a running game's room from anywhere (typically over the
 * public tunnel URL from `tunnel.js`) and stay in sync.
 *
 * URL shape:  wss://<host>/mp/<gameSlug>/<roomName>?name=<playerName>
 *
 * Each room tracks its connected players and the last value of every
 * `shared` variable (utils/src/behaviors.js `shared()`), so a player who
 * joins late still gets the current state instead of stale defaults. This
 * is the missing piece that turns `Behaviors.shared/playerCount/playerCheck`
 * — which already accepted an `adapter` but had nothing real to talk to —
 * into an actual networked multiplayer adapter (see
 * utils/src/network.js on the client/game side).
 *
 * This module owns no HTTP routes; `core/index.js` calls `attach(server,
 * { getSettings })` once, and hands off ws-upgrade requests under `/mp`.
 */

const crypto = require("node:crypto");
const { WebSocketServer } = require("ws");

const MAX_MESSAGE_BYTES = 16 * 1024;
const MAX_MESSAGES_PER_SECOND = 40;
const HEARTBEAT_MS = 30000;
const DEFAULT_MAX_PLAYERS = 8;
const MAX_SHARED_KEYS = 200;
const MAX_NAME_LEN = 32;

/** rooms: Map<"slug::room", { clients: Map<id,{ws,name,joinedAt,budget,budgetAt}>, shared: Map<name,value> }> */
const rooms = new Map();

function roomKey(slug, room) { return `${slug}::${room}`; }

function getOrCreateRoom(key) {
  let room = rooms.get(key);
  if (!room) { room = { clients: new Map(), shared: new Map() }; rooms.set(key, room); }
  return room;
}

function safeSend(ws, payload) {
  if (ws.readyState !== ws.OPEN) return;
  try { ws.send(JSON.stringify(payload)); } catch { /* connection going away */ }
}

function broadcast(room, payload, exceptId = null) {
  const text = JSON.stringify(payload);
  for (const [id, client] of room.clients) {
    if (id === exceptId || client.ws.readyState !== client.ws.OPEN) continue;
    try { client.ws.send(text); } catch { /* connection going away */ }
  }
}

function playerList(room) {
  return [...room.clients.entries()].map(([id, c]) => ({ id, name: c.name }));
}

function removeClient(key, room, id) {
  room.clients.delete(id);
  if (room.clients.size === 0) { rooms.delete(key); return; }
  broadcast(room, { type: "player-left", id, count: room.clients.size, players: playerList(room) });
}

/** Simple per-connection token-bucket so one misbehaving client can't flood a room. */
function withinRateLimit(client) {
  const now = Date.now();
  if (now - client.budgetAt > 1000) { client.budget = MAX_MESSAGES_PER_SECOND; client.budgetAt = now; }
  if (client.budget <= 0) return false;
  client.budget -= 1;
  return true;
}

function sanitizeName(raw) {
  const name = String(raw || "").trim().slice(0, MAX_NAME_LEN);
  return name || `Player-${crypto.randomBytes(2).toString("hex")}`;
}

/**
 * Wires the hub into an existing http/https server's `upgrade` event.
 * `getSettings(slug)` should resolve to `{ enabled, maxPlayers }` (or null
 * if the game doesn't exist) so the hub can honor each game's own
 * Multiplayer settings from the editor instead of a single global cap.
 */
function attach(server, { getSettings } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  server.on("upgrade", async (req, socket, head) => {
    let url;
    try { url = new URL(req.url, "https://placeholder.local"); } catch { socket.destroy(); return; }
    const parts = url.pathname.split("/").filter(Boolean); // ["mp", slug, room]
    if (parts[0] !== "mp" || !parts[1] || !parts[2]) return; // not ours — let other upgrade handlers (if any) see it

    const slug = decodeURIComponent(parts[1]).slice(0, 48);
    const roomName = decodeURIComponent(parts[2]).slice(0, 48);
    const settings = (await getSettings?.(slug).catch(() => null)) || { enabled: false, maxPlayers: DEFAULT_MAX_PLAYERS };

    if (!settings.enabled) { socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); socket.destroy(); return; }

    const key = roomKey(slug, roomName);
    const room = getOrCreateRoom(key);
    if (room.clients.size >= (settings.maxPlayers || DEFAULT_MAX_PLAYERS)) {
      socket.write("HTTP/1.1 409 Conflict\r\n\r\n"); socket.destroy(); return;
    }

    wss.handleUpgrade(req, socket, head, ws => {
      const id = crypto.randomUUID();
      const name = sanitizeName(url.searchParams.get("name"));
      const client = { ws, name, joinedAt: Date.now(), budget: MAX_MESSAGES_PER_SECOND, budgetAt: Date.now(), alive: true };
      room.clients.set(id, client);

      safeSend(ws, {
        type: "welcome", id, room: roomName, slug,
        players: playerList(room),
        shared: Object.fromEntries(room.shared)
      });
      broadcast(room, { type: "player-joined", id, name, count: room.clients.size, players: playerList(room) }, id);

      ws.on("pong", () => { client.alive = true; });

      ws.on("message", raw => {
        if (!withinRateLimit(client)) return;
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        if (!msg || typeof msg !== "object") return;

        if (msg.type === "shared" && typeof msg.name === "string") {
          if (!room.shared.has(msg.name) && room.shared.size >= MAX_SHARED_KEYS) return;
          room.shared.set(msg.name, msg.value);
          broadcast(room, { type: "shared", name: msg.name, value: msg.value, from: id }, id);
        } else if (msg.type === "message" && typeof msg.channel === "string") {
          broadcast(room, { type: "message", channel: msg.channel, payload: msg.payload, from: id }, id);
        } else if (msg.type === "ping") {
          safeSend(ws, { type: "pong" });
        }
      });

      ws.on("close", () => removeClient(key, room, id));
      ws.on("error", () => removeClient(key, room, id));
    });
  });

  const heartbeat = setInterval(() => {
    for (const room of rooms.values()) {
      for (const [id, client] of room.clients) {
        if (!client.alive) { client.ws.terminate(); room.clients.delete(id); continue; }
        client.alive = false;
        try { client.ws.ping(); } catch { /* ignore */ }
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  return wss;
}

/** Live room stats for a game — powers the "connected players" readout in the editor's Multiplayer panel. */
function roomStats(slug) {
  const prefix = `${slug}::`;
  const out = [];
  for (const [key, room] of rooms) {
    if (!key.startsWith(prefix)) continue;
    out.push({ room: key.slice(prefix.length), players: playerList(room), count: room.clients.size });
  }
  return out;
}

module.exports = { attach, roomStats };
