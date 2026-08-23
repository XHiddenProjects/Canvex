/* ---------------------------------------------------------------
   Theme Manager panel — Edit menu → "Editor Settings…". Lets the editor
   pick a preset theme, upload a custom theme (a small JSON file of colors),
   and switch which theme is active. Actual color-applying logic lives in
   theme-manager.js (window.forgeTheme); this file is just the UI over it.
--------------------------------------------------------------- */
(() => {
  const modal = window.__forgeModal;
  const theme = window.forgeTheme;
  const appState = window.__forgeState;
  if (!modal || !theme || !appState) return;
  const toast = msg => window.__forgeToast?.(msg);
  const escapeHtml = window.__forgeEscape || (s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

  const SWATCH_KEYS = ['bg', 'panel', 'accent']; // small 3-dot preview per theme card

  function swatches(colors) {
    return SWATCH_KEYS.map(key => `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${escapeHtml(colors[key] || '#000')};border:1px solid rgba(255,255,255,.15);margin-right:4px;"></span>`).join('');
  }

  function themeCard({ id, name, colors, active, removable }) {
    return `
      <div class="mp-card" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:10px;min-width:0;">
          <div>${swatches(colors)}</div>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(name)}</span>
        </div>
        <div class="mp-actions" style="margin-top:0;flex:none;">
          ${active
            ? '<span class="mp-status" style="color:#66b58b;">Active</span>'
            : `<button data-use-theme="${id}">Use</button>`}
          ${removable ? `<button data-delete-theme="${id}" title="Delete theme">✕</button>` : ''}
        </div>
      </div>`;
  }

  function render(state) {
    const presetCards = state.presets.map(p => themeCard({ id: p.id, name: p.name, colors: p.colors, active: p.id === state.activeThemeId })).join('');
    const customCards = state.customThemes.length
      ? state.customThemes.map(t => themeCard({ id: t.id, name: t.name, colors: t.colors, active: t.id === state.activeThemeId, removable: true })).join('')
      : '<p class="mp-hint">No custom themes yet — upload a theme file below.</p>';

    return `
      <p class="modal-desc">Pick a preset, or upload your own theme as a small JSON file of colors.</p>

      <div class="mp-row-between"><strong>Preset Themes</strong></div>
      ${presetCards}

      <div class="mp-row-between" style="margin-top:14px;"><strong>Custom Themes</strong></div>
      ${customCards}

      <div class="mp-row-between" style="margin-top:14px;"><strong>Upload Theme</strong></div>
      <p class="mp-hint">Opens the File Manager so you can pick a theme <code>.json</code> file already in this project — only JSON files will be selectable.</p>
      <div class="mp-actions">
        <button class="primary" id="themeUploadBtn">Upload Theme…</button>
        <button id="themeTemplateBtn">Download Template</button>
      </div>
      <p class="mp-hint">A theme file is JSON with a <code>name</code> and a <code>colors</code> object (hex or rgb/rgba/hsl/hsla values). Download the template above, edit it, then use Import Asset / drag it into the File Manager first so it's there to pick.</p>
    `;
  }

  function downloadTemplate(state) {
    const base = state.presets[0];
    const blob = new Blob([JSON.stringify({ name: 'My Theme', colors: base.colors }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'forge-theme-template.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function open(state) {
    modal.open('Editor Settings', render(state), { onMount: box => wire(box, state) });
  }

  function wire(box, state) {
    box.querySelectorAll('[data-use-theme]').forEach(btn => btn.onclick = async () => {
      btn.disabled = true;
      try { const next = await theme.selectTheme(btn.dataset.useTheme); open(next); }
      catch (error) { await window.forgeAlert(error.message || 'Could not switch themes', { title: 'Theme error', danger: true }); btn.disabled = false; }
    });

    box.querySelectorAll('[data-delete-theme]').forEach(btn => btn.onclick = async () => {
      const ok = await window.forgeConfirm("Delete this custom theme? This can't be undone.", { title: 'Delete Theme', danger: true, confirmText: 'Delete' });
      if (!ok) return;
      try { const next = await theme.deleteTheme(btn.dataset.deleteTheme); open(next); toast('Theme deleted'); }
      catch (error) { await window.forgeAlert(error.message || 'Could not delete theme', { title: 'Theme error', danger: true }); }
    });

    box.querySelector('#themeTemplateBtn').onclick = () => downloadTemplate(state);

    // Reuses the File Manager's own picker mode (the same one the Assets
    // panel's "Import Asset…" uses) instead of the OS's native file dialog
    // — see window.__forgeOpenFilePicker in forge-filemanager.js. `accepts`
    // restricts what's selectable there to .json files only.
    box.querySelector('#themeUploadBtn').onclick = async () => {
      if (!window.__forgeOpenFilePicker) { toast('File Manager is not available'); return; }

      // The File Manager renders at a lower z-index than this modal (it's
      // meant to sit under regular dialogs, not over them), so bringing it
      // "in front" means stepping this modal aside while it's open rather
      // than trying to out-stack it — reopened below once the picker
      // resolves, however that happens (pick, cancel, or an error).
      modal.close();
      const paths = await window.__forgeOpenFilePicker({ multiple: false, directory: false, accepts: '.json' });
      const path = paths?.[0];
      if (!path) { open(state); return; } // cancelled — back to where we left off

      let content;
      try {
        ({ content } = await window.__forgeApi(`/api/games/${encodeURIComponent(appState.slug)}/files/content?path=${encodeURIComponent(path)}`));
      } catch (error) {
        open(state);
        await window.forgeAlert(error.message || 'Could not read that file.', { title: 'Could not read theme file', danger: true });
        return;
      }

      let parsed;
      try { parsed = JSON.parse(content); }
      catch {
        open(state);
        await window.forgeAlert(`"${path}" isn't valid JSON.`, { title: 'Could not read theme file', danger: true });
        return;
      }

      try {
        const next = await theme.uploadTheme(parsed);
        open(next);
        toast(`Theme "${parsed.name || path}" added`);
      } catch (error) {
        open(state);
        await window.forgeAlert(error.message || 'That theme file could not be added.', { title: 'Invalid theme file', danger: true });
      }
    };
  }

  async function openThemeManagerPanel() {
    modal.open('Editor Settings', '<p class="mp-hint">Loading…</p>');
    let state;
    try { state = theme.getCache() || await theme.load(); }
    catch (error) { modal.open('Editor Settings', `<p class="mp-hint">Could not load themes: ${escapeHtml(error.message || 'unknown error')}</p>`); return; }
    open(state);
  }

  window.__forgeOpenThemeManagerPanel = openThemeManagerPanel;
})();
