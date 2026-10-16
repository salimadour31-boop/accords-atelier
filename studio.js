/* Accords Atelier v2 — studio multipiste (mélodie, accords, basse, batterie).
 * Moteur Web Audio partagé entre la lecture temps réel et le rendu hors ligne
 * (OfflineAudioContext) pour les exports WAV. Aucun appel réseau. */
(function () {
  'use strict';
  var A = window.__AA, C = window.Core, T = window.Theory, S = A.S;
  var $ = function (id) { return document.getElementById(id); };
  function t(k) { return A.t(k); }

  // ---------------------------------------------------------------- État du studio
  var TRACKS = [
    {id: 'melody', vol: 0.8, pan: 0.1, mute: false, solo: false, inst: 'lead', rev: 0.25, dly: 0.15, cut: 1, insts: ['lead', 'sine', 'flute', 'pluck', 'keys']},
    {id: 'chords', vol: 0.55, pan: -0.15, mute: false, solo: false, inst: 'pad', rev: 0.3, dly: 0, cut: 0.8, pattern: 'block', insts: ['pad', 'keys', 'pluck', 'organ'], patterns: ['block', 'arp']},
    {id: 'bass', vol: 0.75, pan: 0, mute: false, solo: false, inst: 'sub', rev: 0, dly: 0, cut: 0.7, pattern: 'root', insts: ['sub', 'synth', 'pluck'], patterns: ['root', 'pulse', 'walk', 'octave']},
    {id: 'drums', vol: 0.7, pan: 0, mute: false, solo: false, inst: 'e808', rev: 0.08, dly: 0, cut: 1, pattern: 'pop', insts: ['e808', 'tight'], patterns: ['pop', 'rock', 'hiphop', 'halftime', 'four']}
  ];
  var M = {src: null, notes: [], buf: null, name: '', midi: null, key: null};  // mélodie courante
  var G = null;                // graphe audio temps réel en cours
  var actx = null, playing = false, sched = null, raf = 0, taps = [];
  var MS = {vol: 0.9, lim: true, rev: 2};

  // ---------------------------------------------------------------- Données → événements
  function spb() { return 60 / S.bpm; }
  /** Événements (en temps) de chaque piste, calculés à partir de l'état courant. */
  function events() {
    var tr = byId(), beats = S.beats, prog = S.prog;
    var melLen = M.notes.reduce(function (m, n) { return Math.max(m, n.t + n.d); }, 0);
    if (M.src === 'audio' && M.buf) melLen = Math.max(melLen, (M.buf.duration - offsetSec()) / spb());
    var len = Math.max(prog.length * beats, Math.ceil(melLen / 4 - 1e-6) * 4) || 16;
    len = Math.ceil(len / 4) * 4;
    return {
      len: len,
      melody: M.src === 'audio' ? [] : M.notes,
      chords: C.chordNotes(prog, {beats: beats, arp: tr.chords.pattern === 'arp'}),
      bass: C.generateBass(prog, {beats: beats, style: tr.bass.pattern}),
      drums: prog.length || M.notes.length ? C.generateDrums(len / 4, tr.drums.pattern) : []
    };
  }
  function byId() { var o = {}; TRACKS.forEach(function (x) { o[x.id] = x; }); return o; }
  function offsetSec() { return (+$('offset').value || 0) / 1000; }
  function audible(tr) { var anySolo = TRACKS.some(function (x) { return x.solo; }); return anySolo ? tr.solo : !tr.mute; }

  // ---------------------------------------------------------------- Synthèse
  var noiseCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function noise(ctx) {
    var b = noiseCache && noiseCache.get(ctx); if (b) return b;
    b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); var d = b.getChannelData(0), r = C.rng(99);
    for (var i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
    if (noiseCache) noiseCache.set(ctx, b); return b;
  }
  function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  /** Enveloppe ADSR simple sur un gain. */
  function env(g, t0, dur, peak, a, dcy, sus, rel) {
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.setTargetAtTime(peak * sus, t0 + a, dcy);
    g.gain.setValueAtTime(peak * sus, t0 + Math.max(a, dur)); g.gain.setTargetAtTime(0, t0 + Math.max(a, dur), rel / 4);
    return t0 + Math.max(a, dur) + rel;
  }
  function osc(ctx, type, f, det) { var o = ctx.createOscillator(); o.type = type; o.frequency.value = f; if (det) o.detune.value = det; return o; }
  /** Joue une note mélodique/harmonique avec le timbre `inst` vers `out`. */
  function synth(ctx, out, inst, n, t0, dur, vel) {
    var g = ctx.createGain(), f = ctx.createBiquadFilter(), oscs = [], end, v = vel / 127, F = hz(n);
    f.type = 'lowpass'; f.connect(g); g.connect(out);
    switch (inst) {
      case 'lead': oscs = [osc(ctx, 'sawtooth', F, -5), osc(ctx, 'square', F, 5)]; f.frequency.value = 2600; f.Q.value = 3; end = env(g, t0, dur, v * 0.22, 0.01, 0.15, 0.7, 0.15); break;
      case 'sine': oscs = [osc(ctx, 'sine', F)]; f.frequency.value = 8000; end = env(g, t0, dur, v * 0.45, 0.01, 0.2, 0.8, 0.12); break;
      case 'flute':
        oscs = [osc(ctx, 'sine', F), osc(ctx, 'triangle', F * 2)]; f.frequency.value = 3000; end = env(g, t0, dur, v * 0.35, 0.06, 0.3, 0.85, 0.15);
        var lfo = osc(ctx, 'sine', 5.2), lg = ctx.createGain(); lg.gain.value = F * 0.006; lfo.connect(lg); lg.connect(oscs[0].frequency); lfo.start(t0); lfo.stop(end + 0.05); break;
      case 'pluck': oscs = [osc(ctx, 'square', F)]; f.frequency.setValueAtTime(4000, t0); f.frequency.exponentialRampToValueAtTime(300, t0 + 0.35); end = env(g, t0, Math.min(dur, 0.6), v * 0.3, 0.004, 0.18, 0.15, 0.08); break;
      case 'keys': oscs = [osc(ctx, 'triangle', F), osc(ctx, 'sine', F * 2)]; f.frequency.value = 5000; end = env(g, t0, dur, v * 0.35, 0.008, 0.4, 0.35, 0.25); break;
      case 'organ': oscs = [osc(ctx, 'sine', F), osc(ctx, 'sine', F * 2), osc(ctx, 'sine', F * 3)]; f.frequency.value = 6000; end = env(g, t0, dur, v * 0.16, 0.02, 0.1, 1, 0.08); break;
      case 'sub': oscs = [osc(ctx, 'sine', F), osc(ctx, 'triangle', F)]; f.frequency.value = 900; end = env(g, t0, dur, v * 0.5, 0.008, 0.3, 0.8, 0.08); break;
      case 'synth': oscs = [osc(ctx, 'sawtooth', F)]; f.frequency.setValueAtTime(1600, t0); f.frequency.exponentialRampToValueAtTime(350, t0 + 0.25); f.Q.value = 6; end = env(g, t0, dur, v * 0.32, 0.005, 0.2, 0.6, 0.06); break;
      default: /* pad */ oscs = [osc(ctx, 'sawtooth', F, -7), osc(ctx, 'sawtooth', F, 7)]; f.frequency.value = 1700; end = env(g, t0, dur, v * 0.14, Math.min(0.35, dur / 3), 0.5, 0.9, 0.5);
    }
    oscs.forEach(function (o) { o.connect(f); o.start(t0); o.stop(end + 0.05); });
  }
  /** Batterie synthétisée : 36 grosse caisse, 38 caisse claire, 42 charleston. */
  function drum(ctx, out, kit, n, t0, vel) {
    var v = vel / 127, g = ctx.createGain(); g.connect(out);
    var tight = kit === 'tight';
    if (n === 36) {
      var o = osc(ctx, 'sine', 150); o.frequency.setValueAtTime(tight ? 180 : 150, t0); o.frequency.exponentialRampToValueAtTime(tight ? 55 : 42, t0 + (tight ? 0.12 : 0.3));
      g.gain.setValueAtTime(v, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + (tight ? 0.25 : 0.5)); o.connect(g); o.start(t0); o.stop(t0 + 0.55);
    } else {
      var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(); s.buffer = noise(ctx); s.connect(f); f.connect(g);
      if (n === 38) {
        f.type = 'bandpass'; f.frequency.value = tight ? 2500 : 1800; f.Q.value = 0.8;
        g.gain.setValueAtTime(v * 0.6, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + (tight ? 0.12 : 0.2));
        var b = osc(ctx, 'triangle', 190), bg = ctx.createGain(); bg.gain.setValueAtTime(v * 0.4, t0); bg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
        b.connect(bg); bg.connect(out); b.start(t0); b.stop(t0 + 0.12);
        s.start(t0); s.stop(t0 + 0.25);
      } else {
        f.type = 'highpass'; f.frequency.value = tight ? 9000 : 7000;
        g.gain.setValueAtTime(v * 0.3, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + (tight ? 0.03 : 0.06));
        s.start(t0, Math.random() * 0.5); s.stop(t0 + 0.08);
      }
    }
  }
  function click(ctx, out, t0, accent) {
    var o = osc(ctx, 'square', accent ? 1760 : 1100), g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.04); o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 0.05);
  }

  // ---------------------------------------------------------------- Graphe de mixage
  /** Réponse impulsionnelle synthétique (bruit à décroissance exponentielle) pour la réverb. */
  function impulse(ctx, sec) {
    var len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, len, ctx.sampleRate), r = C.rng(5);
    for (var c = 0; c < 2; c++) { var d = b.getChannelData(c); for (var i = 0; i < len; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / len, 3); }
    return b;
  }
  function cutHz(x) { return 200 * Math.pow(90, x); } // 0..1 → 200 Hz..18 kHz (échelle log)
  /** Construit : piste → filtre → volume → panoramique → master, + départs réverb/délai ; master → limiteur → sortie.
   *  `only` : id de piste pour rendre une piste seule (stems). */
  function buildGraph(ctx, only) {
    var g = {ctx: ctx, tr: {}};
    g.master = ctx.createGain(); g.master.gain.value = MS.vol;
    g.lim = ctx.createDynamicsCompressor();
    g.lim.threshold.value = -1.5; g.lim.knee.value = 0; g.lim.ratio.value = 20; g.lim.attack.value = 0.002; g.lim.release.value = 0.12;
    g.analyser = ctx.createAnalyser(); g.analyser.fftSize = 512;
    g.master.connect(MS.lim ? g.lim : g.analyser); if (MS.lim) g.lim.connect(g.analyser);
    g.analyser.connect(ctx.destination);
    g.verb = ctx.createConvolver(); g.verb.buffer = impulse(ctx, MS.rev); g.verb.connect(g.master);
    g.delay = ctx.createDelay(2); g.delay.delayTime.value = spb() * 0.75; // croche pointée
    var fb = ctx.createGain(); fb.gain.value = 0.35; g.delay.connect(fb); fb.connect(g.delay); g.delay.connect(g.master);
    TRACKS.forEach(function (tr) {
      var n = {in: ctx.createGain(), filt: ctx.createBiquadFilter(), vol: ctx.createGain(), pan: ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain(), rev: ctx.createGain(), dly: ctx.createGain()};
      n.filt.type = 'lowpass';
      n.in.connect(n.filt); n.filt.connect(n.vol); n.vol.connect(n.pan); n.pan.connect(g.master);
      n.vol.connect(n.rev); n.rev.connect(g.verb); n.vol.connect(n.dly); n.dly.connect(g.delay);
      g.tr[tr.id] = n;
    });
    applyMix(g, only);
    return g;
  }
  /** Applique les réglages de la table de mixage à un graphe (aussi pendant la lecture). */
  function applyMix(g, only) {
    if (!g) return;
    TRACKS.forEach(function (tr) {
      var n = g.tr[tr.id], on = only ? only === tr.id : audible(tr);
      n.vol.gain.value = on ? tr.vol : 0; if (n.pan.pan) n.pan.pan.value = tr.pan;
      n.filt.frequency.value = cutHz(tr.cut); n.rev.gain.value = tr.rev; n.dly.gain.value = tr.dly;
    });
    g.master.gain.value = MS.vol;
  }
  /** Programme les événements dont le temps (en temps musicaux) est dans [a, b). `t0` = instant contexte du temps 0. */
  function scheduleRange(g, ev, a, b, t0, loopLen, metro) {
    var ctx = g.ctx, k = spb(), tr = byId();
    var c0 = Math.floor(a / loopLen), c1 = Math.floor((b - 1e-9) / loopLen);
    for (var cyc = c0; cyc <= c1; cyc++) {
      var base = cyc * loopLen;
      ['melody', 'chords', 'bass', 'drums'].forEach(function (id) {
        ev[id].forEach(function (e) {
          var at = base + e.t; if (at < a || at >= b || e.t >= loopLen) return;
          var when = t0 + at * k;
          if (id === 'drums') drum(ctx, g.tr.drums.in, tr.drums.inst, e.n, when, e.v);
          else synth(ctx, g.tr[id].in, tr[id].inst, e.n, when, Math.min(e.d, loopLen - e.t) * k, e.v);
        });
      });
      // Mélodie audio : relancée au début de chaque cycle
      if (M.src === 'audio' && M.buf && base >= a && base < b) {
        var src = ctx.createBufferSource(), off = offsetSec(), when2 = t0 + base * k;
        src.buffer = M.buf; src.connect(g.tr.melody.in);
        if (off >= 0) src.start(when2, off); else src.start(when2 - off, 0);
        src.stop(when2 + loopLen * k);
        (g.sources = g.sources || []).push(src);
      }
      if (metro) for (var bt = Math.ceil(Math.max(a, base)); bt < Math.min(b, base + loopLen); bt++) click(ctx, g.analyser, t0 + bt * k, (bt - base) % 4 === 0);
    }
  }

  // ---------------------------------------------------------------- Transport temps réel
  function ensureCtx() {
    if (!actx) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; actx = new AC(); }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function play() {
    if (!S.prog.length && !M.notes.length && !M.buf) return status(t('needChords'));
    if (!ensureCtx()) return;
    stop(); if (A.stopPreview) A.stopPreview();
    var ev = events(), L = ev.len, t0 = actx.currentTime + 0.1, done = 0, loop = $('s-loop').checked;
    G = buildGraph(actx); G.t0 = t0; G.len = L; playing = true;
    sched = setInterval(function () {
      var now = (actx.currentTime - t0) / spb(), upto = now + 0.4 / spb() + 0.5;
      if (!loop) upto = Math.min(upto, L);
      if (upto > done) { scheduleRange(G, ev, done, upto, t0, L, $('s-metro').checked); done = upto; }
      if (!loop && now > L + 0.5) stop();
    }, 40);
    draw();
  }
  function stop() {
    playing = false; clearInterval(sched); cancelAnimationFrame(raf);
    if (G) { var old = G; G = null; old.master.gain.setTargetAtTime(0, actx.currentTime, 0.02);
      (old.sources || []).forEach(function (s) { try { s.stop(actx.currentTime + 0.1); } catch (e) {} });
      setTimeout(function () { try { old.analyser.disconnect(); } catch (e) {} }, 250); }
    setPlayhead(-1); $('s-pos').textContent = '1.1'; $('meter').firstChild.style.width = '0';
  }
  /** Boucle d'animation : tête de lecture, position mesure.temps et vumètre. */
  function draw() {
    if (!playing || !G) return;
    var b = (actx.currentTime - G.t0) / spb();
    if (b >= 0) { var lb = b % G.len; setPlayhead(lb / G.len); $('s-pos').textContent = (Math.floor(lb / 4) + 1) + '.' + (Math.floor(lb % 4) + 1); }
    var arr = new Float32Array(G.analyser.fftSize); G.analyser.getFloatTimeDomainData(arr);
    var pk = 0; for (var i = 0; i < arr.length; i++) pk = Math.max(pk, Math.abs(arr[i]));
    var m = $('meter').firstChild; m.style.width = Math.min(100, pk * 100) + '%'; m.className = pk > 0.98 ? 'clip' : '';
    raf = requestAnimationFrame(draw);
  }
  function setPlayhead(x) {
    document.querySelectorAll('.lane .ph').forEach(function (p) { p.style.display = x < 0 ? 'none' : 'block'; p.style.left = (x * 100) + '%'; });
  }

  // ---------------------------------------------------------------- Rendu hors ligne & exports
  /** Rend le morceau (ou une seule piste) en AudioBuffer stéréo 44,1 kHz. */
  function renderOffline(only) {
    var ev = events(), L = ev.len, sr = 44100, sec = L * spb() + 2.5;
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var ctx = new OAC(2, Math.ceil(sec * sr), sr), g = buildGraph(ctx, only);
    scheduleRange(g, ev, 0, L, 0.05, L, false);
    return ctx.startRendering();
  }
  function wavBlob(buf) { return new Blob([C.encodeWav([buf.getChannelData(0), buf.getChannelData(1)], buf.sampleRate)], {type: 'audio/wav'}); }
  function download(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  function base() { return 'accords-studio-' + T.noteName(S.key, false).replace('♯', 's') + '-' + S.mode + '-' + S.bpm + 'bpm'; }
  function hasContent() { return S.prog.length || M.notes.length || M.buf; }
  function exportWav() {
    if (!hasContent()) return status(t('needChords'));
    status(t('rendering'));
    return renderOffline(null).then(function (b) { download(wavBlob(b), base() + '.wav'); status(t('exported')); });
  }
  function exportStems() {
    if (!hasContent()) return status(t('needChords'));
    status(t('rendering'));
    var ids = TRACKS.map(function (x) { return x.id; }), i = 0;
    function next() {
      if (i >= ids.length) { status(t('exported')); return Promise.resolve(); }
      var id = ids[i++];
      return renderOffline(id).then(function (b) { download(wavBlob(b), base() + '-' + id + '.wav'); return next(); });
    }
    return next();
  }
  function midiBytes() {
    var ev = events(), tr = byId();
    var mel = M.src === 'audio' ? M.notes : ev.melody; // pour l'audio : notes détectées
    var GM = {lead: 81, sine: 80, flute: 73, pluck: 25, keys: 4, pad: 89, organ: 16, sub: 38, synth: 38};
    return C.writeMidi([
      {name: t('tr_melody'), ch: 0, program: GM[tr.melody.inst], notes: mel},
      {name: t('tr_chords'), ch: 1, program: GM[tr.chords.inst], notes: ev.chords},
      {name: t('tr_bass'), ch: 2, program: GM[tr.bass.inst], notes: ev.bass},
      {name: t('tr_drums'), ch: 9, notes: ev.drums}
    ], S.bpm);
  }
  function projectJson() {
    return {app: 'accords-atelier', version: 2, key: S.key, mode: S.mode, size: S.size, bpm: S.bpm, beats: S.beats,
      prog: S.prog, melody: {src: M.src === 'audio' ? 'midi' : M.src, notes: M.notes, audioName: M.src === 'audio' ? M.name : null, offsetMs: +$('offset').value || 0},
      gen: {style: $('g-style').value, density: $('g-density').value, range: $('g-range').value, seed: +$('g-seed').value},
      master: MS, tracks: TRACKS.map(function (x) { return {id: x.id, vol: x.vol, pan: x.pan, mute: x.mute, solo: x.solo, inst: x.inst, rev: x.rev, dly: x.dly, cut: x.cut, pattern: x.pattern}; })};
  }
  function loadProject(p) {
    if (!p || p.app !== 'accords-atelier') throw new Error('bad project');
    if (T.MODES[p.mode]) S.mode = p.mode; S.key = (+p.key || 0) % 12; S.size = p.size === 4 ? 4 : 3;
    S.bpm = Math.min(220, Math.max(40, +p.bpm || 90)); S.beats = [1, 2, 4, 8].indexOf(+p.beats) !== -1 ? +p.beats : 4;
    S.prog = (p.prog || []).filter(function (c) { return T.QUAL[c.q]; }).slice(0, 64).map(function (c) { return {r: (+c.r) % 12, q: c.q}; });
    var mel = p.melody || {}; M = {src: mel.notes && mel.notes.length ? (mel.src || 'midi') : null, notes: (mel.notes || []).slice(0, 5000), buf: null, name: '', midi: null};
    if (p.gen) { $('g-style').value = p.gen.style; $('g-density').value = p.gen.density; $('g-range').value = p.gen.range; $('g-seed').value = p.gen.seed; }
    if (p.master) { MS.vol = +p.master.vol || 0.9; MS.lim = p.master.lim !== false; MS.rev = +p.master.rev || 2; }
    (p.tracks || []).forEach(function (x) { var tr = byId()[x.id]; if (!tr) return; ['vol', 'pan', 'mute', 'solo', 'inst', 'rev', 'dly', 'cut', 'pattern'].forEach(function (k) { if (x[k] != null) tr[k] = x[k]; }); });
    A.refresh(); syncMaster(); buildTracks(); analysis(mel.audioName ? t('audioNotSaved') + ' (' + mel.audioName + ')' : '');
  }

  // ---------------------------------------------------------------- Import mélodie
  function readFile(file) { return new Promise(function (ok, ko) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = ko; r.readAsArrayBuffer(file); }); }
  function importMidi(file) {
    return readFile(file).then(function (ab) {
      var m = C.parseMidi(ab), best = C.pickMelodyTrack(m);
      if (best < 0) throw new Error('no notes');
      M = {src: 'midi', notes: [], buf: null, name: file.name, midi: m};
      var sel = $('midi-track'); sel.innerHTML = '';
      m.tracks.forEach(function (tr, i) { if (!tr.notes.length) return; var o = document.createElement('option'); o.value = i; o.textContent = (i + 1) + ' — ' + (tr.name || t('track')) + ' (' + tr.notes.length + ')'; sel.appendChild(o); });
      sel.value = best; $('midi-track-wrap').hidden = false;
      S.bpm = Math.min(220, Math.max(40, Math.round(m.bpm))); A.refresh();
      useMidiTrack(best);
    }).catch(function (e) { status(t('badFile') + ' (' + e.message + ')'); });
  }
  function useMidiTrack(i) {
    var tr = M.midi.tracks[i]; if (!tr) return;
    M.notes = C.monophonize(tr.notes.filter(function (n) { return n.ch !== 9; }).map(function (n) { return {t: n.t, d: n.d, n: n.n, v: n.v}; })).slice(0, 5000);
    M.key = C.detectKey(M.notes); describe(); renderLanes();
  }
  function importAudio(file) {
    if (!ensureCtx()) return;
    status(t('analyzing'));
    return readFile(file).then(function (ab) {
      return new Promise(function (ok, ko) { var p = actx.decodeAudioData(ab, ok, ko); if (p && p.then) p.then(ok, ko); });
    }).then(function (buf) {
      M = {src: 'audio', notes: [], buf: buf, name: file.name, midi: null}; $('midi-track-wrap').hidden = true;
      M.mono = monoDown(buf); M.sec = C.detectPitches(M.mono.data, M.mono.sr, {frame: 1024, hop: 256});
      if (!M.sec.length) { status(t('noPitch')); }
      // aligne automatiquement le temps 1 sur la première note détectée
      if (M.sec.length) $('offset').value = Math.round(M.sec[0].t * 1000);
      M.bpmGuess = C.estimateBpm(M.mono.data, M.mono.sr);
      reconvert(); status('');
    }).catch(function (e) { status(t('badFile') + ' (' + (e && e.message || e) + ')'); });
  }
  /** Mixage mono + sous-échantillonnage (~16 kHz, 90 s max) pour accélérer l'analyse. */
  function monoDown(buf) {
    var f = Math.max(1, Math.floor(buf.sampleRate / 16000)), n = Math.min(buf.length, buf.sampleRate * 90), out = new Float32Array(Math.floor(n / f));
    var chs = []; for (var c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
    for (var i = 0; i < out.length; i++) { var s = 0; for (var k = 0; k < f; k++) for (c = 0; c < chs.length; c++) s += chs[c][i * f + k]; out[i] = s / (f * chs.length); }
    return {data: out, sr: buf.sampleRate / f};
  }
  /** Convertit les notes détectées (secondes) en temps selon BPM et décalage, puis détecte la tonalité. */
  function reconvert() {
    if (M.src !== 'audio' || !M.sec) return;
    M.notes = C.secondsToBeats(M.sec, S.bpm, offsetSec(), 0.25);
    M.key = M.notes.length ? C.detectKey(M.notes) : null; describe(); renderLanes();
  }
  function describe() {
    if (!M.notes.length) return analysis(M.src ? t('noPitch') : '');
    var k = M.key, txt = t('detected') + ' ' + T.noteName(k.key, T.useFlats(k.key, k.mode)) + ' ' + t('m_' + k.mode) +
      ' · ' + M.notes.length + ' ' + t('notes') + ' · ' + S.bpm + ' BPM';
    if (M.bpmGuess) txt += ' (' + t('autoBpm') + ' : ' + M.bpmGuess + ')';
    analysis(txt);
  }
  function harmonize() {
    if (!M.notes.length) return status(t('needMelody'));
    var k = M.key || C.detectKey(M.notes);
    S.key = k.key; S.mode = k.mode;
    S.prog = C.harmonize(M.notes, k.key, k.mode, {beats: S.beats, size: S.size}).slice(0, 64);
    A.refresh(); status(t('harmonized'));
  }

  // ---------------------------------------------------------------- Génération
  function genOpts(seed) { return {seed: seed, style: $('g-style').value, density: $('g-density').value, range: $('g-range').value, beats: S.beats}; }
  function generate() {
    if (!S.prog.length) return status(t('needChords'));
    M = {src: 'gen', notes: C.generateMelody(S.prog, S.key, S.mode, genOpts(+$('g-seed').value || 1)), buf: null, name: '', midi: null};
    M.key = {key: S.key, mode: S.mode, score: 1}; $('midi-track-wrap').hidden = true; describe(); renderLanes(); status(t('generated'));
  }
  function vary() {
    if (!M.notes.length) return status(t('needMelody'));
    var seed = Math.floor(Math.random() * 99999) + 1; $('g-seed').value = seed;
    M.notes = C.varyMelody(M.notes, S.key, S.mode, {seed: seed, prog: S.prog, beats: S.beats, amount: 0.5});
    if (M.src === 'audio') { M.src = 'gen'; M.buf = null; }
    describe(); renderLanes(); status(t('varied') + ' (' + t('seed') + ' ' + seed + ')');
  }

  // ---------------------------------------------------------------- Interface : pistes et timeline
  function opt(sel, vals, cur, prefix) {
    sel.innerHTML = ''; vals.forEach(function (v) { var o = document.createElement('option'); o.value = v; o.textContent = t(prefix + v); sel.appendChild(o); }); sel.value = cur;
  }
  function slider(label, min, max, step, val, on) {
    var l = document.createElement('label'); l.className = 'mini';
    l.innerHTML = '<span></span><input type="range">'; l.firstChild.textContent = label;
    var i = l.lastChild; i.min = min; i.max = max; i.step = step; i.value = val; i.setAttribute('aria-label', label);
    i.oninput = function () { on(+i.value); applyMix(G); }; return l;
  }
  /** (Re)construit les bandeaux de pistes : réglages à gauche, lane (canvas) à droite. */
  function buildTracks() {
    var box = $('tracks'); box.innerHTML = '';
    var ruler = document.createElement('div'); ruler.className = 'track ruler-row';
    ruler.innerHTML = '<div class="tctl"><b>' + t('timeline') + '</b></div><div class="lane"><canvas id="ruler"></canvas><span class="ph"></span></div>';
    box.appendChild(ruler);
    TRACKS.forEach(function (tr) {
      var row = document.createElement('div'); row.className = 'track'; row.dataset.id = tr.id;
      var ctl = document.createElement('div'); ctl.className = 'tctl';
      var head = document.createElement('div'); head.className = 'thead';
      var nm = document.createElement('b'); nm.textContent = t('tr_' + tr.id); head.appendChild(nm);
      var mu = document.createElement('button'); mu.type = 'button'; mu.className = 'ms' + (tr.mute ? ' on' : ''); mu.textContent = 'M'; mu.title = t('mute'); mu.setAttribute('aria-pressed', tr.mute);
      var so = document.createElement('button'); so.type = 'button'; so.className = 'ms solo' + (tr.solo ? ' on' : ''); so.textContent = 'S'; so.title = t('solo'); so.setAttribute('aria-pressed', tr.solo);
      mu.onclick = function () { tr.mute = !tr.mute; mu.classList.toggle('on', tr.mute); mu.setAttribute('aria-pressed', tr.mute); applyMix(G); };
      so.onclick = function () { tr.solo = !tr.solo; so.classList.toggle('on', tr.solo); so.setAttribute('aria-pressed', tr.solo); applyMix(G); };
      head.appendChild(mu); head.appendChild(so);
      var ins = document.createElement('select'); ins.setAttribute('aria-label', t('instrument')); opt(ins, tr.insts, tr.inst, 'i_');
      ins.onchange = function () { tr.inst = ins.value; }; head.appendChild(ins);
      if (tr.patterns) { var pt = document.createElement('select'); pt.setAttribute('aria-label', t('pattern')); opt(pt, tr.patterns, tr.pattern, 'pt_'); pt.onchange = function () { tr.pattern = pt.value; renderLanes(); }; head.appendChild(pt); }
      ctl.appendChild(head);
      var knobs = document.createElement('div'); knobs.className = 'knobs';
      knobs.appendChild(slider(t('volume'), 0, 1.2, 0.01, tr.vol, function (v) { tr.vol = v; }));
      knobs.appendChild(slider(t('pan'), -1, 1, 0.05, tr.pan, function (v) { tr.pan = v; }));
      knobs.appendChild(slider(t('filter'), 0, 1, 0.01, tr.cut, function (v) { tr.cut = v; }));
      knobs.appendChild(slider(t('reverb'), 0, 1, 0.01, tr.rev, function (v) { tr.rev = v; }));
      knobs.appendChild(slider(t('delay'), 0, 0.8, 0.01, tr.dly, function (v) { tr.dly = v; }));
      ctl.appendChild(knobs);
      var lane = document.createElement('div'); lane.className = 'lane';
      lane.innerHTML = '<canvas></canvas><span class="ph"></span>';
      row.appendChild(ctl); row.appendChild(lane); box.appendChild(row);
    });
    renderLanes();
  }
  /** Dessine la grille (mesures/temps), les accords et le contenu de chaque piste. */
  function renderLanes() {
    var ev = events(), L = ev.len, dpr = window.devicePixelRatio || 1, fl = T.useFlats(S.key, S.mode);
    function prep(cv, h) {
      var w = cv.parentNode.clientWidth || 300; cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px';
      var x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
      for (var b = 0; b <= L; b++) { x.fillStyle = b % 4 ? '#262938' : '#3a3e52'; x.fillRect(Math.round(b / L * w), 0, 1, h); }
      return {x: x, w: w, h: h};
    }
    var rc = $('ruler'); if (!rc) return;
    var r = prep(rc, 26); r.x.font = '11px system-ui'; r.x.fillStyle = '#9a9cb0';
    for (var b = 0; b < L; b += 4) r.x.fillText(String(b / 4 + 1), b / L * r.w + 3, 10);
    r.x.fillStyle = '#5fc2b5';
    S.prog.forEach(function (c, i) { r.x.fillText(T.chordName(c.r, c.q, fl), i * S.beats / L * r.w + 3, 23); });
    document.querySelectorAll('#tracks .track[data-id]').forEach(function (row) {
      var id = row.dataset.id, d = prep(row.querySelector('canvas'), 54), x = d.x, notes = ev[id];
      if (id === 'melody' && M.src === 'audio' && M.buf) { // forme d'onde de l'audio importé
        var ch = M.mono.data, k = spb(), off = offsetSec();
        x.fillStyle = 'rgba(242,169,59,.35)';
        for (var px = 0; px < d.w; px++) {
          var s0 = Math.floor(((px / d.w) * L * k + off) * M.mono.sr), s1 = Math.floor((((px + 1) / d.w) * L * k + off) * M.mono.sr), pk = 0;
          for (var s = Math.max(0, s0); s < Math.min(ch.length, s1); s += 4) pk = Math.max(pk, Math.abs(ch[s]));
          x.fillRect(px, d.h / 2 - pk * d.h / 2, 1, pk * d.h);
        }
        notes = M.notes; // notes détectées par-dessus
      }
      if (!notes.length) return;
      if (id === 'drums') {
        var rowY = {36: 40, 38: 24, 42: 8};
        x.fillStyle = '#b48cf2'; notes.forEach(function (n) { x.fillRect(n.t / L * d.w, rowY[n.n] || 30, Math.max(2, d.w / L / 4 - 1), 6); }); return;
      }
      var lo = 127, hi = 0; notes.forEach(function (n) { lo = Math.min(lo, n.n); hi = Math.max(hi, n.n); });
      var span = Math.max(12, hi - lo + 1);
      x.fillStyle = {melody: '#f2a93b', chords: '#5fc2b5', bass: '#6fa3ff'}[id];
      notes.forEach(function (n) { if (n.t >= L) return; x.fillRect(n.t / L * d.w, d.h - 4 - (n.n - lo + 1) / span * (d.h - 8), Math.max(2, n.d / L * d.w - 1), 3); });
    });
  }

  // ---------------------------------------------------------------- Divers
  function status(m) { $('s-status').textContent = m || ''; }
  function analysis(m) { $('analysis').textContent = m || ''; }
  function syncMaster() { $('m-vol').value = MS.vol; $('m-lim').checked = MS.lim; $('m-rev').value = MS.rev; $('s-bpm').value = S.bpm; }
  function setBpm(b) { S.bpm = Math.min(220, Math.max(40, Math.round(b))); A.refresh(); reconvert(); }

  function bind() {
    $('s-play').onclick = play; $('s-stop').onclick = stop;
    $('s-bpm').onchange = function () { setBpm(+this.value || 90); if (playing) play(); };
    $('m-vol').oninput = function () { MS.vol = +this.value; applyMix(G); };
    $('m-lim').onchange = function () { MS.lim = this.checked; if (playing) play(); };
    $('m-rev').onchange = function () { MS.rev = +this.value; if (G) G.verb.buffer = impulse(actx, MS.rev); };
    $('f-midi').onchange = function () { if (this.files[0]) importMidi(this.files[0]); this.value = ''; };
    $('f-audio').onchange = function () { if (this.files[0]) importAudio(this.files[0]); this.value = ''; };
    $('midi-track').onchange = function () { useMidiTrack(+this.value); };
    $('offset').onchange = function () { reconvert(); renderLanes(); };
    $('tap').onclick = function () {
      var now = performance.now(); taps = taps.filter(function (x) { return now - x < 3000; }); taps.push(now);
      if (taps.length >= 3) { var iv = (taps[taps.length - 1] - taps[0]) / (taps.length - 1); setBpm(60000 / iv); status(S.bpm + ' BPM'); }
      else status(t('tapMore'));
    };
    $('auto-bpm').onclick = function () { if (!M.bpmGuess) return status(t('needAudio')); setBpm(M.bpmGuess); status(S.bpm + ' BPM'); };
    $('harmonize').onclick = harmonize;
    $('apply-key').onclick = function () { if (!M.key) return status(t('needMelody')); S.key = M.key.key; S.mode = M.key.mode; A.refresh(); };
    $('gen').onclick = generate;
    $('reseed').onclick = function () { $('g-seed').value = Math.floor(Math.random() * 99999) + 1; generate(); };
    $('vary').onclick = vary;
    $('clear-mel').onclick = function () { M = {src: null, notes: [], buf: null, name: '', midi: null}; $('midi-track-wrap').hidden = true; analysis(''); renderLanes(); };
    $('x-wav').onclick = exportWav; $('x-stems').onclick = exportStems;
    $('x-midi').onclick = function () { if (!hasContent()) return status(t('needChords')); download(new Blob([midiBytes()], {type: 'audio/midi'}), base() + '.mid'); status(t('exported')); };
    $('x-json').onclick = function () { download(new Blob([JSON.stringify(projectJson(), null, 1)], {type: 'application/json'}), base() + '.json'); status(t('exported')); };
    $('f-json').onchange = function () {
      var f = this.files[0]; this.value = ''; if (!f) return;
      f.text().then(function (s) { loadProject(JSON.parse(s)); status(t('loaded')); }).catch(function () { status(t('badFile')); });
    };
    // Resynchronisation avec la partie « progression » (langue, tonalité, accords…)
    var pend = 0;
    document.addEventListener('aa:change', function () { clearTimeout(pend); pend = setTimeout(function () { syncMaster(); buildTracks(); describe(); }, 30); });
    window.addEventListener('resize', function () { clearTimeout(pend); pend = setTimeout(renderLanes, 100); });
  }

  bind(); syncMaster(); buildTracks();
  // API exposée pour les tests automatisés
  window.__STUDIO = {M: function () { return M; }, TRACKS: TRACKS, events: events, renderOffline: renderOffline, midiBytes: midiBytes,
    projectJson: projectJson, loadProject: loadProject, generate: generate, harmonize: harmonize, useNotes: function (n) { M = {src: 'midi', notes: n, buf: null}; M.key = C.detectKey(n); describe(); renderLanes(); },
    wav: function (b) { return C.encodeWav([b.getChannelData(0), b.getChannelData(1)], b.sampleRate); }, play: play, stop: stop};
})();
