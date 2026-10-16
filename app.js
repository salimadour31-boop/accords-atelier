/* Accords Atelier — interface, lecture Web Audio et export MIDI.
 * Aucune dépendance, aucun appel réseau : tout tourne localement. */
(function () {
  'use strict';
  var T = window.Theory, I = window.I18N;
  var $ = function (id) { return document.getElementById(id); };

  // ---------- État ----------
  var S = {lang:'fr', key:0, mode:'ionian', size:3, bpm:90, beats:4, sound:'pad', arp:false, loop:true, prog:[]};
  var FUNC = ['fT','fS','fT','fS','fD','fT','fD']; // fonction harmonique par degré

  var PRESETS = [
    {id:'pop', mode:'ionian', d:[0,4,5,3]},
    {id:'fifties', mode:'ionian', d:[0,5,3,4]},
    {id:'jazz', mode:'ionian', d:[[1,'m7'],[4,'7'],[0,'maj7']]},
    {id:'canon', mode:'ionian', d:[0,4,5,2,3,0,3,4]},
    {id:'andalusian', mode:'aeolian', d:[0,6,5,[4,'M']]},
    {id:'epic', mode:'aeolian', d:[0,5,2,6]},
    {id:'dark', mode:'aeolian', d:[0,5,3,[4,'M']]},
    {id:'blues', mode:'ionian', d:[[0,'7'],[0,'7'],[0,'7'],[0,'7'],[3,'7'],[3,'7'],[0,'7'],[0,'7'],[4,'7'],[3,'7'],[0,'7'],[4,'7']]}
  ];

  function t(k) { return (I[S.lang] && I[S.lang][k]) || I.fr[k] || k; }
  function flats() { return T.useFlats(S.key, S.mode); }

  // ---------- Lien partageable (hash) ----------
  function saveHash() {
    var p = S.prog.map(function (c) { return c.r + '.' + c.q; }).join(',');
    var h = 'l=' + S.lang + '&k=' + S.key + '&m=' + S.mode + '&s=' + S.size + '&b=' + S.bpm + '&n=' + S.beats + '&p=' + p;
    try { history.replaceState(null, '', '#' + h); } catch (e) {}
    // prévient le studio multipiste qu'il doit se resynchroniser
    try { document.dispatchEvent(new CustomEvent('aa:change')); } catch (e) {}
  }
  function loadHash() {
    var h = location.hash.replace(/^#/, ''); if (!h) return;
    h.split('&').forEach(function (kv) {
      var a = kv.split('='), v = decodeURIComponent(a[1] || '');
      if (a[0] === 'l' && I[v]) S.lang = v;
      if (a[0] === 'k' && +v >= 0 && +v < 12) S.key = +v;
      if (a[0] === 'm' && T.MODES[v]) S.mode = v;
      if (a[0] === 's' && (v === '3' || v === '4')) S.size = +v;
      if (a[0] === 'b' && +v >= 40 && +v <= 220) S.bpm = +v;
      if (a[0] === 'n' && [1,2,4,8].indexOf(+v) !== -1) S.beats = +v;
      if (a[0] === 'p' && v) S.prog = v.split(',').map(function (x) {
        var c = x.split('.'); return {r: (+c[0]) % 12, q: c[1]};
      }).filter(function (c) { return !isNaN(c.r) && T.QUAL[c.q]; }).slice(0, 64);
    });
  }

  // ---------- Rendu ----------
  function applyLang() {
    document.documentElement.lang = S.lang === 'kab' ? 'kab' : S.lang;
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.dataset.i18n); });
    document.title = t('title') + ' — ' + t('progression');
    fillSelects(); renderAll();
  }
  function fillSelects() {
    var ks = $('key'), ms = $('mode');
    ks.innerHTML = ''; ms.innerHTML = '';
    for (var k = 0; k < 12; k++) {
      var o = document.createElement('option'); o.value = k;
      o.textContent = T.noteName(k, false) + (T.noteName(k, true) !== T.noteName(k, false) ? ' / ' + T.noteName(k, true) : '');
      ks.appendChild(o);
    }
    Object.keys(T.MODES).forEach(function (m) {
      var o = document.createElement('option'); o.value = m; o.textContent = t('m_' + m); ms.appendChild(o);
    });
    ks.value = S.key; ms.value = S.mode;
    $('ctype').value = S.size; $('tempo').value = S.bpm; $('beats').value = S.beats;
    $('sound').value = S.sound; $('arp').checked = S.arp; $('loop').checked = S.loop;
  }
  function renderPalette() {
    var box = $('palette'); box.innerHTML = '';
    for (var d = 0; d < 7; d++) {
      var c = T.diatonic(S.key, S.mode, d, S.size), b = document.createElement('button');
      b.className = 'chord'; b.type = 'button';
      b.innerHTML = '<span class="rn"></span><span class="nm"></span><span class="fn"></span>';
      b.children[0].textContent = T.roman(S.key, c.root, c.q, S.mode);
      b.children[1].textContent = T.chordName(c.root, c.q, flats());
      b.children[2].textContent = t(FUNC[d]);
      b.onclick = (function (c) { return function () { add({r:c.root, q:c.q}); preview(c.root, c.q); }; })(c);
      box.appendChild(b);
    }
    var pb = $('presets'); pb.innerHTML = '';
    PRESETS.forEach(function (p) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = t('p_' + p.id);
      b.onclick = function () { loadPreset(p); }; pb.appendChild(b);
    });
  }
  function renderProg() {
    var ol = $('prog'); ol.innerHTML = '';
    S.prog.forEach(function (c, i) {
      var li = document.createElement('li'), b = document.createElement('b'), s = document.createElement('small'), x = document.createElement('button');
      b.textContent = T.chordName(c.r, c.q, flats()); s.textContent = T.roman(S.key, c.r, c.q, S.mode);
      x.type = 'button'; x.textContent = '×'; x.title = t('remove'); x.setAttribute('aria-label', t('remove') + ' ' + b.textContent);
      x.onclick = function () { S.prog.splice(i, 1); renderProg(); saveHash(); };
      li.onclick = function (e) { if (e.target !== x) { preview(c.r, c.q); } };
      li.appendChild(b); li.appendChild(s); li.appendChild(x); ol.appendChild(li);
    });
    $('empty').style.display = S.prog.length ? 'none' : '';
  }
  function renderAll() { renderPalette(); renderProg(); }

  // Clavier de deux octaves (C3 à B4 = MIDI 48 à 71)
  var keyEls = {};
  function buildPiano() {
    var p = $('piano'), whites = [0,2,4,5,7,9,11], wCount = 14, wi = 0;
    for (var m = 48; m < 72; m++) {
      var pc = m % 12, el = document.createElement('div');
      if (whites.indexOf(pc) !== -1) { el.className = 'w'; p.appendChild(el); wi++; }
      else { el.className = 'b'; el.style.left = (wi / wCount * 100 - 100 / wCount * 0.3) + '%'; el.style.width = (100 / wCount * 0.6) + '%'; p.appendChild(el); }
      keyEls[m] = el;
    }
  }
  function lightKeys(r, q) {
    Object.keys(keyEls).forEach(function (k) { keyEls[k].classList.remove('on'); });
    if (r == null) { $('current').textContent = '—'; return; }
    var v = T.voicing(r, q);
    v.notes.forEach(function (n) { if (keyEls[n]) keyEls[n].classList.add('on'); });
    $('current').textContent = T.chordName(r, q, flats()) + '  (' + T.roman(S.key, r, q, S.mode) + ') — ' +
      v.notes.map(function (n) { return T.noteName(n, flats()); }).join(' · ');
  }

  // ---------- Actions ----------
  function add(c) { if (S.prog.length < 64) { S.prog.push(c); renderProg(); saveHash(); } }
  function loadPreset(p) {
    S.mode = p.mode; $('mode').value = p.mode;
    S.prog = p.d.map(function (x) {
      var d = Array.isArray(x) ? x[0] : x, q = Array.isArray(x) ? x[1] : null, c = T.diatonic(S.key, S.mode, d, S.size);
      return {r: c.root, q: q || c.q};
    });
    renderAll(); saveHash();
  }
  function transpose(n) {
    S.key = (S.key + n + 12) % 12; $('key').value = S.key;
    S.prog.forEach(function (c) { c.r = (c.r + n + 12) % 12; });
    renderAll(); saveHash();
  }
  function status(msg) { $('status').textContent = msg; }

  // ---------- Audio (Web Audio API) ----------
  var ctx = null, master = null, timer = null, playing = false, uiTimers = [];
  function ensureCtx() {
    if (!ctx) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ctx = new AC(); }
    if (ctx.state === 'suspended') ctx.resume();
    if (!master) {
      master = ctx.createGain(); master.gain.value = 0.18;
      var comp = ctx.createDynamicsCompressor(); master.connect(comp); comp.connect(ctx.destination);
    }
    return ctx;
  }
  function freq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  /** Joue une note : synthèse simple selon le timbre choisi. */
  function voice(m, t0, dur, vel) {
    var g = ctx.createGain(), f = ctx.createBiquadFilter(), oscs = [];
    f.type = 'lowpass'; g.connect(master); f.connect(g);
    var a, rel;
    if (S.sound === 'pad') {
      a = Math.min(0.4, dur / 3); rel = 0.5; f.frequency.value = 1800;
      [-6, 6].forEach(function (det) { var o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = det; oscs.push(o); });
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vel * 0.5, t0 + a);
      g.gain.setValueAtTime(vel * 0.5, t0 + dur); g.gain.linearRampToValueAtTime(0, t0 + dur + rel);
    } else if (S.sound === 'keys') {
      rel = 0.3; f.frequency.value = 4000;
      var o1 = ctx.createOscillator(); o1.type = 'triangle'; var o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 0; oscs.push(o1, o2);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vel, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(vel * 0.35, t0 + Math.min(dur, 0.8));
      g.gain.setValueAtTime(vel * 0.35, t0 + dur); g.gain.linearRampToValueAtTime(0, t0 + dur + rel);
    } else {
      rel = 0.05; f.frequency.setValueAtTime(3500, t0); f.frequency.exponentialRampToValueAtTime(400, t0 + 0.4);
      var o3 = ctx.createOscillator(); o3.type = 'square'; oscs.push(o3);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vel * 0.6, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0005, t0 + Math.min(dur, 0.9)); g.gain.linearRampToValueAtTime(0, t0 + dur + rel);
    }
    oscs.forEach(function (o, i) {
      o.frequency.value = freq(m) * (S.sound === 'keys' && i === 1 ? 2 : 1);
      o.connect(f); o.start(t0); o.stop(t0 + dur + rel + 0.05);
    });
  }
  /** Programme un accord (plaqué ou arpégé) à l'instant t0. */
  function scheduleChord(c, t0, dur) {
    var v = T.voicing(c.r, c.q);
    voice(v.bass, t0, dur * 0.98, 0.5);
    if (S.arp) {
      var step = 60 / S.bpm / 2, seq = v.notes.concat(v.notes.slice(1, -1).reverse()), n = Math.max(1, Math.round(dur / step));
      for (var i = 0; i < n; i++) voice(seq[i % seq.length], t0 + i * step, step * 0.95, 0.45);
    } else v.notes.forEach(function (m) { voice(m, t0, dur * 0.98, 0.4); });
  }
  function preview(r, q) {
    lightKeys(r, q);
    if (playing || !ensureCtx()) return;
    scheduleChord({r:r, q:q}, ctx.currentTime + 0.02, 0.9);
  }
  function highlight(i) {
    var lis = $('prog').children;
    for (var k = 0; k < lis.length; k++) lis[k].classList.toggle('on', k === i);
    if (S.prog[i]) lightKeys(S.prog[i].r, S.prog[i].q);
  }
  function play() {
    if (!S.prog.length) { status(t('needChords')); return; }
    if (!ensureCtx()) return;
    stop(); playing = true; status('');
    var dur = 60 / S.bpm * S.beats, next = ctx.currentTime + 0.08, idx = 0;
    // Planificateur à anticipation : programme les accords 300 ms à l'avance
    timer = setInterval(function () {
      while (playing && next < ctx.currentTime + 0.3) {
        if (idx >= S.prog.length) { if (S.loop) idx = 0; else { var endIn = (next - ctx.currentTime) * 1000; uiTimers.push(setTimeout(stop, endIn)); clearInterval(timer); return; } }
        var c = S.prog[idx]; scheduleChord(c, next, dur);
        uiTimers.push(setTimeout(highlight.bind(null, idx), Math.max(0, (next - ctx.currentTime) * 1000)));
        next += dur; idx++;
      }
    }, 50);
  }
  function stop() {
    playing = false; clearInterval(timer); uiTimers.forEach(clearTimeout); uiTimers = [];
    if (master) { // coupe net en remplaçant le bus principal
      var old = master; master = null; old.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      setTimeout(function () { try { old.disconnect(); } catch (e) {} }, 300);
    }
    highlight(-1);
  }

  // ---------- Export MIDI (format 0, 480 ticks par noire) ----------
  function vlq(n) { var b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; }
  function buildMidi() {
    var PPQ = 480, len = PPQ * S.beats, ev = [], data = [];
    var us = Math.round(60000000 / S.bpm);
    S.prog.forEach(function (c, i) {
      var v = T.voicing(c.r, c.q), notes = [v.bass].concat(v.notes), t0 = i * len;
      notes.forEach(function (n) { ev.push({t:t0, on:1, n:n}); ev.push({t:t0 + len - 10, on:0, n:n}); });
    });
    ev.sort(function (a, b) { return a.t - b.t || a.on - b.on; }); // les note-off avant les note-on au même instant
    data.push(0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255); // tempo
    var last = 0;
    ev.forEach(function (e) { data = data.concat(vlq(e.t - last), [e.on ? 0x90 : 0x80, e.n, e.on ? 90 : 0]); last = e.t; });
    data.push(0, 0xff, 0x2f, 0); // fin de piste
    var L = data.length, head = [0x4d,0x54,0x68,0x64,0,0,0,6,0,0,0,1,(PPQ >> 8) & 255,PPQ & 255,
      0x4d,0x54,0x72,0x6b,(L >>> 24) & 255,(L >> 16) & 255,(L >> 8) & 255,L & 255];
    return new Uint8Array(head.concat(data));
  }
  function download(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    status(t('exported'));
  }
  function baseName() { return 'accords-' + T.noteName(S.key, flats()).replace('♯', 's').replace('♭', 'b') + '-' + S.mode; }

  // ---------- Événements ----------
  function bind() {
    $('lang').onchange = function () { S.lang = this.value; try { localStorage.setItem('aa-lang', S.lang); } catch (e) {} applyLang(); saveHash(); };
    $('key').onchange = function () { var n = (+this.value - S.key + 12) % 12; S.key = +this.value; S.prog.forEach(function (c) { c.r = (c.r + n) % 12; }); renderAll(); saveHash(); };
    $('mode').onchange = function () { S.mode = this.value; renderAll(); saveHash(); };
    $('ctype').onchange = function () { S.size = +this.value; renderPalette(); saveHash(); };
    $('tempo').onchange = function () { S.bpm = Math.min(220, Math.max(40, +this.value || 90)); this.value = S.bpm; saveHash(); };
    $('beats').onchange = function () { S.beats = +this.value; saveHash(); };
    $('sound').onchange = function () { S.sound = this.value; };
    $('arp').onchange = function () { S.arp = this.checked; };
    $('loop').onchange = function () { S.loop = this.checked; };
    $('play').onclick = play; $('stop').onclick = stop;
    $('undo').onclick = function () { S.prog.pop(); renderProg(); saveHash(); };
    $('clear').onclick = function () { stop(); S.prog = []; renderProg(); saveHash(); lightKeys(null); };
    $('transpose-up').onclick = function () { transpose(1); };
    $('transpose-down').onclick = function () { transpose(-1); };
    $('midi').onclick = function () { if (!S.prog.length) return status(t('needChords')); download(new Blob([buildMidi()], {type:'audio/midi'}), baseName() + '.mid'); };
    $('txt').onclick = function () {
      if (!S.prog.length) return status(t('needChords'));
      var names = S.prog.map(function (c) { return T.chordName(c.r, c.q, flats()); }).join(' | ');
      var rn = S.prog.map(function (c) { return T.roman(S.key, c.r, c.q, S.mode); }).join(' – ');
      var txt = t('key') + ': ' + T.noteName(S.key, flats()) + ' ' + t('m_' + S.mode) + '\n' + names + '\n' + rn + '\n' + S.bpm + ' BPM\n';
      download(new Blob([txt], {type:'text/plain;charset=utf-8'}), baseName() + '.txt');
    };
    $('share').onclick = function () {
      saveHash();
      if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(function () { status(t('copied')); }, function () { status(t('copyFail')); });
      else status(t('copyFail'));
    };
  }

  // ---------- Démarrage ----------
  try { S.lang = localStorage.getItem('aa-lang') || ((navigator.language || 'fr').slice(0, 2) === 'en' ? 'en' : 'fr'); } catch (e) {}
  if (!I[S.lang]) S.lang = 'fr';
  loadHash(); $('lang').value = S.lang;
  buildPiano(); bind(); applyLang();
  if (S.prog.length) lightKeys(S.prog[0].r, S.prog[0].q);
  // API utilisée par studio.js et par les tests
  window.__AA = {S:S, buildMidi:buildMidi, t:t, flats:flats, loadPreset:function (i) { loadPreset(PRESETS[i]); },
    refresh:function () { fillSelects(); renderAll(); saveHash(); }, stopPreview:stop};
})();
