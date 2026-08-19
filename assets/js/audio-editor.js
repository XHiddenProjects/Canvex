"use strict";
(() => {
  const mount = document.getElementById('audioPanel');
  const state = window.__forgeState;
  if (!mount || !state) return;
  const api = window.__forgeApi, toast = window.__forgeToast, log = window.__forgeLog, escapeHtml = window.__forgeEscape;
  const modal = window.__forgeModal;

  const WAVES = ['sine', 'square', 'sawtooth', 'triangle'];
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const BASE_PPS = 90; // pixels-per-second at zoom = 1
  const ROW_H = 74;

  // Instrument & vocal synthesis presets — each is real Web Audio DSP
  // (oscillator banks, frequency sweeps, inharmonic partials, or a
  // formant filter bank), rendered offline into an AudioBuffer, not a
  // canned sample. A "full deck" spanning keys, strings, brass, winds,
  // plucked/mallet percussion, pads, and a standard drum kit.
  const INSTRUMENT_PRESETS = {
    piano: { label: 'Piano', synth: 'harmonic', harmonics: [1, 0.55, 0.28, 0.14, 0.06], attack: 0.004, decay: 0.35, sustain: 0.18, release: 0.7 },
    epiano: { label: 'Electric Piano', synth: 'harmonic', harmonics: [1, 0.15, 0.4, 0.05], attack: 0.008, decay: 0.5, sustain: 0.35, release: 0.9 },
    organ: { label: 'Organ', synth: 'harmonic', harmonics: [1, 0.5, 0.33, 0.25, 0.2, 0.15], attack: 0.01, decay: 0.05, sustain: 1, release: 0.15 },
    bass: { label: 'Bass', synth: 'harmonic', harmonics: [1, 0.4, 0.1], octaveShift: -1, attack: 0.006, decay: 0.18, sustain: 0.75, release: 0.3 },
    pluck: { label: 'Pluck / Guitar', synth: 'detunedSaw', detuneCents: 7, attack: 0.002, decay: 0.28, sustain: 0.05, release: 0.35 },
    lead: { label: 'Synth Lead', synth: 'detunedSaw', detuneCents: 10, attack: 0.01, decay: 0.15, sustain: 0.7, release: 0.2 },
    pad: { label: 'Synth Pad', synth: 'detunedSaw', detuneCents: 16, attack: 0.5, decay: 0.3, sustain: 0.8, release: 1.4 },
    strings: { label: 'Strings', synth: 'harmonicVibrato', harmonics: [1, 0.5, 0.3, 0.15, 0.08], vibratoRate: 5, vibratoDepth: 12, attack: 0.25, decay: 0.2, sustain: 0.85, release: 0.9 },
    brass: { label: 'Brass', synth: 'harmonicVibrato', harmonics: [1, 0.7, 0.5, 0.3, 0.15], vibratoRate: 5.5, vibratoDepth: 8, attack: 0.05, decay: 0.1, sustain: 0.9, release: 0.3 },
    flute: { label: 'Flute', synth: 'breath', vibratoRate: 5, vibratoDepth: 10, attack: 0.08, decay: 0.1, sustain: 0.85, release: 0.25 },
    marimba: { label: 'Marimba', synth: 'inharmonic', partials: [1, 3.9, 9.2], partialGains: [1, 0.35, 0.15], attack: 0.001, decay: 0.35, sustain: 0, release: 0.15, fixedDur: 0.5 },
    bell: { label: 'Bell', synth: 'inharmonic', partials: [1, 2.76, 5.4, 8.93], partialGains: [1, 0.55, 0.3, 0.18], attack: 0.001, decay: 1.4, sustain: 0, release: 0.8, fixedDur: 2.2 },
    kick: { label: 'Kick Drum', synth: 'sweep', startFreq: 150, endFreq: 42, attack: 0.001, decay: 0.22, sustain: 0, release: 0.04, fixedDur: 0.3 },
    tom: { label: 'Tom Drum', synth: 'sweep', startFreq: 220, endFreq: 90, attack: 0.001, decay: 0.28, sustain: 0, release: 0.06, fixedDur: 0.35 },
    snare: { label: 'Snare', synth: 'noiseTone', toneFreq: 190, attack: 0.001, decay: 0.14, sustain: 0, release: 0.05, fixedDur: 0.2 },
    clap: { label: 'Clap', synth: 'clapBurst', attack: 0.001, decay: 0.18, sustain: 0, release: 0.05, fixedDur: 0.3 },
    hihat: { label: 'Hi-Hat', synth: 'noiseHP', attack: 0.001, decay: 0.05, sustain: 0, release: 0.02, fixedDur: 0.1 },
    cymbal: { label: 'Cymbal', synth: 'cymbal', attack: 0.001, decay: 1.2, sustain: 0, release: 0.6, fixedDur: 1.8 }
  };
  // Approximate 5-formant (F1–F5) tables per vowel — frequency, filter
  // Q (narrower/higher for the upper formants, like a real vocal tract),
  // and relative gain (F1/F2 carry most of a vowel's identity and are
  // loudest, tapering off through F5) — see synthesizeVocal() for how
  // these combine with vibrato, source roll-off, and breath noise.
  const VOCAL_PRESETS = {
    aah: { label: 'Vocal "Aah"', formants: [{ freq: 700, q: 8, gain: 16 }, { freq: 1220, q: 10, gain: 11 }, { freq: 2600, q: 12, gain: 7 }, { freq: 3300, q: 14, gain: 4 }, { freq: 4200, q: 16, gain: 2 }] },
    ee: { label: 'Vocal "Ee"', formants: [{ freq: 270, q: 9, gain: 14 }, { freq: 2300, q: 10, gain: 12 }, { freq: 3000, q: 12, gain: 7 }, { freq: 3550, q: 14, gain: 4 }, { freq: 4500, q: 16, gain: 2 }] },
    eh: { label: 'Vocal "Eh"', formants: [{ freq: 530, q: 9, gain: 15 }, { freq: 1840, q: 11, gain: 10 }, { freq: 2480, q: 13, gain: 6 }, { freq: 3400, q: 15, gain: 4 }, { freq: 4400, q: 17, gain: 2 }] },
    oh: { label: 'Vocal "Oh"', formants: [{ freq: 450, q: 9, gain: 15 }, { freq: 800, q: 11, gain: 11 }, { freq: 2830, q: 13, gain: 6 }, { freq: 3500, q: 15, gain: 4 }, { freq: 4400, q: 17, gain: 2 }] },
    ooh: { label: 'Vocal "Ooh"', formants: [{ freq: 300, q: 10, gain: 16 }, { freq: 870, q: 12, gain: 10 }, { freq: 2250, q: 14, gain: 6 }, { freq: 3400, q: 16, gain: 4 }, { freq: 4400, q: 18, gain: 2 }] }
  };

  const audio = {
    ctx: null,
    master: null,        // master GainNode all channels route through
    masterGain: 0.9,
    tracks: [],           // { id, name, buffer, startTime, gain, pan, muted, solo, color, prevBuffer }
    selectedId: null,
    playing: false,
    playStart: 0,
    sources: [],
    analysers: {},         // id -> { node, meterEl } while playing
    masterAnalyser: null,
    selection: null,       // { start, end } in absolute timeline seconds, or null
    zoom: 1,
    timelineLength: 30,     // user-adjustable minimum timeline length, in seconds — "Extend" grows this so a composition can run as long as needed
    genTab: 'tone'
  };
  let idSeq = 0;
  const COLORS = ['#41a6f6', '#e4813a', '#38b764', '#b13e53', '#a7f070', '#73eff7', '#c25ff0', '#ffcd75'];

  function pps() { return BASE_PPS * audio.zoom; }
  function timelineDuration() {
    const auto = audio.tracks.reduce((m, t) => Math.max(m, t.buffer ? t.startTime + t.buffer.duration : 0), 0);
    return Math.max(auto, audio.timelineLength || 30, 4);
  }
  function extendTimelineTo(seconds) {
    if (seconds > audio.timelineLength) {
      audio.timelineLength = Math.ceil(seconds);
      const input = mount.querySelector('#audTimelineLen');
      if (input) input.value = audio.timelineLength;
    }
  }
  function noteFreq(name) {
    const m = /^([A-G]#?)(\d)$/.exec(name);
    if (!m) return 440;
    const n = NOTE_NAMES.indexOf(m[1]), octave = Number(m[2]);
    const midi = (octave + 1) * 12 + n;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }
  function noteOptions(selected) {
    const opts = [];
    for (let oct = 2; oct <= 6; oct++) for (const n of NOTE_NAMES) opts.push(`${n}${oct}`);
    return opts.map(n => `<option value="${n}"${n === selected ? ' selected' : ''}>${n}</option>`).join('');
  }

  mount.innerHTML = `
    <div class="audio-editor">
      <aside class="audio-side">
        <div class="audio-gen">
          <h4>Generate</h4>
          <div class="audio-gen-tabs">
            <button type="button" data-gentab="tone" class="active">Tone</button>
            <button type="button" data-gentab="inst">Instrument</button>
            <button type="button" data-gentab="vocal">Vocal</button>
          </div>
          <div class="audio-gen-panel" data-genpanel="tone">
            <select id="audWave" style="width:100%">${WAVES.map(w => `<option value="${w}">${w}</option>`).join('')}<option value="noise">noise</option></select>
            <div class="audio-gen-row">
              <input id="audFreq" type="number" value="440" min="20" max="8000" style="width:70px" title="Frequency (Hz)">
              <input id="audDur" type="number" value="0.6" min="0.05" max="6" step="0.05" style="width:60px" title="Duration (s)">
            </div>
          </div>
          <div class="audio-gen-panel" data-genpanel="inst" style="display:none">
            <select id="audInstrument" style="width:100%">${Object.entries(INSTRUMENT_PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')}</select>
            <div class="audio-gen-row">
              <select id="audInstNote" style="flex:1">${noteOptions('C4')}</select>
              <input id="audInstDur" type="number" value="0.8" min="0.1" max="4" step="0.1" style="width:56px" title="Duration (s)">
            </div>
          </div>
          <div class="audio-gen-panel" data-genpanel="vocal" style="display:none">
            <select id="audVocal" style="width:100%">${Object.entries(VOCAL_PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')}</select>
            <div class="audio-gen-row">
              <select id="audVocalNote" style="flex:1">${noteOptions('A3')}</select>
              <input id="audVocalDur" type="number" value="1" min="0.2" max="4" step="0.1" style="width:56px" title="Duration (s)">
            </div>
          </div>
          <button id="audGenerate" class="primary" style="width:100%;margin-top:6px">✨ Generate</button>
        </div>
        <div class="audio-fx">
          <h4>Effects <span class="muted" style="font-weight:normal;text-transform:none;letter-spacing:0">— selection or whole clip</span></h4>
          <div class="audio-fx-grid">
            <button type="button" data-fx="normalize">Normalize</button>
            <button type="button" data-fx="fadein">Fade In</button>
            <button type="button" data-fx="fadeout">Fade Out</button>
            <button type="button" data-fx="gain">Gain…</button>
            <button type="button" data-fx="reverse">Reverse</button>
            <button type="button" data-fx="silence">Silence</button>
            <button type="button" data-fx="eq">EQ…</button>
            <button type="button" data-fx="reverb">Reverb…</button>
            <button type="button" data-fx="compressor">Compressor…</button>
            <button type="button" data-fx="noisegate">Noise Gate…</button>
          </div>
          <button id="audUndo" style="width:100%;margin-top:6px">↶ Undo Last Effect</button>
        </div>
        <div style="flex:1;min-height:0;display:flex;flex-direction:column">
          <h4>Tracks</h4>
          <div id="audTrackList" style="overflow:auto;flex:1"></div>
        </div>
        <div class="muted" style="line-height:1.5">Generate a tone, instrument note, or vocal, import audio from Assets, or record from the mic. Drag on the timeline to select a range before applying an effect or trimming.</div>
      </aside>
      <div class="audio-main">
        <div class="audio-toolbar">
          <button id="audImport">⇩ Import from Assets</button>
          <button id="audRecord">● Record Mic</button>
          <span class="grow"></span>
          <label class="audio-timeline-len-label" title="Timeline length — type any duration, or keep extending it, so there's always room for what you're creating">Length
            <input id="audTimelineLen" type="number" min="4" step="5" value="30" style="width:64px">s
          </label>
          <button id="audExtendTimeline" title="Add 30 more seconds to the timeline">+30s</button>
          <button id="audZoomOut" title="Zoom out">−</button>
          <button id="audZoomIn" title="Zoom in">+</button>
          <button id="audPlay">▶ Play</button>
          <button id="audStop">■ Stop</button>
          <button id="audTrimApply">✂ Trim to Selection</button>
          <input id="audAssetName" placeholder="sound-name" style="width:130px">
          <button id="audSave">💾 Save as Asset</button>
        </div>
        <div class="audio-timeline-wrap" id="audTimelineWrap">
          <div class="audio-timeline-inner" id="audTimelineInner">
            <canvas class="audio-ruler" id="audRuler"></canvas>
            <div id="audTrackRows"></div>
            <div class="audio-selection" id="audSelectionEl"></div>
            <div class="audio-playhead" id="audPlayhead"></div>
          </div>
        </div>
        <div class="audio-mixer" id="audMixer"></div>
      </div>
    </div>`;

  const el = sel => mount.querySelector(sel);
  const ruler = el('#audRuler');
  const rulerCtx = ruler.getContext('2d');
  const timelineWrap = el('#audTimelineWrap');
  const timelineInner = el('#audTimelineInner');
  const rowsEl = el('#audTrackRows');
  const selectionEl = el('#audSelectionEl');
  const playheadEl = el('#audPlayhead');
  const listEl = el('#audTrackList');
  const mixerEl = el('#audMixer');

  function ensureCtx() {
    if (!audio.ctx) {
      const A = window.AudioContext || window.webkitAudioContext;
      if (!A) { toast('Web Audio unavailable in this browser'); return null; }
      audio.ctx = new A();
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = audio.masterGain;
      audio.masterAnalyser = audio.ctx.createAnalyser();
      audio.masterAnalyser.fftSize = 256;
      audio.master.connect(audio.masterAnalyser).connect(audio.ctx.destination);
    }
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
    return audio.ctx;
  }

  function selectedTrack() { return audio.tracks.find(t => t.id === audio.selectedId) || null; }

  function addTrack(name, buffer) {
    // New clips drop in at the current selection's start (if any) so you
    // can mark a spot on the timeline, generate/import into it, and have
    // it land roughly where you meant — otherwise they start at 0 and
    // can be dragged into place afterwards.
    const startTime = audio.selection ? audio.selection.start : 0;
    const track = { id: `t${idSeq++}`, name, buffer, startTime, gain: 0.8, pan: 0, muted: false, solo: false, color: COLORS[audio.tracks.length % COLORS.length], prevBuffer: null };
    audio.tracks.push(track);
    audio.selectedId = track.id;
    audio.selection = null;
    if (buffer) extendTimelineTo(startTime + buffer.duration);
    renderAll();
    return track;
  }

  // =====================================================================
  // Timeline: a multi-track waveform view (like Audacity) — every track
  // gets its own lane on a shared, zoomable, scrollable time axis. Each
  // track's audio is a "clip" positioned at track.startTime and can be
  // dragged left/right to retime it, independent of dragging on empty
  // lane space (which makes a range selection instead).
  // =====================================================================

  function layoutTimeline() {
    const dur = timelineDuration();
    const width = Math.max(timelineWrap.clientWidth, Math.ceil(dur * pps()) + 120);
    timelineInner.style.width = `${width}px`;
    ruler.width = width; ruler.height = 22;
    return width;
  }

  function drawRuler(width) {
    rulerCtx.clearRect(0, 0, width, ruler.height);
    rulerCtx.fillStyle = '#14161a'; rulerCtx.fillRect(0, 0, width, ruler.height);
    rulerCtx.strokeStyle = 'rgba(255,255,255,.15)'; rulerCtx.fillStyle = '#8b909a'; rulerCtx.font = '10px sans-serif';
    const step = pps() < 40 ? 5 : pps() < 90 ? 1 : 0.5;
    const dur = width / pps();
    rulerCtx.beginPath();
    for (let t = 0; t <= dur; t += step) {
      const x = Math.round(t * pps()) + 0.5;
      rulerCtx.moveTo(x, ruler.height - 8); rulerCtx.lineTo(x, ruler.height);
      rulerCtx.fillText(`${t.toFixed(step < 1 ? 1 : 0)}s`, x + 3, 11);
    }
    rulerCtx.stroke();
  }

  const CLIP_HANDLE_H = 16;
  const WAVE_H = ROW_H - CLIP_HANDLE_H;

  function drawClipCanvas(canvasEl, track) {
    const durPx = Math.max(1, Math.round(track.buffer.duration * pps()));
    canvasEl.width = durPx; canvasEl.height = WAVE_H;
    const c = canvasEl.getContext('2d');
    c.clearRect(0, 0, durPx, WAVE_H);
    const data = track.buffer.getChannelData(0);
    const mid = WAVE_H / 2;
    const step = Math.max(1, Math.floor(data.length / durPx));
    c.strokeStyle = track.color; c.lineWidth = 1; c.beginPath();
    for (let x = 0; x < durPx; x++) {
      let min = 1, max = -1;
      const from = x * step;
      for (let i = 0; i < step; i++) { const v = data[from + i] || 0; if (v < min) min = v; if (v > max) max = v; }
      c.moveTo(x, mid + min * mid * 0.9);
      c.lineTo(x, mid + max * mid * 0.9);
    }
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.08)'; c.beginPath(); c.moveTo(0, mid); c.lineTo(durPx, mid); c.stroke();
  }

  function renderRows() {
    const width = layoutTimeline();
    drawRuler(width);
    rowsEl.innerHTML = audio.tracks.map(t => `
      <div class="audio-track-row${t.id === audio.selectedId ? ' active' : ''}" data-id="${t.id}" style="width:${width}px">
        <div class="audio-track-row-label" style="border-left-color:${t.color}">${escapeHtml(t.name)}</div>
        ${t.buffer ? `<div class="audio-clip" data-clip="${t.id}" style="left:${Math.round(t.startTime * pps())}px;width:${Math.max(1, Math.round(t.buffer.duration * pps()))}px">
          <div class="audio-clip-handle" title="Drag to move this clip in time">${escapeHtml(t.name)} · starts at ${t.startTime.toFixed(2)}s</div>
          <canvas class="audio-track-canvas" data-canvas="${t.id}"></canvas>
        </div>` : ''}
      </div>`).join('') || `<div class="audio-track-row audio-track-row-empty" style="width:${width}px">Generate a tone, import audio, or record to add your first track.</div>`;
    audio.tracks.forEach(t => {
      if (!t.buffer) return;
      const canvasEl = rowsEl.querySelector(`[data-canvas="${t.id}"]`);
      if (canvasEl) drawClipCanvas(canvasEl, t);
    });
    positionOverlays(width);
  }

  function positionOverlays(width) {
    const w = width || layoutTimeline();
    const h = rowsEl.offsetHeight || (audio.tracks.length * ROW_H);
    selectionEl.style.height = `${h}px`;
    playheadEl.style.height = `${h}px`;
    if (audio.selection && audio.selection.end - audio.selection.start > 0.005) {
      const sx = audio.selection.start * pps(), ex = audio.selection.end * pps();
      selectionEl.style.display = 'block';
      selectionEl.style.left = `${sx}px`;
      selectionEl.style.width = `${Math.max(1, ex - sx)}px`;
    } else selectionEl.style.display = 'none';
    if (audio.playing) {
      const elapsed = audio.ctx.currentTime - audio.playStart;
      playheadEl.style.display = 'block';
      playheadEl.style.left = `${Math.max(0, elapsed) * pps()}px`;
    } else playheadEl.style.display = 'none';
  }

  // ---- range selection drag (on empty lane space) vs. clip drag (retiming a clip) ----
  let dragSel = null;
  let clipDrag = null; // { trackId, startClientX, origStartTime }

  rowsEl.addEventListener('mousedown', e => {
    const row = e.target.closest('.audio-track-row[data-id]');
    if (row) { audio.selectedId = row.dataset.id; renderList(); }

    const clipHandle = e.target.closest('.audio-clip-handle');
    if (clipHandle) {
      e.preventDefault();
      const clipEl = clipHandle.closest('.audio-clip');
      clipDrag = { trackId: clipEl.dataset.clip, startClientX: e.clientX, origStartTime: audio.tracks.find(t => t.id === clipEl.dataset.clip)?.startTime || 0 };
      return;
    }

    const rect = timelineInner.getBoundingClientRect();
    const t = Math.max(0, (e.clientX - rect.left) / pps());
    dragSel = t;
    audio.selection = { start: t, end: t };
    renderRows();
  });

  window.addEventListener('mousemove', e => {
    if (clipDrag) {
      const t = audio.tracks.find(x => x.id === clipDrag.trackId); if (!t) return;
      const dxSeconds = (e.clientX - clipDrag.startClientX) / pps();
      t.startTime = Math.max(0, Math.round((clipDrag.origStartTime + dxSeconds) * 100) / 100);
      extendTimelineTo(t.startTime + t.buffer.duration);
      renderRows();
      return;
    }
    if (dragSel === null) return;
    const rect = timelineInner.getBoundingClientRect();
    const t = Math.max(0, (e.clientX - rect.left) / pps());
    audio.selection = { start: Math.min(dragSel, t), end: Math.max(dragSel, t) };
    positionOverlays();
  });
  window.addEventListener('mouseup', () => {
    dragSel = null;
    if (clipDrag) { clipDrag = null; toast('Clip moved — release to keep the new timing'); }
  });

  el('#audZoomIn').addEventListener('click', () => { audio.zoom = Math.min(8, audio.zoom * 1.5); renderRows(); });
  el('#audZoomOut').addEventListener('click', () => { audio.zoom = Math.max(0.25, audio.zoom / 1.5); renderRows(); });
  el('#audTimelineLen').addEventListener('change', () => {
    audio.timelineLength = Math.max(4, Number(el('#audTimelineLen').value) || 30);
    renderRows();
  });
  el('#audExtendTimeline').addEventListener('click', () => {
    audio.timelineLength = (audio.timelineLength || 30) + 30;
    el('#audTimelineLen').value = audio.timelineLength;
    renderRows();
  });
  window.addEventListener('resize', () => { if (mount.classList.contains('active')) renderRows(); });

  // =====================================================================
  // Track list, mixer & VU meters
  // =====================================================================

  function renderList() {
    listEl.innerHTML = audio.tracks.length ? audio.tracks.map(t => `
      <div class="audio-track-item${t.id === audio.selectedId ? ' active' : ''}" data-id="${t.id}">
        <span style="width:8px;height:8px;border-radius:50%;background:${t.color}"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t.name)}</span>
        <span class="muted">${t.buffer ? `@${t.startTime.toFixed(2)}s · ${t.buffer.duration.toFixed(2)}s` : ''}</span>
        <span data-remove="${t.id}" style="color:#9298a1;cursor:pointer" title="Remove">×</span>
      </div>`).join('') : '<div class="muted" style="padding:8px 4px">No tracks yet — generate a sound or import audio.</div>';
  }

  function renderMixer() {
    mixerEl.innerHTML = audio.tracks.map(t => `
      <div class="audio-channel" data-mixer="${t.id}">
        <div class="lbl">${escapeHtml(t.name)}</div>
        <div class="audio-vu-wrap"><div class="audio-vu-bar" data-vu="${t.id}"></div><input type="range" data-gain min="0" max="1" step="0.01" value="${t.gain}"></div>
        <div class="audio-db-readout" data-dbreadout="${t.id}">${gainToDbLabel(t.gain)}</div>
        <div style="display:flex;gap:3px">
          <button type="button" data-mute style="width:24px;padding:2px 0;${t.muted ? 'background:#a4394a;color:#fff' : ''}">M</button>
          <button type="button" data-solo style="width:24px;padding:2px 0;${t.solo ? 'background:#41a6f6;color:#fff' : ''}">S</button>
        </div>
        <input type="range" data-pan min="-1" max="1" step="0.1" value="${t.pan}" title="Pan" class="audio-pan-slider">
      </div>`).join('') + `
      <div class="audio-channel audio-channel-master" data-mixer="master">
        <div class="lbl">Master</div>
        <div class="audio-vu-wrap"><div class="audio-vu-bar" data-vu="master"></div><input type="range" data-master-gain min="0" max="1" step="0.01" value="${audio.masterGain}"></div>
        <div class="audio-db-readout" data-dbreadout="master">${gainToDbLabel(audio.masterGain)}</div>
      </div>`;
  }

  function gainToDbLabel(g) {
    if (g <= 0) return '-∞ dB';
    const db = 20 * Math.log10(g);
    return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
  }

  function renderAll() { renderList(); renderRows(); renderMixer(); }

  listEl.addEventListener('click', e => {
    const rm = e.target.closest('[data-remove]');
    if (rm) { audio.tracks = audio.tracks.filter(t => t.id !== rm.dataset.remove); if (audio.selectedId === rm.dataset.remove) audio.selectedId = audio.tracks[0]?.id || null; renderAll(); return; }
    const row = e.target.closest('[data-id]');
    if (row) { audio.selectedId = row.dataset.id; renderList(); renderRows(); }
  });

  mixerEl.addEventListener('input', e => {
    if (e.target.dataset.masterGain !== undefined) {
      audio.masterGain = Number(e.target.value);
      if (audio.master) audio.master.gain.value = audio.masterGain;
      mixerEl.querySelector('[data-dbreadout="master"]').textContent = gainToDbLabel(audio.masterGain);
      return;
    }
    const chan = e.target.closest('[data-mixer]'); if (!chan) return;
    const t = audio.tracks.find(x => x.id === chan.dataset.mixer); if (!t) return;
    if (e.target.dataset.gain !== undefined) {
      t.gain = Number(e.target.value);
      mixerEl.querySelector(`[data-dbreadout="${t.id}"]`).textContent = gainToDbLabel(t.gain);
    }
    if (e.target.dataset.pan !== undefined) t.pan = Number(e.target.value);
  });
  mixerEl.addEventListener('click', e => {
    const chan = e.target.closest('[data-mixer]'); if (!chan || chan.dataset.mixer === 'master') return;
    const t = audio.tracks.find(x => x.id === chan.dataset.mixer); if (!t) return;
    if (e.target.dataset.mute !== undefined) { t.muted = !t.muted; renderMixer(); }
    if (e.target.dataset.solo !== undefined) { t.solo = !t.solo; renderMixer(); }
  });

  function tickMeters() {
    if (!audio.playing) return;
    const buf = new Uint8Array(32);
    audio.tracks.forEach(t => {
      const bar = mixerEl.querySelector(`[data-vu="${t.id}"]`);
      const entry = audio.analysers[t.id];
      if (!bar) return;
      if (!entry) { bar.style.height = '0%'; return; }
      entry.node.getByteFrequencyData(buf);
      const level = buf.reduce((a, b) => a + b, 0) / buf.length / 255;
      bar.style.height = `${Math.min(100, level * 140)}%`;
    });
    const masterBar = mixerEl.querySelector('[data-vu="master"]');
    if (masterBar && audio.masterAnalyser) {
      audio.masterAnalyser.getByteFrequencyData(buf);
      const level = buf.reduce((a, b) => a + b, 0) / buf.length / 255;
      masterBar.style.height = `${Math.min(100, level * 140)}%`;
    }
    requestAnimationFrame(tickMeters);
  }

  // =====================================================================
  // Generation: raw tones (synchronous) + instrument/vocal synthesis
  // (real Web Audio DSP rendered offline: oscillator banks, frequency
  // sweeps, and — for vocals — a parallel formant filter bank).
  // =====================================================================

  function generateBuffer(type, freq, dur) {
    const c = ensureCtx(); if (!c) return null;
    const sr = c.sampleRate, len = Math.max(1, Math.floor(sr * dur));
    const buffer = c.createBuffer(1, len, sr);
    const d = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.min(1, i / (sr * 0.01)) * Math.min(1, (len - i) / (sr * 0.03));
      let v = 0;
      if (type === 'noise') v = Math.random() * 2 - 1;
      else if (type === 'sine') v = Math.sin(2 * Math.PI * freq * t);
      else if (type === 'square') v = Math.sign(Math.sin(2 * Math.PI * freq * t));
      else if (type === 'sawtooth') v = 2 * (t * freq - Math.floor(0.5 + t * freq));
      else if (type === 'triangle') v = 2 * Math.abs(2 * (t * freq - Math.floor(t * freq + 0.5))) - 1;
      d[i] = v * env * 0.6;
    }
    return buffer;
  }

  function applyADSR(gainParam, preset, sustainDur) {
    const a = preset.attack, d = preset.decay, s = preset.sustain, r = preset.release, peak = 0.85;
    const sustainStart = a + d;
    gainParam.setValueAtTime(0, 0);
    gainParam.linearRampToValueAtTime(peak, Math.max(0.001, a));
    gainParam.linearRampToValueAtTime(peak * s, Math.max(sustainStart, a + 0.002));
    gainParam.setValueAtTime(peak * s, Math.max(sustainStart, sustainDur));
    gainParam.linearRampToValueAtTime(0.0001, Math.max(sustainStart, sustainDur) + r);
  }

  async function synthesizeInstrument(key, freq, dur) {
    const c = ensureCtx(); if (!c) return null;
    const preset = INSTRUMENT_PRESETS[key];
    const noteDur = preset.fixedDur || dur;
    const totalDur = noteDur + preset.release + 0.05;
    const off = new OfflineAudioContext(1, Math.ceil(c.sampleRate * totalDur), c.sampleRate);
    const master = off.createGain();
    applyADSR(master.gain, preset, noteDur);
    master.connect(off.destination);

    function addVibrato(osc, rate, depthCents) {
      const lfo = off.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = rate;
      const lfoGain = off.createGain(); lfoGain.gain.setValueAtTime(0, 0); lfoGain.gain.linearRampToValueAtTime(depthCents, 0.2);
      lfo.connect(lfoGain).connect(osc.detune);
      lfo.start(0); lfo.stop(totalDur);
    }

    if (preset.synth === 'harmonic') {
      const baseFreq = preset.octaveShift ? freq * Math.pow(2, preset.octaveShift) : freq;
      preset.harmonics.forEach((amp, i) => {
        const osc = off.createOscillator(); osc.type = 'sine'; osc.frequency.value = baseFreq * (i + 1);
        const g = off.createGain(); g.gain.value = amp;
        osc.connect(g).connect(master);
        osc.start(0); osc.stop(totalDur);
      });
    } else if (preset.synth === 'harmonicVibrato') {
      // Same additive-harmonic engine as 'harmonic', but with a vibrato
      // LFO on each partial's detune — gives strings/brass their
      // characteristic pitch waver instead of a dead-flat tone.
      preset.harmonics.forEach((amp, i) => {
        const osc = off.createOscillator(); osc.type = 'sine'; osc.frequency.value = freq * (i + 1);
        addVibrato(osc, preset.vibratoRate, preset.vibratoDepth);
        const g = off.createGain(); g.gain.value = amp;
        osc.connect(g).connect(master);
        osc.start(0); osc.stop(totalDur);
      });
    } else if (preset.synth === 'breath') {
      // Flute: a near-sine tone (flutes are close to pure tones) with
      // vibrato, plus a thin layer of filtered air noise for breathiness.
      const osc = off.createOscillator(); osc.type = 'sine'; osc.frequency.value = freq;
      addVibrato(osc, preset.vibratoRate, preset.vibratoDepth);
      osc.connect(master); osc.start(0); osc.stop(totalDur);
      const nb = off.createBuffer(1, Math.floor(off.sampleRate * totalDur), off.sampleRate);
      const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      const ns = off.createBufferSource(); ns.buffer = nb;
      const bp = off.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq * 2.5; bp.Q.value = 0.8;
      const ng = off.createGain(); ng.gain.value = 0.07;
      ns.connect(bp).connect(ng).connect(master); ns.start(0);
    } else if (preset.synth === 'detunedSaw') {
      [-1, 1].forEach(sign => {
        const osc = off.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = freq;
        osc.detune.value = sign * preset.detuneCents;
        osc.connect(master);
        osc.start(0); osc.stop(totalDur);
      });
    } else if (preset.synth === 'inharmonic') {
      // Mallet/bell percussion: partials at non-integer frequency ratios
      // (unlike a harmonic instrument) is what makes these sound
      // metallic/woody rather than tonal.
      preset.partials.forEach((ratio, i) => {
        const osc = off.createOscillator(); osc.type = 'sine'; osc.frequency.value = freq * ratio;
        const g = off.createGain(); g.gain.value = preset.partialGains[i];
        osc.connect(g).connect(master);
        osc.start(0); osc.stop(totalDur);
      });
    } else if (preset.synth === 'sweep') {
      const osc = off.createOscillator(); osc.type = 'sine';
      osc.frequency.setValueAtTime(preset.startFreq, 0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, preset.endFreq), preset.decay);
      osc.connect(master);
      osc.start(0); osc.stop(totalDur);
    } else if (preset.synth === 'noiseTone') {
      const nb = off.createBuffer(1, Math.floor(off.sampleRate * 0.3), off.sampleRate);
      const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      const ns = off.createBufferSource(); ns.buffer = nb;
      const bp = off.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = preset.toneFreq; bp.Q.value = 1.2;
      ns.connect(bp).connect(master); ns.start(0);
      const tone = off.createOscillator(); tone.type = 'triangle'; tone.frequency.value = preset.toneFreq;
      const tg = off.createGain(); tg.gain.value = 0.3;
      tone.connect(tg).connect(master); tone.start(0); tone.stop(totalDur);
    } else if (preset.synth === 'noiseHP') {
      const nb = off.createBuffer(1, Math.floor(off.sampleRate * 0.2), off.sampleRate);
      const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      const ns = off.createBufferSource(); ns.buffer = nb;
      const hp = off.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
      ns.connect(hp).connect(master); ns.start(0);
    } else if (preset.synth === 'clapBurst') {
      // A handclap is several quick noise bursts, not one — layering a
      // few short bandpassed bursts at small offsets sells the "clap"
      // texture far better than a single noise hit.
      [0, 0.02, 0.04, 0.07].forEach(delay => {
        const nb = off.createBuffer(1, Math.floor(off.sampleRate * 0.08), off.sampleRate);
        const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        const ns = off.createBufferSource(); ns.buffer = nb;
        const bp = off.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 1;
        const g = off.createGain(); g.gain.setValueAtTime(0.8, delay); g.gain.exponentialRampToValueAtTime(0.001, delay + 0.05);
        ns.connect(bp).connect(g).connect(master);
        ns.start(delay);
      });
    } else if (preset.synth === 'cymbal') {
      // A bank of inharmonic square oscillators plus highpassed noise —
      // the classic cheap-but-effective way to fake a metallic cymbal
      // shimmer without sampled audio.
      [1, 1.4, 2.3, 3.7, 5.9].forEach(ratio => {
        const osc = off.createOscillator(); osc.type = 'square'; osc.frequency.value = 300 * ratio;
        const g = off.createGain(); g.gain.value = 0.08;
        osc.connect(g).connect(master);
        osc.start(0); osc.stop(totalDur);
      });
      const nb = off.createBuffer(1, Math.floor(off.sampleRate * totalDur), off.sampleRate);
      const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      const ns = off.createBufferSource(); ns.buffer = nb;
      const hp = off.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000;
      const ng = off.createGain(); ng.gain.value = 0.25;
      ns.connect(hp).connect(ng).connect(master); ns.start(0);
    }
    return await off.startRendering();
  }

  async function synthesizeVocal(key, freq, dur) {
    const c = ensureCtx(); if (!c) return null;
    const preset = VOCAL_PRESETS[key];
    const totalDur = dur + 0.25;
    const off = new OfflineAudioContext(1, Math.ceil(c.sampleRate * totalDur), c.sampleRate);

    // Glottal-ish source: a sawtooth (harmonically rich, like real vocal
    // folds) with vibrato + a touch of faster pitch jitter (real voices
    // are never perfectly steady), then gently low-passed to round off
    // the source's natural spectral roll-off before it hits the
    // formants — a raw sawtooth alone sounds buzzy/electronic.
    const src = off.createOscillator(); src.type = 'sawtooth'; src.frequency.value = freq;

    const vibrato = off.createOscillator(); vibrato.type = 'sine'; vibrato.frequency.value = 5.5;
    const vibratoGain = off.createGain();
    vibratoGain.gain.setValueAtTime(0, 0);
    vibratoGain.gain.linearRampToValueAtTime(22, 0.18); // vibrato fades in, like a real sustained note
    vibrato.connect(vibratoGain).connect(src.detune);
    vibrato.start(0); vibrato.stop(totalDur);

    const jitter = off.createOscillator(); jitter.type = 'sine'; jitter.frequency.value = 9.2;
    const jitterGain = off.createGain(); jitterGain.gain.value = 4;
    jitter.connect(jitterGain).connect(src.detune);
    jitter.start(0); jitter.stop(totalDur);

    const sourceTilt = off.createBiquadFilter(); sourceTilt.type = 'lowpass'; sourceTilt.frequency.value = 3200; sourceTilt.Q.value = 0.5;
    src.connect(sourceTilt);

    const master = off.createGain();
    applyADSR(master.gain, { attack: 0.04, decay: 0.06, sustain: 0.82, release: 0.18 }, dur);
    const brightness = off.createBiquadFilter(); brightness.type = 'highshelf'; brightness.frequency.value = 3500; brightness.gain.value = 3;
    master.connect(brightness).connect(off.destination);

    // Five-formant bank (F1–F5) run in parallel off the same source —
    // this is what actually carries the vowel's identity.
    preset.formants.forEach(f => {
      const bp = off.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = f.freq; bp.Q.value = f.q; bp.gain.value = f.gain;
      sourceTilt.connect(bp).connect(master);
    });

    // Breath noise — a thin layer of filtered air under the tone, since
    // a real voice is never a purely tonal buzz.
    const nb = off.createBuffer(1, Math.floor(off.sampleRate * totalDur), off.sampleRate);
    const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const ns = off.createBufferSource(); ns.buffer = nb;
    const breathFilter = off.createBiquadFilter(); breathFilter.type = 'bandpass'; breathFilter.frequency.value = 2800; breathFilter.Q.value = 0.6;
    const breathGain = off.createGain(); breathGain.gain.value = 0.05;
    ns.connect(breathFilter).connect(breathGain).connect(master);
    ns.start(0);

    src.start(0); src.stop(totalDur);
    return await off.startRendering();
  }

  function switchGenTab(tab) {
    audio.genTab = tab;
    mount.querySelectorAll('[data-gentab]').forEach(b => b.classList.toggle('active', b.dataset.gentab === tab));
    mount.querySelectorAll('[data-genpanel]').forEach(p => p.style.display = p.dataset.genpanel === tab ? '' : 'none');
  }
  mount.querySelectorAll('[data-gentab]').forEach(b => b.addEventListener('click', () => switchGenTab(b.dataset.gentab)));

  el('#audGenerate').addEventListener('click', async () => {
    if (audio.genTab === 'tone') {
      const wave = el('#audWave').value, freq = Number(el('#audFreq').value) || 440, dur = Number(el('#audDur').value) || 0.5;
      const buffer = generateBuffer(wave, freq, dur);
      if (!buffer) return;
      addTrack(`${wave}-${freq}hz`, buffer);
      toast(`Generated ${wave} tone`);
    } else if (audio.genTab === 'inst') {
      const key = el('#audInstrument').value, note = el('#audInstNote').value, dur = Number(el('#audInstDur').value) || 0.8;
      const buffer = await synthesizeInstrument(key, noteFreq(note), dur);
      if (!buffer) return;
      addTrack(`${INSTRUMENT_PRESETS[key].label} ${note}`, buffer);
      toast(`Generated ${INSTRUMENT_PRESETS[key].label} note`);
    } else {
      const key = el('#audVocal').value, note = el('#audVocalNote').value, dur = Number(el('#audVocalDur').value) || 1;
      const buffer = await synthesizeVocal(key, noteFreq(note), dur);
      if (!buffer) return;
      addTrack(`${VOCAL_PRESETS[key].label} ${note}`, buffer);
      toast(`Generated ${VOCAL_PRESETS[key].label}`);
    }
  });

  // =====================================================================
  // Effects rack — real Web Audio DSP (OfflineAudioContext render for
  // filter/convolver/compressor-based effects, direct sample math for
  // gain/fade/normalize/reverse/silence/noise-gate). Every effect applies
  // to the current timeline selection if one exists, otherwise the whole
  // clip on the selected track — and a single-level undo restores the
  // buffer from right before the last effect.
  // =====================================================================

  function getRange(track) {
    const total = track.buffer.length;
    const sel = audio.selection;
    if (!sel || sel.end - sel.start < 0.01) return { from: 0, to: total };
    const dur = track.buffer.duration;
    // Selections are in absolute timeline seconds; translate into this
    // track's own local buffer time using its startTime offset.
    const start = Math.max(0, Math.min(dur, sel.start - track.startTime));
    const end = Math.max(0, Math.min(dur, sel.end - track.startTime));
    if (end - start < 0.005) return { from: 0, to: total };
    return { from: Math.floor((start / dur) * total), to: Math.floor((end / dur) * total) };
  }

  async function applyRangeEffect(processFn) {
    const t = selectedTrack();
    if (!t || !t.buffer) { toast('Select a track with audio first'); return; }
    const c = ensureCtx(); if (!c) return;
    const { from, to } = getRange(t);
    const len = Math.max(1, to - from);
    const sub = c.createBuffer(t.buffer.numberOfChannels, len, t.buffer.sampleRate);
    for (let ch = 0; ch < t.buffer.numberOfChannels; ch++) sub.copyToChannel(t.buffer.getChannelData(ch).slice(from, to), ch);
    let processed;
    try { processed = await processFn(sub, c); }
    catch (err) { toast(`Effect failed: ${err.message}`); return; }
    t.prevBuffer = t.buffer;
    const newBuffer = c.createBuffer(t.buffer.numberOfChannels, t.buffer.length, t.buffer.sampleRate);
    for (let ch = 0; ch < t.buffer.numberOfChannels; ch++) {
      const full = t.buffer.getChannelData(ch).slice();
      const proc = processed.getChannelData(Math.min(ch, processed.numberOfChannels - 1));
      full.set(proc.subarray(0, len), from);
      newBuffer.copyToChannel(full, ch);
    }
    t.buffer = newBuffer;
    renderAll();
  }

  function copyBuffer(buf, c) {
    const out = c.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) out.copyToChannel(buf.getChannelData(ch).slice(), ch);
    return out;
  }

  const FX = {
    normalize: (buf, c) => {
      const out = copyBuffer(buf, c);
      let peak = 0;
      for (let ch = 0; ch < out.numberOfChannels; ch++) { const d = out.getChannelData(ch); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i])); }
      if (peak < 0.0001) return out;
      const scale = 0.98 / peak;
      for (let ch = 0; ch < out.numberOfChannels; ch++) { const d = out.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] *= scale; }
      return out;
    },
    fadein: (buf, c) => {
      const out = copyBuffer(buf, c);
      for (let ch = 0; ch < out.numberOfChannels; ch++) { const d = out.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] *= i / d.length; }
      return out;
    },
    fadeout: (buf, c) => {
      const out = copyBuffer(buf, c);
      for (let ch = 0; ch < out.numberOfChannels; ch++) { const d = out.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] *= 1 - i / d.length; }
      return out;
    },
    reverse: (buf, c) => {
      const out = copyBuffer(buf, c);
      for (let ch = 0; ch < out.numberOfChannels; ch++) out.getChannelData(ch).reverse();
      return out;
    },
    silence: (buf, c) => c.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate),
    gain: (buf, c, db) => {
      const out = copyBuffer(buf, c);
      const mult = Math.pow(10, db / 20);
      for (let ch = 0; ch < out.numberOfChannels; ch++) { const d = out.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = Math.max(-1, Math.min(1, d[i] * mult)); }
      return out;
    },
    noisegate: (buf, c, thresholdDb) => {
      const out = copyBuffer(buf, c);
      const threshold = Math.pow(10, thresholdDb / 20);
      for (let ch = 0; ch < out.numberOfChannels; ch++) { const d = out.getChannelData(ch); for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) < threshold) d[i] = 0; }
      return out;
    },
    eq: async (buf, c, { low, mid, high }) => {
      const off = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate);
      const src = off.createBufferSource(); src.buffer = buf;
      const lowShelf = off.createBiquadFilter(); lowShelf.type = 'lowshelf'; lowShelf.frequency.value = 200; lowShelf.gain.value = low;
      const midPeak = off.createBiquadFilter(); midPeak.type = 'peaking'; midPeak.frequency.value = 1500; midPeak.Q.value = 0.8; midPeak.gain.value = mid;
      const highShelf = off.createBiquadFilter(); highShelf.type = 'highshelf'; highShelf.frequency.value = 6000; highShelf.gain.value = high;
      src.connect(lowShelf).connect(midPeak).connect(highShelf).connect(off.destination);
      src.start();
      return await off.startRendering();
    },
    reverb: async (buf, c, { wet, decay }) => {
      const off = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate);
      const src = off.createBufferSource(); src.buffer = buf;
      const irLen = Math.floor(off.sampleRate * decay);
      const ir = off.createBuffer(2, irLen, off.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.5); }
      const convolver = off.createConvolver(); convolver.buffer = ir;
      const wetGain = off.createGain(); wetGain.gain.value = wet;
      const dryGain = off.createGain(); dryGain.gain.value = 1 - wet * 0.6;
      src.connect(dryGain).connect(off.destination);
      src.connect(convolver).connect(wetGain).connect(off.destination);
      src.start();
      return await off.startRendering();
    },
    compressor: async (buf, c, { threshold, ratio, attack, release }) => {
      const off = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate);
      const src = off.createBufferSource(); src.buffer = buf;
      const comp = off.createDynamicsCompressor();
      comp.threshold.value = threshold; comp.ratio.value = ratio; comp.attack.value = attack; comp.release.value = release; comp.knee.value = 6;
      src.connect(comp).connect(off.destination);
      src.start();
      return await off.startRendering();
    }
  };

  function paramDialog(title, bodyHtml, mountFn) {
    return new Promise(resolve => {
      if (!modal) { resolve(null); return; }
      let settled = false;
      const finish = v => { if (settled) return; settled = true; resolve(v); };
      modal.open(title, bodyHtml, {
        onMount: root => {
          root.querySelector('[data-modal-close]')?.addEventListener('click', () => finish(null));
          mountFn(root, finish);
        }
      });
    });
  }

  const fxHandlers = {
    normalize: () => applyRangeEffect((buf, c) => FX.normalize(buf, c)),
    fadein: () => applyRangeEffect((buf, c) => FX.fadein(buf, c)),
    fadeout: () => applyRangeEffect((buf, c) => FX.fadeout(buf, c)),
    reverse: () => applyRangeEffect((buf, c) => FX.reverse(buf, c)),
    silence: () => applyRangeEffect((buf, c) => FX.silence(buf, c)),
    gain: async () => {
      const val = await window.forgePrompt('Gain to apply, in decibels (e.g. 6 to boost, -6 to cut):', '3', { title: 'Gain' });
      if (val === null) return;
      const db = Number(val); if (Number.isNaN(db)) { toast('Enter a number'); return; }
      await applyRangeEffect((buf, c) => FX.gain(buf, c, db));
      toast(`Applied ${db > 0 ? '+' : ''}${db} dB gain`);
    },
    noisegate: async () => {
      const val = await window.forgePrompt('Silence anything quieter than this threshold, in decibels (e.g. -40):', '-40', { title: 'Noise Gate' });
      if (val === null) return;
      const db = Number(val); if (Number.isNaN(db)) { toast('Enter a number'); return; }
      await applyRangeEffect((buf, c) => FX.noisegate(buf, c, db));
      toast('Noise gate applied');
    },
    eq: async () => {
      const params = await paramDialog('3-Band EQ', `
        <div class="audio-fx-field"><label>Low (200Hz) <span data-val>0 dB</span></label><input type="range" id="fxLow" min="-24" max="24" value="0"></div>
        <div class="audio-fx-field"><label>Mid (1.5kHz) <span data-val>0 dB</span></label><input type="range" id="fxMid" min="-24" max="24" value="0"></div>
        <div class="audio-fx-field"><label>High (6kHz) <span data-val>0 dB</span></label><input type="range" id="fxHigh" min="-24" max="24" value="0"></div>
        <div class="pkg-actions" style="margin-top:10px"><button class="primary" data-apply>Apply EQ</button></div>`,
        (root, finish) => {
          root.querySelectorAll('input[type="range"]').forEach(inp => {
            const label = inp.closest('.audio-fx-field').querySelector('[data-val]');
            const sync = () => label.textContent = `${inp.value} dB`;
            inp.addEventListener('input', sync); sync();
          });
          root.querySelector('[data-apply]').addEventListener('click', () => finish({
            low: Number(root.querySelector('#fxLow').value), mid: Number(root.querySelector('#fxMid').value), high: Number(root.querySelector('#fxHigh').value)
          }));
        });
      if (!params) return;
      modal.close();
      await applyRangeEffect((buf, c) => FX.eq(buf, c, params));
      toast('EQ applied');
    },
    reverb: async () => {
      const params = await paramDialog('Reverb', `
        <div class="audio-fx-field"><label>Wet mix <span data-val>35%</span></label><input type="range" id="fxWet" min="0" max="100" value="35"></div>
        <div class="audio-fx-field"><label>Decay <span data-val>1.5s</span></label><input type="range" id="fxDecay" min="2" max="60" value="15"></div>
        <div class="pkg-actions" style="margin-top:10px"><button class="primary" data-apply>Apply Reverb</button></div>`,
        (root, finish) => {
          const wetLbl = root.querySelector('#fxWet').closest('.audio-fx-field').querySelector('[data-val]');
          const decayLbl = root.querySelector('#fxDecay').closest('.audio-fx-field').querySelector('[data-val]');
          root.querySelector('#fxWet').addEventListener('input', e => wetLbl.textContent = `${e.target.value}%`);
          root.querySelector('#fxDecay').addEventListener('input', e => decayLbl.textContent = `${(e.target.value / 10).toFixed(1)}s`);
          root.querySelector('[data-apply]').addEventListener('click', () => finish({
            wet: Number(root.querySelector('#fxWet').value) / 100, decay: Number(root.querySelector('#fxDecay').value) / 10
          }));
        });
      if (!params) return;
      modal.close();
      await applyRangeEffect((buf, c) => FX.reverb(buf, c, params));
      toast('Reverb applied');
    },
    compressor: async () => {
      const params = await paramDialog('Compressor', `
        <div class="audio-fx-field"><label>Threshold <span data-val>-24 dB</span></label><input type="range" id="fxThresh" min="-60" max="0" value="-24"></div>
        <div class="audio-fx-field"><label>Ratio <span data-val>4:1</span></label><input type="range" id="fxRatio" min="1" max="20" value="4"></div>
        <div class="audio-fx-field"><label>Attack <span data-val>3 ms</span></label><input type="range" id="fxAttack" min="0" max="100" value="3"></div>
        <div class="audio-fx-field"><label>Release <span data-val>250 ms</span></label><input type="range" id="fxRelease" min="10" max="1000" value="250"></div>
        <div class="pkg-actions" style="margin-top:10px"><button class="primary" data-apply>Apply Compressor</button></div>`,
        (root, finish) => {
          const map = { fxThresh: v => `${v} dB`, fxRatio: v => `${v}:1`, fxAttack: v => `${v} ms`, fxRelease: v => `${v} ms` };
          Object.keys(map).forEach(id => {
            const inp = root.querySelector(`#${id}`), lbl = inp.closest('.audio-fx-field').querySelector('[data-val]');
            inp.addEventListener('input', () => lbl.textContent = map[id](inp.value));
          });
          root.querySelector('[data-apply]').addEventListener('click', () => finish({
            threshold: Number(root.querySelector('#fxThresh').value), ratio: Number(root.querySelector('#fxRatio').value),
            attack: Number(root.querySelector('#fxAttack').value) / 1000, release: Number(root.querySelector('#fxRelease').value) / 1000
          }));
        });
      if (!params) return;
      modal.close();
      await applyRangeEffect((buf, c) => FX.compressor(buf, c, params));
      toast('Compressor applied');
    }
  };

  mount.querySelectorAll('[data-fx]').forEach(btn => btn.addEventListener('click', () => fxHandlers[btn.dataset.fx]?.()));

  el('#audUndo').addEventListener('click', () => {
    const t = selectedTrack();
    if (!t || !t.prevBuffer) { toast('Nothing to undo'); return; }
    t.buffer = t.prevBuffer; t.prevBuffer = null;
    renderAll();
    toast('Undid last effect');
  });

  // ---- import from asset library ----
  el('#audImport').addEventListener('click', async () => {
    if (!state.slug) { toast('No project loaded'); return; }
    try {
      const assets = await api(`/api/games/${encodeURIComponent(state.slug)}/assets`);
      const audioAssets = (assets.assets || assets || []).filter(a => a.category === 'audio');
      if (!audioAssets.length) { toast('No audio assets found in this project'); return; }
      window.__forgeOpenPicker ? window.__forgeOpenPicker(audioAssets, pickAsset) : pickAsset(audioAssets[0]);
    } catch (error) { toast('Could not load assets: ' + error.message); }
  });
  async function pickAsset(asset) {
    const c = ensureCtx(); if (!c) return;
    try {
      const res = await fetch(asset.url || asset.dataUrl);
      const arr = await res.arrayBuffer();
      const buffer = await c.decodeAudioData(arr);
      addTrack(asset.name, buffer);
      toast(`Imported "${asset.name}"`);
    } catch { toast('Could not decode that audio file'); }
  }
  window.__forgeAudioEditorLoad = asset => pickAsset(asset);

  // ---- mic recording ----
  let recorder = null, recChunks = [];
  el('#audRecord').addEventListener('click', async () => {
    if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(stream);
      recChunks = [];
      recorder.ondataavailable = e => recChunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach(tr => tr.stop());
        const blob = new Blob(recChunks, { type: 'audio/webm' });
        const c = ensureCtx(); if (!c) return;
        const buffer = await c.decodeAudioData(await blob.arrayBuffer());
        addTrack(`recording-${Date.now()}`, buffer);
        toast('Recording added as a new track');
        el('#audRecord').textContent = '● Record Mic';
      };
      recorder.start();
      el('#audRecord').textContent = '■ Stop Recording';
      toast('Recording… click again to stop');
    } catch { toast('Microphone access denied or unavailable'); }
  });

  // ---- trim selection ----
  el('#audTrimApply').addEventListener('click', () => {
    const t = selectedTrack(); if (!t || !t.buffer) return;
    const { from, to } = getRange(t);
    if (to - from < 100) { toast('Drag on the timeline to select a range first'); return; }
    const c = ensureCtx(); if (!c) return;
    const len = Math.max(1, to - from);
    const trimmed = c.createBuffer(t.buffer.numberOfChannels, len, t.buffer.sampleRate);
    for (let ch = 0; ch < t.buffer.numberOfChannels; ch++) trimmed.copyToChannel(t.buffer.getChannelData(ch).slice(from, to), ch);
    // The kept region no longer starts at sample 0 of the old buffer, so
    // shift the clip's timeline position forward to match what's left.
    t.startTime = t.startTime + from / t.buffer.sampleRate;
    t.prevBuffer = t.buffer;
    t.buffer = trimmed;
    audio.selection = null;
    renderAll();
    toast('Trimmed to selection');
  });

  // ---- playback (routes through per-track gain/pan + master, with VU meters) ----
  function stopAll() {
    audio.sources.forEach(s => { try { s.stop(); } catch {} });
    audio.sources = [];
    audio.analysers = {};
    audio.playing = false;
    el('#audPlay').textContent = '▶ Play';
    positionOverlays();
  }
  el('#audPlay').addEventListener('click', () => {
    const c = ensureCtx(); if (!c) return;
    if (audio.playing) { stopAll(); return; }
    const anySolo = audio.tracks.some(t => t.solo);
    let played = false, maxDur = 0;
    const startAt = c.currentTime + 0.05; // small lead-in so every track's scheduled start lands cleanly
    audio.tracks.forEach(t => {
      if (!t.buffer || t.muted || (anySolo && !t.solo)) return;
      const src = c.createBufferSource(); src.buffer = t.buffer;
      const gain = c.createGain(); gain.gain.value = t.gain;
      const analyser = c.createAnalyser(); analyser.fftSize = 64;
      const panner = c.createStereoPanner ? c.createStereoPanner() : null;
      if (panner) { panner.pan.value = t.pan; src.connect(gain).connect(panner).connect(analyser).connect(audio.master); }
      else src.connect(gain).connect(analyser).connect(audio.master);
      src.start(startAt + t.startTime);
      audio.sources.push(src);
      audio.analysers[t.id] = { node: analyser };
      maxDur = Math.max(maxDur, t.startTime + t.buffer.duration);
      played = true;
    });
    if (!played) { toast('No audible tracks (check mute/solo)'); return; }
    audio.playing = true; audio.playStart = startAt;
    el('#audPlay').textContent = '⏸ Pause';
    setTimeout(() => { if (audio.playing) stopAll(); }, maxDur * 1000 + 100);
    const tick = () => { if (!audio.playing) return; positionOverlays(); requestAnimationFrame(tick); };
    tick();
    tickMeters();
  });
  el('#audStop').addEventListener('click', stopAll);

  // ---- save to assets (WAV export) ----
  function bufferToWav(buffer) {
    const numCh = buffer.numberOfChannels, sr = buffer.sampleRate, len = buffer.length;
    const bytesPerSample = 2, blockAlign = numCh * bytesPerSample;
    const dataSize = len * blockAlign;
    const bufOut = new ArrayBuffer(44 + dataSize);
    const view = new DataView(bufOut);
    const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); writeStr(8, 'WAVE');
    writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, numCh, true); view.setUint32(24, sr, true);
    view.setUint32(28, sr * blockAlign, true); view.setUint16(32, blockAlign, true); view.setUint16(34, 16, true);
    writeStr(36, 'data'); view.setUint32(40, dataSize, true);
    const channels = []; for (let i = 0; i < numCh; i++) channels.push(buffer.getChannelData(i));
    let offset = 44;
    for (let i = 0; i < len; i++) for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
    return bufOut;
  }
  function arrayBufferToBase64(buf) {
    let binary = ''; const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  el('#audSave').addEventListener('click', async () => {
    if (!state.slug) return;
    const t = selectedTrack();
    if (!t || !t.buffer) { toast('Generate or import a track first'); return; }
    const name = (el('#audAssetName').value.trim() || t.name || `sound-${Date.now()}`).replace(/\.wav$/i, '');
    try {
      const wav = bufferToWav(t.buffer);
      const dataUrl = `data:audio/wav;base64,${arrayBufferToBase64(wav)}`;
      const { asset } = await api(`/api/games/${encodeURIComponent(state.slug)}/assets`, {
        method: 'POST',
        body: JSON.stringify({ name: `${name}.wav`, category: 'audio', mime: 'audio/wav', dataUrl })
      });
      toast(asset?.overwritten ? `Saved — overwrote existing "${name}.wav"` : `Saved "${name}.wav" to Assets`);
      log('info', `Audio track "${name}" saved as asset${asset?.overwritten ? ' (overwrote previous version)' : ''}`);
      window.__forgeLoadAssets?.();
    } catch (error) { toast(error.message); }
  });

  window.addEventListener('forge-tool-modal-open', e => { if (e.detail?.name === 'audio') renderAll(); });

  renderAll();
})();
