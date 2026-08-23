/* ---------------------------------------------------------------
 * theme-manager.js
 * ---------------------------------------------------------------
 * Applies the device's selected theme (see src/theme-manager.js) by
 * setting CSS custom properties on <html>. Include this on any page that
 * should pick up the theme — currently the dashboard and the editor.
 *
 * Themes are addressed by a small set of semantic color keys (bg, panel,
 * accent, ...) rather than raw CSS variable names, because editor.css and
 * dashboard.css each define their own separate, differently-named custom
 * properties. VAR_ALIASES maps each semantic key onto every variable name
 * it might correspond to; setting a name that doesn't exist on the current
 * page is harmless, so the same theme payload works everywhere unmodified.
 *
 * This file only applies themes and talks to the API. The picker/upload UI
 * lives in theme-manager-panel.js (editor-only, opened from Edit → Editor
 * Settings…), which calls the functions this exposes on window.forgeTheme.
 * ------------------------------------------------------------- */
(() => {
  if (window.forgeTheme) return; // already installed on this page

  const COLOR_KEYS = ["bg", "panel", "panelAlt", "panelRaised", "border", "borderStrong", "text", "muted", "accent", "accentHover", "danger", "warning", "success"];
  const VAR_ALIASES = {
    bg: ["--bg"],
    panel: ["--panel", "--surface"],
    panelAlt: ["--panel2", "--surface-2"],
    panelRaised: ["--panel3", "--surface-3"],
    border: ["--line", "--border"],
    borderStrong: ["--line2", "--border-strong"],
    text: ["--text"],
    muted: ["--muted"],
    accent: ["--accent", "--primary"],
    accentHover: ["--accent2", "--primary-hover"],
    danger: ["--danger"],
    warning: ["--warning"],
    success: ["--green"]
  };

  async function apiCall(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.error || `Request failed (${response.status})`), { status: response.status });
    return body;
  }

  function applyColors(colors) {
    if (!colors) return;
    const style = document.documentElement.style;
    for (const key of COLOR_KEYS) {
      const value = colors[key];
      if (!value) continue;
      for (const varName of VAR_ALIASES[key]) style.setProperty(varName, value);
    }
  }

  let cache = null;
  const ready = load();

  async function load() {
    try { cache = await apiCall("/api/theme"); applyColors(cache.colors); }
    catch { /* e.g. not logged in yet (auth screen) — the default stylesheet colors stand in until then */ }
    return cache;
  }

  async function selectTheme(themeId) {
    cache = await apiCall("/api/theme/active", { method: "PUT", body: JSON.stringify({ themeId }) });
    applyColors(cache.colors);
    return cache;
  }

  async function uploadTheme(themeData) {
    const result = await apiCall("/api/theme/custom", { method: "POST", body: JSON.stringify(themeData) });
    cache = result;
    return result;
  }

  async function deleteTheme(themeId) {
    cache = await apiCall(`/api/theme/custom/${encodeURIComponent(themeId)}`, { method: "DELETE" });
    applyColors(cache.colors);
    return cache;
  }

  window.forgeTheme = { ready, load, selectTheme, uploadTheme, deleteTheme, applyColors, getCache: () => cache };
})();
