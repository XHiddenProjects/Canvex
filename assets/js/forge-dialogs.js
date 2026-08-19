/* ---------------------------------------------------------------
 * forge-dialogs.js
 * ---------------------------------------------------------------
 * Custom, app-themed replacements for the browser's native alert(),
 * confirm(), and prompt() — those pause the whole tab, can't be styled,
 * and look jarringly out of place next to the rest of the UI. This is
 * intentionally self-contained (no dependency on any page's stylesheet
 * or on editor.js's __forgeModal) so the same <script> tag works
 * unmodified on the editor, the dashboard, and the play page — three
 * separate HTML documents with three separate stylesheets.
 *
 * Styling is applied via inline `style="..."` attributes rather than an
 * injected <style> block: the app's CSP is `style-src 'self'` (no
 * unsafe-inline, so a <style> tag/textContent is blocked) but
 * `style-src-attr 'unsafe-inline'` (so inline style attributes on
 * elements are explicitly allowed) — see core/index.js.
 *
 * Usage (all return Promises, so callers become `async`/`await` instead
 * of relying on the native calls' synchronous blocking):
 *   await window.forgeAlert('Message', { title, danger });
 *   const ok = await window.forgeConfirm('Message', { title, danger, confirmText, cancelText });
 *   const value = await window.forgePrompt('Message', 'default value', { title, placeholder });
 * ------------------------------------------------------------- */
(() => {
  if (window.forgeAlert) return; // already installed (e.g. script included twice)

  const OVERLAY_STYLE = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;'
    + 'background:rgba(10,11,14,.55);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;';
  const BOX_STYLE = 'width:min(380px,calc(100vw - 32px));background:#23262d;border:1px solid #3a3f49;border-radius:8px;'
    + 'box-shadow:0 20px 50px rgba(0,0,0,.55);color:#d7d9dd;padding:16px;box-sizing:border-box;';
  const TITLE_STYLE = 'font-size:13px;font-weight:600;margin:0 0 8px;color:#eef0f3;';
  const MSG_STYLE = 'font-size:12.5px;line-height:1.5;color:#b7bbc3;margin:0 0 14px;white-space:pre-wrap;';
  const INPUT_STYLE = 'width:100%;box-sizing:border-box;background:#171920;border:1px solid #3a3f49;color:#eef0f3;'
    + 'border-radius:5px;padding:7px 9px;font-size:12.5px;margin-bottom:14px;font-family:inherit;';
  const ACTIONS_STYLE = 'display:flex;justify-content:flex-end;gap:8px;';
  const BTN_STYLE = 'border:1px solid #3a3f49;background:#2c3037;color:#d7d9dd;border-radius:5px;padding:7px 14px;'
    + 'font-size:12.5px;cursor:pointer;font-family:inherit;';
  const BTN_PRIMARY_STYLE = BTN_STYLE + 'background:#e47b35;border-color:#e47b35;color:#fff;';
  const BTN_DANGER_STYLE = BTN_STYLE + 'background:#d75f64;border-color:#d75f64;color:#fff;';

  function el(tag, style, props) {
    const node = document.createElement(tag);
    if (style) node.setAttribute('style', style);
    if (props) Object.assign(node, props);
    return node;
  }

  function buildOverlay() {
    const overlay = el('div', OVERLAY_STYLE);
    const box = el('div', BOX_STYLE);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    return { overlay, box };
  }

  function addTitle(box, title) {
    if (title) box.appendChild(el('div', TITLE_STYLE, { textContent: title }));
  }
  function addMessage(box, message) {
    box.appendChild(el('div', MSG_STYLE, { textContent: message }));
  }

  function teardown(overlay, onKeydown) {
    document.removeEventListener('keydown', onKeydown, true);
    overlay.remove();
  }

  function hoverize(btn, base, hover) {
    btn.addEventListener('mouseenter', () => btn.setAttribute('style', hover));
    btn.addEventListener('mouseleave', () => btn.setAttribute('style', base));
  }

  /** Custom alert() replacement. Resolves once dismissed. */
  function forgeAlert(message, opts = {}) {
    return new Promise(resolve => {
      const { overlay, box } = buildOverlay();
      addTitle(box, opts.title);
      addMessage(box, message);
      const actions = el('div', ACTIONS_STYLE);
      const okStyle = BTN_PRIMARY_STYLE, okHover = BTN_PRIMARY_STYLE + 'background:#f09a55;';
      const ok = el('button', okStyle, { textContent: 'OK' });
      hoverize(ok, okStyle, okHover);
      actions.appendChild(ok);
      box.appendChild(actions);
      const finish = () => { teardown(overlay, onKeydown); resolve(); };
      ok.addEventListener('click', finish);
      overlay.addEventListener('click', e => { if (e.target === overlay) finish(); });
      function onKeydown(e) { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); finish(); } }
      document.addEventListener('keydown', onKeydown, true);
      ok.focus();
    });
  }

  /** Custom confirm() replacement. Resolves true/false. */
  function forgeConfirm(message, opts = {}) {
    return new Promise(resolve => {
      const { overlay, box } = buildOverlay();
      addTitle(box, opts.title);
      addMessage(box, message);
      const actions = el('div', ACTIONS_STYLE);
      const cancelStyle = BTN_STYLE, cancelHover = BTN_STYLE + 'background:#363b43;';
      const cancel = el('button', cancelStyle, { textContent: opts.cancelText || 'Cancel' });
      hoverize(cancel, cancelStyle, cancelHover);
      const okStyle = opts.danger ? BTN_DANGER_STYLE : BTN_PRIMARY_STYLE;
      const okHover = opts.danger ? BTN_DANGER_STYLE + 'background:#e57378;' : BTN_PRIMARY_STYLE + 'background:#f09a55;';
      const ok = el('button', okStyle, { textContent: opts.confirmText || 'OK' });
      hoverize(ok, okStyle, okHover);
      actions.append(cancel, ok);
      box.appendChild(actions);
      const finish = value => { teardown(overlay, onKeydown); resolve(value); };
      ok.addEventListener('click', () => finish(true));
      cancel.addEventListener('click', () => finish(false));
      overlay.addEventListener('click', e => { if (e.target === overlay) finish(false); });
      function onKeydown(e) {
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        else if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      }
      document.addEventListener('keydown', onKeydown, true);
      ok.focus();
    });
  }

  /** Custom prompt() replacement. Resolves the entered string, or null if cancelled. */
  function forgePrompt(message, defaultValue = '', opts = {}) {
    return new Promise(resolve => {
      const { overlay, box } = buildOverlay();
      addTitle(box, opts.title);
      addMessage(box, message);
      const input = el('input', INPUT_STYLE, { type: 'text', value: defaultValue || '' });
      if (opts.placeholder) input.placeholder = opts.placeholder;
      const focusStyle = INPUT_STYLE + 'outline:none;border-color:#e47b35;';
      input.addEventListener('focus', () => input.setAttribute('style', focusStyle));
      input.addEventListener('blur', () => input.setAttribute('style', INPUT_STYLE));
      box.appendChild(input);
      const actions = el('div', ACTIONS_STYLE);
      const cancelStyle = BTN_STYLE, cancelHover = BTN_STYLE + 'background:#363b43;';
      const cancel = el('button', cancelStyle, { textContent: 'Cancel' });
      hoverize(cancel, cancelStyle, cancelHover);
      const okStyle = BTN_PRIMARY_STYLE, okHover = BTN_PRIMARY_STYLE + 'background:#f09a55;';
      const ok = el('button', okStyle, { textContent: opts.confirmText || 'OK' });
      hoverize(ok, okStyle, okHover);
      actions.append(cancel, ok);
      box.appendChild(actions);
      const finish = value => { teardown(overlay, onKeydown); resolve(value); };
      ok.addEventListener('click', () => finish(input.value));
      cancel.addEventListener('click', () => finish(null));
      overlay.addEventListener('click', e => { if (e.target === overlay) finish(null); });
      function onKeydown(e) {
        if (e.key === 'Escape') { e.preventDefault(); finish(null); }
        else if (e.key === 'Enter' && document.activeElement === input) { e.preventDefault(); finish(input.value); }
      }
      document.addEventListener('keydown', onKeydown, true);
      input.focus();
      input.select();
    });
  }

  window.forgeAlert = forgeAlert;
  window.forgeConfirm = forgeConfirm;
  window.forgePrompt = forgePrompt;
})();
