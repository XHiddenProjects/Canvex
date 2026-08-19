"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");

const TEMPLATES = new Set(["Blank Canvas", "2D Platformer", "Top Down"]);
const ASSET_CATEGORIES = new Set(["image", "audio", "model", "shader", "script", "font", "other"]);
const MAX_ASSET_BYTES = 12 * 1024 * 1024; // 12MB per asset (decoded)
const DEFAULT_MAX_PLAYERS = 8;
const MAX_ROOM_PLAYERS = 64;
function slugify(value) {
  return String(value).normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}
function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
function gamePath(root, slug) {
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(slug)) throw httpError(400, "Invalid game identifier");
  return path.join(root, "games", slug);
}

function starterSource(name, template) {
  const extras = template === "2D Platformer" ? "\n  // Platformer movement and physics go here." : template === "Top Down" ? "\n  // Top-down movement and camera go here." : "";
  return `"use strict";\n\n// ${name}\nfunction startGame() {\n  console.log("Starting ${name}");${extras}\n}\n\nstartGame();\n`;
}

async function createGame(root, input) {
  const name = String(input.name || "").trim();
  const template = TEMPLATES.has(input.template) ? input.template : "Blank Canvas";
  if (!name || name.length > 64) throw httpError(400, "Game name must contain 1 to 64 characters");
  const base = slugify(name);
  if (!base) throw httpError(400, "Game name must contain letters or numbers");
  let slug = base, index = 2;
  while (true) { try { await fs.access(gamePath(root, slug)); slug = `${base.slice(0, 43)}-${index++}`; } catch (e) { if (e.code === "ENOENT") break; throw e; } }
  const dir = gamePath(root, slug);
  const now = new Date().toISOString();
  const config = { schemaVersion: 1, name, slug, template, createdAt: now, updatedAt: now,
    entry: "src/main.js", engine: { width: 1280, height: 720, background: "#101827" },
    multiplayer: { enabled: false, roomName: "main", maxPlayers: DEFAULT_MAX_PLAYERS } };
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.mkdir(path.join(dir, "assets"), { recursive: true });
  await fs.mkdir(path.join(dir, "scenes"), { recursive: true });
  await fs.mkdir(path.join(dir, ".forge"), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(dir, "game.config.json"), JSON.stringify(config, null, 2)),
    fs.writeFile(path.join(dir, "src", "main.js"), starterSource(name, template)),
    fs.writeFile(path.join(dir, "scenes", "main.scene.json"), JSON.stringify({ name: "Main", objects: [], createdAt: now, updatedAt: now }, null, 2)),
    fs.writeFile(path.join(dir, "assets", ".gitkeep"), ""),
    // Placeholder connect info so `connectMultiplayer()` works the moment a
    // game script calls it, before anyone opens the Multiplayer panel —
    // the host part is filled in properly once the server knows its own
    // address (see `startServer` in core/index.js).
    fs.writeFile(path.join(dir, ".forge", "multiplayer.json"), JSON.stringify({ slug, room: "main", url: null, updatedAt: now }, null, 2))
  ]);
  return config;
}

async function listGames(root) {
  await fs.mkdir(path.join(root, "games"), { recursive: true });
  const entries = await fs.readdir(path.join(root, "games"), { withFileTypes: true });
  const values = await Promise.all(entries.filter(e => e.isDirectory()).map(async e => {
    try { return JSON.parse(await fs.readFile(path.join(root, "games", e.name, "game.config.json"), "utf8")); } catch { return null; }
  }));
  return values.filter(Boolean).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function readGame(root, slug) {
  try {
    const dir = gamePath(root, slug);
    const [config, source, scenes] = await Promise.all([
      fs.readFile(path.join(dir, "game.config.json"), "utf8"),
      fs.readFile(path.join(dir, "src", "main.js"), "utf8"),
      listScenes(root, slug)
    ]);
    return { config: JSON.parse(config), files: { "src/main.js": source }, scenes };
  } catch (error) { if (error.code === "ENOENT") throw httpError(404, "Game not found"); throw error; }
}

/** Deletes a game and everything under it (source, scenes, assets, metadata). */
async function deleteGame(root, slug) {
  const dir = gamePath(root, slug);
  try { await fs.access(dir); }
  catch (error) { if (error.code === "ENOENT") throw httpError(404, "Game not found"); throw error; }
  await fs.rm(dir, { recursive: true, force: true });
  return { slug, deleted: true };
}

/**
 * Reads the real `assets/` folder on disk for every game, so the dashboard's
 * Asset Library section reflects actual files instead of being a dead tab.
 */
async function listAssets(root) {
  const games = await listGames(root);
  const perGame = await Promise.all(games.map(async game => {
    const assets = await listAssetsDetailed(root, game.slug).catch(() => []);
    return { slug: game.slug, name: game.name, files: assets.map(a => a.fileName) };
  }));
  return perGame;
}

// ---------------------------------------------------------------------------
// Scenes: every game can hold multiple named scenes/levels, each stored as
// its own `scenes/<id>.scene.json` file so switching or adding levels never
// requires touching the others.
// ---------------------------------------------------------------------------

function sceneIdFromName(name, existingIds) {
  const base = slugify(name) || "scene";
  let id = base, index = 2;
  while (existingIds.has(id)) id = `${base.slice(0, 40)}-${index++}`;
  return id;
}

/** Lists every scene (id, name, object count, timestamps) for a game, sorted by name. */
async function listScenes(root, slug) {
  const dir = path.join(gamePath(root, slug), "scenes");
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = entries.filter(e => e.isFile() && e.name.endsWith(".scene.json"));
  const scenes = await Promise.all(files.map(async e => {
    const id = e.name.replace(/\.scene\.json$/, "");
    try {
      const data = JSON.parse(await fs.readFile(path.join(dir, e.name), "utf8"));
      return { id, name: data.name || id, objectCount: Array.isArray(data.objects) ? data.objects.length : 0,
        createdAt: data.createdAt || null, updatedAt: data.updatedAt || null };
    } catch { return null; }
  }));
  return scenes.filter(Boolean).sort((a, b) => (a.id === "main" ? -1 : b.id === "main" ? 1 : a.name.localeCompare(b.name)));
}

/** Reads one scene's full contents (name + objects) by id. */
async function readScene(root, slug, sceneId) {
  const dir = gamePath(root, slug);
  const id = String(sceneId || "main").trim().slice(0, 64) || "main";
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw httpError(400, "Invalid scene identifier");
  try {
    const data = JSON.parse(await fs.readFile(path.join(dir, "scenes", `${id}.scene.json`), "utf8"));
    return { id, ...data };
  } catch (error) { if (error.code === "ENOENT") throw httpError(404, "Scene not found"); throw error; }
}

/** Creates a new empty scene (level) for a game and returns its metadata. */
async function createScene(root, slug, input) {
  const dir = gamePath(root, slug);
  try { await fs.access(dir); } catch (error) { if (error.code === "ENOENT") throw httpError(404, "Game not found"); throw error; }
  const name = String(input?.name || "New Scene").trim().slice(0, 64) || "New Scene";
  const existing = await listScenes(root, slug);
  const id = sceneIdFromName(name, new Set(existing.map(s => s.id)));
  const now = new Date().toISOString();
  const scene = { name, objects: [], createdAt: now, updatedAt: now };
  await fs.writeFile(path.join(dir, "scenes", `${id}.scene.json`), JSON.stringify(scene, null, 2));
  return { id, ...scene };
}

/** Deletes a scene by id. The last remaining scene in a game cannot be deleted. */
async function deleteScene(root, slug, sceneId) {
  const dir = gamePath(root, slug);
  const existing = await listScenes(root, slug);
  if (existing.length <= 1) throw httpError(400, "A game must keep at least one scene");
  const id = String(sceneId || "").trim();
  if (!existing.some(s => s.id === id)) throw httpError(404, "Scene not found");
  await fs.rm(path.join(dir, "scenes", `${id}.scene.json`), { force: true });
  return { id, deleted: true };
}

const OBJECT_TYPES = new Set(["camera", "light", "sprite", "mesh", "group", "collider", "ui", "audio"]);

function sanitizeSceneObject(input) {
  const id = String(input?.id || "").trim().slice(0, 64);
  if (!id) return null;
  const num = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
  const str = (value, max, fallback = "") => (typeof value === "string" ? value.slice(0, max) : fallback);
  return {
    id,
    name: String(input?.name || "Game Object").slice(0, 64),
    type: OBJECT_TYPES.has(input?.type) ? input.type : "mesh",
    icon: String(input?.icon || "◇").slice(0, 4),
    parent: Boolean(input?.parent),
    indent: Math.max(0, Math.min(4, Math.round(num(input?.indent, 0)))),
    position: {
      x: num(input?.position?.x),
      y: num(input?.position?.y),
      z: num(input?.position?.z)
    },
    rotation: {
      x: num(input?.rotation?.x),
      y: num(input?.rotation?.y),
      z: num(input?.rotation?.z)
    },
    scale: {
      x: num(input?.scale?.x, 1),
      y: num(input?.scale?.y, 1),
      z: num(input?.scale?.z, 1)
    },
    enabled: input?.enabled !== false,
    visible: input?.visible !== false,
    tag: str(input?.tag, 32, "Untagged") || "Untagged",
    layer: str(input?.layer, 32, "Default") || "Default",
    attachments: Array.isArray(input?.attachments)
      ? input.attachments.slice(0, 32).map(a => ({
          id: str(a?.id, 64),
          name: str(a?.name, 128, "Asset"),
          category: str(a?.category, 32, "other"),
          assetId: str(a?.assetId, 64),
          url: str(a?.url, 512)
        })).filter(a => a.id)
      : [],
    // Image/pixel-art asset URL the viewport renders this object with (as a texture).
    spriteUrl: typeof input?.spriteUrl === "string" ? input.spriteUrl.slice(0, 512) : null,
    // Model (.obj) asset URL the viewport loads and renders this object with.
    modelUrl: typeof input?.modelUrl === "string" ? input.modelUrl.slice(0, 512) : null
  };
}

/**
 * Persists the editor's scene tree (name + objects) to `scenes/<id>.scene.json`
 * and bumps the game's `updatedAt` so the dashboard's "recently edited" and
 * sort-by-updated views reflect the save.
 */
async function saveScene(root, slug, sceneId, input) {
  const dir = gamePath(root, slug);
  const configPath = path.join(dir, "game.config.json");
  let config;
  try { config = JSON.parse(await fs.readFile(configPath, "utf8")); }
  catch (error) { if (error.code === "ENOENT") throw httpError(404, "Game not found"); throw error; }

  const id = String(sceneId || "main").trim().slice(0, 64) || "main";
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw httpError(400, "Invalid scene identifier");

  if (!input || typeof input !== "object" || !Array.isArray(input.objects)) {
    throw httpError(400, "Scene must include an objects array");
  }
  if (input.objects.length > 500) throw httpError(400, "A scene can contain at most 500 objects");

  const scenePath = path.join(dir, "scenes", `${id}.scene.json`);
  let createdAt = new Date().toISOString();
  try { createdAt = JSON.parse(await fs.readFile(scenePath, "utf8")).createdAt || createdAt; } catch { /* new scene file */ }

  const scene = {
    name: String(input.name || "Main").trim().slice(0, 64) || "Main",
    objects: input.objects.map(sanitizeSceneObject).filter(Boolean),
    createdAt,
    updatedAt: new Date().toISOString()
  };

  await fs.writeFile(scenePath, JSON.stringify(scene, null, 2));
  config.updatedAt = new Date().toISOString();
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));

  return { id, ...scene };
}

// ---------------------------------------------------------------------------
// Multiplayer: per-game settings (enabled, room name, player cap) that the
// editor's Multiplayer panel reads/writes and that `core/multiplayer-hub.js`
// enforces when a remote player tries to join over the public tunnel link.
// ---------------------------------------------------------------------------

function sanitizeRoomName(value) {
  const slug = slugify(value || "main");
  return slug || "main";
}

/** Reads a game's multiplayer settings, filling in defaults for games created before this feature existed. */
async function readMultiplayerSettings(root, slug) {
  const { config } = await readGame(root, slug);
  return config.multiplayer || { enabled: false, roomName: "main", maxPlayers: DEFAULT_MAX_PLAYERS };
}

/** Updates a game's multiplayer settings (enabled / room name / max players) from the editor's Multiplayer panel. */
async function updateMultiplayerSettings(root, slug, input) {
  const dir = gamePath(root, slug);
  const configPath = path.join(dir, "game.config.json");
  let config;
  try { config = JSON.parse(await fs.readFile(configPath, "utf8")); }
  catch (error) { if (error.code === "ENOENT") throw httpError(404, "Game not found"); throw error; }

  const current = config.multiplayer || { enabled: false, roomName: "main", maxPlayers: DEFAULT_MAX_PLAYERS };
  const maxPlayers = Number.isFinite(input?.maxPlayers) ? Math.min(Math.max(Math.trunc(input.maxPlayers), 1), MAX_ROOM_PLAYERS) : current.maxPlayers;
  const multiplayer = {
    enabled: typeof input?.enabled === "boolean" ? input.enabled : current.enabled,
    roomName: input?.roomName !== undefined ? sanitizeRoomName(input.roomName) : current.roomName,
    maxPlayers
  };

  config.multiplayer = multiplayer;
  config.updatedAt = new Date().toISOString();
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  return multiplayer;
}

/**
 * Writes `games/<slug>/.forge/multiplayer.json` — the file `connectMultiplayer()`
 * in `utils/src/network.js` reads at runtime so a game script never has to
 * hardcode (or have a human copy-paste) a connection URL. Called by the
 * server itself whenever the facts change: multiplayer settings are saved,
 * or the public tunnel starts/stops. `url` is whatever is reachable right
 * now — the public tunnel's `wss://<slug>.loca.lt` while "Go Public" is on,
 * otherwise the local `wss://<host>:<port>`.
 */
async function writeMultiplayerConnectInfo(root, slug, { url }) {
  const dir = gamePath(root, slug);
  const forgeDir = path.join(dir, ".forge");
  const settings = await readMultiplayerSettings(root, slug);
  await fs.mkdir(forgeDir, { recursive: true });
  await fs.writeFile(
    path.join(forgeDir, "multiplayer.json"),
    JSON.stringify({ slug, room: settings.roomName, url, updatedAt: new Date().toISOString() }, null, 2)
  );
}

// ---------------------------------------------------------------------------
// Public play info + stats: the `/play/:slug` page (no login required) only
// ever needs to know a game's *name* and multiplayer room — never its full
// source/scenes/assets — so this stays a narrow, deliberately public-safe
// view. Stats are keyed by playerId (see src/player-manager.js: a guest's
// browser cookie, or a registered player's account id) so a leaderboard
// entry survives a page reload for guests, and survives a new browser
// entirely for anyone who registered.
// ---------------------------------------------------------------------------

/** Public-safe game info for the play page — no source, no assets, no auth. */
async function readPublicGameInfo(root, slug) {
  const { config } = await readGame(root, slug);
  return {
    slug: config.slug, name: config.name,
    multiplayer: config.multiplayer || { enabled: false, roomName: "main", maxPlayers: DEFAULT_MAX_PLAYERS }
  };
}

const STATS_PATH = (root, slug) => path.join(gamePath(root, slug), ".forge", "stats.json");

async function readStats(root, slug) {
  try { return JSON.parse(await fs.readFile(STATS_PATH(root, slug), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return {}; throw error; }
}

/** Saves one stat value (e.g. `{ key: "score", value: 1400 }`) for one player. */
async function submitStat(root, slug, player, { key, value }) {
  const statKey = String(key || "").trim().slice(0, 32);
  if (!statKey) throw httpError(400, "A stat key is required");
  if (value === undefined || (typeof value !== "number" && typeof value !== "string" && typeof value !== "boolean")) {
    throw httpError(400, "A stat value (number, string, or boolean) is required");
  }

  const stats = await readStats(root, slug);
  const entry = stats[player.id] || { displayName: player.displayName, kind: player.kind, entries: {} };
  entry.displayName = player.displayName; // keep in sync if they renamed
  entry.kind = player.kind;
  entry.entries[statKey] = value;
  entry.updatedAt = new Date().toISOString();
  stats[player.id] = entry;

  const dir = path.dirname(STATS_PATH(root, slug));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(STATS_PATH(root, slug), JSON.stringify(stats, null, 2));
  return entry;
}

/** Top N players for one stat key, highest value first. */
async function readLeaderboard(root, slug, key, limit = 10) {
  const stats = await readStats(root, slug);
  return Object.entries(stats)
    .filter(([, entry]) => entry.entries && key in entry.entries && typeof entry.entries[key] === "number")
    .map(([playerId, entry]) => ({ playerId, displayName: entry.displayName, kind: entry.kind, value: entry.entries[key] }))
    .sort((a, b) => b.value - a.value)
    .slice(0, Math.max(1, Math.min(Number(limit) || 10, 100)));
}

// ---------------------------------------------------------------------------
// Assets: every uploaded file lives under `assets/<category>/<fileName>` with
// a sibling `<fileName>.meta.json` carrying its metadata (id, display name,
// category, tags, size, timestamps, and — for scripts — the source code).
// This keeps every asset's data and metadata organized and co-located.
// ---------------------------------------------------------------------------

function assetsDir(root, slug) { return path.join(gamePath(root, slug), "assets"); }

function categoryFromMime(mime = "") {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("font/") || mime.includes("font")) return "font";
  return "other";
}

/** Lists every asset for a game with full metadata, grouped by category on the client. */
async function listAssetsDetailed(root, slug) {
  const dir = assetsDir(root, slug);
  await fs.mkdir(dir, { recursive: true });
  const categories = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const assets = [];
  for (const cat of categories) {
    if (!cat.isDirectory()) continue;
    const catDir = path.join(dir, cat.name);
    const files = await fs.readdir(catDir, { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".meta.json")) continue;
      try {
        const meta = JSON.parse(await fs.readFile(path.join(catDir, file.name), "utf8"));
        assets.push({ ...meta, url: `/api/games/${slug}/assets/${meta.id}/file` });
      } catch { /* skip corrupt metadata */ }
    }
  }
  return assets.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Saves an uploaded asset. Binary/text uploads carry `dataUrl` (a base64
 * `data:` URI from the browser's FileReader); script assets instead carry
 * `code` (plain text, generated by the block editor or typed by hand).
 *
 * Saving under a name that already exists (same display name, same
 * category — matched case/whitespace-insensitively) overwrites that asset
 * in place: same id, same on-disk file, `createdAt` preserved, `updatedAt`
 * bumped, and `overwritten: true` on the returned record so the editor can
 * show "overwrote existing …" instead of "saved a new …". Anything else is
 * created fresh.
 */
async function uploadAsset(root, slug, input) {
  const dir = gamePath(root, slug);
  try { await fs.access(dir); } catch (error) { if (error.code === "ENOENT") throw httpError(404, "Game not found"); throw error; }

  const name = String(input?.name || "").trim().slice(0, 128);
  if (!name) throw httpError(400, "Asset name is required");
  const category = ASSET_CATEGORIES.has(input?.category) ? input.category : "other";
  const tags = Array.isArray(input?.tags) ? input.tags.map(t => String(t).slice(0, 32)).slice(0, 16) : [];

  let buffer, mime = input?.mime || "application/octet-stream", ext = "";
  if (typeof input?.code === "string") {
    buffer = Buffer.from(input.code, "utf8");
    // Scripts used to be saved as "text/plain", which is why downloading
    // one looked like a generic .txt file instead of a .js file — give
    // each code-backed category a mime that actually matches what it is.
    mime = category === "shader" ? "text/plain" : "text/javascript";
    ext = category === "shader" ? ".glsl" : ".js";
  } else if (typeof input?.dataUrl === "string") {
    const match = /^data:([^;]+);base64,(.+)$/.exec(input.dataUrl.trim());
    if (!match) throw httpError(400, "dataUrl must be a base64 data: URI");
    mime = match[1] || mime;
    buffer = Buffer.from(match[2], "base64");
    const extMatch = /\.[a-z0-9]+$/i.exec(name);
    ext = extMatch ? "" : guessExtension(mime);
  } else {
    throw httpError(400, "Asset upload must include dataUrl or code");
  }
  if (buffer.length > MAX_ASSET_BYTES) throw httpError(413, "Asset exceeds the 12MB upload limit");

  const catDir = path.join(assetsDir(root, slug), category);
  await fs.mkdir(catDir, { recursive: true });

  // Look for an existing asset with the same name in the same category —
  // that's what "save" overwrites, rather than piling up a new file per save.
  const existing = (await listAssetsDetailed(root, slug))
    .find(a => a.category === category && a.name.trim().toLowerCase() === name.toLowerCase());

  const now = new Date().toISOString();
  let id, fileName, createdAt, overwritten;
  if (existing) {
    id = existing.id;
    createdAt = existing.createdAt || now;
    overwritten = true;
    // Keep the same file name unless the extension actually changed (e.g.
    // re-saving a model over a shader slot never happens in practice, but
    // stay safe rather than leave two files referencing one id).
    const wantExt = ext || path.extname(existing.fileName) || path.extname(name);
    const prevExt = path.extname(existing.fileName);
    if (wantExt && wantExt !== prevExt) {
      await fs.rm(path.join(catDir, existing.fileName), { force: true });
      await fs.rm(path.join(catDir, `${existing.fileName}.meta.json`), { force: true });
      fileName = `${slugify(name) || "asset"}-${id.slice(0, 8)}${wantExt}`;
    } else {
      fileName = existing.fileName;
    }
  } else {
    id = crypto.randomUUID();
    createdAt = now;
    overwritten = false;
    fileName = `${slugify(name) || "asset"}-${id.slice(0, 8)}${ext || path.extname(name)}`;
  }

  await fs.writeFile(path.join(catDir, fileName), buffer);

  const meta = {
    id, name, category, tags, fileName, mime, size: buffer.length,
    script: typeof input?.code === "string" ? input.code : undefined,
    // Only the Block Editor sends this: the raw node/connection graph
    // behind a generated script, so re-opening that asset for editing can
    // load the actual visual graph back in instead of just the text it
    // compiled to (which can't be reversed back into blocks).
    graph: (category === "script" && input?.graph && typeof input.graph === "object") ? input.graph : undefined,
    createdAt, updatedAt: now
  };
  await fs.writeFile(path.join(catDir, `${fileName}.meta.json`), JSON.stringify(meta, null, 2));
  return { ...meta, overwritten, url: `/api/games/${slug}/assets/${id}/file` };
}

function guessExtension(mime) {
  const map = {
    "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/svg+xml": ".svg",
    "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/ogg": ".ogg",
    "application/json": ".json", "text/plain": ".txt"
  };
  return map[mime] || "";
}

/** Finds an asset's metadata + on-disk file path by id, or throws 404. */
async function findAsset(root, slug, assetId) {
  const assets = await listAssetsDetailed(root, slug);
  const meta = assets.find(a => a.id === assetId);
  if (!meta) throw httpError(404, "Asset not found");
  const filePath = path.join(assetsDir(root, slug), meta.category, meta.fileName);
  return { meta, filePath, metaPath: `${filePath}.meta.json` };
}

/** Deletes an asset's file and its metadata sidecar. */
async function deleteAsset(root, slug, assetId) {
  const { filePath, metaPath } = await findAsset(root, slug, assetId);
  await Promise.all([fs.rm(filePath, { force: true }), fs.rm(metaPath, { force: true })]);
  return { id: assetId, deleted: true };
}

/** Updates an asset's display name/tags/script contents without changing its id. */
async function updateAsset(root, slug, assetId, input) {
  const { meta, metaPath } = await findAsset(root, slug, assetId);
  if (input?.name) meta.name = String(input.name).trim().slice(0, 128);
  if (Array.isArray(input?.tags)) meta.tags = input.tags.map(t => String(t).slice(0, 32)).slice(0, 16);
  if (typeof input?.code === "string") meta.script = input.code;
  if (input?.graph && typeof input.graph === "object") meta.graph = input.graph;
  meta.updatedAt = new Date().toISOString();
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
  return { ...meta, url: `/api/games/${slug}/assets/${assetId}/file` };
}

module.exports = {
  createGame, listGames, readGame, deleteGame,
  listScenes, readScene, createScene, deleteScene, saveScene,
  listAssets, listAssetsDetailed, uploadAsset, deleteAsset, updateAsset, findAsset,
  readMultiplayerSettings, updateMultiplayerSettings, writeMultiplayerConnectInfo,
  readPublicGameInfo, submitStat, readLeaderboard
};