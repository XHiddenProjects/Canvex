"use strict";

/**
 * Device-wide theme settings — separate from per-project game.config.json,
 * since a theme is a preference for the local editor/dashboard itself, not
 * something that travels with a game project. Persisted at .forge/theme.json
 * alongside the single local account (see src/account-manager.js).
 *
 * Colors are addressed by a small set of semantic keys (see COLOR_KEYS)
 * rather than raw CSS variable names — the editor and dashboard pages each
 * ship their own separate CSS custom properties with different names
 * (assets/css/editor.css's --panel vs assets/css/dashboard.css's --surface,
 * for example), and assets/js/theme-manager.js maps these semantic keys onto
 * whichever variable names exist on the page a theme gets applied to.
 */

const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");

function httpError(status, message) { const error = new Error(message); error.status = status; return error; }

const THEME_PATH = root => path.join(root, ".forge", "theme.json");

const COLOR_KEYS = [
  "bg", "panel", "panelAlt", "panelRaised", "border", "borderStrong",
  "text", "muted", "accent", "accentHover", "danger", "warning", "success"
];

// Hex (#rgb/#rgba/#rrggbb/#rrggbbaa) or rgb()/rgba()/hsl()/hsla() with only
// numeric/percent/comma/whitespace content — deliberately strict since these
// values get written straight into a CSS custom property; nothing here can
// smuggle in a url(), semicolon, or another declaration.
const COLOR_PATTERN = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\)|hsla?\(\s*[\d.]+(deg)?\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(,\s*[\d.]+\s*)?\))$/;

const MAX_CUSTOM_THEMES = 30;
const MAX_NAME_LENGTH = 40;

const PRESETS = [
  {
    id: "forge-dark", name: "ForgeEngine Dark",
    colors: { bg: "#17191d", panel: "#202329", panelAlt: "#262a31", panelRaised: "#2d323a", border: "#353a43", borderStrong: "#424852", text: "#d7d9dd", muted: "#8d939d", accent: "#e47b35", accentHover: "#f09a55", danger: "#d75f64", warning: "#d8a84c", success: "#66b58b" }
  },
  {
    id: "midnight-purple", name: "Midnight Purple",
    colors: { bg: "#14121f", panel: "#1c1930", panelAlt: "#231f3d", panelRaised: "#2b2549", border: "#352f56", borderStrong: "#443c6e", text: "#e4e1f5", muted: "#948fc2", accent: "#8b5cf6", accentHover: "#a78bfa", danger: "#f16583", warning: "#f0c869", success: "#5fd6a8" }
  },
  {
    id: "slate-blue", name: "Slate Blue",
    colors: { bg: "#12161c", panel: "#1a1f27", panelAlt: "#212832", panelRaised: "#28303c", border: "#33404f", borderStrong: "#425264", text: "#dbe4ee", muted: "#8b9aab", accent: "#3b9eff", accentHover: "#63b3ff", danger: "#ff6b6b", warning: "#f2c14e", success: "#4fd1a5" }
  },
  {
    id: "forest", name: "Forest",
    colors: { bg: "#141a15", panel: "#1c231d", panelAlt: "#232b24", panelRaised: "#2a332b", border: "#354037", borderStrong: "#455247", text: "#dbe8dc", muted: "#8fa593", accent: "#5fb87a", accentHover: "#7dd39a", danger: "#e2705f", warning: "#dcb35a", success: "#7ad38f" }
  },
  {
    id: "sunset", name: "Sunset",
    colors: { bg: "#1a1412", panel: "#241b18", panelAlt: "#2c211d", panelRaised: "#352822", border: "#40302a", borderStrong: "#523d34", text: "#f2e3da", muted: "#c2a190", accent: "#ef7d4c", accentHover: "#f7965f", danger: "#e5555a", warning: "#f0a53c", success: "#6fc48a" }
  },
  {
    id: "high-contrast", name: "High Contrast",
    colors: { bg: "#000000", panel: "#0d0d0d", panelAlt: "#151515", panelRaised: "#1e1e1e", border: "#3a3a3a", borderStrong: "#5c5c5c", text: "#ffffff", muted: "#b8b8b8", accent: "#ffb020", accentHover: "#ffc857", danger: "#ff5a5a", warning: "#ffcc00", success: "#3ddc84" }
  }
];

function findPreset(id) { return PRESETS.find(p => p.id === id); }

/** Reads .forge/theme.json, defaulting to the first preset active with no custom themes if it doesn't exist yet. */
async function readThemeState(root) {
  let raw = null;
  try { raw = JSON.parse(await fs.readFile(THEME_PATH(root), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const customThemes = Array.isArray(raw?.customThemes) ? raw.customThemes : [];
  const activeThemeId = typeof raw?.activeThemeId === "string" ? raw.activeThemeId : PRESETS[0].id;
  return { activeThemeId, customThemes };
}

async function writeThemeState(root, state) {
  const filePath = THEME_PATH(root);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2));
}

function resolveColors(activeThemeId, customThemes) {
  const preset = findPreset(activeThemeId);
  if (preset) return preset.colors;
  const custom = customThemes.find(t => t.id === activeThemeId);
  // Layer a custom theme's (possibly partial — see validateColors) colors
  // over the default preset so every semantic key always resolves to
  // *something* even if the uploaded file only specified a few.
  return custom ? { ...PRESETS[0].colors, ...custom.colors } : PRESETS[0].colors;
}

/** Full theme payload the client needs: what's active, the built-in presets, any uploaded themes, and the resolved color set to apply right now. */
async function readThemeSettings(root) {
  const { activeThemeId, customThemes } = await readThemeState(root);
  return { activeThemeId, presets: PRESETS, customThemes, colors: resolveColors(activeThemeId, customThemes) };
}

/** Validates an (optionally partial) colors object from an uploaded theme file, dropping anything unrecognized. */
function validateColors(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw httpError(400, 'Theme file must include a "colors" object');
  const colors = {};
  for (const key of COLOR_KEYS) {
    const raw = input[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const value = String(raw).trim();
    if (!COLOR_PATTERN.test(value)) throw httpError(400, `Invalid color value for "${key}": ${value}`);
    colors[key] = value;
  }
  if (!Object.keys(colors).length) throw httpError(400, "Theme file has no recognizable color values");
  return colors;
}

/** Sets which preset or custom theme is active. */
async function setActiveTheme(root, themeId) {
  const id = String(themeId || "");
  const state = await readThemeState(root);
  const exists = Boolean(findPreset(id)) || state.customThemes.some(t => t.id === id);
  if (!exists) throw httpError(404, "Theme not found");
  state.activeThemeId = id;
  await writeThemeState(root, state);
  return readThemeSettings(root);
}

/** Adds an uploaded custom theme (from a JSON file the user picked in the Theme Manager). */
async function addCustomTheme(root, input) {
  const name = String(input?.name || "").trim().slice(0, MAX_NAME_LENGTH);
  if (!name) throw httpError(400, `Theme name must contain 1 to ${MAX_NAME_LENGTH} characters`);
  const colors = validateColors(input?.colors);

  const state = await readThemeState(root);
  if (state.customThemes.length >= MAX_CUSTOM_THEMES) throw httpError(400, `Custom theme limit reached (${MAX_CUSTOM_THEMES}) — delete one first`);

  const theme = { id: crypto.randomUUID(), name, colors, createdAt: new Date().toISOString() };
  state.customThemes.push(theme);
  await writeThemeState(root, state);
  return readThemeSettings(root);
}

/** Removes a custom theme; if it was active, falls back to the default preset. */
async function deleteCustomTheme(root, themeId) {
  const state = await readThemeState(root);
  const before = state.customThemes.length;
  state.customThemes = state.customThemes.filter(t => t.id !== themeId);
  if (state.customThemes.length === before) throw httpError(404, "Custom theme not found");
  if (state.activeThemeId === themeId) state.activeThemeId = PRESETS[0].id;
  await writeThemeState(root, state);
  return readThemeSettings(root);
}

module.exports = { COLOR_KEYS, PRESETS, readThemeSettings, setActiveTheme, addCustomTheme, deleteCustomTheme };
