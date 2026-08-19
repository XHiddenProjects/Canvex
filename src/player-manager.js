"use strict";

/**
 * Player accounts — deliberately a *separate* system from `account-manager.js`.
 * That module is the single login for the person who owns this ForgeEngine
 * install (the creator). This module is for the people who open a game's
 * `/play/:slug` link: anyone can play instantly as a guest (no signup), and
 * can optionally register a lightweight player account so their name and
 * stats follow them across browsers/devices instead of living only in one
 * browser's cookies.
 */

const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");

const PLAYERS_PATH = root => path.join(root, ".forge", "players.json");
const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

const GUEST_COOKIE = "forge_guest";
const PLAYER_COOKIE = "forge_player";
const guestCookieOptions = () => ({ httpOnly: true, sameSite: "lax", secure: true, path: "/" });
// 180 days: the whole point of registering is that this outlives a browser session.
const playerCookieOptions = () => ({ httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 180 * 24 * 60 * 60 * 1000 });

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

function cookies(header = "") {
  return Object.fromEntries(
    header.split(";").map(v => v.trim()).filter(Boolean).map(v => {
      const i = v.indexOf("="); return [decodeURIComponent(v.slice(0, i)), decodeURIComponent(v.slice(i + 1))];
    })
  );
}

function hashToken(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a || "")), bufB = Buffer.from(String(b || ""));
  if (bufA.length !== bufB.length) { crypto.timingSafeEqual(bufA, bufA); return false; }
  return crypto.timingSafeEqual(bufA, bufB);
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: crypto.scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS).toString("hex") };
}
function verifyPassword(password, record) {
  if (!record?.salt || !record?.hash) return false;
  return timingSafeStringEqual(crypto.scryptSync(password, record.salt, SCRYPT_KEYLEN, SCRYPT_PARAMS).toString("hex"), record.hash);
}

function validName(displayName) {
  const value = String(displayName || "").trim().slice(0, 32);
  return value || `Guest-${crypto.randomBytes(2).toString("hex")}`;
}

async function readPlayers(root) {
  try { return JSON.parse(await fs.readFile(PLAYERS_PATH(root), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}
async function writePlayers(root, players) {
  const filePath = PLAYERS_PATH(root);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(players, null, 2));
}

function publicIdentity(kind, { id, displayName }) { return { kind, id, displayName }; }

/**
 * Resolves whoever is making this request: a registered player (if their
 * `forge_player` cookie matches a stored session), a guest (if they have a
 * `forge_guest` cookie from a previous visit), or `null` if this is their
 * first request and the caller should create a guest identity for them.
 */
async function resolveSession(root, req) {
  const jar = cookies(req.headers.cookie);

  if (jar[PLAYER_COOKIE]) {
    try {
      const { id, token } = JSON.parse(Buffer.from(jar[PLAYER_COOKIE], "base64url").toString("utf8"));
      const players = await readPlayers(root);
      const player = players.find(p => p.id === id);
      if (player && timingSafeStringEqual(hashToken(token), player.sessionHash || "")) {
        return publicIdentity("account", player);
      }
    } catch { /* malformed/stale cookie — fall through */ }
  }

  if (jar[GUEST_COOKIE]) {
    try {
      const { id, displayName } = JSON.parse(Buffer.from(jar[GUEST_COOKIE], "base64url").toString("utf8"));
      if (id) return publicIdentity("guest", { id, displayName: validName(displayName) });
    } catch { /* malformed cookie — fall through */ }
  }

  return null;
}

/** Issues a fresh guest identity and the cookie that carries it (no server-side storage needed). */
function createGuest(res, displayName) {
  const identity = { id: crypto.randomUUID(), displayName: validName(displayName) };
  res.cookie(GUEST_COOKIE, Buffer.from(JSON.stringify(identity)).toString("base64url"), guestCookieOptions());
  return publicIdentity("guest", identity);
}

/** Lets a guest rename themselves without losing their id (and therefore their stats-so-far). */
function renameGuest(res, existingId, displayName) {
  const identity = { id: existingId, displayName: validName(displayName) };
  res.cookie(GUEST_COOKIE, Buffer.from(JSON.stringify(identity)).toString("base64url"), guestCookieOptions());
  return publicIdentity("guest", identity);
}

/** Registers a new player account (display name must be unique) and logs them in. */
async function registerPlayer(root, res, { displayName, password }) {
  const name = validName(displayName);
  if (String(password || "").length < 8) throw httpError(400, "Password must be at least 8 characters");

  const players = await readPlayers(root);
  if (players.some(p => p.displayName.toLowerCase() === name.toLowerCase())) {
    throw httpError(409, "That name is already taken — try logging in, or pick another name");
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  const player = { id: crypto.randomUUID(), displayName: name, password: hashPassword(password), createdAt: now, updatedAt: now, sessionHash: hashToken(token) };
  players.push(player);
  await writePlayers(root, players);

  res.cookie(PLAYER_COOKIE, Buffer.from(JSON.stringify({ id: player.id, token })).toString("base64url"), playerCookieOptions());
  res.clearCookie(GUEST_COOKIE, guestCookieOptions());
  return publicIdentity("account", player);
}

/** Logs an existing player account back in on this browser. */
async function loginPlayer(root, res, { displayName, password }) {
  const name = validName(displayName);
  const players = await readPlayers(root);
  const player = players.find(p => p.displayName.toLowerCase() === name.toLowerCase());
  if (!player || !verifyPassword(String(password || ""), player.password)) throw httpError(401, "Incorrect name or password");

  const token = crypto.randomBytes(32).toString("base64url");
  player.sessionHash = hashToken(token);
  player.updatedAt = new Date().toISOString();
  await writePlayers(root, players);

  res.cookie(PLAYER_COOKIE, Buffer.from(JSON.stringify({ id: player.id, token })).toString("base64url"), playerCookieOptions());
  res.clearCookie(GUEST_COOKIE, guestCookieOptions());
  return publicIdentity("account", player);
}

function logoutPlayer(res) {
  res.clearCookie(PLAYER_COOKIE, playerCookieOptions());
  res.clearCookie(GUEST_COOKIE, guestCookieOptions());
}

module.exports = { resolveSession, createGuest, renameGuest, registerPlayer, loginPlayer, logoutPlayer };
