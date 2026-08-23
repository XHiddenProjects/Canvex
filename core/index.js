"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const https = require("node:https");
const express = require("express");
const {
  createGame, listGames, readGame, deleteGame,
  listScenes, readScene, createScene, deleteScene, saveScene,
  listAssets, listAssetsDetailed, uploadAsset, deleteAsset, updateAsset, findAsset,
  readProjectSettings, updateProjectSettings,
  readMultiplayerSettings, updateMultiplayerSettings, writeMultiplayerConnectInfo,
  readPublicGameInfo, submitStat, readLeaderboard,
  listFileTree, createFileEntry, renameFileEntry, deleteFileEntry,
  readFileText, writeFileText, statFileEntry, importFiles, exportFileOrFolder
} = require("../src/game-manager");
const {
  SESSION_COOKIE,
  sessionCookieOptions,
  accountStatus,
  registerAccount,
  loginAccount,
  logoutAccount,
  changePassword,
  authenticateLocalRequest
} = require("../src/account-manager");
const multiplayerHub = require("./multiplayer-hub");
const tunnel = require("./tunnel");
const playerManager = require("../src/player-manager");
const { readThemeSettings, setActiveTheme, addCustomTheme, deleteCustomTheme } = require("../src/theme-manager");

const app = express();
const ROOT = path.resolve(__dirname, "..");
const CERTS_DIR = path.join(ROOT, "certs");
const TLS_KEY_FILE = process.env.TLS_KEY_FILE || "localhost-key.pem";
const TLS_CERT_FILE = process.env.TLS_CERT_FILE || "localhost.pem";
const TLS_CA_FILE = process.env.TLS_CA_FILE || "";
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || "127.0.0.1";

app.disable("x-powered-by");
// Each project can raise its own per-asset upload cap up to 100MB in Project
// Settings (src/game-manager.js's MAX_MAX_ASSET_MB) — this global body-parser
// limit is the outer bound every request has to fit under regardless of that
// per-project setting, so it needs headroom over 100MB for base64's ~1.37x
// encoding overhead, plus room for the File Manager's multi-file/folder
// import (several base64 `dataUrl`s batched into one JSON body).
app.use(express.json({ limit: "150mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  // img-src allows blob: alongside 'self'/data: — Three.js's GLTFLoader
  // decodes embedded glTF/GLB textures by turning them into a Blob and
  // loading that via an <img> (blob:...) rather than a data: URL, so the
  // model viewer/editor's texture loading needs it. blob: URLs are only
  // ever created by our own script from in-memory data (never a remote
  // origin), so this doesn't open the door to loading third-party images.
  res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self'; script-src-attr 'none'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  next();
});

// Tells the dashboard whether an account exists on this device yet, and
// whether the current browser session is already logged in — the client
// uses this on every load to decide: create-account screen, login screen,
// or the dashboard itself.
app.get("/api/account/status", async (req, res, next) => {
  try { res.json(await accountStatus(ROOT, req)); }
  catch (error) { next(error); }
});

// First-run only: creates the single local account for this device.
app.post("/api/account/register", async (req, res, next) => {
  try {
    const { account, sessionToken } = await registerAccount(ROOT, req.body || {});
    res.cookie(SESSION_COOKIE, sessionToken, sessionCookieOptions());
    res.status(201).json({ account });
  } catch (error) { next(error); }
});

// Returning users: verifies the password against the on-device account.
app.post("/api/account/login", async (req, res, next) => {
  try {
    const { account, sessionToken } = await loginAccount(ROOT, req.body || {});
    res.cookie(SESSION_COOKIE, sessionToken, sessionCookieOptions());
    res.status(200).json({ account });
  } catch (error) { next(error); }
});

app.post("/api/account/logout", async (req, res, next) => {
  try {
    await logoutAccount(ROOT);
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
    res.status(200).json({ ok: true });
  } catch (error) { next(error); }
});



// ---------------------------------------------------------------------------
// Public play surface: unlike everything below, these routes are reachable
// with NO login — this is what makes the `/play/:slug` link something you
// can actually hand to a friend. They're registered before the `/api` auth
// gate on purpose so they never hit it. Identity here is `player-manager.js`
// (guest-by-default, optional lightweight player account), which is a
// completely separate system from the single device account gated below.
// ---------------------------------------------------------------------------
app.get("/play/:slug", async (req, res, next) => {
  try {
    await readPublicGameInfo(ROOT, req.params.slug); // 404s early if the game doesn't exist
    res.sendFile(path.join(ROOT, "public", "play.html"));
  } catch (error) { next(error); }
});

app.get("/api/play/:slug/info", async (req, res, next) => {
  try { res.json({ game: await readPublicGameInfo(ROOT, req.params.slug) }); }
  catch (error) { next(error); }
});

app.get("/api/play/:slug/rooms", async (req, res, next) => {
  try {
    await readPublicGameInfo(ROOT, req.params.slug); // 404s if the game doesn't exist
    res.json({ rooms: multiplayerHub.roomStats(req.params.slug) });
  } catch (error) { next(error); }
});

app.get("/api/play/session", async (req, res, next) => {
  try {
    const identity = await playerManager.resolveSession(ROOT, req);
    res.json({ identity: identity || playerManager.createGuest(res) });
  } catch (error) { next(error); }
});

app.post("/api/play/session/guest", async (req, res, next) => {
  try {
    const existing = await playerManager.resolveSession(ROOT, req);
    const displayName = req.body?.displayName;
    const identity = existing?.kind === "guest"
      ? playerManager.renameGuest(res, existing.id, displayName)
      : playerManager.createGuest(res, displayName);
    res.json({ identity });
  } catch (error) { next(error); }
});

app.post("/api/play/session/register", async (req, res, next) => {
  try { res.status(201).json({ identity: await playerManager.registerPlayer(ROOT, res, req.body || {}) }); }
  catch (error) { next(error); }
});

app.post("/api/play/session/login", async (req, res, next) => {
  try { res.json({ identity: await playerManager.loginPlayer(ROOT, res, req.body || {}) }); }
  catch (error) { next(error); }
});

app.post("/api/play/session/logout", (_req, res) => {
  playerManager.logoutPlayer(res);
  res.json({ ok: true });
});

app.post("/api/play/:slug/stats", async (req, res, next) => {
  try {
    const identity = (await playerManager.resolveSession(ROOT, req)) || playerManager.createGuest(res);
    res.json({ entry: await submitStat(ROOT, req.params.slug, identity, req.body || {}) });
  } catch (error) { next(error); }
});

app.get("/api/play/:slug/leaderboard", async (req, res, next) => {
  try { res.json({ leaderboard: await readLeaderboard(ROOT, req.params.slug, req.query.key, req.query.limit) }); }
  catch (error) { next(error); }
});

// Everything else under /api requires an authenticated session.
app.use("/api", (req, res, next) => authenticateLocalRequest(ROOT, req, res, next));

app.post("/api/account/change-password", async (req, res, next) => {
  try {
    const { account, sessionToken } = await changePassword(ROOT, req.body || {});
    res.cookie(SESSION_COOKIE, sessionToken, sessionCookieOptions());
    res.status(200).json({ account });
  } catch (error) { next(error); }
});

// Theme: device-wide (not per-project) preset/custom theme selection, read
// and written from the editor's Edit menu → "Editor Settings…" panel (see
// assets/js/theme-manager.js and theme-manager-panel.js).
app.get("/api/theme", async (_req, res, next) => {
  try { res.json(await readThemeSettings(ROOT)); }
  catch (error) { next(error); }
});

app.put("/api/theme/active", async (req, res, next) => {
  try { res.json(await setActiveTheme(ROOT, req.body?.themeId)); }
  catch (error) { next(error); }
});

app.post("/api/theme/custom", async (req, res, next) => {
  try { res.status(201).json(await addCustomTheme(ROOT, req.body || {})); }
  catch (error) { next(error); }
});

app.delete("/api/theme/custom/:id", async (req, res, next) => {
  try { res.json(await deleteCustomTheme(ROOT, req.params.id)); }
  catch (error) { next(error); }
});

app.get("/api/games", async (_req, res, next) => {
  try { res.json({ games: await listGames(ROOT) }); } catch (error) { next(error); }
});

app.post("/api/games", async (req, res, next) => {
  try {
    const game = await createGame(ROOT, req.body || {});
    res.status(201).json({ game, editorUrl: `/editor/${encodeURIComponent(game.slug)}` });
  } catch (error) { next(error); }
});

app.get("/api/games/:slug", async (req, res, next) => {
  try { res.json({ game: await readGame(ROOT, req.params.slug) }); }
  catch (error) { next(error); }
});

app.delete("/api/games/:slug", async (req, res, next) => {
  try { res.json(await deleteGame(ROOT, req.params.slug)); }
  catch (error) { next(error); }
});

app.get("/api/assets", async (_req, res, next) => {
  try { res.json({ games: await listAssets(ROOT) }); } catch (error) { next(error); }
});

// Scenes (levels): a game can hold several, each edited/saved independently.
app.get("/api/games/:slug/scenes", async (req, res, next) => {
  try { res.json({ scenes: await listScenes(ROOT, req.params.slug) }); }
  catch (error) { next(error); }
});

app.post("/api/games/:slug/scenes", async (req, res, next) => {
  try { res.status(201).json({ scene: await createScene(ROOT, req.params.slug, req.body || {}) }); }
  catch (error) { next(error); }
});

app.get("/api/games/:slug/scenes/:sceneId", async (req, res, next) => {
  try { res.json({ scene: await readScene(ROOT, req.params.slug, req.params.sceneId) }); }
  catch (error) { next(error); }
});

app.put("/api/games/:slug/scenes/:sceneId", async (req, res, next) => {
  try { res.json({ scene: await saveScene(ROOT, req.params.slug, req.params.sceneId, req.body || {}) }); }
  catch (error) { next(error); }
});

app.delete("/api/games/:slug/scenes/:sceneId", async (req, res, next) => {
  try { res.json(await deleteScene(ROOT, req.params.slug, req.params.sceneId)); }
  catch (error) { next(error); }
});

// Backward-compatible single-scene route, defaults to the "main" scene.
app.put("/api/games/:slug/scene", async (req, res, next) => {
  try { res.json({ scene: await saveScene(ROOT, req.params.slug, "main", req.body || {}) }); }
  catch (error) { next(error); }
});

// Project settings: name, canvas size/background, and per-project upload
// cap — read and written from the editor's Project menu → "Project
// Settings…" panel (see assets/js/project-settings-panel.js).
app.get("/api/games/:slug/settings", async (req, res, next) => {
  try { res.json({ settings: await readProjectSettings(ROOT, req.params.slug) }); }
  catch (error) { next(error); }
});

app.put("/api/games/:slug/settings", async (req, res, next) => {
  try { res.json({ settings: await updateProjectSettings(ROOT, req.params.slug, req.body || {}) }); }
  catch (error) { next(error); }
});

// Multiplayer: per-game settings (enabled / room name / player cap), read
// and written from the editor's Multiplayer panel (Project menu).
app.get("/api/games/:slug/multiplayer", async (req, res, next) => {
  try { res.json({ multiplayer: await readMultiplayerSettings(ROOT, req.params.slug) }); }
  catch (error) { next(error); }
});

app.put("/api/games/:slug/multiplayer", async (req, res, next) => {
  try {
    const multiplayer = await updateMultiplayerSettings(ROOT, req.params.slug, req.body || {});
    // Keep this game's `.forge/multiplayer.json` (read automatically by
    // `connectMultiplayer()` at runtime) pointing at whatever's reachable
    // right now, so a saved room-name change takes effect without the user
    // touching the game script.
    await writeMultiplayerConnectInfo(ROOT, req.params.slug, { url: currentConnectUrlFor(req.params.slug) });
    res.json({ multiplayer });
  } catch (error) { next(error); }
});

// Live player/room counts for the game, so the editor can show who's
// actually connected right now (polled while the Multiplayer panel is open).
app.get("/api/games/:slug/multiplayer/rooms", (req, res) => {
  res.json({ rooms: multiplayerHub.roomStats(req.params.slug) });
});

// Public tunnel: exposes this local server (including the /mp multiplayer
// WebSocket path) behind a single shareable internet URL via `localtunnel`,
// so players outside the host's network can join. One tunnel per running
// server process. The subdomain requested is always the game's own slug
// (so the link reads `wss://<game-name>.loca.lt`), and whichever game the
// tunnel currently belongs to gets its `.forge/multiplayer.json` connect
// file kept in sync automatically — nothing for the user to copy or paste.
let boundPort = PORT; // updated to the real listening port once the server starts (PORT may be 0 = "OS picks one")
function localWsUrl() { return `wss://${HOST}:${boundPort}`; }
function currentConnectUrlFor(slug) {
  const t = tunnel.status();
  return t.active && t.slug === slug ? t.url.replace(/^http/, "ws") : localWsUrl();
}

app.get("/api/multiplayer/tunnel", (_req, res) => {
  res.json({ tunnel: tunnel.status() });
});

app.post("/api/multiplayer/tunnel", async (req, res, next) => {
  try {
    const slug = req.body?.slug;
    const result = await tunnel.start(boundPort, { subdomain: slug, slug });
    if (slug) await writeMultiplayerConnectInfo(ROOT, slug, { url: result.url.replace(/^http/, "ws") });
    res.json({ tunnel: result });
  } catch (error) { next(error); }
});

app.delete("/api/multiplayer/tunnel", async (_req, res, next) => {
  try {
    const wasSlug = tunnel.status().slug;
    const result = await tunnel.stop();
    if (wasSlug) await writeMultiplayerConnectInfo(ROOT, wasSlug, { url: localWsUrl() });
    res.json({ tunnel: result });
  } catch (error) { next(error); }
});

// Assets: organized per-game under assets/<category>/, each with a JSON
// metadata sidecar (name, tags, size, timestamps, and script source for code assets).
app.get("/api/games/:slug/assets", async (req, res, next) => {
  try { res.json({ assets: await listAssetsDetailed(ROOT, req.params.slug) }); }
  catch (error) { next(error); }
});

app.post("/api/games/:slug/assets", async (req, res, next) => {
  try { res.status(201).json({ asset: await uploadAsset(ROOT, req.params.slug, req.body || {}) }); }
  catch (error) { next(error); }
});

app.patch("/api/games/:slug/assets/:assetId", async (req, res, next) => {
  try { res.json({ asset: await updateAsset(ROOT, req.params.slug, req.params.assetId, req.body || {}) }); }
  catch (error) { next(error); }
});

app.delete("/api/games/:slug/assets/:assetId", async (req, res, next) => {
  try { res.json(await deleteAsset(ROOT, req.params.slug, req.params.assetId)); }
  catch (error) { next(error); }
});

app.get("/api/games/:slug/assets/:assetId/file", async (req, res, next) => {
  try {
    const { meta, filePath } = await findAsset(ROOT, req.params.slug, req.params.assetId);
    res.setHeader("Content-Type", meta.mime || "application/octet-stream");
    res.sendFile(filePath);
  } catch (error) { next(error); }
});

// File Manager: a general-purpose, nested folder/file tree per game, kept
// under games/<slug>/files/ — see the "File Manager" section of
// src/game-manager.js for how this differs from assets/scenes/src.
app.get("/api/games/:slug/files", async (req, res, next) => {
  try { res.json({ tree: await listFileTree(ROOT, req.params.slug) }); }
  catch (error) { next(error); }
});

app.post("/api/games/:slug/files", async (req, res, next) => {
  try { res.status(201).json({ entry: await createFileEntry(ROOT, req.params.slug, req.body || {}) }); }
  catch (error) { next(error); }
});

app.put("/api/games/:slug/files/rename", async (req, res, next) => {
  try { res.json({ entry: await renameFileEntry(ROOT, req.params.slug, req.body || {}) }); }
  catch (error) { next(error); }
});

app.delete("/api/games/:slug/files", async (req, res, next) => {
  try { res.json(await deleteFileEntry(ROOT, req.params.slug, req.query.path)); }
  catch (error) { next(error); }
});

app.get("/api/games/:slug/files/content", async (req, res, next) => {
  try { res.json(await readFileText(ROOT, req.params.slug, req.query.path)); }
  catch (error) { next(error); }
});

app.put("/api/games/:slug/files/content", async (req, res, next) => {
  try { res.json(await writeFileText(ROOT, req.params.slug, req.body || {})); }
  catch (error) { next(error); }
});

app.post("/api/games/:slug/files/import", async (req, res, next) => {
  try { res.status(201).json(await importFiles(ROOT, req.params.slug, req.body || {})); }
  catch (error) { next(error); }
});

// Inline preview (image <img>, video/audio <source>, etc.) — no
// Content-Disposition, so the browser renders it instead of downloading it.
app.get("/api/games/:slug/files/raw", async (req, res, next) => {
  try {
    const { abs, mime } = await statFileEntry(ROOT, req.params.slug, req.query.path);
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(abs);
  } catch (error) { next(error); }
});

// Export: a single file downloads as-is; a folder downloads as a .zip
// built on the fly (see exportFileOrFolder / src/zip-writer.js).
app.get("/api/games/:slug/files/export", async (req, res, next) => {
  try {
    const result = await exportFileOrFolder(ROOT, req.params.slug, req.query.path || "");
    if (result.kind === "file") {
      res.setHeader("Content-Type", result.mime);
      res.setHeader("Content-Disposition", `attachment; filename="${result.name.replace(/"/g, "")}"`);
      res.sendFile(result.abs);
    } else {
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${result.name.replace(/"/g, "")}"`);
      res.send(result.buffer);
    }
  } catch (error) { next(error); }
});

app.use("/assets", express.static(path.join(ROOT, "assets"), { fallthrough: false }));
app.use("/utils", express.static(path.join(ROOT, "utils", "src"), { fallthrough: false }));
app.get(["/editor", "/editor/:slug"], (_req, res) => {
  res.sendFile(path.join(ROOT, "public", "editor.html"));
});
app.use(express.static(path.join(ROOT, "public")));

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: status >= 500 ? "Internal server error" : error.message });
});

async function loadTlsOptions() {
  const options = {
    key: await fs.readFile(path.join(CERTS_DIR, TLS_KEY_FILE)),
    cert: await fs.readFile(path.join(CERTS_DIR, TLS_CERT_FILE)),
    minVersion: "TLSv1.2"
  };
  if (TLS_CA_FILE) options.ca = await fs.readFile(path.join(CERTS_DIR, TLS_CA_FILE));
  return options;
}

async function startServer() {
  try {
    await fs.mkdir(path.join(ROOT, "games"), { recursive: true });
    const tlsOptions = await loadTlsOptions();
    const server = https.createServer(tlsOptions, app);
    multiplayerHub.attach(server, { getSettings: slug => readMultiplayerSettings(ROOT, slug).catch(() => null) });
    server.listen(PORT, HOST, async () => {
      boundPort = server.address().port;
      console.log(`ForgeEngine: https://${HOST}:${boundPort}`);
      // Now that the server actually knows its own address, backfill every
      // game's `.forge/multiplayer.json` with the real local connect URL
      // (it starts out null at game-creation time) so `connectMultiplayer()`
      // works out of the box without anyone opening the Multiplayer panel.
      try {
        const games = await listGames(ROOT);
        await Promise.all(games.map(g =>
          writeMultiplayerConnectInfo(ROOT, g.slug, { url: `wss://${HOST}:${boundPort}` }).catch(() => {})
        ));
      } catch { /* non-fatal — connect info stays whatever it was */ }
    });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      console.error(`HTTPS certificates were not found. Expected ${path.join(CERTS_DIR, TLS_KEY_FILE)} and ${path.join(CERTS_DIR, TLS_CERT_FILE)}.`);
    }
    console.error(error);
    process.exitCode = 1;
  }
}

startServer();
module.exports = app;