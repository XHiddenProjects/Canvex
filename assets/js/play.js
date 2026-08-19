/* ---------------------------------------------------------------
   Public play page (/play/:slug). No login required — anyone with the
   link lands here as a guest and can optionally create/sign into a
   lightweight player account (src/player-manager.js) to keep their name
   and stats across browsers.

   The multiplayer connection is derived entirely from `location` — the
   same page works whether it was opened locally or through the public
   loca.lt tunnel, with nothing to configure or paste in.
--------------------------------------------------------------- */
(() => {
  const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
  const $ = sel => document.querySelector(sel);
  let identity = null;
  let ws = null;

  async function api(url, options = {}) {
    const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.error || `Request failed (${res.status})`), { status: res.status });
    return body;
  }

  function renderIdentity() {
    $('#whoName').textContent = identity.displayName;
    const badge = $('#whoBadge');
    badge.textContent = identity.kind === 'account' ? 'Account' : 'Guest';
    badge.className = 'badge' + (identity.kind === 'account' ? ' account' : '');

    const actions = $('#identityActions');
    actions.innerHTML = '';
    if (identity.kind === 'guest') {
      const rename = document.createElement('button'); rename.textContent = 'Edit name';
      rename.onclick = async () => {
        const name = await window.forgePrompt('Your name', identity.displayName, { title: 'Edit Name' });
        if (name == null) return;
        const { identity: next } = await api(`/api/play/session/guest`, { method: 'POST', body: JSON.stringify({ displayName: name }) });
        identity = next; renderIdentity(); reconnect();
      };
      const save = document.createElement('button'); save.className = 'primary'; save.textContent = 'Save progress — sign in';
      save.onclick = () => openAuthModal();
      actions.append(rename, save);
    } else {
      const logout = document.createElement('button'); logout.textContent = 'Log out';
      logout.onclick = async () => { await api('/api/play/session/logout', { method: 'POST' }); location.reload(); };
      actions.append(logout);
    }
  }

  function openAuthModal(tab = 'login') {
    const modal = $('#authModal');
    modal.style.display = 'flex';
    setTab(tab);
    $('#authName').value = identity?.kind === 'guest' ? identity.displayName : '';
    $('#authPassword').value = '';
    $('#authError').textContent = '';
  }
  function closeAuthModal() { $('#authModal').style.display = 'none'; }

  function setTab(tab) {
    $('#tabLogin').classList.toggle('active', tab === 'login');
    $('#tabRegister').classList.toggle('active', tab === 'register');
    $('#authSubmit').textContent = tab === 'login' ? 'Log in' : 'Create account';
    $('#authSubmit').dataset.tab = tab;
  }

  $('#authClose').onclick = closeAuthModal;
  $('#tabLogin').onclick = () => setTab('login');
  $('#tabRegister').onclick = () => setTab('register');
  $('#authSubmit').onclick = async () => {
    const tab = $('#authSubmit').dataset.tab || 'login';
    const displayName = $('#authName').value.trim();
    const password = $('#authPassword').value;
    try {
      const { identity: next } = await api(`/api/play/session/${tab === 'login' ? 'login' : 'register'}`, {
        method: 'POST', body: JSON.stringify({ displayName, password })
      });
      identity = next;
      closeAuthModal();
      renderIdentity();
      reconnect();
      refreshLeaderboard();
    } catch (error) { $('#authError').textContent = error.message || 'Something went wrong'; }
  };

  function renderPlayers(players) {
    const list = $('#playerList');
    list.innerHTML = '';
    if (!players || !players.length) { list.innerHTML = '<li class="hint" style="background:none;border:none">No one else here yet.</li>'; return; }
    for (const p of players) {
      const li = document.createElement('li');
      li.textContent = p.name + (identity && p.id === identity.wsId ? ' (you)' : '');
      list.append(li);
    }
  }

  function setConnected(live, label) {
    $('#connDot').classList.toggle('live', live);
    $('#connLabel').textContent = label;
  }

  function reconnect() {
    if (ws) { try { ws.close(); } catch { /* already closing */ } }
    connect();
  }

  async function connect() {
    let info;
    try { ({ game: info } = await api(`/api/play/${encodeURIComponent(slug)}/info`)); }
    catch { setConnected(false, 'Game not found'); return; }

    $('#gameName').textContent = info.name;
    $('#roomHint').textContent = `Room "${info.multiplayer.roomName}" · up to ${info.multiplayer.maxPlayers} players`;

    if (!info.multiplayer.enabled) { setConnected(false, 'Multiplayer is off for this game'); return; }

    // Auto-derived from the current page — works identically whether this
    // was opened as https://<host>:<port>/play/... locally or as the
    // public https://<game-name>.loca.lt/play/... tunnel link. Nothing to
    // configure.
    const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const target = `${wsProtocol}://${location.host}/mp/${encodeURIComponent(slug)}/${encodeURIComponent(info.multiplayer.roomName)}?name=${encodeURIComponent(identity.displayName)}`;

    setConnected(false, 'Connecting…');
    ws = new WebSocket(target);
    ws.onopen = () => setConnected(true, 'Connected');
    ws.onclose = () => setConnected(false, 'Disconnected');
    ws.onerror = () => setConnected(false, 'Connection error');
    ws.onmessage = event => {
      let msg; try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'welcome') { identity.wsId = msg.id; renderPlayers(msg.players); }
      else if (msg.type === 'player-joined' || msg.type === 'player-left') { renderPlayers(msg.players); }
    };
  }

  async function refreshLeaderboard() {
    try {
      const { leaderboard } = await api(`/api/play/${encodeURIComponent(slug)}/leaderboard?key=score&limit=10`);
      const tbody = $('#leaderboardTable tbody');
      tbody.innerHTML = leaderboard.length
        ? leaderboard.map((row, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(row.displayName)}${row.kind === 'account' ? ' ✓' : ''}</td><td>${row.value}</td></tr>`).join('')
        : '<tr><td class="hint">No scores submitted yet.</td></tr>';
    } catch { /* leaderboard is optional polish — ignore failures */ }
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  $('#submitScore').onclick = async () => {
    const value = Number($('#scoreInput').value);
    if (!Number.isFinite(value)) return;
    await api(`/api/play/${encodeURIComponent(slug)}/stats`, { method: 'POST', body: JSON.stringify({ key: 'score', value }) });
    $('#scoreInput').value = '';
    refreshLeaderboard();
  };

  (async function init() {
    if (!slug) { $('#gameName').textContent = 'No game specified'; return; }
    const { identity: current } = await api('/api/play/session');
    identity = current;
    renderIdentity();
    await connect();
    refreshLeaderboard();
  })();
})();
