/* Accords Atelier — théorie musicale (gammes, accords, chiffrage romain).
 * Tout est calculé en demi-tons : 0 = Do (C), 11 = Si (B). */
(function (g) {
  'use strict';
  var SHARP = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
  var FLAT  = ['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'];
  var MAJOR = [0,2,4,5,7,9,11];

  // Modes : intervalles + décalage par rapport à la gamme majeure parente (pour l'orthographe ♯/♭)
  var MODES = {
    ionian:     {steps:[0,2,4,5,7,9,11], parent:0},
    dorian:     {steps:[0,2,3,5,7,9,10], parent:2},
    phrygian:   {steps:[0,1,3,5,7,8,10], parent:4},
    lydian:     {steps:[0,2,4,6,7,9,11], parent:5},
    mixolydian: {steps:[0,2,4,5,7,9,10], parent:7},
    aeolian:    {steps:[0,2,3,5,7,8,10], parent:9},
    locrian:    {steps:[0,1,3,5,6,8,10], parent:11},
    harmonic:   {steps:[0,2,3,5,7,8,11], parent:9}, // mineur harmonique
    melodic:    {steps:[0,2,3,5,7,9,11], parent:9}  // mineur mélodique (ascendant)
  };

  // Qualités d'accord : clé courte -> intervalles + suffixe affiché
  var QUAL = {
    'M':    {iv:[0,4,7],    sfx:''},
    'm':    {iv:[0,3,7],    sfx:'m'},
    'dim':  {iv:[0,3,6],    sfx:'°'},
    'aug':  {iv:[0,4,8],    sfx:'+'},
    'maj7': {iv:[0,4,7,11], sfx:'maj7'},
    '7':    {iv:[0,4,7,10], sfx:'7'},
    'm7':   {iv:[0,3,7,10], sfx:'m7'},
    'm7b5': {iv:[0,3,6,10], sfx:'m7♭5'},
    'dim7': {iv:[0,3,6,9],  sfx:'°7'},
    'mM7':  {iv:[0,3,7,11], sfx:'m(maj7)'},
    'augM7':{iv:[0,4,8,11], sfx:'+maj7'}
  };

  /** Utilise les bémols si la gamme majeure parente est F, B♭, E♭, A♭, D♭ ou G♭. */
  function useFlats(key, mode) {
    var p = (key - MODES[mode].parent + 12) % 12;
    return [5,10,3,8,1,6].indexOf(p) !== -1;
  }
  function noteName(pc, flats) { return (flats ? FLAT : SHARP)[((pc % 12) + 12) % 12]; }

  /** Retrouve la clé de qualité à partir d'une liste d'intervalles. */
  function qualityFromIv(iv) {
    var s = iv.join(',');
    for (var k in QUAL) if (QUAL[k].iv.join(',') === s) return k;
    return null;
  }

  /** Accord diatonique construit sur le degré d (0-6), par empilement de tierces. */
  function diatonic(key, mode, d, size) {
    var st = MODES[mode].steps, iv = [];
    for (var i = 0; i < size; i++) {
      var idx = d + i * 2, oct = Math.floor(idx / 7);
      iv.push(st[idx % 7] + 12 * oct - st[d]);
    }
    return {root: (key + st[d]) % 12, q: qualityFromIv(iv) || (size === 3 ? 'M' : '7')};
  }

  var ROMAN = ['I','II','III','IV','V','VI','VII'];
  /** Chiffrage romain relatif à la tonique (référence : gamme majeure). */
  function roman(key, root, q, mode) {
    var semi = (root - key + 12) % 12, deg = MAJOR.indexOf(semi), acc = '';
    if (semi === 6 && mode !== 'locrian') { deg = 3; acc = '♯'; } // ♯IV (lydien) plutôt que ♭V
    else if (deg === -1) { deg = MAJOR.indexOf(semi + 1); acc = '♭'; }
    var minorish = /^(m|dim|m7|m7b5|dim7|mM7)$/.test(q);
    var r = ROMAN[deg]; if (minorish) r = r.toLowerCase();
    var tail = {M:'',m:'',dim:'°',aug:'+',maj7:'maj7','7':'7',m7:'7',m7b5:'ø7',dim7:'°7',mM7:'(maj7)',augM7:'+maj7'}[q];
    return acc + r + tail;
  }

  function chordName(root, q, flats) { return noteName(root, flats) + QUAL[q].sfx; }

  /** Notes MIDI d'un accord : voix centrée autour de C3–B4 + basse une octave dessous. */
  function voicing(root, q) {
    var base = 48 + root; if (base >= 55) base -= 12;
    var notes = QUAL[q].iv.map(function (i) { return base + i; });
    return {bass: base - 12, notes: notes};
  }

  g.Theory = {MODES:MODES, QUAL:QUAL, useFlats:useFlats, noteName:noteName,
    diatonic:diatonic, roman:roman, chordName:chordName, voicing:voicing};
})(typeof window !== "undefined" ? window : globalThis);
