/* ---------------------------------------------------------------
   Project Settings panel — Project menu → "Project Settings…". Lets the
   editor configure a game's name, canvas size/background, and the
   per-project upload cap (persisted in game.config.json via
   core/game-manager.js's readProjectSettings / updateProjectSettings).

   The upload cap is what a too-large asset trips over: dropping a big
   texture/audio/model file into the Assets panel or File Manager fails
   with "Asset exceeds this project's <N>MB upload limit" (HTTP 413) once
   the decoded file is bigger than this setting. Raising it here is the
   fix — up to the hard ceiling reported by the server (maxAssetMBRange).
--------------------------------------------------------------- */
(() => {
  const state = window.__forgeState;
  const modal = window.__forgeModal;
  if (!state || !modal) return;
  const api = url => window.__forgeApi(url);
  const apiSend = (url, options) => window.__forgeApi(url, options);
  const toast = msg => window.__forgeToast?.(msg);
  const escapeHtml = window.__forgeEscape || (s => s);

  function render(settings) {
    const { min, max } = settings.maxAssetMBRange;
    return `
      <p class="modal-desc">Rename the project, set the canvas defaults, and control how large a single asset can be.</p>

      <div class="mp-card">
        <div class="field-row"><span>Project name</span><input type="text" id="psName" value="${escapeHtml(settings.name)}" maxlength="64"></div>
        <div class="mp-hint">Template: ${escapeHtml(settings.template || 'Blank Canvas')} (set when the project was created).</div>
      </div>

      <div class="mp-card">
        <div class="mp-row-between"><strong>Canvas</strong></div>
        <div class="field-row"><span>Width</span><input type="number" id="psWidth" value="${settings.engine.width}" min="64" max="7680"></div>
        <div class="field-row"><span>Height</span><input type="number" id="psHeight" value="${settings.engine.height}" min="64" max="7680"></div>
        <div class="field-row"><span>Background</span><input type="color" id="psBackground" value="${escapeHtml(settings.engine.background)}"></div>
      </div>

      <div class="mp-card">
        <div class="mp-row-between"><strong>Upload limit</strong></div>
        <p class="mp-hint">Assets bigger than this (images, audio, models, imported files) are rejected with a "too large" error instead of uploading. Raise it if you're hitting that on a big file — allowed range is ${min}–${max}MB.</p>
        <div class="field-row"><span>Max upload size (MB)</span><input type="number" id="psMaxUpload" value="${settings.limits.maxAssetMB}" min="${min}" max="${max}"></div>
      </div>

      <div class="mp-actions"><button class="primary" id="psSave">Save Settings</button><span class="mp-status" id="psSaveStatus"></span></div>
    `;
  }

  function wire(box, data) {
    box.querySelector('#psSave').onclick = async () => {
      const { min, max } = data.maxAssetMBRange;
      const name = box.querySelector('#psName').value.trim();
      const width = Number(box.querySelector('#psWidth').value);
      const height = Number(box.querySelector('#psHeight').value);
      const background = box.querySelector('#psBackground').value;
      const maxAssetMB = Math.max(min, Math.min(max, Math.round(Number(box.querySelector('#psMaxUpload').value) || data.limits.maxAssetMB)));
      const statusEl = box.querySelector('#psSaveStatus');
      statusEl.textContent = 'Saving…';
      try {
        const { settings } = await apiSend(`/api/games/${encodeURIComponent(state.slug)}/settings`, {
          method: 'PUT',
          body: JSON.stringify({ name, engine: { width, height, background }, limits: { maxAssetMB } })
        });
        Object.assign(data, settings);
        statusEl.textContent = 'Saved';
        $('#projectName').textContent = settings.name;
        document.title = `${settings.name} · ForgeEngine Editor`;
        toast('Project settings saved');
      } catch (error) { statusEl.textContent = ''; toast(error.message || 'Could not save project settings'); }
    };
  }

  function $(sel) { return document.querySelector(sel); }

  async function openProjectSettingsPanel() {
    if (!state.slug) { toast('No game selected'); return; }
    modal.open('Project Settings', '<p class="mp-hint">Loading…</p>');
    let settings;
    try { settings = await api(`/api/games/${encodeURIComponent(state.slug)}/settings`).then(r => r.settings); }
    catch (error) { modal.open('Project Settings', `<p class="mp-hint">Could not load project settings: ${escapeHtml(error.message || 'unknown error')}</p>`); return; }

    modal.open('Project Settings', render(settings), {
      onMount: box => wire(box, settings)
    });
  }

  window.__forgeOpenProjectSettingsPanel = openProjectSettingsPanel;
})();
