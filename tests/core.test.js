/* Tests unitaires du noyau : node tests/core.test.js */
'use strict';
var assert = require('assert'), C = require('../core.js'), T = globalThis.Theory;
var ok = 0; function test(name, fn) { fn(); ok++; console.log('✓ ' + name); }
function mel(seq, dur) { var t = 0; return seq.map(function (n) { var o = {t: t, d: dur || 1, n: n, v: 96}; t += dur || 1; return o; }); }

test('writeMidi -> parseMidi aller-retour (format 1, multipiste)', function () {
  var notes = mel([60, 62, 64, 65, 67], 0.5);
  var bytes = C.writeMidi([{name: 'Lead', ch: 0, program: 80, notes: notes}, {name: 'Drums', ch: 9, notes: [{t: 0, d: 0.25, n: 36, v: 110}]}], 100);
  assert.strictEqual(String.fromCharCode.apply(null, bytes.slice(0, 4)), 'MThd');
  var m = C.parseMidi(bytes);
  assert.strictEqual(m.format, 1); assert.strictEqual(m.tracks.length, 3); assert.strictEqual(m.bpm, 100);
  assert.strictEqual(m.tracks[1].name, 'Lead');
  assert.deepStrictEqual(m.tracks[1].notes.map(function (n) { return n.n; }), [60, 62, 64, 65, 67]);
  assert.ok(Math.abs(m.tracks[1].notes[2].t - 1) < 1e-9);
  assert.strictEqual(m.tracks[2].notes[0].ch, 9);
  assert.strictEqual(C.pickMelodyTrack(m), 1);
});
test('parseMidi : running status, note-on vélocité 0, sysex, format 0', function () {
  var trk = [0, 0xf0, 2, 0x7e, 0xf7, 0, 0x90, 60, 100, 96, 60, 0, 0, 62, 90, 0x83, 0x60, 62, 0, 0, 0xff, 0x2f, 0];
  var L = trk.length, f = [0x4d,0x54,0x68,0x64,0,0,0,6,0,0,0,1,0,96,0x4d,0x54,0x72,0x6b,0,0,0,L].concat(trk);
  var m = C.parseMidi(new Uint8Array(f));
  assert.strictEqual(m.bpm, 120); assert.strictEqual(m.tracks[0].notes.length, 2);
  assert.strictEqual(m.tracks[0].notes[0].d, 1); assert.strictEqual(m.tracks[0].notes[1].d, 5);
  assert.throws(function () { C.parseMidi(new Uint8Array([1, 2, 3])); });
});
test('detectKey : Do majeur, La mineur, Ré dorien', function () {
  var cmaj = mel([60, 64, 67, 65, 64, 62, 60, 67, 69, 67, 65, 64, 62, 59, 60]);
  var r = C.detectKey(cmaj); assert.strictEqual(r.key, 0); assert.strictEqual(r.mode, 'ionian');
  var amin = mel([69, 72, 76, 74, 72, 71, 69, 64, 65, 64, 62, 60, 59, 68, 69]);
  r = C.detectKey(amin); assert.strictEqual(r.key, 9); assert.ok(r.mode === 'aeolian' || r.mode === 'harmonic', r.mode);
  var ddor = mel([62, 65, 69, 71, 69, 65, 62, 71, 72, 71, 69, 65, 64, 62, 62]);
  r = C.detectKey(ddor, ['ionian', 'aeolian', 'dorian']); assert.strictEqual(r.key, 2); assert.strictEqual(r.mode, 'dorian');
});
test('harmonize : épouse les notes de chaque mesure et finit sur la tonique', function () {
  // mesure 1 : C E G ; 2 : F A C ; 3 : G B D ; 4 : C E G
  var m = mel([60, 64, 67, 64, 65, 69, 72, 69, 67, 71, 74, 71, 72, 67, 64, 60]);
  var p = C.harmonize(m, 0, 'ionian', {beats: 4, size: 3});
  assert.deepStrictEqual(p.map(function (c) { return T.chordName(c.r, c.q, false); }), ['C', 'F', 'G', 'C']);
  var p7 = C.harmonize(m, 0, 'ionian', {beats: 4, size: 4});
  assert.strictEqual(p7.length, 4); assert.strictEqual(p7[2].q, '7');
});
test('generateMelody : reproductible, dans la tessiture, notes de l’accord sur temps forts', function () {
  var prog = [0, 5, 3, 4].map(function (d) { var c = T.diatonic(0, 'ionian', d, 3); return {r: c.root, q: c.q}; });
  ['lyrical', 'pop', 'arp'].forEach(function (style) {
    ['sparse', 'medium', 'dense'].forEach(function (density) {
      var o = {seed: 42, style: style, density: density, range: 'mid', beats: 4};
      var a = C.generateMelody(prog, 0, 'ionian', o), b = C.generateMelody(prog, 0, 'ionian', o);
      assert.deepStrictEqual(a, b); assert.ok(a.length >= 4);
      a.forEach(function (n) {
        assert.ok(n.n >= 60 && n.n <= 77, 'range ' + n.n); assert.ok(n.t >= 0 && n.t < 16);
        if (n.t % 2 === 0) assert.ok(C.chordPcs(prog[Math.floor(n.t / 4)]).indexOf(n.n % 12) !== -1, style + ' strong beat ' + n.t);
        assert.ok(C.scalePcs(0, 'ionian').indexOf(n.n % 12) !== -1);
      });
    });
  });
  var c1 = C.generateMelody(prog, 0, 'ionian', {seed: 1}), c2 = C.generateMelody(prog, 0, 'ionian', {seed: 2});
  assert.notDeepStrictEqual(c1, c2);
  assert.ok(C.chordPcs(prog[3]).indexOf(c1[c1.length - 1].n % 12) !== -1); // finit sur une note de G
  var c3 = C.generateMelody(prog.concat([prog[0]]), 0, 'ionian', {seed: 5}); assert.strictEqual(c3[c3.length - 1].n % 12, 0); // tonique si accord final = I
});
test('varyMelody : reproductible et diatonique', function () {
  var m = mel([60, 64, 67, 72, 71, 67, 65, 62]);
  var a = C.varyMelody(m, 0, 'ionian', {seed: 3}), b = C.varyMelody(m, 0, 'ionian', {seed: 3});
  assert.deepStrictEqual(a, b); assert.notDeepStrictEqual(a, m);
  a.forEach(function (n) { assert.ok(C.scalePcs(0, 'ionian').indexOf(n.n % 12) !== -1); });
});
test('basse, batterie et accords', function () {
  var prog = [{r: 0, q: 'M'}, {r: 7, q: '7'}];
  ['root', 'pulse', 'walk', 'octave'].forEach(function (s) {
    var b = C.generateBass(prog, {style: s}); assert.ok(b.length); assert.strictEqual(b[0].n % 12, 0); assert.ok(b[0].n < 48);
  });
  var d = C.generateDrums(2, 'pop'); assert.ok(d.filter(function (n) { return n.n === 36; }).length === 6);
  assert.strictEqual(C.chordNotes(prog).length, 7);
});
test('YIN et transcription audio (sinusoïdes synthétiques)', function () {
  var sr = 22050, seq = [57, 60, 64, 69], data = new Float32Array(sr * 2);
  seq.forEach(function (m, i) { var f = 440 * Math.pow(2, (m - 69) / 12); for (var k = 0; k < sr / 2; k++) data[i * sr / 2 + k] = 0.5 * Math.sin(2 * Math.PI * f * k / sr) + 0.2 * Math.sin(4 * Math.PI * f * k / sr); });
  var hz = C.yin(data.subarray(0, 2048), sr); assert.ok(Math.abs(hz - 220) < 2, hz);
  var notes = C.detectPitches(data, sr);
  assert.deepStrictEqual(notes.map(function (n) { return n.n; }), seq);
  var b = C.secondsToBeats(notes, 120, 0, 0.25); assert.ok(Math.abs(b[1].t - 1) <= 0.25);
});
test('estimateBpm sur un clic à 100 BPM', function () {
  var sr = 22050, data = new Float32Array(sr * 10), per = Math.round(sr * 0.6);
  for (var p = 0; p < data.length; p += per) for (var k = 0; k < 300 && p + k < data.length; k++) data[p + k] = Math.exp(-k / 60) * (k % 2 ? 1 : -1);
  var b = C.estimateBpm(data, sr); assert.ok(Math.abs(b - 100) <= 2, b);
});
test('encodeWav : en-tête RIFF valide', function () {
  var w = C.encodeWav([new Float32Array([0, 0.5, -0.5, 1]), new Float32Array(4)], 44100), v = new DataView(w.buffer);
  assert.strictEqual(String.fromCharCode.apply(null, w.slice(0, 4)), 'RIFF');
  assert.strictEqual(v.getUint32(4, true), w.length - 8); assert.strictEqual(v.getUint16(22, true), 2);
  assert.strictEqual(v.getUint32(24, true), 44100); assert.strictEqual(v.getUint32(40, true), 16);
  assert.strictEqual(v.getInt16(48, true), 16383);
});
console.log('\n' + ok + ' tests OK');
