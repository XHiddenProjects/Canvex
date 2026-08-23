"use strict";
/* ---------------------------------------------------------------
 * forge-filemanager.js
 * ---------------------------------------------------------------
 * A custom File Manager for the project's `files/` tree (separate from
 * the Assets panel — this is a general nested folder/file browser):
 *   - browse via a folder tree + grid/list of the current folder
 *   - create files & folders, rename, delete
 *   - import files or whole folders (drag & drop, or the Import buttons)
 *   - export a single file as-is, or a folder as a generated .zip
 *   - double-click a file to open it in a real viewport tab: syntax
 *     highlighted + editable for text/code, a themed viewer for images
 *     and video/audio, or a "no preview" card with a Download action
 *     for anything else.
 *
 * Self-contained: depends only on window.__forgeState / __forgeApi /
 * __forgeToast (editor.js) and window.forgeAlert/forgeConfirm/forgePrompt
 * (forge-dialogs.js), all already loaded before this script runs.
 * ------------------------------------------------------------- */
(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  function boot() {
    const state = window.__forgeState;
    const api = window.__forgeApi;
    const apiUpload = window.__forgeApiUpload;
    if (!state || !api) { setTimeout(boot, 50); return; }

    const toast = msg => window.__forgeToast?.(msg);
    const escapeHtml = window.__forgeEscape || (s => String(s));

    // ---------------------------------------------------------------
    // Shared file-type helpers
    // ---------------------------------------------------------------
    const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico']);
    const VIDEO_EXT = new Set(['.mp4', '.webm', '.ogv', '.mov', '.m4v']);
    const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.m4a']);
    const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.json', '.glsl', '.frag', '.vert', '.css', '.html', '.htm', '.md', '.markdown', '.bb', '.bbcode', '.tex', '.latex', '.txt', '.csv', '.xml', '.yml', '.yaml']);
    // Extensions whose content is a markup language with an actual
    // "rendered" form — these get a real rendered-HTML Preview mode
    // (renderMarkupPreview below) instead of just a read-only view of
    // their own source. Plain code files have no such rendered form, so
    // Preview for those stays as highlighted source, same as before.
    const MARKUP_KIND = { '.md': 'markdown', '.markdown': 'markdown', '.bb': 'bbcode', '.bbcode': 'bbcode', '.tex': 'latex', '.latex': 'latex' };
    // Maps a file extension to a registered highlight.js language. The
    // vendored highlight.min.js now bundles all 193 highlight.js grammars
    // (see editor.html's script comment) plus GLSL registered separately,
    // so every extension below resolves to real keyword coloring rather
    // than guessing at an unregistered language.
    const HLJS_LANG = {
  // JavaScript
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',

  // TypeScript
  '.ts': 'typescript',
  '.tsx': 'typescript',

  // JSON
  '.json': 'json',
  '.jsonc': 'json',

  // Web
  '.html': 'xml',
  '.htm': 'xml',
  '.xhtml': 'xml',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'scss',
  '.less': 'less',

  // Markdown
  '.md': 'markdown',
  '.markdown': 'markdown',

  // LaTeX
  '.tex': 'latex',
  '.latex': 'latex',

  // XML
  '.xml': 'xml',
  '.svg': 'xml',

  // YAML
  '.yml': 'yaml',
  '.yaml': 'yaml',

  // TOML / INI
  '.toml': 'ini',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.conf': 'ini',

  // Shell
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',

  // C-family
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',

  // C#
  '.cs': 'csharp',

  // Java
  '.java': 'java',

  // Kotlin
  '.kt': 'kotlin',
  '.kts': 'kotlin',

  // Swift
  '.swift': 'swift',

  // Go
  '.go': 'go',

  // Rust
  '.rs': 'rust',

  // Python
  '.py': 'python',

  // PHP
  '.php': 'php',

  // Ruby
  '.rb': 'ruby',

  // Perl
  '.pl': 'perl',

  // Lua
  '.lua': 'lua',

  // R
  '.r': 'r',

  // SQL
  '.sql': 'sql',

  // Docker
  '.dockerfile': 'dockerfile',

  // Git
  '.gitignore': 'plaintext',
  '.gitattributes': 'plaintext',

  // Powershell
  '.ps1': 'powershell',

  // GLSL
  '.glsl': 'glsl',
  '.frag': 'glsl',
  '.vert': 'glsl',
  '.vs': 'glsl',
  '.fs': 'glsl',

  // Misc
  '.txt': 'plaintext',
  '.log': 'plaintext',
  '.csv': 'plaintext'
};

    function extOf(name) { const m = /\.[a-z0-9]+$/i.exec(name || ''); return m ? m[0].toLowerCase() : ''; }
    function kindOf(name) {
      const ext = extOf(name);
      if (IMAGE_EXT.has(ext)) return 'image';
      if (VIDEO_EXT.has(ext)) return 'video';
      if (AUDIO_EXT.has(ext)) return 'audio';
      if (CODE_EXT.has(ext)) return 'code';
      return 'other';
    }
    const GLYPH = { folder: '🗀', image: '🖼', video: '🎬', audio: '♪', code: '⌘', other: '◫' };
    function glyphFor(entry) { return entry.type === 'folder' ? GLYPH.folder : GLYPH[kindOf(entry.name)]; }

    // ---------------------------------------------------------------
    // Markup renderers — turn Markdown/BBCode/LaTeX source into real
    // HTML for the code viewer's Preview mode (see renderCodeView).
    // ---------------------------------------------------------------

    // A light XSS safety net for HTML produced from user-authored project
    // files: strips <script> tags, inline on*="" event handlers, and
    // javascript: URLs. Not a full sanitizer (no DOMPurify vendored), but
    // covers the common injection vectors for content that's otherwise
    // just the user's own project files rendering their own markup.
    function sanitizeMarkupHtml(html) {
      return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
    }

    function renderMarkdownPreview(src) {
      if (!window.marked) return `<div class="forge-markup-error">Markdown renderer failed to load.</div><pre>${escapeHtml(src)}</pre>`;
      window.marked.setOptions({ gfm: true, breaks: true });
      return sanitizeMarkupHtml(window.marked.parse(src));
    }

    // A common practical subset of BBCode — the tags forums/chat systems
    // actually use — rather than the full, rarely-standardized spec.
    function renderBbcodePreview(src) {
      let html = escapeHtml(src);
      const tag = (name, open, close) => {
        const re = new RegExp(`\\[${name}\\]([\\s\\S]*?)\\[/${name}\\]`, 'gi');
        html = html.replace(re, (_, inner) => `${open}${inner}${close}`);
      };
      // [code] first, so markup inside it isn't further processed.
      html = html.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (_, inner) => `<pre><code>${inner}</code></pre>`);
      tag('b', '<strong>', '</strong>');
      tag('i', '<em>', '</em>');
      tag('u', '<span style="text-decoration:underline">', '</span>');
      tag('s', '<span style="text-decoration:line-through">', '</span>');
      tag('center', '<div class="bb-center">', '</div>');
      html = html.replace(/\[quote(?:=&quot;?([^\]&]*)&quot;?)?\]([\s\S]*?)\[\/quote\]/gi,
        (_, author, inner) => `<blockquote>${author ? `<strong>${author} wrote:</strong><br>` : ''}${inner}</blockquote>`);
      html = html.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_, href, inner) => `<a href="${href}" target="_blank" rel="noopener">${inner}</a>`);
      html = html.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (_, href) => `<a href="${href}" target="_blank" rel="noopener">${href}</a>`);
      html = html.replace(/\[img\]([\s\S]*?)\[\/img\]/gi, (_, src2) => `<img src="${src2}" alt="">`);
      html = html.replace(/\[color=([^\]]+)\]([\s\S]*?)\[\/color\]/gi, (_, c, inner) => `<span style="color:${c}">${inner}</span>`);
      html = html.replace(/\[size=(\d+)\]([\s\S]*?)\[\/size\]/gi, (_, n, inner) => `<span class="bb-size-${Math.max(1, Math.min(6, Math.round(n / 4)))}">${inner}</span>`);
      html = html.replace(/\[spoiler(?:=([^\]]*))?\]([\s\S]*?)\[\/spoiler\]/gi,
        (_, label, inner) => `<div class="bb-spoiler"><span class="bb-spoiler-toggle" onclick="this.parentElement.classList.toggle('open')">▸ ${label || 'Spoiler'}</span><div class="bb-spoiler-body">${inner}</div></div>`);
      // [list]/[*] (unordered) and [list=1] (ordered)
      html = html.replace(/\[list=1\]([\s\S]*?)\[\/list\]/gi, (_, inner) =>
        `<ol>${inner.split(/\[\*\]/).map(s => s.trim()).filter(Boolean).map(s => `<li>${s}</li>`).join('')}</ol>`);
      html = html.replace(/\[list\]([\s\S]*?)\[\/list\]/gi, (_, inner) =>
        `<ul>${inner.split(/\[\*\]/).map(s => s.trim()).filter(Boolean).map(s => `<li>${s}</li>`).join('')}</ul>`);
      return sanitizeMarkupHtml(html.replace(/\n/g, '<br>'));
    }

    // Not a full LaTeX engine (no \documentclass/package/layout support —
    // that needs a real TeX toolchain) — renders inline/display math via
    // KaTeX plus the handful of text commands common in LaTeX notes
    // (sections, emphasis, lists), so plain LaTeX-flavored notes preview
    // usefully without requiring the file to compile.
    function renderLatexPreview(src) {
      if (!window.katex) return `<div class="forge-markup-error">LaTeX renderer failed to load.</div><pre>${escapeHtml(src)}</pre>`;
      const mathSpans = [];
      const stash = (expr, displayMode) => {
        let rendered;
        try { rendered = window.katex.renderToString(expr, { throwOnError: false, displayMode }); }
        catch (e) { rendered = `<span class="forge-markup-error">${escapeHtml(String(e.message || e))}</span>`; }
        mathSpans.push(rendered);
        return `\u0000${mathSpans.length - 1}\u0000`;
      };
      // Pull out math first (longest/most-specific delimiters before
      // shorter ones) so its contents are never touched by text escaping
      // or the command replacements below.
      let text = src
        .replace(/\$\$([\s\S]+?)\$\$/g, (_, e) => stash(e, true))
        .replace(/\\\[([\s\S]+?)\\\]/g, (_, e) => stash(e, true))
        .replace(/\\\(([\s\S]+?)\\\)/g, (_, e) => stash(e, false))
        .replace(/\$([^$\n]+?)\$/g, (_, e) => stash(e, false));

      text = escapeHtml(text)
        .replace(/\\section\*?\{([^}]*)\}/g, '<h2>$1</h2>')
        .replace(/\\subsection\*?\{([^}]*)\}/g, '<h3>$1</h3>')
        .replace(/\\subsubsection\*?\{([^}]*)\}/g, '<h4>$1</h4>')
        .replace(/\\textbf\{([^}]*)\}/g, '<strong>$1</strong>')
        .replace(/\\(?:textit|emph)\{([^}]*)\}/g, '<em>$1</em>')
        .replace(/\\underline\{([^}]*)\}/g, '<span style="text-decoration:underline">$1</span>')
        .replace(/\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/g, (_, inner) =>
          `<ul>${inner.split('\\item').map(s => s.trim()).filter(Boolean).map(s => `<li>${s}</li>`).join('')}</ul>`)
        .replace(/\\begin\{enumerate\}([\s\S]*?)\\end\{enumerate\}/g, (_, inner) =>
          `<ol>${inner.split('\\item').map(s => s.trim()).filter(Boolean).map(s => `<li>${s}</li>`).join('')}</ol>`)
        .replace(/\\\\/g, '<br>')
        .replace(/\n{2,}/g, '</p><p>')
        .replace(/\u0000(\d+)\u0000/g, (_, i) => mathSpans[+i]);
      return sanitizeMarkupHtml(`<p>${text}</p>`);
    }

    function renderMarkupPreview(kind, src) {
      if (kind === 'markdown') return renderMarkdownPreview(src);
      if (kind === 'bbcode') return renderBbcodePreview(src);
      if (kind === 'latex') return renderLatexPreview(src);
      return escapeHtml(src);
    }
    function formatSize(bytes) {
      if (bytes == null) return '';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    function formatTime(sec) {
      if (!isFinite(sec) || sec < 0) sec = 0;
      sec = Math.floor(sec);
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      const mm = h ? String(m).padStart(2, '0') : String(m);
      const ss = String(s).padStart(2, '0');
      return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    }

    /** Custom themed audio/video player used in the file preview pane,
     *  replacing the browser's native <video controls>/<audio controls>
     *  chrome with controls that match the rest of the editor: a play
     *  button, a scrubber, time readout, volume, playback speed, and
     *  (for video) fullscreen. Video keeps the old autoplay-muted
     *  behaviour so a preview starts immediately without surprise sound. */
    function renderMediaPlayer(body, entry, kind) {
      const isVideo = kind === 'video';
      const src = rawUrl(entry.path);
      body.innerHTML = `
        <div class="fm-player ${isVideo ? 'fm-player-video' : 'fm-player-audio'}">
          ${isVideo ? `
            <div class="fm-player-stage">
              <video class="fm-player-media" src="${src}" playsinline></video>
              <button type="button" class="fm-player-bigplay" aria-label="Play">▶</button>
            </div>` : `
            <div class="fm-player-art">
              <span class="fm-player-art-glyph">♪</span>
              <div class="fm-player-bars">${'<span></span>'.repeat(5)}</div>
            </div>
            <div class="fm-player-title" title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</div>
            <audio class="fm-player-media" src="${src}"></audio>`}
          <div class="fm-player-bar">
            <div class="fm-player-row fm-player-row-main">
              <button type="button" class="fm-player-btn fm-player-playpause" aria-label="Play">▶</button>
              <span class="fm-player-time fm-player-cur">0:00</span>
              <input type="range" class="fm-player-seek fc-range-fill" min="0" max="0" step="0.1" value="0">
              <span class="fm-player-time fm-player-dur">0:00</span>
            </div>
            <div class="fm-player-row fm-player-row-aux">
              <div class="fm-player-vol-group">
                <button type="button" class="fm-player-btn fm-player-mute" aria-label="Mute">🔊</button>
                <input type="range" class="fm-player-vol fc-range-fill" min="0" max="100" step="1" value="100">
              </div>
              <select class="fm-player-rate" title="Playback speed">
                <option value="0.5">0.5×</option>
                <option value="0.75">0.75×</option>
                <option value="1" selected>1×</option>
                <option value="1.25">1.25×</option>
                <option value="1.5">1.5×</option>
                <option value="2">2×</option>
              </select>
              ${isVideo ? `<button type="button" class="fm-player-btn fm-player-fullscreen" aria-label="Fullscreen">⛶</button>` : ''}
            </div>
          </div>
        </div>`;

      const root = body.querySelector('.fm-player');
      const media = root.querySelector('.fm-player-media');
      const playBtn = root.querySelector('.fm-player-playpause');
      const bigPlay = root.querySelector('.fm-player-bigplay');
      const curEl = root.querySelector('.fm-player-cur');
      const durEl = root.querySelector('.fm-player-dur');
      const seek = root.querySelector('.fm-player-seek');
      const muteBtn = root.querySelector('.fm-player-mute');
      const volSlider = root.querySelector('.fm-player-vol');
      const rateSel = root.querySelector('.fm-player-rate');
      const fsBtn = root.querySelector('.fm-player-fullscreen');
      const bars = root.querySelectorAll('.fm-player-bars span');
      let seeking = false;
      let lastVolume = 1;
      let barsRaf = null;

      function setPlayIcon(playing) {
        playBtn.textContent = playing ? '⏸' : '▶';
        playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        if (bigPlay) bigPlay.style.display = playing ? 'none' : 'flex';
        root.classList.toggle('is-playing', playing);
      }
      function togglePlay() { if (media.paused || media.ended) media.play().catch(() => {}); else media.pause(); }
      playBtn.addEventListener('click', togglePlay);
      bigPlay?.addEventListener('click', togglePlay);
      if (isVideo) media.addEventListener('click', togglePlay);

      // Paints the scrubber as a single background gradient on the input
      // itself (the app's existing .fc-range-fill convention from
      // forms.css) rather than stacking separate overlay elements —
      // three zones: played (accent), buffered-but-not-played (gray),
      // and not-yet-buffered (base track color).
      function paintSeek() {
        const max = Number(seek.max) || 0;
        const playedPct = max ? Math.min(100, (Number(seek.value) / max) * 100) : 0;
        let bufferedPct = playedPct;
        if (max) {
          let end = 0;
          try {
            for (let i = 0; i < media.buffered.length; i++) {
              if (media.buffered.start(i) <= media.currentTime + 0.25) {
                end = Math.max(end, media.buffered.end(i));
              }
            }
            if (!end && media.buffered.length) end = media.buffered.end(media.buffered.length - 1);
          } catch (e) { /* buffered can throw before any data has loaded */ }
          bufferedPct = Math.max(playedPct, Math.min(100, (end / max) * 100));
        }
        seek.style.background = `linear-gradient(90deg, var(--accent) 0%, var(--accent) ${playedPct}%, #565c66 ${playedPct}%, #565c66 ${bufferedPct}%, #33383f ${bufferedPct}%, #33383f 100%)`;
      }
      media.addEventListener('play', () => setPlayIcon(true));
      media.addEventListener('pause', () => setPlayIcon(false));
      media.addEventListener('ended', () => setPlayIcon(false));
      media.addEventListener('loadedmetadata', () => {
        media.muted = false;
        durEl.textContent = formatTime(media.duration);
        seek.max = String(media.duration || 0);
        paintSeek();
        updateMuteIcon();
      });
      media.addEventListener('timeupdate', () => {
        if (seeking) { paintSeek(); return; }
        curEl.textContent = formatTime(media.currentTime);
        seek.value = String(media.currentTime);
        paintSeek();
      });
      media.addEventListener('progress', paintSeek);
      seek.addEventListener('input', () => {
        seeking = true;
        curEl.textContent = formatTime(Number(seek.value));
        paintSeek();
      });
      seek.addEventListener('change', () => { media.currentTime = Number(seek.value); seeking = false; });

      function paintVol() {
        const v = Number(volSlider.value);
        volSlider.style.background = `linear-gradient(90deg, var(--accent) 0%, var(--accent) ${v}%, #33383f ${v}%, #33383f 100%)`;
      }
      function updateMuteIcon() {
        muteBtn.textContent = (media.muted || media.volume === 0) ? '🔇' : (media.volume < 0.5 ? '🔉' : '🔊');
      }
      volSlider.addEventListener('input', () => {
        const v = Number(volSlider.value) / 100;
        media.muted = false;
        media.volume = v;
        paintVol();
        updateMuteIcon();
      });
      muteBtn.addEventListener('click', () => {
        if (media.muted || media.volume === 0) {
          media.muted = false;
          media.volume = lastVolume || 1;
          volSlider.value = String(Math.round(media.volume * 100));
        } else {
          lastVolume = media.volume;
          media.muted = true;
        }
        paintVol();
        updateMuteIcon();
      });
      rateSel.addEventListener('change', () => { media.playbackRate = Number(rateSel.value); });


      if (isVideo && fsBtn) {
        fsBtn.addEventListener('click', () => {
          const stage = root.querySelector('.fm-player-stage');
          if (document.fullscreenElement) document.exitFullscreen();
          else stage.requestFullscreen?.();
        });
      }

      // Little animated level bars on the audio "album art" while playing —
      // purely decorative, no analyser needed.
      if (!isVideo && bars.length) {
        function animateBars() {
          bars.forEach(b => { b.style.transform = `scaleY(${(0.25 + Math.random() * 0.9).toFixed(2)})`; });
          barsRaf = requestAnimationFrame(animateBars);
        }
        function stopBars() {
          if (barsRaf) cancelAnimationFrame(barsRaf);
          barsRaf = null;
          bars.forEach(b => { b.style.transform = 'scaleY(.25)'; });
        }
        media.addEventListener('play', () => { if (!barsRaf) animateBars(); });
        media.addEventListener('pause', stopBars);
        media.addEventListener('ended', stopBars);
      }

      media.volume = 1;
      if (isVideo) {
        // Autoplay requires muted; the unmute control lets the user opt in to sound.
        media.muted = true;
        media.play().catch(() => {});
      }
      paintVol();
      paintSeek();
      updateMuteIcon();
    }

    function rawUrl(path) { return `/api/games/${encodeURIComponent(state.slug)}/files/raw?path=${encodeURIComponent(path)}`; }
    function exportUrl(path) { return `/api/games/${encodeURIComponent(state.slug)}/files/export?path=${encodeURIComponent(path)}`; }

    function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    // ===================================================================
    // Popup browser
    // ===================================================================
    const overlay = $('#fmOverlay');
    if (!overlay) return; // markup not present on this page (e.g. play.html)

    const fm = { cwd: '', tree: [], expanded: new Set(['']), view: 'grid', search: '', selected: null, picker: null, pickerSelected: new Set() };
    let pickerResolve = null;

    /** Looks up any node (file or folder) by path, unlike findNode() below
     *  which only resolves folders (used for tree navigation). */
    function nodeAt(path) {
      if (!path) return { type: 'folder', path: '', children: fm.tree };
      const segs = path.split('/');
      let list = fm.tree, node = null;
      for (const seg of segs) {
        node = (list || []).find(n => n.name === seg);
        if (!node) return null;
        list = node.children;
      }
      return node;
    }

    function findNode(path) {
      if (!path) return { children: fm.tree };
      const segs = path.split('/');
      let list = fm.tree, node = null;
      for (const seg of segs) {
        node = (list || []).find(n => n.name === seg && n.type === 'folder');
        if (!node) return null;
        list = node.children;
      }
      return node;
    }

    async function reloadTree() {
      try {
        const { tree } = await api(`/api/games/${encodeURIComponent(state.slug)}/files`);
        fm.tree = tree || [];
      } catch (error) { toast(error.message); fm.tree = []; }
    }

    function folderList(nodes) { return (nodes || []).filter(n => n.type === 'folder'); }

    function renderTree() {
      const root = $('#fmTree');
      const rows = [];
      function walk(nodes, depth) {
        for (const node of folderList(nodes)) {
          const isOpen = fm.expanded.has(node.path);
          const isActive = fm.cwd === node.path;
          rows.push(`<div class="fm-tree-row${isActive ? ' active' : ''}" data-path="${escapeHtml(node.path)}" style="padding-left:${8 + depth * 14}px">
            <span class="fm-caret${folderList(node.children).length ? '' : ' leaf'}" data-caret="${escapeHtml(node.path)}">${isOpen ? '▾' : '▸'}</span>
            <span class="fm-glyph">🗀</span><span class="fm-label">${escapeHtml(node.name)}</span>
          </div>`);
          if (isOpen) walk(node.children, depth + 1);
        }
      }
      const projectRow = `<div class="fm-tree-row${fm.cwd === '' ? ' active' : ''}" data-path="" style="padding-left:8px">
        <span class="fm-caret leaf"></span><span class="fm-glyph">◇</span><span class="fm-label">Project Files</span>
      </div>`;
      root.innerHTML = projectRow + (() => { walk(fm.tree, 1); return rows.join(''); })();
    }

    function renderBreadcrumbs() {
      const el = $('#fmBreadcrumbs');
      const segs = fm.cwd ? fm.cwd.split('/') : [];
      let acc = '';
      const parts = [`<button data-path="">Project</button>`];
      segs.forEach((seg, i) => {
        acc = acc ? `${acc}/${seg}` : seg;
        parts.push(`<span class="fm-crumb-sep">›</span><button data-path="${escapeHtml(acc)}">${escapeHtml(seg)}</button>`);
      });
      el.innerHTML = parts.join('');
    }

    // Matches the File Manager picker's `accepts` option using the same
    // forms supported by a native file input: extensions, exact MIME types,
    // and wildcard MIME groups. Folders always remain visible for navigation.
    function matchesPickerAccept(entry) {
      if (!fm.picker || fm.picker.directory || entry.type === 'folder') return true;

      const accepts = fm.picker.accepts;
      if (!accepts || (Array.isArray(accepts) && accepts.length === 0)) return true;

      const rules = (Array.isArray(accepts) ? accepts : String(accepts).split(','))
        .flatMap(rule => String(rule).split(','))
        .map(rule => rule.trim().toLowerCase())
        .filter(Boolean);
      if (!rules.length) return true;

      const name = String(entry.name || '').toLowerCase();
      const ext = extOf(name);
      const mime = String(entry.mimeType || entry.mime || entry.typeMime || '').toLowerCase();
      return rules.some(rule => {
        if (rule.startsWith('.')) return ext === rule;
        if (rule.endsWith('/*')) return !!mime && mime.startsWith(rule.slice(0, -1));
        if (rule.includes('/')) return mime === rule;
        // Also accept a bare extension such as "png" for convenience.
        return ext === `.${rule.replace(/^\./, '')}`;
      });
    }

    function currentEntries() {
      const node = findNode(fm.cwd);
      const list = node ? (node.children || []) : [];
      const q = fm.search.trim().toLowerCase();
      return list.filter(entry =>
        matchesPickerAccept(entry) &&
        (!q || entry.name.toLowerCase().includes(q))
      );
    }

    function cardHtml(entry) {
      const kind = entry.type === 'folder' ? 'folder' : kindOf(entry.name);
      let thumb = `<span>${GLYPH[kind] || '◫'}</span>`;
      if (kind === 'image') thumb = `<img src="${rawUrl(entry.path)}" alt="" loading="lazy">`;
      const meta = entry.type === 'folder' ? `${(entry.children || []).length} item${(entry.children || []).length === 1 ? '' : 's'}` : formatSize(entry.size);
      // In picker mode, only the entry type the picker wants (folders when
      // picking a directory, files otherwise) is selectable — the other
      // type is still browsable (folders stay double-clickable to navigate
      // into) but dimmed, since it can't be chosen.
      const pickable = fm.picker && (fm.picker.directory ? entry.type === 'folder' : entry.type === 'file');
      const pickDisabled = fm.picker && !pickable;
      const checked = fm.picker && fm.pickerSelected.has(entry.path);
      const pickClasses = fm.picker ? `${pickable ? ' fm-pick-target' : ''}${pickDisabled ? ' fm-pick-disabled' : ''}${checked ? ' fm-pick-checked' : ''}` : '';
      const checkbox = pickable ? `<span class="fm-pick-check">✓</span>` : '';
      return `<div class="fm-card type-${kind}${fm.selected === entry.path ? ' selected' : ''}${pickClasses}" data-path="${escapeHtml(entry.path)}" data-type="${entry.type}" title="${escapeHtml(entry.name)}">
        ${checkbox}
        <div class="fm-thumb">${thumb}</div>
        <span class="fm-name">${escapeHtml(entry.name)}</span>
        <span class="fm-meta">${escapeHtml(meta)}</span>
      </div>`;
    }

    function renderGrid() {
      const grid = $('#fmGrid');
      const entries = currentEntries();
      grid.classList.toggle('list-view', fm.view === 'list');
      if (!entries.length) {
        const node = findNode(fm.cwd);
        const hasAnything = !!(node && node.children && node.children.length);
        const q = fm.search.trim();
        grid.innerHTML = !hasAnything
          ? `<div class="fm-empty">This folder is empty. Create a file/folder, or import something into it.</div>`
          : q
          ? `<div class="fm-empty">No files match "${escapeHtml(q)}".</div>`
          : `<div class="fm-empty">No files here match the allowed type for this picker.</div>`;
      } else {
        grid.innerHTML = entries.map(cardHtml).join('');
      }
      const folders = entries.filter(e => e.type === 'folder').length;
      $('#fmStatus').textContent = `${entries.length} item${entries.length === 1 ? '' : 's'} (${folders} folder${folders === 1 ? '' : 's'}, ${entries.length - folders} file${entries.length - folders === 1 ? '' : 's'})`;
    }

    function renderAll() { renderTree(); renderBreadcrumbs(); renderGrid(); }

    async function refresh() { await reloadTree(); renderAll(); }

    function navigateTo(path) {
      fm.cwd = path;
      fm.selected = null;
      let acc = '';
      for (const seg of path ? path.split('/') : []) { acc = acc ? `${acc}/${seg}` : seg; fm.expanded.add(acc); }
      renderAll();
    }

    /** Refreshes the fm-picker-bar (count, hint text, confirm button) to
     *  match the current selection — called after every selection change. */
    function renderPickerBar() {
      const bar = $('#fmPickerBar');
      const title = $('#fmTitle');
      if (!fm.picker) { bar.style.display = 'none'; title.textContent = 'File Manager'; return; }
      bar.style.display = 'flex';
      title.textContent = fm.picker.directory ? 'Select a Folder' : `Select File${fm.picker.multiple ? '(s)' : ''}`;
      const n = fm.pickerSelected.size;
      $('#fmPickerHint').textContent = fm.picker.directory
        ? 'Click a folder to select it, or browse in and use "Select This Folder".'
        : (fm.picker.multiple ? 'Click file(s) to select, or double-click one to import it immediately.' : 'Click a file to select it, or double-click to import it immediately.');
      $('#fmPickerConfirm').textContent = n ? `Select ${n} item${n === 1 ? '' : 's'}` : 'Select';
      $('#fmPickerConfirm').disabled = n === 0;
      $('#fmPickerSelectFolder').style.display = fm.picker.directory ? 'inline-flex' : 'none';
    }

    function togglePickerSelection(path) {
      if (!fm.picker) return;
      if (fm.pickerSelected.has(path)) { fm.pickerSelected.delete(path); }
      else {
        if (!fm.picker.multiple) fm.pickerSelected.clear();
        fm.pickerSelected.add(path);
      }
      renderGrid();
      renderPickerBar();
    }

    function confirmPicker(paths) {
      const resolve = pickerResolve;
      pickerResolve = null;
      fm.picker = null;
      fm.pickerSelected = new Set();
      closeManager();
      resolve?.(paths && paths.length ? paths : null);
    }
    function cancelPicker() {
      const resolve = pickerResolve;
      pickerResolve = null;
      fm.picker = null;
      fm.pickerSelected = new Set();
      closeManager();
      resolve?.(null);
    }

    $('#fmPickerCancel')?.addEventListener('click', cancelPicker);
    $('#fmPickerConfirm')?.addEventListener('click', () => confirmPicker([...fm.pickerSelected]));
    $('#fmPickerSelectFolder')?.addEventListener('click', () => {
      if (!fm.picker?.multiple) { confirmPicker([fm.cwd]); return; }
      fm.pickerSelected.add(fm.cwd);
      renderGrid();
      renderPickerBar();
    });

    async function openManager(opts) {
      if (!state.slug) { toast('Loading project…'); return; }
      if (opts && opts.__resolve) {
        fm.picker = { multiple: !!opts.multiple, directory: !!opts.directory, accepts: opts.accepts ?? null };
        fm.pickerSelected = new Set();
        pickerResolve = opts.__resolve;
      } else {
        fm.picker = null;
      }
      overlay.classList.add('show');
      document.body.classList.add('fm-open');
      await refresh();
      renderPickerBar();
    }
    function closeManager() { overlay.classList.remove('show'); document.body.classList.remove('fm-open'); }
    window.__forgeOpenFileManager = () => openManager();
    /** Opens the File Manager as a picker instead of the OS's native file
     *  dialog, so imports (e.g. the Assets panel's Import button) can pull
     *  from files already in the project. `multiple`/`directory` mirror the
     *  same-named attributes on a native <input type=file>. Resolves with
     *  an array of selected paths, or null if the user cancels. */
    window.__forgeOpenFilePicker = (opts = {}) => new Promise(resolve => openManager({ ...opts, __resolve: resolve }));

    $('#openFileManager')?.addEventListener('click', () => openManager());
    $('#fmClose')?.addEventListener('click', () => { if (fm.picker) cancelPicker(); else closeManager(); });
    overlay.addEventListener('click', e => { if (e.target === overlay) { if (fm.picker) cancelPicker(); else closeManager(); } });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.classList.contains('show')) { if (fm.picker) cancelPicker(); else closeManager(); } });

    $('#fmTree')?.addEventListener('click', e => {
      const caret = e.target.closest('[data-caret]');
      if (caret) {
        const p = caret.dataset.caret;
        if (fm.expanded.has(p)) fm.expanded.delete(p); else fm.expanded.add(p);
        renderTree();
        return;
      }
      const row = e.target.closest('.fm-tree-row');
      if (row) navigateTo(row.dataset.path);
    });

    $('#fmBreadcrumbs')?.addEventListener('click', e => {
      const btn = e.target.closest('button[data-path]');
      if (btn) navigateTo(btn.dataset.path);
    });

    $('#fmSearch')?.addEventListener('input', e => { fm.search = e.target.value; renderGrid(); });
    $('#fmGridViewBtn')?.addEventListener('click', e => { fm.view = 'grid'; e.currentTarget.classList.add('active'); $('#fmListViewBtn')?.classList.remove('active'); renderGrid(); });
    $('#fmListViewBtn')?.addEventListener('click', e => { fm.view = 'list'; e.currentTarget.classList.add('active'); $('#fmGridViewBtn')?.classList.remove('active'); renderGrid(); });

    // --- grid interactions: select / open / rename(dblclick on name is same as open) ---
    $('#fmGrid')?.addEventListener('click', e => {
      const card = e.target.closest('.fm-card');
      if (!card) { fm.selected = null; return; }
      if (fm.picker) {
        // Only the checkbox toggles selection — a plain click on the rest
        // of the card intentionally does nothing here (rather than also
        // toggling) so it doesn't re-render the grid mid double-click and
        // break the browser's dblclick detection on the "pick & close"
        // fast path below.
        if (e.target.closest('.fm-pick-check') && card.classList.contains('fm-pick-target')) togglePickerSelection(card.dataset.path);
        return;
      }
      fm.selected = card.dataset.path;
      $$('.fm-card.selected').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    });
    $('#fmGrid')?.addEventListener('dblclick', e => {
      const card = e.target.closest('.fm-card');
      if (!card) return;
      if (card.dataset.type === 'folder') { navigateTo(card.dataset.path); return; }
      if (fm.picker) {
        // Double-clicking a file while picking files is a fast "pick this
        // one and close" shortcut, matching native file-open dialogs.
        if (!fm.picker.directory) confirmPicker([card.dataset.path]);
        return;
      }
      openFileFromManager(card.dataset.path);
    });

    // --- create / rename / delete ---
    $('#fmNewFolder')?.addEventListener('click', async () => {
      const name = await window.forgePrompt('Folder name', '', { title: 'New Folder', placeholder: 'New Folder' });
      if (!name || !name.trim()) return;
      try {
        await api(`/api/games/${encodeURIComponent(state.slug)}/files`, { method: 'POST', body: JSON.stringify({ parentPath: fm.cwd, name: name.trim(), type: 'folder' }) });
        await refresh();
        toast(`Folder "${name.trim()}" created`);
      } catch (error) { toast(error.message); }
    });
    $('#fmNewFile')?.addEventListener('click', async () => {
      const name = await window.forgePrompt('File name (with extension)', '', { title: 'New File', placeholder: 'new-file.js' });
      if (!name || !name.trim()) return;
      try {
        await api(`/api/games/${encodeURIComponent(state.slug)}/files`, { method: 'POST', body: JSON.stringify({ parentPath: fm.cwd, name: name.trim(), type: 'file', content: '' }) });
        await refresh();
        toast(`File "${name.trim()}" created`);
      } catch (error) { toast(error.message); }
    });

    async function renameEntry(entryPath, entryName) {
      const name = await window.forgePrompt('Rename', entryName, { title: 'Rename' });
      if (!name || !name.trim() || name.trim() === entryName) return;
      try {
        await api(`/api/games/${encodeURIComponent(state.slug)}/files/rename`, { method: 'PUT', body: JSON.stringify({ path: entryPath, newName: name.trim() }) });
        await refresh();
        toast(`Renamed to "${name.trim()}"`);
      } catch (error) { toast(error.message); }
    }
    async function deleteEntry(entryPath, entryName, isFolder) {
      const ok = await window.forgeConfirm(isFolder ? `Delete folder "${entryName}" and everything inside it?` : `Delete "${entryName}"?`, { title: 'Delete', danger: true, confirmText: 'Delete' });
      if (!ok) return;
      try {
        await api(`/api/games/${encodeURIComponent(state.slug)}/files?path=${encodeURIComponent(entryPath)}`, { method: 'DELETE' });
        window.__forgeCloseFileTab?.(entryPath, isFolder);
        await refresh();
        toast(`"${entryName}" deleted`);
      } catch (error) { toast(error.message); }
    }
    function downloadEntry(entryPath) {
      const a = document.createElement('a');
      a.href = exportUrl(entryPath);
      document.body.appendChild(a); a.click(); a.remove();
    }

    // --- import ---
    async function importIntoCwd(files, { asFolder = false } = {}) {
      if (!files.length) return;
      const payload = [];
      const readErrors = [];
      for (const file of files) {
        try {
          const dataUrl = await readFileAsDataUrl(file);
          const relPath = asFolder ? (file.webkitRelativePath || file.name) : file.name;
          payload.push({ relPath, dataUrl });
        } catch (error) { readErrors.push(`${file.name}: could not read file`); }
      }
      if (!payload.length) {
        if (readErrors.length) await window.forgeAlert(readErrors.join('\n'), { title: 'Import failed', danger: true });
        return;
      }
      const label = asFolder ? 'folder' : (payload.length === 1 ? payload[0].relPath : `${payload.length} files`);
      const tracker = window.forgeUploadProgress?.begin(`Importing ${label}`);
      const row = tracker?.addFile(label);
      try {
        const { imported } = await apiUpload(`/api/games/${encodeURIComponent(state.slug)}/files/import`, {
          method: 'POST',
          body: JSON.stringify({ parentPath: fm.cwd, files: payload }),
          onProgress: fraction => row?.progress(fraction)
        });
        row?.done();
        tracker?.finish();
        await refresh();
        toast(`${imported} file(s) imported`);
        if (readErrors.length) await window.forgeAlert(readErrors.join('\n'), { title: 'Some files were skipped', danger: true });
      } catch (error) {
        row?.error(error.message);
        tracker?.finish();
        await window.forgeAlert(error.message, { title: 'Import failed', danger: true });
      }
    }
    $('#fmImportFilesBtn')?.addEventListener('click', () => $('#fmImportFilesInput').click());
    $('#fmImportFolderBtn')?.addEventListener('click', () => $('#fmImportFolderInput').click());
    $('#fmImportFilesInput')?.addEventListener('change', e => { importIntoCwd([...e.target.files]); e.target.value = ''; });
    $('#fmImportFolderInput')?.addEventListener('change', e => { importIntoCwd([...e.target.files], { asFolder: true }); e.target.value = ''; });

    const drop = $('#fmDrop');
    ['dragover', 'dragenter'].forEach(evt => drop?.addEventListener(evt, e => { e.preventDefault(); drop.classList.add('drag-over'); }));
    ['dragleave', 'drop'].forEach(evt => drop?.addEventListener(evt, e => { e.preventDefault(); drop.classList.remove('drag-over'); }));
    drop?.addEventListener('drop', e => importIntoCwd([...(e.dataTransfer?.files || [])]));

    // --- export current folder ---
    $('#fmExportBtn')?.addEventListener('click', () => downloadEntry(fm.cwd));

    // --- context menu (right click / long-press on a card) ---
    const ctxMenu = document.createElement('div');
    ctxMenu.className = 'context-menu';
    ctxMenu.id = 'fmContextMenu';
    document.body.appendChild(ctxMenu);
    let ctxTarget = null;
    function closeCtx() { ctxMenu.classList.remove('show'); ctxTarget = null; }
    function openCtx(x, y, entry) {
      ctxTarget = entry;
      const items = entry.type === 'folder'
        ? [['open', '↪', 'Open'], ['rename', '✎', 'Rename'], ['export', '⇩', 'Export as .zip'], '---', ['delete', '✕', 'Delete', 'danger']]
        : [['open', '↪', 'Open'], ['rename', '✎', 'Rename'], ['download', '⇩', 'Download'], '---', ['delete', '✕', 'Delete', 'danger']];
      ctxMenu.innerHTML = `<div class="ctx-title">${escapeHtml(entry.name)}</div>` +
        items.map(it => it === '---' ? '<hr>' : `<button data-act="${it[0]}"${it[3] ? ` class="${it[3]}"` : ''}><span class="ctx-icon">${it[1]}</span>${it[2]}</button>`).join('');
      const vw = innerWidth, vh = innerHeight, mw = 190, mh = items.length * 30 + 30;
      ctxMenu.style.left = Math.min(x, vw - mw - 8) + 'px';
      ctxMenu.style.top = Math.min(y, vh - mh - 8) + 'px';
      ctxMenu.classList.add('show');
    }
    $('#fmGrid')?.addEventListener('contextmenu', e => {
      const card = e.target.closest('.fm-card');
      if (!card) return;
      e.preventDefault();
      const entries = currentEntries();
      const entry = entries.find(v => v.path === card.dataset.path);
      if (entry) openCtx(e.clientX, e.clientY, entry);
    });
    ctxMenu.addEventListener('click', e => {
      const btn = e.target.closest('button[data-act]');
      if (!btn || !ctxTarget) return;
      const act = btn.dataset.act, entry = ctxTarget;
      closeCtx();
      if (act === 'open') {
        if (entry.type === 'folder') navigateTo(entry.path);
        else if (fm.picker) { if (!fm.picker.directory) confirmPicker([entry.path]); }
        else openFileFromManager(entry.path);
      }
      else if (act === 'rename') renameEntry(entry.path, entry.name);
      else if (act === 'delete') deleteEntry(entry.path, entry.name, entry.type === 'folder');
      else if (act === 'download' || act === 'export') downloadEntry(entry.path);
    });
    document.addEventListener('click', e => { if (!e.target.closest('#fmContextMenu')) closeCtx(); });
    document.addEventListener('contextmenu', e => { if (!e.target.closest('#fmContextMenu') && !e.target.closest('.fm-card')) closeCtx(); });

    // ===================================================================
    // Viewport file tabs — opening a file switches the viewport from the
    // Scene canvas to a themed tab: code (syntax-highlighted + editable),
    // image, video/audio, or a "no preview" card with Download.
    // ===================================================================
    const viewportTabsBar = $('.viewport-tabs');
    const sceneTab = viewportTabsBar?.querySelector('button.active');
    const addTabBtn = $('#addViewportTab');
    const pane = $('#fmFilePane');
    const viewportEl = $('#viewport');
    const openTabs = new Map(); // path -> { button, entry, dirty, textCache }

    function showScene() {
      $$('.viewport-tabs > button[data-fm-tab]').forEach(b => b.classList.remove('active'));
      sceneTab?.classList.add('active');
      pane.style.display = 'none';
      pane.innerHTML = '';
    }
    sceneTab?.addEventListener('click', showScene);

    function closeTab(path) {
      const t = openTabs.get(path);
      if (!t) return;
      t.button.remove();
      openTabs.delete(path);
      if (pane.dataset.activePath === path) showScene();
    }
    window.__forgeCloseFileTab = (changedPath, isFolder) => {
      for (const path of [...openTabs.keys()]) {
        if (isFolder ? (path === changedPath || path.startsWith(changedPath + '/')) : path === changedPath) closeTab(path);
      }
    };

    function activateTab(path) {
      $$('.viewport-tabs > button').forEach(b => b.classList.remove('active'));
      openTabs.get(path)?.button.classList.add('active');
      pane.style.display = 'flex';
      pane.dataset.activePath = path;
      viewportEl.dataset.mode = viewportEl.dataset.mode; // no-op, keeps canvas mode intact underneath
    }

    function makeTab(entry) {
      const btn = document.createElement('button');
      btn.dataset.fmTab = '1';
      btn.innerHTML = `<span class="tab-dot"></span><span>${escapeHtml(entry.name)}</span> <span class="close">×</span>`;
      viewportTabsBar.insertBefore(btn, addTabBtn);
      btn.addEventListener('click', e => {
        if (e.target.closest('.close')) { closeTab(entry.path); return; }
        activateTab(entry.path);
        renderFileInPane(entry);
      });
      return btn;
    }

    async function openFileFromManager(path) {
      const entries = flattenTree(fm.tree);
      const entry = entries.find(e => e.path === path);
      if (!entry) return;
      closeManager();
      if (openTabs.has(path)) { activateTab(path); renderFileInPane(entry); return; }
      const button = makeTab(entry);
      openTabs.set(path, { button, entry, dirty: false });
      activateTab(path);
      renderFileInPane(entry);
    }
    function flattenTree(nodes, out = []) {
      for (const n of nodes || []) { if (n.type === 'file') out.push(n); else flattenTree(n.children, out); }
      return out;
    }

    /** Reads project file(s)/folder(s) already sitting in the File Manager's
     *  tree and hands them to the Assets panel's existing upload pipeline —
     *  this is what the Assets "Import" button now does after the user
     *  picks something in window.__forgeOpenFilePicker(), instead of that
     *  button reading straight off the user's OS disk. A folder in `paths`
     *  is expanded to every file underneath it. */
    async function importProjectFilesAsAssets(paths) {
      if (!paths || !paths.length) return;
      await reloadTree();
      const allFiles = flattenTree(fm.tree);
      const targets = new Map(); // path -> display name
      for (const p of paths) {
        const node = nodeAt(p);
        if (!node) continue;
        if (node.type === 'folder') {
          allFiles.filter(f => f.path === p || f.path.startsWith(`${p}/`)).forEach(f => targets.set(f.path, f.name));
        } else {
          targets.set(p, node.name);
        }
      }
      if (!targets.size) { toast('No files found to import'); return; }
      const fileObjs = [];
      for (const [path, name] of targets) {
        try {
          const res = await fetch(rawUrl(path));
          if (!res.ok) throw new Error('Could not read file');
          const blob = await res.blob();
          fileObjs.push(new File([blob], name, { type: blob.type || 'application/octet-stream' }));
        } catch (error) { toast(`${name}: ${error.message}`); }
      }
      if (fileObjs.length) await window.__forgeUploadFiles?.(fileObjs);
    }
    window.__forgeImportProjectFilesAsAssets = importProjectFilesAsAssets;

    function markDirty(path, dirty) {
      const t = openTabs.get(path);
      if (!t) return;
      t.dirty = dirty;
      t.button.querySelector('.tab-dot').style.background = dirty ? 'var(--accent, #e47b35)' : '';
    }

    async function renderFileInPane(entry) {
      const kind = kindOf(entry.name);
      pane.innerHTML = `<div class="fm-file-head">
        <span class="fm-file-path">${escapeHtml(entry.path)}</span>
        <span class="muted" id="fmFileSizeLabel">${formatSize(entry.size)}</span>
        <button class="fm-btn" id="fmFileDownload">⇩ Download</button>
      </div>
      <div class="fm-file-body" id="fmFileBody"><div class="fm-binary-view"><span class="fm-binary-glyph">⋯</span><span>Loading…</span></div></div>`;
      pane.querySelector('#fmFileDownload').addEventListener('click', () => downloadEntry(entry.path));

      const body = pane.querySelector('#fmFileBody');
      if (kind === 'code') {
        try {
          const { content } = await api(`/api/games/${encodeURIComponent(state.slug)}/files/content?path=${encodeURIComponent(entry.path)}`);
          renderCodeView(body, entry, content);
        } catch (error) {
          body.innerHTML = `<div class="fm-binary-view"><span class="fm-binary-glyph">⚠</span><span>${escapeHtml(error.message)}</span></div>`;
        }
      } else if (kind === 'image') {
        body.innerHTML = `<div class="fm-image-view"><img src="${rawUrl(entry.path)}" alt="${escapeHtml(entry.name)}"></div>`;
      } else if (kind === 'video' || kind === 'audio') {
        renderMediaPlayer(body, entry, kind);
      } else {
        body.innerHTML = `<div class="fm-binary-view"><span class="fm-binary-glyph">${GLYPH.other}</span><strong>${escapeHtml(entry.name)}</strong><span>No inline preview for this file type — download it to view.</span></div>`;
      }
    }

    function renderCodeView(body, entry, content) {
      const ext = extOf(entry.name);
      const lang = HLJS_LANG[ext];
      const markupKind = MARKUP_KIND[ext]; // set only for .md/.bb/.tex-style files
      body.innerHTML = `
        <div class="forge-code-editor" style="flex:1;display:flex;flex-direction:column">
          <div style="flex:0 0 auto;display:flex;gap:6px;padding:6px 8px;border-bottom:1px solid var(--line,#353a43);background:#1a1d22">
            <button class="fm-btn active" id="fmCodeEditToggle">✎ Edit</button>
            <button class="fm-btn" id="fmCodeSave" disabled>💾 Save</button>
            <span class="muted" id="fmCodeStatus" style="align-self:center;font-size:10.5px"></span>
          </div>
          <div style="position:relative;flex:1;min-height:0">
            <div class="forge-code-editor__gutter" id="fmCodeGutter"></div>
            <pre class="forge-code-editor__highlight forge-hljs hljs" id="fmCodeHighlight"><code></code></pre>
            <textarea id="fmCodeInput" class="forge-code-editor__input" spellcheck="false"></textarea>
            <div class="forge-markup-preview" id="fmMarkupPreview" style="display:none"></div>
          </div>
        </div>`;
      const textarea = body.querySelector('#fmCodeInput');
      const highlightEl = body.querySelector('#fmCodeHighlight');
      const highlightCode = highlightEl.querySelector('code');
      const gutterEl = body.querySelector('#fmCodeGutter');
      const previewEl = body.querySelector('#fmMarkupPreview');
      const editToggle = body.querySelector('#fmCodeEditToggle');
      const saveBtn = body.querySelector('#fmCodeSave');
      const statusEl = body.querySelector('#fmCodeStatus');
      let editing = false;

      function paint(src) {
        if (window.hljs && lang && typeof window.hljs.highlight === 'function') {
          try { highlightCode.innerHTML = window.hljs.highlight(src, { language: lang, ignoreIllegals: true }).value; }
          catch { highlightCode.textContent = src; }
        } else {
          highlightCode.textContent = src;
        }
        if (!src.endsWith('\n')) highlightCode.innerHTML += '\n';
        const lineCount = src.split('\n').length;
        gutterEl.textContent = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');
      }

      // Edit mode: raw source, editable, line numbers, tabs insert real
      // indentation. Preview mode: for a markup file (.md/.bb/.tex-style),
      // its actual rendered HTML — not the code-formatted source — since
      // that's the whole point of "preview" for a markup language; for a
      // plain code file (no rendered form to show), preview is just a
      // read-only look at the same highlighted source as edit mode.
      function setEditing(on) {
        editing = on;
        editToggle.classList.toggle('active', on);
        editToggle.textContent = on ? '👁 Preview' : '✎ Edit';
        if (markupKind && !on) {
          previewEl.innerHTML = renderMarkupPreview(markupKind, textarea.value);
          previewEl.style.display = '';
          gutterEl.style.display = 'none';
          highlightEl.style.display = 'none';
          textarea.style.display = 'none';
        } else {
          previewEl.style.display = 'none';
          gutterEl.style.display = '';
          highlightEl.style.display = '';
          textarea.style.display = '';
          textarea.readOnly = !on;
          textarea.classList.toggle('forge-code-editor__input--readonly', !on);
        }
      }

      // Real Tab/Shift+Tab indent-outdent instead of the browser's default
      // "Tab moves focus out of the textarea" behavior.
      function reindentSelectedLines(outdent) {
        const val = textarea.value, start = textarea.selectionStart, end = textarea.selectionEnd;
        const lineStart = val.lastIndexOf('\n', start - 1) + 1;
        const selected = val.slice(lineStart, end);
        const lines = selected.split('\n');
        const changed = outdent ? lines.map(l => l.replace(/^(\t| {1,2})/, '')) : lines.map(l => `\t${l}`);
        const result = changed.join('\n');
        textarea.value = val.slice(0, lineStart) + result + val.slice(end);
        textarea.selectionStart = start === end && !outdent ? start + 1 : lineStart;
        textarea.selectionEnd = start === end && !outdent ? start + 1 : lineStart + result.length;
      }
      textarea.addEventListener('keydown', e => {
        if (e.key !== 'Tab' || textarea.readOnly) return;
        e.preventDefault();
        if (!e.shiftKey && textarea.selectionStart === textarea.selectionEnd) {
          const { selectionStart: s } = textarea;
          textarea.value = textarea.value.slice(0, s) + '\t' + textarea.value.slice(s);
          textarea.selectionStart = textarea.selectionEnd = s + 1;
        } else {
          reindentSelectedLines(e.shiftKey);
        }
        textarea.dispatchEvent(new Event('input'));
      });

      textarea.value = content;
      paint(content);
      setEditing(false);

      textarea.addEventListener('input', () => {
        paint(textarea.value);
        markDirty(entry.path, true);
        saveBtn.disabled = false;
        statusEl.textContent = 'Unsaved changes';
      });
      textarea.addEventListener('scroll', () => {
        highlightEl.scrollTop = textarea.scrollTop; highlightEl.scrollLeft = textarea.scrollLeft;
        gutterEl.scrollTop = textarea.scrollTop;
      });
      editToggle.addEventListener('click', () => setEditing(!editing));
      saveBtn.addEventListener('click', async () => {
        try {
          await api(`/api/games/${encodeURIComponent(state.slug)}/files/content`, { method: 'PUT', body: JSON.stringify({ path: entry.path, content: textarea.value }) });
          markDirty(entry.path, false);
          saveBtn.disabled = true;
          statusEl.textContent = 'Saved';
          toast(`Saved "${entry.name}"`);
          if (markupKind && !editing) previewEl.innerHTML = renderMarkupPreview(markupKind, textarea.value);
        } catch (error) { statusEl.textContent = error.message; toast(error.message); }
      });
      document.addEventListener('keydown', function keyHandler(e) {
        if (!body.isConnected) { document.removeEventListener('keydown', keyHandler); return; }
        if ((e.ctrlKey || e.metaKey) && e.key === 's' && pane.dataset.activePath === entry.path) { e.preventDefault(); saveBtn.click(); }
      });
    }
  }

  boot();
})();