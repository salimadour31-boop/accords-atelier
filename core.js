/* Accords Atelier v2 — noyau « studio » sans DOM (testable sous Node).
 * Contenu : lecture/écriture MIDI, détection de tonalité, harmonisation,
 * générateur de mélodie à graine, variations, basse, batterie, détection de
 * hauteur (YIN), estimation du tempo, encodeur WAV.
 * Le temps est exprimé en TEMPS (noires) ; une note = {t, d, n, v}. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { require('./theory.js'); module.exports = factory(globalThis.Theory); }
  else root.Core = factory(root.Theory);
})(typeof window !== 'undefined' ? window : globalThis, function (T) {
  'use strict';
  if (!T && typeof globalThis !== 'undefined') T = globalThis.Theory;

  // ---------------------------------------------------------------- Aléatoire
  /** Générateur pseudo-aléatoire reproductible (mulberry32). */
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0; var x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length) % arr.length]; }

  // ---------------------------------------------------------------- Lecture MIDI
  /** Analyse un fichier MIDI standard (format 0/1). Lève une erreur si invalide.
   *  Retourne {format, ppq, bpm, timeSig:[num,den], tracks:[{name, notes:[{t,d,n,v,ch}]}]} (t,d en temps). */
  function parseMidi(buf) {
    var b = buf instanceof Uint8Array ? buf : new Uint8Array(buf), p = 0;
    function u32() { var v = (b[p] << 24 | b[p+1] << 16 | b[p+2] << 8 | b[p+3]) >>> 0; p += 4; return v; }
    function u16() { var v = b[p] << 8 | b[p+1]; p += 2; return v; }
    function str(n) { var s = ''; for (var i = 0; i < n; i++) s += String.fromCharCode(b[p+i]); p += n; return s; }
    function vlq() { var v = 0, c, k = 0; do { if (p >= b.length || k++ > 4) throw new Error('VLQ'); c = b[p++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80); return v; }
    if (b.length < 14 || str(4) !== 'MThd') throw new Error('Not a MIDI file');
    var hl = u32(), format = u16(), ntr = u16(), div = u16(); p = 8 + hl;
    if (div & 0x8000) throw new Error('SMPTE timing not supported');
    var ppq = div || 480, tempo = 500000, tempoSet = false, ts = [4, 4], tracks = [];
    for (var ti = 0; ti < ntr && p + 8 <= b.length; ti++) {
      var id = str(4), len = u32(), end = Math.min(b.length, p + len);
      if (id !== 'MTrk') { p = end; continue; }
      var tick = 0, rs = 0, open = {}, notes = [], name = '';
      while (p < end) {
        tick += vlq();
        var st = b[p];
        if (st & 0x80) { p++; if (st < 0xf0) rs = st; } else { if (!rs) throw new Error('Running status'); st = rs; }
        if (st === 0xff) {                       // méta-événement
          var type = b[p++], ml = vlq(), ms = p;
          if (type === 0x51 && ml === 3 && !tempoSet) { tempo = b[ms] << 16 | b[ms+1] << 8 | b[ms+2]; tempoSet = true; }
          if (type === 0x58 && ml >= 2) ts = [b[ms], Math.pow(2, b[ms+1])];
          if (type === 0x03) name = str(ml), p = ms;
          p = ms + ml; if (type === 0x2f) break;
        } else if (st === 0xf0 || st === 0xf7) { p += vlq(); }   // sysex ignoré
        else {
          var hi = st & 0xf0, ch = st & 0x0f, d1 = b[p++], d2 = (hi === 0xc0 || hi === 0xd0) ? 0 : b[p++];
          var k = ch + ':' + d1;
          if (hi === 0x90 && d2 > 0) { (open[k] = open[k] || []).push({tick: tick, v: d2}); }
          else if (hi === 0x80 || (hi === 0x90 && d2 === 0)) {
            var o = open[k] && open[k].shift();
            if (o) notes.push({t: o.tick / ppq, d: Math.max(1, tick - o.tick) / ppq, n: d1, v: o.v, ch: ch});
          }
        }
      }
      p = end;
      notes.sort(function (x, y) { return x.t - y.t || x.n - y.n; });
      tracks.push({name: name, notes: notes});
    }
    return {format: format, ppq: ppq, bpm: Math.round(60000000 / tempo * 100) / 100, timeSig: ts, tracks: tracks};
  }

  /** Choisit la piste la plus probablement « mélodique » (hors batterie, la plus haute/monophonique). */
  function pickMelodyTrack(midi) {
    var best = -1, bestScore = -1;
    midi.tracks.forEach(function (tr, i) {
      var ns = tr.notes.filter(function (n) { return n.ch !== 9; }); if (!ns.length) return;
      var avg = ns.reduce(function (s, n) { return s + n.n; }, 0) / ns.length;
      var score = ns.length * (avg / 60);
      if (score > bestScore) { bestScore = score; best = i; }
    });
    return best;
  }

  /** Rend une ligne monophonique (garde la note la plus aiguë quand plusieurs se chevauchent). */
  function monophonize(notes) {
    var s = notes.slice().sort(function (a, b) { return a.t - b.t || b.n - a.n; }), out = [];
    s.forEach(function (n) {
      var last = out[out.length - 1];
      if (last && Math.abs(last.t - n.t) < 1e-6) return;
      if (last && last.t + last.d > n.t) last.d = Math.max(0.05, n.t - last.t);
      out.push({t: n.t, d: n.d, n: n.n, v: n.v || 96});
    });
    return out;
  }

  // ---------------------------------------------------------------- Écriture MIDI
  function vlqBytes(n) { var b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; }
  function strBytes(s) { var o = []; for (var i = 0; i < s.length; i++) o.push(s.charCodeAt(i) & 0x7f); return o; }
  /** Écrit un MIDI format 1 : piste 0 = tempo, puis une piste par entrée {name, ch, program, notes}. */
  function writeMidi(tracks, bpm, ppq) {
    ppq = ppq || 480;
    function chunk(id, data) { var L = data.length; return strBytes(id).concat([(L >>> 24) & 255, (L >> 16) & 255, (L >> 8) & 255, L & 255], data); }
    var us = Math.round(60000000 / bpm);
    var t0 = [0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255, 0, 0xff, 0x58, 4, 4, 2, 24, 8, 0, 0xff, 0x2f, 0];
    var out = chunk('MThd', [0, 1, 0, tracks.length + 1, (ppq >> 8) & 255, ppq & 255]).concat(chunk('MTrk', t0));
    tracks.forEach(function (tr) {
      var nm = strBytes(tr.name || ''), data = [0, 0xff, 0x03].concat(vlqBytes(nm.length), nm), ev = [];
      if (tr.program != null && tr.ch !== 9) data.push(0, 0xc0 | tr.ch, tr.program & 127);
      tr.notes.forEach(function (n) {
        var a = Math.round(n.t * ppq), z = Math.max(a + 1, Math.round((n.t + n.d) * ppq) - 2);
        ev.push({t: a, on: 1, n: n.n, v: Math.max(1, Math.min(127, Math.round(n.v || 96)))}, {t: z, on: 0, n: n.n, v: 0});
      });
      ev.sort(function (x, y) { return x.t - y.t || x.on - y.on; });
      var last = 0;
      ev.forEach(function (e) { data = data.concat(vlqBytes(e.t - last), [(e.on ? 0x90 : 0x80) | tr.ch, e.n & 127, e.v]); last = e.t; });
      data.push(0, 0xff, 0x2f, 0);
      out = out.concat(chunk('MTrk', data));
    });
    return new Uint8Array(out);
  }

  // ---------------------------------------------------------------- Tonalité
  /** Histogramme de classes de hauteur pondéré par la durée (+ bonus temps fort). */
  function pcHistogram(notes) {
    var h = [0,0,0,0,0,0,0,0,0,0,0,0];
    notes.forEach(function (n) { h[((n.n % 12) + 12) % 12] += n.d * (Math.abs(n.t - Math.round(n.t)) < 1e-3 ? 1.25 : 1); });
    return h;
  }
  function corr(a, b) {
    var ma = 0, mb = 0, i; for (i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; } ma /= 12; mb /= 12;
    var num = 0, da = 0, db = 0;
    for (i = 0; i < 12; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) * (a[i] - ma); db += (b[i] - mb) * (b[i] - mb); }
    return da && db ? num / Math.sqrt(da * db) : 0;
  }
  // Profils de Krumhansl-Kessler (majeur/mineur), données de recherche publiques.
  var KK_MAJ = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
  var KK_MIN = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
  /** Profil d'un mode : tonique, tierce et quinte renforcées, notes de la gamme moyennes, hors gamme faibles. */
  function modeProfile(mode) {
    var st = T.MODES[mode].steps, p = [], i;
    for (i = 0; i < 12; i++) p.push(1.5);
    st.forEach(function (s, d) { p[s] = d === 0 ? 6 : d === 2 ? 4.5 : d === 4 ? 5 : 3.3; });
    if (mode === 'ionian') return KK_MAJ; if (mode === 'aeolian') return KK_MIN;
    return p;
  }
  /** Détecte la tonalité et le mode. Retourne {key, mode, score, ranking:[...]}. */
  function detectKey(notes, modes) {
    var h = pcHistogram(notes), res = [];
    modes = modes || Object.keys(T.MODES);
    // la dernière et la première note renforcent légèrement leur tonique
    var s = notes.slice().sort(function (a, b) { return a.t - b.t; });
    modes.forEach(function (m) {
      var prof = modeProfile(m);
      for (var k = 0; k < 12; k++) {
        var rot = []; for (var i = 0; i < 12; i++) rot.push(prof[(i - k + 12) % 12]);
        var sc = corr(h, rot);
        if (s.length) { if (s[s.length - 1].n % 12 === k) sc += 0.04; if (s[0].n % 12 === k) sc += 0.02; }
        if (m === 'ionian' || m === 'aeolian') sc += 0.03; // préférence pour les modes usuels à score égal
        res.push({key: k, mode: m, score: sc});
      }
    });
    res.sort(function (a, b) { return b.score - a.score; });
    return {key: res[0].key, mode: res[0].mode, score: res[0].score, ranking: res.slice(0, 5)};
  }

  // ---------------------------------------------------------------- Harmonisation
  function chordPcs(c) { return T.QUAL[c.q].iv.map(function (i) { return (c.r + i) % 12; }); }
  /** Propose une progression (un accord par segment de `beats` temps) qui épouse la mélodie.
   *  Programmation dynamique : adéquation notes/accord + enchaînements usuels. */
  function harmonize(notes, key, mode, opts) {
    opts = opts || {};
    var beats = opts.beats || 4, size = opts.size || 3;
    var total = notes.reduce(function (m, n) { return Math.max(m, n.t + n.d); }, 0);
    var segs = Math.max(1, Math.ceil(total / beats - 1e-6));
    var cands = []; for (var d = 0; d < 7; d++) { var c = T.diatonic(key, mode, d, size); cands.push({r: c.root, q: c.q, d: d}); }
    // Score local d'un accord sur un segment
    var local = [];
    for (var s = 0; s < segs; s++) {
      var a = s * beats, z = a + beats, row = [];
      var w = [0,0,0,0,0,0,0,0,0,0,0,0], tot = 0;
      notes.forEach(function (n) {
        var ov = Math.min(z, n.t + n.d) - Math.max(a, n.t); if (ov <= 0) return;
        var strong = (n.t >= a - 1e-6 && Math.abs(((n.t - a) % 2)) < 1e-3) ? 1.6 : 1; // temps 1 et 3
        var x = ov * strong; w[n.n % 12] += x; tot += x;
      });
      cands.forEach(function (c) {
        var pcs = chordPcs(c), fit = 0;
        for (var i = 0; i < 12; i++) fit += pcs.indexOf(i) !== -1 ? w[i] : -0.6 * w[i];
        if (w[c.r] > 0) fit += 0.3 * w[c.r]; // fondamentale présente dans la mélodie
        row.push(tot ? fit / tot : 0);
      });
      local.push(row);
    }
    // Bonus de transition par mouvement de degré
    function trans(p, c, s) {
      var mv = (cands[c].d - cands[p].d + 7) % 7, b = 0;
      if (mv === 3) b += 0.25;        // quarte ascendante (V→I, ii→V…)
      else if (mv === 4) b += 0.12;   // quinte ascendante
      else if (mv === 0) b -= 0.15;   // répétition
      else if (mv === 5 || mv === 2) b += 0.08;
      if (cands[c].d === 6 && mode !== 'aeolian') b -= 0.1; // vii° plus rare
      return b;
    }
    var dp = [], bk = [];
    for (s = 0; s < segs; s++) {
      dp.push([]); bk.push([]);
      for (var c2 = 0; c2 < 7; c2++) {
        var base = local[s][c2] + (cands[c2].d === 0 && (s === 0 || s === segs - 1) ? 0.3 : 0);
        if (!s) { dp[s][c2] = base; bk[s][c2] = -1; continue; }
        var best = -1e9, bi = 0;
        for (var p = 0; p < 7; p++) { var v = dp[s-1][p] + trans(p, c2, s); if (v > best) { best = v; bi = p; } }
        dp[s][c2] = best + base; bk[s][c2] = bi;
      }
    }
    var end = 0; for (c2 = 1; c2 < 7; c2++) if (dp[segs-1][c2] > dp[segs-1][end]) end = c2;
    var path = []; for (s = segs - 1; s >= 0; s--) { path.unshift(end); end = bk[s][end]; }
    return path.map(function (i) { return {r: cands[i].r, q: cands[i].q}; });
  }

  // ---------------------------------------------------------------- Mélodie
  function scalePcs(key, mode) { return T.MODES[mode].steps.map(function (s) { return (key + s) % 12; }); }
  /** Note la plus proche de `ref` dont la classe est dans `pcs`, bornée dans [lo,hi]. */
  function nearest(ref, pcs, lo, hi) {
    var best = null, bd = 1e9;
    for (var m = lo; m <= hi; m++) if (pcs.indexOf(m % 12) !== -1) { var dd = Math.abs(m - ref); if (dd < bd) { bd = dd; best = m; } }
    return best == null ? ref : best;
  }
  /** Pas diatonique (dir = ±1) à partir de m dans la gamme. */
  function stepScale(m, dir, pcs) { var x = m + dir; while (pcs.indexOf(((x % 12) + 12) % 12) === -1) x += dir; return x; }

  var RHYTHMS = { // motifs par demi-mesure (2 temps), en temps
    sparse: [[2], [1, 1], [1.5, 0.5]],
    medium: [[1, 1], [0.5, 0.5, 1], [1, 0.5, 0.5], [1.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
    dense:  [[0.5, 0.5, 0.5, 0.5], [0.25, 0.25, 0.5, 1], [0.5, 0.25, 0.25, 0.5, 0.5], [0.25, 0.25, 0.25, 0.25, 0.5, 0.5]]
  };
  var RANGES = {low: [52, 69], mid: [60, 77], high: [67, 84]};

  /** Génère une mélodie sur la progression.
   *  opts : {seed, style:'lyrical'|'pop'|'arp', density:'sparse'|'medium'|'dense', range:'low'|'mid'|'high', beats} */
  function generateMelody(prog, key, mode, opts) {
    opts = opts || {};
    var r = rng(opts.seed == null ? 1 : opts.seed), beats = opts.beats || 4;
    var rg = RANGES[opts.range] || RANGES.mid, lo = rg[0], hi = rg[1];
    var dens = RHYTHMS[opts.density] || RHYTHMS.medium, style = opts.style || 'pop';
    var pcs = scalePcs(key, mode), out = [], prev = nearest(Math.round((lo + hi) / 2), [key], lo, hi);
    // Motif rythmique répété pour donner de la cohérence (A A' B A)
    var motif = []; for (var i = 0; i < Math.max(1, beats / 2); i++) motif.push(pick(r, dens));
    prog.forEach(function (c, ci) {
      var cp = chordPcs(c), t0 = ci * beats, pos = 0, half = 0;
      var useNew = (ci % 4 === 2) && r() < 0.7;
      while (pos < beats - 1e-6) {
        var pat = useNew ? pick(r, dens) : motif[half % motif.length];
        if (pos + 2 > beats) pat = [beats - pos];
        pat.forEach(function (d) {
          var t = t0 + pos, strong = Math.abs(pos % 1) < 1e-6 && (pos % 2 === 0 || d >= 1), n;
          if (style === 'arp') {
            var dir = (Math.floor(pos * 2) % 4 < 2) ? 1 : -1, x = prev + dir;
            while (cp.indexOf(((x % 12) + 12) % 12) === -1) x += dir;
            if (x > hi || x < lo) { x = prev - dir; while (cp.indexOf(((x % 12) + 12) % 12) === -1) x -= dir; }
            n = x;
          } else if (strong) {
            // temps fort : note de l'accord proche (petit saut possible en style pop)
            var target = prev + (style === 'pop' && r() < 0.35 ? (r() < 0.5 ? -4 : 4) : 0);
            n = nearest(target, cp, lo, hi);
            if (n === prev && r() < 0.5) n = nearest(prev + (r() < 0.5 ? 3 : -3), cp, lo, hi);
          } else {
            // temps faible : note de passage (pas diatonique) ou note de l'accord
            var dirn = prev > hi - 3 ? -1 : prev < lo + 3 ? 1 : (r() < 0.5 ? -1 : 1);
            n = (style === 'lyrical' || r() < 0.65) ? stepScale(prev, dirn, pcs) : nearest(prev + dirn * 3, cp, lo, hi);
          }
          n = Math.max(lo, Math.min(hi, n));
          if (pcs.indexOf(n % 12) === -1 && cp.indexOf(n % 12) === -1) n = nearest(n, pcs, lo, hi);
          var rest = !strong && r() < (opts.density === 'sparse' ? 0.2 : 0.08);
          if (!rest) out.push({t: t, d: d * 0.95, n: n, v: strong ? 100 : 84});
          prev = n; pos += d;
        });
        half++;
      }
    });
    // Cadence : la dernière note tombe sur la tonique (ou une note de l'accord final)
    if (out.length) {
      var last = out[out.length - 1], fc = chordPcs(prog[prog.length - 1]);
      last.n = nearest(last.n, fc.indexOf(key) !== -1 ? [key] : fc, lo, hi);
    }
    return out;
  }

  /** Variation d'une mélodie existante (reproductible) : ornements, rythme, contour.
   *  Les notes sur les temps forts restent des notes de l'accord quand une progression est fournie. */
  function varyMelody(notes, key, mode, opts) {
    opts = opts || {};
    var r = rng(opts.seed == null ? 7 : opts.seed), pcs = scalePcs(key, mode), amount = opts.amount == null ? 0.5 : opts.amount;
    var prog = opts.prog || null, beats = opts.beats || 4, out = [];
    notes.forEach(function (n) {
      var strong = Math.abs(n.t % 1) < 1e-3, c = prog && prog[Math.floor(n.t / beats)], nn = n.n;
      if (!strong && r() < amount * 0.6) nn = stepScale(n.n, r() < 0.5 ? 1 : -1, pcs);
      if (strong && c && r() < amount * 0.4) nn = nearest(n.n + (r() < 0.5 ? 3 : -3), chordPcs(c), n.n - 7, n.n + 7);
      if (n.d >= 1 && r() < amount * 0.5) { // division d'une note longue avec broderie
        var h = n.d / 2;
        out.push({t: n.t, d: h * 0.95, n: nn, v: n.v});
        out.push({t: n.t + h, d: h * 0.95, n: stepScale(nn, r() < 0.5 ? 1 : -1, pcs), v: (n.v || 90) * 0.9});
      } else out.push({t: n.t, d: n.d, n: nn, v: n.v});
    });
    return out;
  }

  // ---------------------------------------------------------------- Basse & batterie
  /** Ligne de basse à partir des accords. style : 'root' | 'pulse' | 'walk' | 'octave'. */
  function generateBass(prog, opts) {
    opts = opts || {}; var beats = opts.beats || 4, style = opts.style || 'root', out = [];
    prog.forEach(function (c, i) {
      var root = 36 + c.r; if (root > 43) root -= 12;
      var fifth = root + (T.QUAL[c.q].iv[2] || 7), t0 = i * beats, nxt = prog[(i + 1) % prog.length], k;
      if (style === 'pulse') for (k = 0; k < beats * 2; k++) out.push({t: t0 + k / 2, d: 0.45, n: root, v: k % 2 ? 80 : 100});
      else if (style === 'octave') for (k = 0; k < beats * 2; k++) out.push({t: t0 + k / 2, d: 0.45, n: k % 2 ? root + 12 : root, v: 95});
      else if (style === 'walk') {
        var nr = 36 + nxt.r; if (nr > 43) nr -= 12;
        var seq = [root, root + T.QUAL[c.q].iv[1], fifth, nr + (nr > root ? -1 : 1)];
        for (k = 0; k < beats; k++) out.push({t: t0 + k, d: 0.9, n: seq[k % 4], v: k ? 88 : 100});
      } else { out.push({t: t0, d: beats * 0.6, n: root, v: 100}); if (beats >= 4) out.push({t: t0 + beats * 0.75, d: beats * 0.2, n: fifth, v: 80}); }
    });
    return out;
  }
  // Batterie : 16 pas par mesure ; n = 36 grosse caisse, 38 caisse claire, 42 charleston (numéros GM)
  var DRUMS = {
    pop:      {k: 'x.......x.x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.'},
    rock:     {k: 'x.....x.x.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.'},
    hiphop:   {k: 'x......x..x.....', s: '....x.......x..x', h: 'x.xxx.x.x.xxx.x.'},
    halftime: {k: 'x.........x.....', s: '........x.......', h: 'x...x...x...x...'},
    four:     {k: 'x...x...x...x...', s: '....x.......x...', h: '..x...x...x...x.'}
  };
  function generateDrums(bars, style, beatsPerBar) {
    var p = DRUMS[style] || DRUMS.pop, out = [], bpb = beatsPerBar || 4, steps = bpb * 4;
    for (var b = 0; b < bars; b++) for (var s = 0; s < steps; s++) {
      var t = b * bpb + s / 4, i = s % 16;
      if (p.k[i] === 'x') out.push({t: t, d: 0.25, n: 36, v: 110});
      if (p.s[i] === 'x') out.push({t: t, d: 0.25, n: 38, v: 100});
      if (p.h[i] === 'x') out.push({t: t, d: 0.1, n: 42, v: s % 4 ? 60 : 85});
    }
    return out;
  }
  /** Notes des accords (voix + rythme plaqué ou arpégé) pour la piste Accords. */
  function chordNotes(prog, opts) {
    opts = opts || {}; var beats = opts.beats || 4, out = [];
    prog.forEach(function (c, i) {
      var v = T.voicing(c.r, c.q), t0 = i * beats;
      if (opts.arp) {
        var seq = v.notes.concat(v.notes.slice(1, -1).reverse());
        for (var k = 0; k < beats * 2; k++) out.push({t: t0 + k / 2, d: 0.48, n: seq[k % seq.length], v: 80});
      } else v.notes.forEach(function (n) { out.push({t: t0, d: beats * 0.98, n: n, v: 78}); });
    });
    return out;
  }

  // ---------------------------------------------------------------- Audio : hauteur & tempo
  /** YIN (de Cheveigné & Kawahara, 2002) sur une trame. Retourne la fréquence en Hz ou 0. */
  function yin(frame, sr, fmin, fmax, thr) {
    var N = frame.length, maxT = Math.min(Math.floor(sr / (fmin || 70)), (N >> 1) - 1), minT = Math.max(2, Math.floor(sr / (fmax || 1500)));
    var d = new Float32Array(maxT + 1), tau, i, run = 0, W = N - maxT;
    for (tau = 1; tau <= maxT; tau++) { var s = 0; for (i = 0; i < W; i++) { var x = frame[i] - frame[i + tau]; s += x * x; } d[tau] = s; }
    d[0] = 1;
    for (tau = 1; tau <= maxT; tau++) { run += d[tau]; d[tau] = run ? d[tau] * tau / run : 1; }
    thr = thr || 0.15;
    for (tau = minT; tau <= maxT; tau++) {
      if (d[tau] < thr) {
        while (tau + 1 <= maxT && d[tau + 1] < d[tau]) tau++;
        var a = d[tau - 1], b = d[tau], c = tau + 1 <= maxT ? d[tau + 1] : b, den = a + c - 2 * b;
        var off = den ? (a - c) / (2 * den) : 0; // interpolation parabolique
        return sr / (tau + off);
      }
    }
    return 0;
  }
  /** Transcrit un signal mono en notes {t (s), d (s), n}. Adapté aux mélodies monophoniques. */
  function detectPitches(data, sr, opts) {
    opts = opts || {};
    var N = opts.frame || 2048, hop = opts.hop || 512, frames = [], rmsMax = 0, i;
    for (var p = 0; p + N <= data.length; p += hop) {
      var f = data.subarray(p, p + N), rms = 0; for (i = 0; i < N; i += 4) rms += f[i] * f[i]; rms = Math.sqrt(rms / (N / 4));
      frames.push({rms: rms, p: p}); if (rms > rmsMax) rmsMax = rms;
    }
    var gate = Math.max(0.01, rmsMax * 0.08), mid = [];
    frames.forEach(function (fr) {
      if (fr.rms < gate) { mid.push(-1); return; }
      var hz = yin(data.subarray(fr.p, fr.p + N), sr, 70, 1500, 0.15);
      mid.push(hz ? Math.round(69 + 12 * Math.log2(hz / 440)) : -1);
    });
    // filtre médian (5 trames) pour lisser les erreurs d'octave isolées
    var sm = mid.map(function (_, k) { var w = mid.slice(Math.max(0, k - 2), k + 3).slice().sort(function (a, b) { return a - b; }); return w[w.length >> 1]; });
    var notes = [], cur = null, fdur = hop / sr, minDur = opts.minDur || 0.07;
    sm.forEach(function (m, k) {
      var t = k * fdur + N / sr / 2;
      if (cur && m === cur.n) { cur.d = t - cur.t + fdur; return; }
      if (cur && cur.d >= minDur) notes.push(cur);
      cur = m > 0 ? {t: t, d: fdur, n: m, v: 96} : null;
    });
    if (cur && cur.d >= minDur) notes.push(cur);
    return notes;
  }
  /** Estime le tempo (BPM) par autocorrélation de l'enveloppe d'attaques. */
  function estimateBpm(data, sr) {
    var hop = 512, env = [], prev = 0;
    for (var p = 0; p + hop <= data.length; p += hop) {
      var e = 0; for (var i = p; i < p + hop; i++) e += data[i] * data[i];
      e = Math.sqrt(e / hop); env.push(Math.max(0, e - prev)); prev = e;
    }
    var fps = sr / hop, best = 0, bestBpm = 120;
    for (var bpm = 60; bpm <= 180; bpm += 0.5) {
      var lag = fps * 60 / bpm, s = 0, l0 = Math.floor(lag), fr = lag - l0;
      for (var k = 0; k + l0 + 1 < env.length; k++) s += env[k] * (env[k + l0] * (1 - fr) + env[k + l0 + 1] * fr);
      s *= 1 + 0.15 * Math.exp(-Math.pow((bpm - 110) / 40, 2)); // léger a priori autour de 110
      if (s > best) { best = s; bestBpm = bpm; }
    }
    return Math.round(bestBpm);
  }
  /** Convertit des notes en secondes vers des temps (et quantifie à la double-croche si demandé). */
  function secondsToBeats(notes, bpm, offset, quant) {
    var k = bpm / 60, q = quant || 0;
    return notes.map(function (n) {
      var t = (n.t - (offset || 0)) * k, d = n.d * k;
      if (q) { t = Math.round(t / q) * q; d = Math.max(q, Math.round(d / q) * q); }
      return {t: t, d: d, n: n.n, v: n.v || 96};
    }).filter(function (n) { return n.t >= 0; });
  }

  // ---------------------------------------------------------------- WAV
  /** Encode des canaux Float32 en WAV PCM 16 bits. */
  function encodeWav(channels, sr) {
    var nc = channels.length, len = channels[0].length, bytes = 44 + len * nc * 2, buf = new ArrayBuffer(bytes), v = new DataView(buf), p = 0;
    function s(x) { for (var i = 0; i < x.length; i++) v.setUint8(p++, x.charCodeAt(i)); }
    s('RIFF'); v.setUint32(p, bytes - 8, true); p += 4; s('WAVE'); s('fmt ');
    v.setUint32(p, 16, true); p += 4; v.setUint16(p, 1, true); p += 2; v.setUint16(p, nc, true); p += 2;
    v.setUint32(p, sr, true); p += 4; v.setUint32(p, sr * nc * 2, true); p += 4; v.setUint16(p, nc * 2, true); p += 2; v.setUint16(p, 16, true); p += 2;
    s('data'); v.setUint32(p, len * nc * 2, true); p += 4;
    for (var i = 0; i < len; i++) for (var c = 0; c < nc; c++) {
      var x = Math.max(-1, Math.min(1, channels[c][i])); v.setInt16(p, x < 0 ? x * 0x8000 : x * 0x7fff, true); p += 2;
    }
    return new Uint8Array(buf);
  }

  return {rng: rng, parseMidi: parseMidi, pickMelodyTrack: pickMelodyTrack, monophonize: monophonize, writeMidi: writeMidi,
    pcHistogram: pcHistogram, detectKey: detectKey, harmonize: harmonize, chordPcs: chordPcs, scalePcs: scalePcs,
    generateMelody: generateMelody, varyMelody: varyMelody, generateBass: generateBass, generateDrums: generateDrums,
    chordNotes: chordNotes, DRUMS: DRUMS, yin: yin, detectPitches: detectPitches, estimateBpm: estimateBpm,
    secondsToBeats: secondsToBeats, encodeWav: encodeWav};
});
