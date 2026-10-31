'use strict';
// Unit-Tests für Brieftext, Vorschau und Export-Daten (gleiche Regeln wie die Fristanzeige). Start: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const JS = path.join(__dirname, '..', 'docs', 'assets', 'js');
const FT = require(path.join(__dirname, '..', 'docs', 'assets', 'data', 'feiertage.json'));

function lade() {
  const win = { addEventListener() {}, matchMedia: () => ({ matches: false }) };
  const doc = { querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ setAttribute() {}, appendChild() {} }), body: { appendChild() {} } };
  const ctx = { window: win, document: doc, self: win, navigator: {}, fetch: () => new Promise(() => {}), localStorage: { setItem() {}, removeItem() {}, getItem: () => null }, console, Date, Math, JSON, String, Number, Array, Object, RegExp, Error, TextEncoder, Uint8Array, Blob: function () {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(JS, 'fristen.js'), 'utf8'), ctx);
  win.VFFristen = ctx.VFFristen || ctx.self.VFFristen;
  vm.runInContext(fs.readFileSync(path.join(JS, 'brief.js'), 'utf8'), ctx);
  win.VFBrief.setzeFeiertage(FT);
  return win.VFBrief;
}
const B = lade();
const text = b => [b.sperre || '', b.betreff].concat(b.absaetze).join('\n');

test('AT befristet, erstes Jahr läuft: kein Satz „abgelaufen“, Entwurf mit frühestem Zugang', () => {
  const b = B.briefDaten('miete-kuendigung', 'AT', { variante_AT: 'befristet', mietbeginn: '2026-01-01', zugang: '2026-10-31', objekt: 'Testgasse 1' });
  assert.equal(b.fr.jahrStatus, 'laeuft');
  assert.ok(!/abgelaufen/.test(b.absaetze.join(' ')), 'Brief behauptet Ablauf des ersten Jahres');
  assert.match(b.sperre, /ENTWURF – erst ab 1\. Jänner 2027 verwendbar/);
  const html = B.blattHtml(b);
  assert.ok(html.includes('class="sperre"'), 'Vorschau/Druck ohne Sperrhinweis');
  assert.ok(B.fristenHtml('miete-kuendigung', 'AT', b.fr).includes('noch nicht abgelaufen'));
});
test('AT befristet, erstes Jahr abgelaufen: Ablaufdatum aus der Prüfung im Brief, kein Sperrhinweis', () => {
  const b = B.briefDaten('miete-kuendigung', 'AT', { variante_AT: 'befristet', mietbeginn: '2025-01-01', zugang: '2026-11-03' });
  assert.equal(b.sperre, null);
  assert.ok(b.absaetze.join(' ').includes('mit 31. Dezember 2025 abgelaufen'));
});
test('AT befristet ohne Mietbeginn: nicht versandfertig', () => {
  const b = B.briefDaten('miete-kuendigung', 'AT', { variante_AT: 'befristet', zugang: '2026-11-03' });
  assert.match(b.sperre, /nicht versandfertig/);
  assert.ok(!/abgelaufen/.test(b.absaetze.join(' ')));
});
test('AT unbefristet: kein Sperrhinweis, keine § 29-Behauptung', () => {
  const b = B.briefDaten('miete-kuendigung', 'AT', { variante_AT: 'unbefristet-monatlich', zugang: '2026-11-03' });
  assert.equal(b.sperre, null);
  assert.ok(!/§ 29/.test(text(b)));
});
test('DE Mietbrief: Landesfeiertag aus dem Assistenten verändert Termin in Frist und Brief', () => {
  const ohne = B.briefDaten('miete-kuendigung', 'DE', { variante_DE: 'standard', zugang: '2027-11-04' });
  const mit = B.briefDaten('miete-kuendigung', 'DE', { variante_DE: 'standard', zugang: '2027-11-04', feiertage_DE: 'allerheiligen' });
  assert.equal(ohne.fr.termin, '2028-02-29');
  assert.equal(mit.fr.termin, '2028-01-31');
  assert.ok(mit.absaetze[0].includes('31. Januar 2028'));
});
test('CH Familienwohnung, alleinige Mieterin: Zustimmungs-Unterschrift in Vorschau und Export-Daten', () => {
  const b = B.briefDaten('miete-kuendigung', 'CH', { variante_CH: 'ortsueblich', termine_CH: '3,6,9', zugang: '2026-11-03', familie_CH: true });
  assert.equal(b.unterschriften, 2);
  assert.equal(b.unterschriftZeilen.length, 1);
  assert.match(b.unterschriftZeilen[0], /Art\. 266m OR/);
  assert.ok(B.blattHtml(b).includes('weitere-unterschrift'));
  const zwei = B.briefDaten('miete-kuendigung', 'CH', { variante_CH: 'ortsueblich', termine_CH: '3,6,9', zugang: '2026-11-03', familie_CH: true, mitmieter: 'Max Muster' });
  assert.equal(zwei.unterschriftZeilen.length, 2);
  const keine = B.briefDaten('miete-kuendigung', 'CH', { variante_CH: 'ortsueblich', termine_CH: '3,6,9', zugang: '2026-11-03' });
  assert.equal(keine.unterschriftZeilen.length, 0);
});
test('Reklamation DE: Anzeige heißt Grundfrist bzw. zeigt Ablaufhemmung, nie „endet“', () => {
  const b = B.briefDaten('reklamation', 'DE', { uebergabe: '2024-11-04', entdeckt: '2026-10-15', fristTage: '14' });
  const h = B.fristenHtml('reklamation', 'DE', b.fr);
  assert.ok(h.includes('15. Februar 2027'), h);
  assert.ok(h.includes('Grundfrist'));
  assert.ok(!/Gewährleistungsfrist endet/.test(h));
  assert.ok(h.includes('Kein endgültiges Ende'));
});
test('Reklamation AT: Verlängerung nach Verbesserung wird angezeigt', () => {
  const b = B.briefDaten('reklamation', 'AT', { uebergabe: '2026-10-05', vertrag: '2026-10-02', nachbesserung: true, fristTage: '14' });
  const h = B.fristenHtml('reklamation', 'AT', b.fr);
  assert.ok(h.includes('5. Oktober 2029') && h.includes('§ 10 Abs. 2a VGG'), h);
});
