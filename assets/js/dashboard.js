"use strict";

(() => {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  const authScreen = $("#authScreen");
  const createAccountForm = $("#createAccountForm");
  const loginForm = $("#loginForm");
  const app = $("#app");
  const grid = $("#projectGrid"), empty = $("#emptyState"), dialog = $("#createDialog");
  let games = [];

  async function api(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body;
  }

  // ---------------------------------------------------------------
  // Auth gate: on every load, ask the server (never browser storage)
  // whether an account exists on this device and whether the current
  // browser session is already logged in, then show exactly one screen.
  // ---------------------------------------------------------------

  async function init() {
    try {
      const status = await api("/api/account/status");
      if (!status.hasAccount) return showCreateAccount();
      if (!status.authenticated) return showLogin();
      return showDashboard({ displayName: status.displayName, createdAt: status.createdAt });
    } catch (error) {
      console.error(error);
      showCreateAccount(error.message);
    }
  }

  function showCreateAccount(errorMessage = "") {
    authScreen.hidden = false;
    app.hidden = true;
    createAccountForm.hidden = false;
    loginForm.hidden = true;
    $("#createAccountError").textContent = errorMessage;
    $("#createDisplayName").focus();
  }

  function showLogin(errorMessage = "") {
    authScreen.hidden = false;
    app.hidden = true;
    createAccountForm.hidden = true;
    loginForm.hidden = false;
    $("#loginError").textContent = errorMessage;
    $("#loginPassword").focus();
  }

  async function showDashboard(account) {
    authScreen.hidden = true;
    app.hidden = false;
    $("#profileName").textContent = account?.displayName || "Developer";
    $("#settingsDisplayName").textContent = account?.displayName || "Developer";
    $("#settingsCreatedAt").textContent = account?.createdAt ? new Date(account?.createdAt).toLocaleDateString() : "—";
    await Promise.all([loadGames(), loadAssets(), updateStorage()]);
  }

  createAccountForm.addEventListener("submit", async event => {
    event.preventDefault();
    const displayName = $("#createDisplayName").value.trim();
    const password = $("#createPassword").value;
    const passwordConfirm = $("#createPasswordConfirm").value;
    if (password !== passwordConfirm) {
      $("#createAccountError").textContent = "Passwords do not match";
      return;
    }
    try {
      const { account } = await api("/api/account/register", { method: "POST", body: JSON.stringify({ displayName, password }) });
      await showDashboard(account);
    } catch (error) {
      $("#createAccountError").textContent = error.message;
    }
  });

  loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const { account } = await api("/api/account/login", { method: "POST", body: JSON.stringify({ password: $("#loginPassword").value }) });
      $("#loginPassword").value = "";
      await showDashboard(account);
    } catch (error) {
      $("#loginError").textContent = error.message;
    }
  });

  async function logout() {
    try { await api("/api/account/logout", { method: "POST", body: "{}" }); }
    catch (error) { console.error(error); }
    finally { showLogin(); }
  }
  $("#logoutButton")?.addEventListener("click", logout);
  $("#settingsLogoutButton")?.addEventListener("click", logout);

  // ---------------------------------------------------------------
  // Dashboard (unchanged behavior, now only reachable once logged in)
  // ---------------------------------------------------------------

  async function loadGames() {
    games = (await api("/api/games")).games;
    render();
  }

  async function loadAssets() {
    const { games: assetGames } = await api("/api/assets");
    renderAssets(assetGames);
  }

  function renderAssets(assetGames) {
    const list = $("#assetList"), empty = $("#assetsEmptyState");
    empty.hidden = assetGames.length !== 0;
    list.replaceChildren(...assetGames.map(game => {
      const row = document.createElement("article");
      row.className = "forge-asset-row";

      const info = document.createElement("div");
      const title = document.createElement("h4"); title.textContent = game.name;
      const count = document.createElement("p");
      count.textContent = game.files.length === 0 ? "No files in this project's assets folder yet" : `${game.files.length} file${game.files.length === 1 ? "" : "s"}`;
      info.append(title, count);
      if (game.files.length) {
        const fileList = document.createElement("ul");
        fileList.className = "forge-asset-files";
        fileList.replaceChildren(...game.files.slice(0, 8).map(name => {
          const item = document.createElement("li"); item.textContent = name; return item;
        }));
        info.append(fileList);
      }

      const open = document.createElement("a");
      open.className = "forge-button forge-button--secondary";
      open.textContent = "Open editor";
      open.href = `/editor/${encodeURIComponent(game.slug)}`;

      row.append(info, open);
      return row;
    }));
  }

  function render() {
    const query = $("#projectSearch").value.trim().toLowerCase();
    const sort = $("#projectSort").value;
    const visible = games.filter(game => game.name.toLowerCase().includes(query)).sort((a,b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "created") return b.createdAt.localeCompare(a.createdAt);
      return b.updatedAt.localeCompare(a.updatedAt);
    });
    grid.replaceChildren(...visible.map(game => {
      const card = document.createElement("article");
      card.className = "forge-project";
      const title = document.createElement("h3"); title.textContent = game.name;
      const meta = document.createElement("p"); meta.textContent = `${game.template} · ${new Date(game.updatedAt).toLocaleString()}`;
      const actions = document.createElement("div");
      actions.className = "forge-project__actions";
      const open = document.createElement("a"); open.className = "forge-button forge-button--primary"; open.textContent = "Open editor"; open.href = `/editor/${encodeURIComponent(game.slug)}`;
      const del = document.createElement("button");
      del.type = "button";
      del.className = "forge-button forge-button--danger";
      del.textContent = "Delete";
      del.addEventListener("click", () => confirmDeleteGame(game));
      actions.append(open, del);
      card.append(title, meta, actions); return card;
    }));
    empty.hidden = visible.length !== 0;
    $("#projectCount").textContent = games.length;
    $("#recentCount").textContent = games.filter(g => Date.now() - Date.parse(g.updatedAt) < 604800000).length;
  }

  // Storage-usage indicator: read fresh from the browser's Storage API each
  // time. Nothing here is persisted client-side (no localStorage/sessionStorage) —
  // it's just a live readout of on-device quota usage.
  async function updateStorage() {
    let percent = 0;
    if (navigator.storage?.estimate) {
      const { usage = 0, quota = 1 } = await navigator.storage.estimate();
      percent = Math.min(100, Math.round((usage / quota) * 100));
    }
    const label = $(".forge-storage__row span:last-child");
    const bar = $(".forge-progress span");
    if (label) label.textContent = `${percent}%`;
    if (bar) bar.style.width = `${percent}%`;
  }

  async function confirmDeleteGame(game) {
    const ok = await window.forgeConfirm(`Delete "${game.name}"? This removes its scenes, scripts, and assets permanently. This can't be undone.`, { title: 'Delete Game', danger: true, confirmText: 'Delete' });
    if (!ok) return;
    try {
      await api(`/api/games/${encodeURIComponent(game.slug)}`, { method: "DELETE" });
      await Promise.all([loadGames(), loadAssets()]);
    } catch (error) {
      window.forgeAlert(error.message || "Couldn't delete this game.", { title: 'Error' });
    }
  }

  function openCreate(template = "Blank Canvas") { $("#gameTemplate").value = template; $("#formError").textContent = ""; dialog.showModal(); $("#gameName").focus(); }
  $$('[data-create-game]').forEach(button => button.addEventListener("click", () => openCreate()));
  $$('[data-template]').forEach(button => button.addEventListener("click", () => openCreate(button.dataset.template)));
  $("#projectSearch").addEventListener("input", render);
  $("#projectSort").addEventListener("change", render);
  $("#createForm").addEventListener("submit", async event => {
    // Cancel and the × button both submit this form too (they're inside it,
    // with formnovalidate so required fields don't block them). They should
    // just let the native `method="dialog"` behavior close the dialog —
    // only the actual "Create and open editor" submit should hit the API.
    if (event.submitter?.value === "cancel") return;

    event.preventDefault();
    try {
      const body = { name: $("#gameName").value, template: $("#gameTemplate").value };
      const result = await api("/api/games", { method: "POST", body: JSON.stringify(body) });
      location.assign(result.editorUrl);
    } catch (error) { $("#formError").textContent = error.message; }
  });
  dialog.addEventListener("close", () => {
    $("#createForm").reset();
    $("#formError").textContent = "";
  });
  $("#menuButton")?.addEventListener("click", () => document.body.classList.toggle("nav-open"));
  $("#scrim")?.addEventListener("click", () => document.body.classList.remove("nav-open"));

  // Notifications popover
  const notificationsButton = $("#notificationsButton");
  const notificationsPopover = $("#notificationsPopover");
  function closeNotifications() {
    notificationsPopover.hidden = true;
    notificationsButton.setAttribute("aria-expanded", "false");
  }
  notificationsButton?.addEventListener("click", event => {
    event.stopPropagation();
    const willOpen = notificationsPopover.hidden;
    closeNotifications();
    if (willOpen) {
      notificationsPopover.hidden = false;
      notificationsButton.setAttribute("aria-expanded", "true");
    }
  });
  document.addEventListener("click", event => {
    if (!notificationsPopover.hidden && !notificationsPopover.contains(event.target) && event.target !== notificationsButton) closeNotifications();
  });
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeNotifications(); });

  // Settings: change password
  $("#changePasswordForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const errorEl = $("#changePasswordError"), successEl = $("#changePasswordSuccess");
    errorEl.textContent = ""; successEl.textContent = "";
    try {
      await api("/api/account/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: $("#currentPassword").value, newPassword: $("#newPassword").value })
      });
      $("#changePasswordForm").reset();
      successEl.textContent = "Password updated.";
    } catch (error) {
      errorEl.textContent = error.message;
    }
  });

  init();
})();