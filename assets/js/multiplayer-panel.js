/* ---------------------------------------------------------------
   Multiplayer panel — Project menu → "Multiplayer…". Lets the editor
   configure a game's multiplayer room (enabled / room name / player cap,
   persisted in game.config.json via core/game-manager.js) and turn the
   local server into a public, shareable link (core/tunnel.js +
   core/multiplayer-hub.js) so players anywhere can join that room.
--------------------------------------------------------------- */
(() => {
  const state = window.__forgeState;
  const modal = window.__forgeModal;
  if (!state || !modal) return;
  const api = url => window.__forgeApi(url);
  const apiSend = (url, options) => window.__forgeApi(url, options);
  const toast = msg => window.__forgeToast?.(msg);
  const escapeHtml = window.__forgeEscape || (s => s);

  let pollTimer = null;

  function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

  function wsUrlFor(httpUrl) {
    return String(httpUrl || '').replace(/^http/, 'ws');
  }

  function render({ settings, tunnel, rooms }) {
    const room = (rooms || []).find(r => r.room === settings.roomName);
    const playerCount = room ? room.count : 0;
    const players = room ? room.players.map(p => escapeHtml(p.name)).join(', ') : '';
    const connectUrl = tunnel.active ? `${wsUrlFor(tunnel.url)}` : null;

    return `
      <p class="modal-desc">Let players anywhere join this game's shared room — enable it below, then share the public link so friends outside your network can connect.</p>

      <div class="mp-card">
        <div class="mp-row">
          <label class="switch"><input type="checkbox" id="mpEnabled" ${settings.enabled ? 'checked' : ''}><span></span></label>
          <div><strong>Enable multiplayer for this game</strong><div class="mp-hint">Turns on the room this game's <code>shared</code>/<code>playerCount</code> blocks connect to.</div></div>
        </div>
        <div class="field-row"><span>Room name</span><input type="text" id="mpRoomName" value="${escapeHtml(settings.roomName)}" maxlength="48"></div>
        <div class="field-row"><span>Max players</span><input type="number" id="mpMaxPlayers" value="${settings.maxPlayers}" min="1" max="64"></div>
        <div class="mp-actions"><button class="primary" id="mpSaveSettings">Save Settings</button><span class="mp-status" id="mpSaveStatus"></span></div>
      </div>

      <div class="mp-card">
        <div class="mp-row-between">
          <strong>Public link</strong>
          <span class="badge ${tunnel.active ? 'mp-live' : ''}">${tunnel.active ? 'Live' : 'Offline'}</span>
        </div>
        <p class="mp-hint">Opens this local server to the internet (via a temporary tunnel) so players outside your network can reach the multiplayer room above. Only share it with people you trust — anyone with the link can join.</p>
        ${tunnel.active ? `
          <div class="mp-link-row">
            <input type="text" id="mpLinkField" readonly value="${escapeHtml(connectUrl)}">
            <button id="mpCopyLink">Copy</button>
          </div>
          <div class="mp-hint">Share this link with players. Your game script doesn't need it — <code>Behaviors.connectMultiplayer({ name })</code> finds this game's room and whichever link is live (this one, or your local network) automatically.</div>
          <div class="mp-actions"><button id="mpStopTunnel">Stop Sharing</button></div>
        ` : `
          <div class="mp-actions"><button class="primary" id="mpStartTunnel">Go Public</button></div>
        `}
      </div>

      <div class="mp-card">
        <div class="mp-row-between"><strong>Connected now</strong><span class="mp-hint">Room “${escapeHtml(settings.roomName)}”</span></div>
        <div class="mp-players" id="mpPlayers">${playerCount === 0 ? '<span class="mp-hint">No players connected.</span>' : `<strong>${playerCount}</strong> connected — ${players}`}</div>
      </div>
    `;
  }

  async function fetchAll() {
    const slug = state.slug;
    const [{ multiplayer }, { tunnel }, { rooms }] = await Promise.all([
      api(`/api/games/${encodeURIComponent(slug)}/multiplayer`),
      api('/api/multiplayer/tunnel'),
      api(`/api/games/${encodeURIComponent(slug)}/multiplayer/rooms`)
    ]);
    return { settings: multiplayer, tunnel, rooms };
  }

  function wire(box, data) {
    box.querySelector('#mpSaveSettings').onclick = async () => {
      const enabled = box.querySelector('#mpEnabled').checked;
      const roomName = box.querySelector('#mpRoomName').value.trim() || 'main';
      const maxPlayers = Math.max(1, Math.min(64, Number(box.querySelector('#mpMaxPlayers').value) || 8));
      const statusEl = box.querySelector('#mpSaveStatus');
      statusEl.textContent = 'Saving…';
      try {
        const { multiplayer } = await apiSend(`/api/games/${encodeURIComponent(state.slug)}/multiplayer`, {
          method: 'PUT', body: JSON.stringify({ enabled, roomName, maxPlayers })
        });
        data.settings = multiplayer;
        statusEl.textContent = 'Saved';
        toast('Multiplayer settings saved');
        refresh(box, data);
      } catch (error) { statusEl.textContent = ''; toast(error.message || 'Could not save multiplayer settings'); }
    };

    const startBtn = box.querySelector('#mpStartTunnel');
    if (startBtn) startBtn.onclick = async () => {
      startBtn.disabled = true; startBtn.textContent = 'Starting…';
      try {
        const { tunnel } = await apiSend('/api/multiplayer/tunnel', { method: 'POST', body: JSON.stringify({ slug: state.slug }) });
        data.tunnel = tunnel;
        toast('Public link is live');
        refresh(box, data);
      } catch (error) {
        toast(error.message || 'Could not start the public tunnel');
        startBtn.disabled = false; startBtn.textContent = 'Go Public';
      }
    };

    const stopBtn = box.querySelector('#mpStopTunnel');
    if (stopBtn) stopBtn.onclick = async () => {
      stopBtn.disabled = true;
      try {
        const { tunnel } = await apiSend('/api/multiplayer/tunnel', { method: 'DELETE' });
        data.tunnel = tunnel;
        toast('Public link stopped');
        refresh(box, data);
      } catch (error) { toast(error.message || 'Could not stop the public tunnel'); stopBtn.disabled = false; }
    };

    const copyBtn = box.querySelector('#mpCopyLink');
    if (copyBtn) copyBtn.onclick = () => {
      const field = box.querySelector('#mpLinkField');
      field.select();
      navigator.clipboard?.writeText(field.value).then(() => toast('Link copied')).catch(() => toast('Copy failed — select and copy manually'));
    };
  }

  function refresh(box, data) {
    box.innerHTML = `<div class="modal-head"><strong>Multiplayer</strong><button data-modal-close aria-label="Close">×</button></div><div class="modal-body">${render(data)}</div>`;
    box.querySelector('[data-modal-close]').addEventListener('click', () => modal.close());
    wire(box.querySelector('.modal-body'), data);
  }

  async function openMultiplayerPanel() {
    if (!state.slug) { toast('No game selected'); return; }
    modal.open('Multiplayer', '<p class="mp-hint">Loading…</p>');
    let data;
    try { data = await fetchAll(); }
    catch (error) { modal.open('Multiplayer', `<p class="mp-hint">Could not load multiplayer settings: ${escapeHtml(error.message || 'unknown error')}</p>`); return; }

    modal.open('Multiplayer', render(data), {
      onMount: box => wire(box, data)
    });

    stopPolling();
    pollTimer = setInterval(async () => {
      const overlay = document.getElementById('modalOverlay');
      if (!overlay || !overlay.classList.contains('show')) { stopPolling(); return; }
      try {
        const { rooms } = await api(`/api/games/${encodeURIComponent(state.slug)}/multiplayer/rooms`);
        data.rooms = rooms;
        const box = document.getElementById('modalBox');
        const playersEl = box?.querySelector('#mpPlayers');
        if (playersEl) {
          const room = (rooms || []).find(r => r.room === data.settings.roomName);
          const count = room ? room.count : 0;
          const names = room ? room.players.map(p => escapeHtml(p.name)).join(', ') : '';
          playersEl.innerHTML = count === 0 ? '<span class="mp-hint">No players connected.</span>' : `<strong>${count}</strong> connected — ${names}`;
        }
      } catch { /* transient — try again next tick */ }
    }, 3000);
  }

  window.__forgeOpenMultiplayerPanel = openMultiplayerPanel;
})();
