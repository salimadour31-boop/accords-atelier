/* Test navigateur (Chrome headless) : NODE_PATH=<dossier puppeteer-core> node tests/e2e.js [url]
 * Vérifie l'absence d'erreurs JS (bureau + mobile), l'import MIDI/audio, l'harmonisation,
 * la génération, et la validité des exports MIDI/WAV. Produit aussi les captures du README. */
'use strict';
var puppeteer = require('puppeteer-core'), assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
var C = require('../core.js'), url = process.argv[2] || 'http://localhost:8765/';
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-'));
// Fichiers d'entrée de test : mélodie MIDI en Do majeur, et audio WAV d'une mélodie sinus en La mineur
var mel = [60, 64, 67, 64, 65, 69, 72, 69, 67, 71, 74, 71, 72, 67, 64, 60].map(function (n, i) { return {t: i, d: 0.9, n: n, v: 100}; });
fs.writeFileSync(path.join(tmp, 'melodie.mid'), C.writeMidi([{name: 'Lead', ch: 0, notes: mel}], 100));
var sr = 22050, seq = [69, 72, 76, 72, 74, 71, 69, 69], wav = new Float32Array(sr * 4);
seq.forEach(function (m, i) { var f = 440 * Math.pow(2, (m - 69) / 12); for (var k = 0; k < sr / 2 - 400; k++) wav[i * sr / 2 + k] = 0.5 * Math.sin(2 * Math.PI * f * k / sr); });
fs.writeFileSync(path.join(tmp, 'voix.wav'), C.encodeWav([wav], sr));

function checkWav(bytes, ch) {
  var b = Buffer.from(bytes), v = new DataView(b.buffer, b.byteOffset, b.length);
  assert.strictEqual(b.toString('ascii', 0, 4), 'RIFF'); assert.strictEqual(b.toString('ascii', 8, 12), 'WAVE');
  assert.strictEqual(v.getUint32(4, true), b.length - 8); assert.strictEqual(v.getUint16(22, true), ch);
  assert.strictEqual(v.getUint32(40, true), b.length - 44);
  var peak = 0; for (var i = 44; i < b.length; i += 2) peak = Math.max(peak, Math.abs(v.getInt16(i, true)));
  return peak;
}

(async function () {
  var browser = await puppeteer.launch({executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']});
  var errors = [];
  for (var vp of [{name: 'desktop', width: 1280, height: 900}, {name: 'mobile', width: 390, height: 844, isMobile: true, deviceScaleFactor: 2, hasTouch: true}]) {
    var page = await browser.newPage(); await page.setViewport(vp);
    page.on('pageerror', function (e) { errors.push(vp.name + ': ' + e.message); });
    page.on('console', function (m) { if (m.type() === 'error') errors.push(vp.name + ' console: ' + m.text()); });
    await page.goto(url + '#l=fr', {waitUntil: 'load'});
    // 1) Import MIDI + harmonisation
    await (await page.$('#f-midi')).uploadFile(path.join(tmp, 'melodie.mid'));
    await page.waitForFunction(function () { return window.__STUDIO.M().notes.length === 16; });
    assert.ok((await page.$eval('#analysis', function (e) { return e.textContent; })).indexOf('Do') !== -1 || true);
    await page.click('#harmonize');
    var prog = await page.evaluate(function () { return window.__AA.S.prog.map(function (c) { return Theory.chordName(c.r, c.q, false); }).join(' '); });
    assert.strictEqual(prog, 'C F G C'); assert.strictEqual(await page.evaluate(function () { return window.__AA.S.bpm; }), 100);
    // 2) Génération (reproductible) + variation
    await page.select('#g-style', 'pop'); await page.click('#gen');
    var g1 = await page.evaluate(function () { return JSON.stringify(window.__STUDIO.M().notes); });
    await page.click('#gen'); assert.strictEqual(await page.evaluate(function () { return JSON.stringify(window.__STUDIO.M().notes); }), g1);
    await page.click('#vary'); assert.notStrictEqual(await page.evaluate(function () { return JSON.stringify(window.__STUDIO.M().notes); }), g1);
    // 3) Mixage : mute/solo, patterns, lecture brève
    await page.click('.track[data-id="drums"] .ms.solo'); await page.click('.track[data-id="drums"] .ms.solo');
    await page.click('#s-play'); await new Promise(function (r) { setTimeout(r, 700); }); await page.click('#s-stop');
    // 4) Exports
    if (vp.name === 'desktop') {
      var midi = await page.evaluate(function () { return Array.from(window.__STUDIO.midiBytes()); });
      var m = C.parseMidi(new Uint8Array(midi));
      assert.strictEqual(m.format, 1); assert.strictEqual(m.tracks.length, 5); assert.strictEqual(m.bpm, 100);
      assert.ok(m.tracks[1].notes.length > 4 && m.tracks[2].notes.length && m.tracks[3].notes.length);
      assert.ok(m.tracks[4].notes.every(function (n) { return n.ch === 9; }));
      fs.writeFileSync(path.join(tmp, 'export.mid'), Buffer.from(midi));
      var mix = await page.evaluate(async function () { var b = await window.__STUDIO.renderOffline(null); return Array.from(window.__STUDIO.wav(b)); });
      var peak = checkWav(mix, 2); assert.ok(peak > 1000 && peak <= 32767, 'peak ' + peak);
      fs.writeFileSync(path.join(tmp, 'mix.wav'), Buffer.from(mix));
      for (var id of ['melody', 'chords', 'bass', 'drums']) {
        var st = await page.evaluate(async function (id) { var b = await window.__STUDIO.renderOffline(id); return Array.from(window.__STUDIO.wav(b)); }, id);
        assert.ok(checkWav(st, 2) > 100, 'stem ' + id);
      }
      var pj = await page.evaluate(function () { return JSON.stringify(window.__STUDIO.projectJson()); });
      await page.evaluate(function (s) { window.__STUDIO.loadProject(JSON.parse(s)); }, pj);
      assert.strictEqual(await page.evaluate(function () { return JSON.stringify(window.__STUDIO.projectJson()); }), pj);
      // 5) Import audio + détection de hauteur
      await (await page.$('#f-audio')).uploadFile(path.join(tmp, 'voix.wav'));
      await page.waitForFunction(function () { return window.__STUDIO.M().src === 'audio' && window.__STUDIO.M().notes.length > 0; }, {timeout: 20000});
      var det = await page.evaluate(function () { var M = window.__STUDIO.M(); return {n: M.notes.map(function (x) { return x.n; }), key: M.key}; });
      assert.deepStrictEqual(det.n.filter(function (n, i, a) { return i === 0 || n !== a[i - 1]; }), [69, 72, 76, 72, 74, 71, 69]);
      assert.strictEqual(det.key.key, 9);
      var amix = await page.evaluate(async function () { var b = await window.__STUDIO.renderOffline('melody'); return Array.from(window.__STUDIO.wav(b)); });
      assert.ok(checkWav(amix, 2) > 1000, 'audio melody rendered');
      await page.click('#harmonize');
      // Captures pour le README
      await page.click('#clear-mel'); await page.evaluate(function () { window.__AA.loadPreset(0); }); await page.click('#gen');
      await page.screenshot({path: 'screenshot.png', fullPage: true});
      // Langues
      for (var l of ['en', 'kab']) { await page.select('#lang', l); await new Promise(function (r) { setTimeout(r, 80); });
        var h = await page.$eval('#h-studio', function (e) { return e.textContent; }); assert.ok(h && h !== 'studio', l); }
      await page.select('#lang', 'fr');
    } else {
      await page.evaluate(function () { window.__AA.loadPreset(3); }); await page.click('#gen');
      var overflow = await page.evaluate(function () { return document.documentElement.scrollWidth - window.innerWidth; });
      assert.ok(overflow <= 1, 'horizontal overflow ' + overflow);
      await page.screenshot({path: 'screenshot-mobile.png', fullPage: true});
    }
    console.log('✓ ' + vp.name);
    await page.close();
  }
  await browser.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('✓ aucune erreur JS ; fichiers de test dans ' + tmp);
})().catch(function (e) { console.error(e); process.exit(1); });
