/* ---------------------------------------------------------------
   Forge Hooks — the wiring that lets a Package be a real addon/plugin
   instead of a fake "Installed ✓" toggle. A package's code receives a
   `forge` object (see runPackageCode in editor.js) and calls
   `forge.hooks.on(name, fn)` to attach itself to any of the engine's
   named hook points (HOOK_CATALOG below). Anything else in the editor,
   the block-graph Test Mode runtime, or (server-side) a game's own
   entry script can then simply `emit(name, ...)` and every installed
   package that hooked that point runs.

   `list()` is the introspection half of this: it returns, per hook
   name, every currently-registered handler function (with which
   package registered it), so a package can inspect what's already
   hooked in — "hooks are functions that return each function that
   exists" — before deciding to add, replace, or build on top of it.
--------------------------------------------------------------- */
(() => {
  // Canonical catalog of every hook point the app fires. This is the
  // reference a package author reads (surfaced in the Package Manager's
  // "Hooks Reference" panel) to know what's available and what
  // arguments a handler receives.
  const HOOK_CATALOG = {
    onPackageInstall: { args: '(pkg)', desc: 'Fires right after a package\'s code has run and registered its hooks.' },
    onPackageUninstall: { args: '(pkg)', desc: 'Fires after a package is removed and its hooks detached.' },
    onObjectAdd: { args: '(object)', desc: 'A new object was added to the current scene.' },
    onObjectDelete: { args: '(object)', desc: 'An object was removed from the current scene.' },
    onObjectSelect: { args: '(object|null)', desc: 'The selected object in the Scene panel changed.' },
    onSceneSave: { args: '(scene)', desc: 'The current scene was saved to disk.' },
    onTemplateApply: { args: '(template, objects)', desc: 'A project template replaced the current scene\'s objects.' },
    onTestStart: { args: '(ctx)', desc: 'Block Editor Test Mode started running the graph.' },
    onTestStop: { args: '()', desc: 'Block Editor Test Mode stopped.' },
    onNodeRun: { args: '(node, execKey)', desc: 'A block/node in the Block Editor graph fired during Test Mode.' }
  };

  const handlers = new Map(); // hookName -> Map(id -> { fn, packageId })
  let seq = 0;

  function ensure(name) {
    if (!handlers.has(name)) handlers.set(name, new Map());
    return handlers.get(name);
  }

  /**
   * Registers a handler for a named hook.
   * @param {string} name - One of HOOK_CATALOG's keys (custom names are
   *   allowed too — a package can define its own hook for other
   *   packages to build on).
   * @param {Function} fn - Called with whatever emit(name, ...) passes.
   * @param {string|null} packageId - Owning package, so it can be
   *   cleanly detached again on uninstall.
   * @returns {number} Handler id, usable with off().
   */
  function on(name, fn, packageId = null) {
    if (typeof fn !== 'function') return -1;
    const id = ++seq;
    ensure(name).set(id, { fn, packageId });
    return id;
  }

  /** Removes a single handler previously returned by on(). */
  function off(name, id) {
    handlers.get(name)?.delete(id);
  }

  /** Removes every handler a given package registered, across all hooks. */
  function offPackage(packageId) {
    for (const bucket of handlers.values()) {
      for (const [id, entry] of bucket) if (entry.packageId === packageId) bucket.delete(id);
    }
  }

  /**
   * Fires a hook synchronously. Each handler is isolated in its own
   * try/catch so one broken package can't take down the others (or the
   * caller) — errors are logged to the console and via __forgeLog if
   * available, and skipped.
   * @returns {Array} Whatever each handler returned, in registration order.
   */
  function emit(name, ...args) {
    const bucket = handlers.get(name);
    if (!bucket || !bucket.size) return [];
    const results = [];
    for (const { fn, packageId } of bucket.values()) {
      try { results.push(fn(...args)); }
      catch (err) {
        console.error(`[forge-hooks] "${name}" handler from package "${packageId || 'unknown'}" threw:`, err);
        window.__forgeLog?.('error', `Package "${packageId || 'unknown'}" error in ${name}: ${err.message}`);
      }
    }
    return results;
  }

  /**
   * Introspection: returns, for every hook name that has at least one
   * registered handler, the list of those handler functions along with
   * which package owns each — i.e. it "returns each function that
   * exists" for a given hook, so a package can see what's already
   * wired in before adding its own behavior.
   */
  function list(name) {
    if (name) return [...(handlers.get(name) || new Map()).values()].map(({ fn, packageId }) => ({ packageId, fn }));
    const out = {};
    for (const [hookName, bucket] of handlers) out[hookName] = [...bucket.values()].map(({ fn, packageId }) => ({ packageId, fn }));
    return out;
  }

  /** Returns the static catalog (or one entry from it) — what hooks exist and their shape, whether or not anything is registered yet. */
  function describe(name) { return name ? HOOK_CATALOG[name] || null : HOOK_CATALOG; }

  window.__forgeHooks = { on, off, offPackage, emit, list, describe, HOOK_CATALOG };
})();
