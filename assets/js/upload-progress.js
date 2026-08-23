/* ---------------------------------------------------------------
 * upload-progress.js
 * ---------------------------------------------------------------
 * A small floating progress panel for file uploads (Assets panel drag/drop
 * and upload button, File Manager import). Self-contained like
 * forge-dialogs.js — inline styles only (the app's CSP is style-src 'self'
 * with no unsafe-inline, but style-src-attr allows inline `style="..."`
 * attributes; see core/index.js) — so it works from any script without a
 * stylesheet dependency.
 *
 * Usage:
 *   const tracker = window.forgeUploadProgress.begin('Uploading assets');
 *   const row = tracker.addFile('texture.png');
 *   row.progress(0.42);      // 0..1
 *   row.done();              // or:
 *   row.error('Too large');  // marks the row red; message shown on hover via title
 *   tracker.finish();        // panel auto-hides shortly after, or immediately if nothing failed
 * ------------------------------------------------------------- */
(() => {
  if (window.forgeUploadProgress) return; // already installed

  const PANEL_STYLE = 'position:fixed;right:16px;bottom:16px;z-index:9500;width:300px;max-width:calc(100vw - 32px);'
    + 'background:#23262d;border:1px solid #3a3f49;border-radius:8px;box-shadow:0 20px 50px rgba(0,0,0,.55);'
    + 'color:#d7d9dd;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;'
    + 'font-size:12.5px;overflow:hidden;';
  const HEADER_STYLE = 'display:flex;align-items:center;justify-content:space-between;padding:10px 12px;'
    + 'border-bottom:1px solid #2c3037;font-weight:600;color:#eef0f3;';
  const CLOSE_STYLE = 'background:none;border:none;color:#8a8f99;cursor:pointer;font-size:14px;line-height:1;padding:2px;';
  const LIST_STYLE = 'max-height:220px;overflow-y:auto;padding:6px 0;';
  const ROW_STYLE = 'padding:6px 12px;';
  const ROW_NAME_STYLE = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;'
    + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#c6c9cf;';
  const ROW_STATUS_STYLE = 'flex:none;color:#8a8f99;font-variant-numeric:tabular-nums;';
  const TRACK_STYLE = 'height:4px;border-radius:2px;background:#171920;overflow:hidden;';
  const BAR_STYLE = 'height:100%;width:0%;background:#e47b35;border-radius:2px;transition:width .15s ease;';
  const BAR_DONE_STYLE = BAR_STYLE + 'background:#5cb87a;width:100%;';
  const BAR_ERROR_STYLE = BAR_STYLE + 'background:#d75f64;width:100%;';

  function el(tag, style, props) {
    const node = document.createElement(tag);
    if (style) node.setAttribute('style', style);
    if (props) Object.assign(node, props);
    return node;
  }

  /** Starts a new upload progress panel. Returns a tracker with addFile()/finish(). */
  function begin(title = 'Uploading') {
    const panel = el('div', PANEL_STYLE);
    const header = el('div', HEADER_STYLE);
    header.appendChild(el('span', '', { textContent: title }));
    const close = el('button', CLOSE_STYLE, { textContent: '✕', title: 'Dismiss' });
    header.appendChild(close);
    panel.appendChild(header);
    const list = el('div', LIST_STYLE);
    panel.appendChild(list);
    document.body.appendChild(panel);
    close.addEventListener('click', () => panel.remove());

    let hasError = false;
    let autoHideTimer = null;

    function addFile(name) {
      const row = el('div', ROW_STYLE);
      const nameRow = el('div', ROW_NAME_STYLE);
      nameRow.appendChild(el('span', 'overflow:hidden;text-overflow:ellipsis;', { textContent: name }));
      const status = el('span', ROW_STATUS_STYLE, { textContent: '0%' });
      nameRow.appendChild(status);
      row.appendChild(nameRow);
      const track = el('div', TRACK_STYLE);
      const bar = el('div', BAR_STYLE);
      track.appendChild(bar);
      row.appendChild(track);
      list.appendChild(row);

      return {
        progress(fraction) {
          const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
          bar.style.width = pct + '%';
          status.textContent = pct + '%';
        },
        done() {
          bar.setAttribute('style', BAR_DONE_STYLE);
          status.textContent = '✓';
        },
        error(message) {
          hasError = true;
          bar.setAttribute('style', BAR_ERROR_STYLE);
          status.textContent = '⚠';
          row.title = message || 'Upload failed';
          status.title = message || 'Upload failed';
        }
      };
    }

    function finish() {
      // Give the last bar a beat to render as "done" before hiding; leave
      // failed uploads visible longer (and clickable-dismiss) so the rows
      // stay readable next to the error prompt this triggers separately.
      clearTimeout(autoHideTimer);
      autoHideTimer = setTimeout(() => panel.remove(), hasError ? 4000 : 900);
    }

    return { addFile, finish, get hasError() { return hasError; } };
  }

  window.forgeUploadProgress = { begin };
})();
