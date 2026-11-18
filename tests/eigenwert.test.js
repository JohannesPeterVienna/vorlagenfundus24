'use strict';
// Unit-Tests für Fristentabelle (Daten, Suche, CSV, Auswahl-Link), Rechenbeispiele und den teilbaren
// Link des Fristenrechners. Start: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'docs', 'assets', 'js');
const F = require(path.join(JS, 'fristen.js'));
const T = require(path.join(JS, 'tabelle.js'));
const FT = require(path.join(ROOT, 'docs', 'assets', 'data', 'feiertage.json'));
const DATEN = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'daten', 'fristen.json'), 'utf8'));
const BEISPIELE = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'daten', 'beispiele.json'), 'utf8'));

function ladeBrief() {
  const win = { addEventListener() {}, matchMedia: () => ({ matches: false }) };
  const doc = { querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ setAttribute() {}, appendChild() {} }), body: { appendChild() {} } };
  const ctx = { window: win, document: doc, self: win, navigator: {}, fetch: () => new Promise(() => {}), localStorage: { setItem() {}, removeItem() {}, getItem: () => null }, console, Date, Math, JSON, String, Number, Array, Object, RegExp, Error, TextEncoder };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(JS, 'fristen.js'), 'utf8'), ctx);
  win.VFFristen = ctx.VFFristen || ctx.self.VFFristen;
  vm.runInContext(fs.readFileSync(path.join(JS, 'brief.js'), 'utf8'), ctx);
  win.VFBrief.setzeFeiertage(FT);
  return win.VFBrief;
}
const B = ladeBrief();

test('Fristentabelle: Pflichtfelder, eindeutige IDs, nur amtliche Quellen je Land', () => {
  const host = { AT: /^https:\/\/(www\.)?ris\.bka\.gv\.at\/eli\//, DE: /^https:\/\/www\.gesetze-im-internet\.de\/[a-z0-9_]+\/__[0-9a-z]+\.html$/, CH: /^https:\/\/www\.fedlex\.admin\.ch\/eli\/cc\// };
  const ids = new Set();
  assert.match(DATEN.abruf, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(DATEN.fristen.length >= 80);
  for (const f of DATEN.fristen) {
    for (const k of ['id', 'land', 'bereich', 'titel', 'frist', 'beginn', 'norm', 'url', 'fassung']) assert.ok(typeof f[k] === 'string' && f[k].trim(), f.id + ': ' + k + ' fehlt');
    assert.ok(!ids.has(f.id), 'doppelte ID ' + f.id); ids.add(f.id);
    assert.match(f.id, /^[a-z0-9-]+$/);
    assert.ok(host[f.land], f.id + ': Land unbekannt');
    assert.match(f.url, host[f.land], f.id + ': Quelle passt nicht zum Land');
    assert.ok(f.id.startsWith(f.land.toLowerCase() + '-'), f.id + ': ID und Land passen nicht');
    assert.match(f.norm, f.land === 'CH' ? /^Art\. / : /^§ /, f.id + ': Fundstelle ohne Paragraf/Artikel');
    if (f.rechner) {
      assert.ok(Number.isInteger(f.rechner.n) && f.rechner.n >= 1 && f.rechner.n <= 3650);
      assert.ok(['tage', 'wochen', 'monate', 'jahre'].includes(f.rechner.u));
      assert.ok(f.rechner.v === 0 || f.rechner.v === 1);
    }
    if (f.seite) assert.ok(fs.existsSync(path.join(ROOT, 'build', 'content', f.seite.replace(/\//g, '') + '.html')), f.id + ': Seite fehlt ' + f.seite);
  }
});

test('Fristentabelle: Rechner-Links werden vom Fristenrechner vollständig verstanden', () => {
  for (const f of DATEN.fristen.filter(x => x.rechner)) {
    const w = B.linkWerteLesen(`#land=${f.land}&n=${f.rechner.n}&u=${f.rechner.u}&v=${f.rechner.v}`);
    assert.deepEqual(JSON.parse(JSON.stringify(w)), { land: f.land, n: f.rechner.n, u: f.rechner.u, v: f.rechner.v === 1 }, f.id);
  }
});

test('Rechenbeispiele: jedes Datum stimmt mit dem Rechenkern überein', () => {
  assert.ok(BEISPIELE.length >= 9);
  for (const b of BEISPIELE) {
    const args = Array.isArray(b.args) ? b.args : [Object.assign({ feiertage: FT }, b.args)];
    const r = F[b.funktion].apply(null, args);
    if (typeof b.erwartet === 'string') assert.equal(r, b.erwartet, b.id);
    else for (const k of Object.keys(b.erwartet)) assert.equal(r[k], b.erwartet[k], b.id + ': ' + k);
    for (const [k] of b.punkte) {
      if (k.startsWith('=')) { F.parse(k.slice(1)); continue; }
      const v = (typeof b.erwartet === 'object' && b.erwartet[k]) || b.args[k];
      assert.match(String(v), /^\d{4}-\d{2}-\d{2}$/, b.id + ': Punkt ' + k);
    }
  }
});

test('Rechenbeispiele: fest genannte Zwischentage sind wirklich frei bzw. Stichtage', () => {
  const frei = (d, land) => F.shiftToWorkday(F.parse(d), land, FT, null).verschoben.length > 0;
  assert.ok(frei('2027-01-01', 'DE') && frei('2026-12-25', 'DE') && frei('2026-12-26', 'DE') && frei('2026-12-27', 'DE') && frei('2027-05-02', 'DE'));
  assert.equal(F.iso(F.nthWerktag(2027, 0, 3, 'DE', FT, true)), '2027-01-05');
  assert.equal(F.mietKuendigung({ land: 'DE', variante: 'standard', zugang: '2027-01-07', feiertage: FT }).termin, '2027-04-30');
  assert.equal(F.spaetesterZugangFuerTermin('2027-06-30', 1), '2027-05-31');
  assert.equal(F.vereinAustrittCH({ zugang: '2027-06-30' }).austritt, '2027-12-31');
});

test('Tabelle: Suche ist UND-verknüpft, kennt Umlaute und Paragrafenzeichen', () => {
  assert.ok(T.passt('Kündigung § 573c Abs. 1 BGB', 'kuendigung 573c'));
  assert.ok(T.passt('Bußgeldbescheid', 'bussgeld'));
  assert.ok(!T.passt('Widerruf 14 Tage', 'widerruf monat'));
  assert.ok(T.passt('irgendwas', ''));
});

test('Tabelle: CSV entschärft Formeln und maskiert Anführungszeichen', () => {
  for (const s of ['=1+1', '+49 30', '-2', '@SUM(A1)', '\tx', '\rx']) assert.ok(T.csvZelle(s).startsWith('"\''), s);
  assert.equal(T.csvZelle('a"b;c'), '"a""b;c"');
  assert.equal(T.csvZelle('Zeile\nzwei'), '"Zeile zwei"');
  assert.equal(T.csvZelle('§ 573c'), '"§ 573c"');
  const c = T.csv([['a', '=b'], ['c', 'd']]);
  assert.ok(c.startsWith('﻿"a";"\'=b"\r\n'));
});

test('Tabelle: Auswahl-Link nimmt nur bekannte Länder und Bereiche an', () => {
  const ber = ['Kauf', 'Wohnen', 'Behörde und Gericht'];
  assert.deepEqual(T.auswahlLesen('#land=AT,DE,XX,AT&bereich=Kauf', ber), { laender: ['AT', 'DE'], bereich: 'Kauf' });
  assert.deepEqual(T.auswahlLesen('#bereich=%3Cscript%3E&land=<img>', ber), { laender: [], bereich: '' });
  assert.deepEqual(T.auswahlLesen('#f-de-bgb-355', ber), { laender: [], bereich: '' });
  assert.deepEqual(T.auswahlLesen('#bereich=%E0%A4%A', ber), { laender: [], bereich: '' });
  assert.equal(T.auswahlSchreiben({ laender: ['AT'], bereich: 'Behörde und Gericht' }), '#land=AT&bereich=Beh%C3%B6rde%20und%20Gericht');
  assert.equal(T.auswahlSchreiben({ laender: ['AT', 'DE', 'CH'], bereich: '' }), '');
  assert.deepEqual(T.auswahlLesen(T.auswahlSchreiben({ laender: ['CH'], bereich: 'Wohnen' }), ber), { laender: ['CH'], bereich: 'Wohnen' });
});

test('Fristenrechner-Link: hin und zurück, Unsinn wird verworfen', () => {
  const w = { land: 'DE', e: '2026-12-11', n: 14, u: 'tage', v: true, opt: ['fronleichnam'], x: ['2026-12-24'] };
  assert.deepEqual(JSON.parse(JSON.stringify(B.linkWerteLesen(B.linkWerteSchreiben(w)))), w);
  assert.equal(B.linkWerteLesen('#wz-titel'), null);
  assert.equal(B.linkWerteLesen(''), null);
  assert.equal(B.linkWerteLesen('#land=<script>alert(1)</script>&e=2026-02-30&n=99999&u=jahrhunderte&v=2'), null);
  assert.equal(B.linkWerteLesen('#e=%E0%A4%A'), null);
  assert.equal(B.linkWerteLesen('#land=AT&' + 'x='.padEnd(700, '1')), null);
  const teil = JSON.parse(JSON.stringify(B.linkWerteLesen('#land=CH&e=javascript:alert(1)&n=-5&opt=<b>,auffahrt&x=2026-13-01,2026-12-24&name=Erika')));
  assert.deepEqual(teil, { land: 'CH', opt: ['auffahrt'], x: ['2026-12-24'] });
});

test('Rechenweg: nennt Vorschrift, fehlenden Monatstag und jeden übersprungenen Tag', () => {
  const r1 = F.fristEnde({ ereignis: '2026-12-11', anzahl: 14, einheit: 'tage', land: 'DE', feiertage: FT });
  const w1 = B.rechenweg(r1, { land: 'DE', e: '2026-12-11', n: 14, u: 'tage', v: true });
  assert.match(w1[0], /§ 187 Abs\. 1 BGB/);
  assert.match(w1[1], /Tag 1 ist Samstag, 12\. Dezember 2026; Tag 14 ist Freitag, 25\. Dezember 2026/);
  assert.equal(w1.filter(z => /ist kein Werktag/.test(z)).length, 3);
  assert.match(w1[w1.length - 1], /Montag, 28\. Dezember 2026 \(§ 193 BGB\)/);
  const r2 = F.fristEnde({ ereignis: '2027-01-31', anzahl: 1, einheit: 'monate', verschieben: false });
  const w2 = B.rechenweg(r2, { land: 'AT', e: '2027-01-31', n: 1, u: 'monate', v: false });
  assert.match(w2[1], /Den 31\. gibt es im Zielmonat nicht.*28\. Februar 2027 \(§ 902 Abs\. 2 ABGB\)/);
  assert.match(w2[2], /Verschiebung ausgeschaltet/);
});
