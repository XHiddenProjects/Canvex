"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { createZip } = require("./zip-writer");

const TEMPLATES = new Set(["Blank Canvas", "2D Platformer", "Top Down"]);
const ASSET_CATEGORIES = new Set(["image", "audio", "model", "shader", "script", "font", "other"]);
// Per-project upload cap (decoded bytes), configurable from the editor's
// Project Settings panel and persisted at config.limits.maxAssetMB. 12MB
// remains the default for new/legacy projects; MAX_MAX_ASSET_MB is a hard
// ceiling no project can raise itself past — keep this in sync with the
// express.json body limit in core/index.js (which must stay comfortably
// above MAX_MAX_ASSET_MB once base64 + JSON overhead is factored in).
const DEFAULT_MAX_ASSET_MB = 12;
const MIN_MAX_ASSET_MB = 1;
const MAX_MAX_ASSET_MB = 100;
const DEFAULT_MAX_PLAYERS = 8;
const MAX_ROOM_PLAYERS = 64;
function slugify(value) {
  return String(value).normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}
function httpError(status, message) { const error = new Error(message); error.status = status; return error; }

/** Resolves a project's configured upload cap, clamped to a safe range, with a default for projects saved before this setting existed. */
function assetByteLimit(config) {
  const raw = Number(config?.limits?.maxAssetMB);
  const mb = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), MIN_MAX_ASSET_MB), MAX_MAX_ASSET_MB) : DEFAULT_MAX_ASSET_MB;
  return { mb, bytes: mb * 1024 * 1024 };
}

/** Reads just a game's config.json (used where the full readGame() bundle — source + scenes — isn't needed). */
async function readConfig(root, slug) {
  try { return JSON.parse(await fs.readFile(path.join(gamePath(root, slug), "game.config.json"), "utf8")); }
  catch (error) { if (error.code === "ENOENT") throw httpError(404, "Game not found"); throw error; }
}
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
    multiplayer: { enabled: false, roomName: "main", maxPlayers: DEFAULT_MAX_PLAYERS },
    limits: { maxAssetMB: DEFAULT_MAX_ASSET_MB } };
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
// Project settings: name, canvas size/background, and the per-project
// upload cap — persisted at the top level / `config.limits` and edited from
// the editor's Project menu → "Project Settings…" panel.
// ---------------------------------------------------------------------------

/** Reads a game's editable project settings, filling in defaults for projects saved before a field existed. */
async function readProjectSettings(root, slug) {
  const config = await readConfig(root, slug);
  const { mb } = assetByteLimit(config);
  return {
    name: config.name,
    template: config.template,
    engine: config.engine || { width: 1280, height: 720, background: "#101827" },
    limits: { maxAssetMB: mb },
    maxAssetMBRange: { min: MIN_MAX_ASSET_MB, max: MAX_MAX_ASSET_MB }
  };
}

/** Updates a game's name, canvas width/height/background, and upload cap from the Project Settings panel. */
async function updateProjectSettings(root, slug, input) {
  const dir = gamePath(root, slug);
  const configPath = path.join(dir, "game.config.json");
  let config;
  try { config = JSON.parse(await fs.readFile(configPath, "utf8")); }
  catch (error) { if (error.code === "ENOENT") throw httpError(404, "Game not found"); throw error; }

  if (input?.name !== undefined) {
    const name = String(input.name).trim().slice(0, 64);
    if (!name) throw httpError(400, "Project name must contain 1 to 64 characters");
    config.name = name;
  }

  const engine = config.engine || { width: 1280, height: 720, background: "#101827" };
  if (input?.engine?.width !== undefined) {
    const width = Math.round(Number(input.engine.width));
    if (!Number.isFinite(width) || width < 64 || width > 7680) throw httpError(400, "Canvas width must be between 64 and 7680");
    engine.width = width;
  }
  if (input?.engine?.height !== undefined) {
    const height = Math.round(Number(input.engine.height));
    if (!Number.isFinite(height) || height < 64 || height > 7680) throw httpError(400, "Canvas height must be between 64 and 7680");
    engine.height = height;
  }
  if (input?.engine?.background !== undefined) {
    const background = String(input.engine.background).trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(background)) throw httpError(400, "Background must be a hex color like #101827");
    engine.background = background;
  }
  config.engine = engine;

  if (input?.limits?.maxAssetMB !== undefined) {
    const raw = Number(input.limits.maxAssetMB);
    if (!Number.isFinite(raw)) throw httpError(400, "Max upload size must be a number");
    if (raw < MIN_MAX_ASSET_MB || raw > MAX_MAX_ASSET_MB) throw httpError(400, `Max upload size must be between ${MIN_MAX_ASSET_MB}MB and ${MAX_MAX_ASSET_MB}MB`);
    config.limits = { ...config.limits, maxAssetMB: Math.trunc(raw) };
  }

  config.updatedAt = new Date().toISOString();
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  return readProjectSettings(root, slug);
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
  const config = await readConfig(root, slug);

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
  const { mb: maxMB, bytes: maxBytes } = assetByteLimit(config);
  if (buffer.length > maxBytes) throw httpError(413, `Asset exceeds this project's ${maxMB}MB upload limit (change it in Project Settings)`);

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

// ---------------------------------------------------------------------------
// File Manager: a general-purpose, nested folder/file tree per game, stored
// under games/<slug>/files/ — separate from assets/ (categorized, flat,
// engine-managed) and src/ (the single entry script) so the editor's File
// Manager popup can freely create/rename/delete/import/export arbitrary
// files and folders without disturbing either of those.
// ---------------------------------------------------------------------------

const MAX_TEXT_BYTES = 3 * 1024 * 1024; // 3MB cap for opening/saving a file as text
const MAX_IMPORT_FILES = 300; // per import batch (e.g. one "Import Folder" selection)

const MIME_BY_EXT = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp", ".ico": "image/x-icon",
  ".mp4": "video/mp4", ".webm": "video/webm", ".ogv": "video/ogg", ".mov": "video/quicktime", ".m4v": "video/mp4",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4",
  ".json": "application/json", ".js": "text/javascript", ".mjs": "text/javascript", ".cjs": "text/javascript",
  ".ts": "text/plain", ".glsl": "text/plain", ".frag": "text/plain", ".vert": "text/plain",
  ".css": "text/css", ".html": "text/html", ".htm": "text/html", ".md": "text/markdown",
  ".txt": "text/plain", ".csv": "text/csv", ".xml": "application/xml", ".yml": "text/plain", ".yaml": "text/plain",
  ".pdf": "application/pdf", ".zip": "application/zip"
};
function mimeForPath(p) { return MIME_BY_EXT[path.extname(p).toLowerCase()] || "application/octet-stream"; }

function filesDir(root, slug) { return path.join(gamePath(root, slug), "files"); }

/** Sanitizes a single file/folder display name (no separators, no traversal). */
function sanitizeEntryName(name) {
  const n = String(name ?? "").trim();
  if (!n || n.length > 128) throw httpError(400, "Name must be 1-128 characters");
  if (/[\\/]/.test(n) || n === "." || n === "..") throw httpError(400, "Invalid name");
  if (/[\x00-\x1f]/.test(n)) throw httpError(400, "Invalid name");
  return n;
}

/** Resolves a user-supplied relative path against the game's files/ root,
 *  rejecting any attempt to escape it (e.g. "../", absolute paths). */
function resolveFilesPath(base, relPath) {
  const segments = String(relPath || "").replace(/\\/g, "/").split("/").filter(seg => seg && seg !== ".");
  if (segments.some(seg => seg === "..")) throw httpError(400, "Invalid path");
  const abs = path.join(base, ...segments);
  if (abs !== base && !abs.startsWith(base + path.sep)) throw httpError(400, "Invalid path");
  return abs;
}

async function ensureFilesRoot(root, slug) {
  const dir = gamePath(root, slug);
  try { await fs.access(dir); } catch (error) { if (error.code === "ENOENT") throw httpError(404, "Game not found"); throw error; }
  const base = filesDir(root, slug);
  await fs.mkdir(base, { recursive: true });
  return base;
}

/** Recursively builds the project's file/folder tree for the File Manager. */
async function listFileTree(root, slug) {
  const base = await ensureFilesRoot(root, slug);
  async function walk(dirAbs, relPath) {
    const entries = await fs.readdir(dirAbs, { withFileTypes: true });
    const nodes = await Promise.all(entries
      .filter(e => !e.name.startsWith("."))
      .map(async e => {
        const entryRel = relPath ? `${relPath}/${e.name}` : e.name;
        const entryAbs = path.join(dirAbs, e.name);
        const stat = await fs.stat(entryAbs);
        if (e.isDirectory()) {
          return { name: e.name, path: entryRel, type: "folder", updatedAt: stat.mtime.toISOString(), children: await walk(entryAbs, entryRel) };
        }
        return { name: e.name, path: entryRel, type: "file", size: stat.size, updatedAt: stat.mtime.toISOString(), ext: path.extname(e.name).toLowerCase(), mime: mimeForPath(entryAbs) };
      }));
    return nodes.sort((a, b) => (a.type !== b.type ? (a.type === "folder" ? -1 : 1) : a.name.localeCompare(b.name)));
  }
  return walk(base, "");
}

/** Creates a new file or folder. `input.parentPath` is the containing
 *  folder ("" for the project root); `input.content` seeds a new file. */
async function createFileEntry(root, slug, input) {
  const base = await ensureFilesRoot(root, slug);
  const parentPath = String(input?.parentPath || "");
  const name = sanitizeEntryName(input?.name);
  const type = input?.type === "folder" ? "folder" : "file";
  const parentAbs = resolveFilesPath(base, parentPath);
  const relPath = parentPath ? `${parentPath}/${name}` : name;
  const targetAbs = resolveFilesPath(base, relPath);

  const parentStat = await fs.stat(parentAbs).catch(() => null);
  if (!parentStat || !parentStat.isDirectory()) throw httpError(404, "Destination folder not found");
  const exists = await fs.access(targetAbs).then(() => true).catch(() => false);
  if (exists) throw httpError(409, `"${name}" already exists here`);

  if (type === "folder") {
    await fs.mkdir(targetAbs);
  } else {
    const content = typeof input?.content === "string" ? input.content : "";
    await fs.writeFile(targetAbs, content, "utf8");
  }
  const stat = await fs.stat(targetAbs);
  return { name, path: relPath, type, size: type === "file" ? stat.size : undefined, updatedAt: stat.mtime.toISOString() };
}

/** Renames a file or folder in place (same parent, new display name). */
async function renameFileEntry(root, slug, input) {
  const base = await ensureFilesRoot(root, slug);
  const relPath = String(input?.path || "");
  if (!relPath) throw httpError(400, "Path is required");
  const newName = sanitizeEntryName(input?.newName);
  const srcAbs = resolveFilesPath(base, relPath);
  const srcStat = await fs.stat(srcAbs).catch(() => null);
  if (!srcStat) throw httpError(404, "Not found");

  const parentRel = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "";
  const destRel = parentRel ? `${parentRel}/${newName}` : newName;
  const destAbs = resolveFilesPath(base, destRel);
  if (destAbs !== srcAbs) {
    const destExists = await fs.access(destAbs).then(() => true).catch(() => false);
    if (destExists) throw httpError(409, `"${newName}" already exists here`);
  }
  await fs.rename(srcAbs, destAbs);
  const stat = await fs.stat(destAbs);
  return { name: newName, path: destRel, type: stat.isDirectory() ? "folder" : "file", size: stat.isDirectory() ? undefined : stat.size, updatedAt: stat.mtime.toISOString() };
}

/** Deletes a file, or a folder and everything under it. */
async function deleteFileEntry(root, slug, relPath) {
  const base = await ensureFilesRoot(root, slug);
  if (!relPath) throw httpError(400, "Path is required");
  const abs = resolveFilesPath(base, relPath);
  if (abs === base) throw httpError(400, "Can't delete the project root");
  await fs.rm(abs, { recursive: true, force: true });
  return { path: relPath, deleted: true };
}

/** Reads a text file's contents for the code-view / editing tab. */
async function readFileText(root, slug, relPath) {
  const base = await ensureFilesRoot(root, slug);
  if (!relPath) throw httpError(400, "Path is required");
  const abs = resolveFilesPath(base, relPath);
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat || !stat.isFile()) throw httpError(404, "File not found");
  if (stat.size > MAX_TEXT_BYTES) throw httpError(413, "File is too large to open as text");
  const content = await fs.readFile(abs, "utf8");
  return { path: relPath, content, size: stat.size, updatedAt: stat.mtime.toISOString() };
}

/** Saves edited text content back to a file. */
async function writeFileText(root, slug, input) {
  const base = await ensureFilesRoot(root, slug);
  const relPath = String(input?.path || "");
  if (!relPath) throw httpError(400, "Path is required");
  const abs = resolveFilesPath(base, relPath);
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat || !stat.isFile()) throw httpError(404, "File not found");
  const content = typeof input?.content === "string" ? input.content : "";
  if (Buffer.byteLength(content, "utf8") > MAX_TEXT_BYTES) throw httpError(413, "Content exceeds the 3MB size limit");
  await fs.writeFile(abs, content, "utf8");
  const newStat = await fs.stat(abs);
  return { path: relPath, size: newStat.size, updatedAt: newStat.mtime.toISOString() };
}

/** Resolves a path to its on-disk location + mime, for raw preview/download. */
async function statFileEntry(root, slug, relPath) {
  const base = await ensureFilesRoot(root, slug);
  const abs = resolveFilesPath(base, relPath || "");
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat || !stat.isFile()) throw httpError(404, "File not found");
  return { abs, size: stat.size, mime: mimeForPath(abs) };
}

/** Imports one or more uploaded files (each carrying a base64 `dataUrl`)
 *  into `input.parentPath`. `relPath` on each entry may include `/`
 *  segments (as `webkitdirectory` folder uploads provide), so whole
 *  folder structures import in one call, recreating subfolders as needed. */
async function importFiles(root, slug, input) {
  const base = await ensureFilesRoot(root, slug);
  const { mb: maxMB, bytes: maxBytes } = assetByteLimit(await readConfig(root, slug));
  const parentPath = String(input?.parentPath || "");
  const parentAbs = resolveFilesPath(base, parentPath);
  const parentStat = await fs.stat(parentAbs).catch(() => null);
  if (!parentStat || !parentStat.isDirectory()) throw httpError(404, "Destination folder not found");

  const files = Array.isArray(input?.files) ? input.files : [];
  if (!files.length) throw httpError(400, "No files to import");
  if (files.length > MAX_IMPORT_FILES) throw httpError(400, `Too many files in one import (max ${MAX_IMPORT_FILES})`);

  const imported = [];
  for (const f of files) {
    const relName = String(f?.relPath || f?.name || "").replace(/\\/g, "/");
    if (!relName) continue;
    const match = /^data:([^;]*);base64,(.+)$/.exec(String(f?.dataUrl || "").trim());
    if (!match) continue;
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length > maxBytes) throw httpError(413, `"${relName}" exceeds this project's ${maxMB}MB import limit (change it in Project Settings)`);
    const targetRel = parentPath ? `${parentPath}/${relName}` : relName;
    const targetAbs = resolveFilesPath(base, targetRel);
    await fs.mkdir(path.dirname(targetAbs), { recursive: true });
    await fs.writeFile(targetAbs, buffer);
    imported.push(targetRel);
  }
  return { imported: imported.length, paths: imported };
}

/** Exports a single file as-is, or a folder as a freshly-built .zip. */
async function exportFileOrFolder(root, slug, relPath) {
  const base = await ensureFilesRoot(root, slug);
  const abs = resolveFilesPath(base, relPath || "");
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat) throw httpError(404, "Not found");

  if (stat.isFile()) {
    return { kind: "file", abs, name: path.basename(abs), mime: mimeForPath(abs) };
  }

  async function collect(dirAbs, relBase) {
    const entries = await fs.readdir(dirAbs, { withFileTypes: true });
    let files = [];
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const entryAbs = path.join(dirAbs, e.name);
      const entryRel = relBase ? `${relBase}/${e.name}` : e.name;
      if (e.isDirectory()) files = files.concat(await collect(entryAbs, entryRel));
      else files.push({ name: entryRel, data: await fs.readFile(entryAbs) });
    }
    return files;
  }
  const rootName = relPath ? path.basename(abs) : `${slug}-files`;
  const zipEntries = await collect(abs, rootName);
  const buffer = createZip(zipEntries);
  return { kind: "zip", buffer, name: `${rootName}.zip` };
}

module.exports = {
  createGame, listGames, readGame, deleteGame,
  listScenes, readScene, createScene, deleteScene, saveScene,
  listAssets, listAssetsDetailed, uploadAsset, deleteAsset, updateAsset, findAsset,
  readProjectSettings, updateProjectSettings,
  readMultiplayerSettings, updateMultiplayerSettings, writeMultiplayerConnectInfo,
  readPublicGameInfo, submitStat, readLeaderboard,
  listFileTree, createFileEntry, renameFileEntry, deleteFileEntry,
  readFileText, writeFileText, statFileEntry, importFiles, exportFileOrFolder
};