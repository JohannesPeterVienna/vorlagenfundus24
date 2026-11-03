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

// ---- Codex-Befunde VF01–VF03 (3.11.2026) ----
test('VF01: Mietkündigung CH ohne Ortsgebrauch und ohne Mietbeginn ist nicht versandfertig', () => {
  const b = B.briefDaten('miete-kuendigung', 'CH', { variante_CH: 'mietdauer', zugang: '2026-11-03', datum: '2026-11-03' });
  assert.ok(b.fr.fehler && /Mietbeginn fehlt/.test(b.fr.fehler));
  assert.match(b.sperre || '', /ENTWURF – nicht versandfertig: Mietbeginn fehlt/);
  assert.ok(!/2\. März 2027/.test(text(b)));
  assert.ok(B.blattHtml(b).includes('class="sperre"'));
  const mit = B.briefDaten('miete-kuendigung', 'CH', { variante_CH: 'mietdauer', zugang: '2026-11-03', datum: '2026-11-03', mietbeginn: '2025-01-01' });
  assert.equal(mit.sperre, null);
  assert.ok(text(mit).includes('31. März 2027'));
});
test('VF02: Frist im Schreiben hängt am Datum des Schreibens (Kaution DE)', () => {
  const a = B.briefDaten('kaution', 'DE', { datum: '2026-11-03', fristTage: '14' });
  assert.equal(a.fr.zugangAnnahme, '2026-11-06');
  assert.equal(a.fr.ende, '2026-11-20');
  assert.ok(text(a).includes('bis 20. November 2026'));
  const b = B.briefDaten('kaution', 'DE', { datum: '2026-12-15', fristTage: '14' });
  // 15.12. + 3 Tage = 18.12.; + 14 Tage = 1.1.2027 (Neujahr, Freitag) → Montag 4.1.2027 (§ 193 BGB)
  assert.equal(b.fr.ende, '2027-01-04');
  assert.ok(text(b).includes('bis 4. Januar 2027'));
  const h = B.fristenHtml('kaution', 'DE', b.fr);
  assert.ok(h.includes('Annahme: Datum des Schreibens 15. Dezember 2026 + 3 Tage Postlaufzeit = Zugang am 18. Dezember 2026'), h);
  // eigene Postlaufzeit
  assert.equal(B.briefDaten('kaution', 'DE', { datum: '2026-11-03', fristTage: '14', postTage: '1' }).fr.ende, '2026-11-18');
});
test('VF02: Mängelanzeige und Reklamation folgen dem Briefdatum; eigenes Fristende vor dem Briefdatum wird abgelehnt', () => {
  assert.equal(B.briefDaten('maengel', 'AT', { datum: '2026-12-15', fristTage: '14' }).fr.ende, '2027-01-04');
  const r = B.briefDaten('reklamation', 'DE', { datum: '2026-12-15', uebergabe: '2026-10-01', fristTage: '14' });
  assert.equal(r.fr.antwortBis, '2027-01-04');
  const eigen = B.briefDaten('kaution', 'DE', { datum: '2026-12-15', fristBis: '2027-01-15' });
  assert.equal(eigen.fr.ende, '2027-01-15');
  assert.equal(eigen.sperre, null);
  const falsch = B.briefDaten('kaution', 'DE', { datum: '2026-12-15', fristBis: '2026-11-20' });
  assert.match(falsch.fr.fehler, /liegt vor dem Datum des Schreibens/);
  assert.match(falsch.sperre, /ENTWURF – nicht versandfertig/);
  assert.ok(text(falsch).includes('[Datum]') && !text(falsch).includes('20. November 2026, '));
  const rf = B.briefDaten('reklamation', 'DE', { datum: '2026-12-15', uebergabe: '2026-10-01', fristBis: '2026-12-01' });
  assert.ok(rf.fr.fristFehler && /ENTWURF/.test(rf.sperre));
  assert.ok(B.fristenHtml('reklamation', 'DE', rf.fr).includes('Grundfrist'), 'Gewährleistung bleibt sichtbar');
});
test('VF02: Wiederherstellen rechnet Fristen nicht still neu', () => {
  const v = { land: 'DE', datum: '2026-11-03', fristTage: '14', postTage: '3', fristBis: '' };
  v.__frist = B.fristKern(B.briefDaten('kaution', 'DE', v).fr);
  assert.equal(v.__frist.ende, '2026-11-20');
  // Später (15.12.) geladen: gleiches Ergebnis, Briefdatum unverändert, aber markiert
  const p = B.wiederherstellPruefung('kaution', 'DE', v, '2026-12-15');
  assert.equal(p.fristBis, null);
  assert.ok(p.hinweise.some(t => /unverändert übernommen/.test(t)), p.hinweise.join('|'));
  // Gespeicherte Frist weicht ab (z. B. alter Stand): gespeicherter Wert bleibt, Hinweis
  const alt = Object.assign({}, v, { __frist: { ende: '2026-11-23' } });
  const q = B.wiederherstellPruefung('kaution', 'DE', alt, '2026-11-03');
  assert.equal(q.fristBis, '2026-11-23');
  assert.ok(q.hinweise.some(t => /Gespeicherte Frist beibehalten: 23\. November 2026/.test(t)));
  // Mietkündigung: Abweichung wird gemeldet
  const m = { land: 'DE', variante_DE: 'standard', zugang: '2026-11-04', datum: '2026-11-03', __frist: { termin: '2027-02-28' } };
  assert.ok(B.wiederherstellPruefung('miete-kuendigung', 'DE', m, '2026-11-03').hinweise.some(t => /Achtung/.test(t)));
});
test('VF03: Feiertagsdaten nicht geladen → kein Datum, Brief nicht versandfertig', () => {
  try {
    B.setzeFeiertage(null);
    const r = B.briefDaten('ruecktritt', 'DE', { erhalt: '2026-03-20' });
    assert.ok(r.fr.fehler && /Feiertagsdaten/.test(r.fr.fehler));
    assert.match(r.sperre, /nicht versandfertig/);
    assert.ok(!B.fristenHtml('ruecktritt', 'DE', r.fr).includes('3. April 2026'));
    const k = B.briefDaten('kaution', 'DE', { datum: '2026-11-03' });
    assert.ok(k.fr.fehler && /ENTWURF/.test(k.sperre));
    const m = B.briefDaten('miete-kuendigung', 'DE', { variante_DE: 'standard', zugang: '2026-11-04' });
    assert.ok(m.fr.fehler && /ENTWURF/.test(m.sperre));
    // AT-Mietkündigung braucht keine Feiertage und bleibt berechenbar
    assert.equal(B.briefDaten('miete-kuendigung', 'AT', { variante_AT: 'unbefristet-monatlich', zugang: '2026-11-04' }).fr.termin, '2026-12-31');
  } finally { B.setzeFeiertage(FT); }
  assert.equal(B.briefDaten('ruecktritt', 'DE', { erhalt: '2026-03-20' }).fr.ende, '2026-04-07');
});
test('Zugang vor dem Datum des Schreibens: Mietkündigung und Vereinsaustritt nicht versandfertig', () => {
  for (const land of ['AT', 'DE', 'CH']) {
    const m = B.briefDaten('miete-kuendigung', land, { variante_AT: 'unbefristet-monatlich', variante_DE: 'standard', variante_CH: 'ortsueblich', termine_CH: '3,6,9', zugang: '2026-11-02', datum: '2026-11-03' });
    assert.ok(m.fr.fehler && /liegt vor dem Datum des Schreibens/.test(m.fr.fehler), land + ': ' + JSON.stringify(m.fr));
    assert.match(m.sperre, /nicht versandfertig/);
    assert.ok(!m.absaetze[0].includes('2027'), 'kein Termin im Brief');
    const v = B.briefDaten('verein-austritt', land, { verein: 'TSV', zugang: '2026-11-02', datum: '2026-11-03' });
    assert.ok(v.fr && /liegt vor dem Datum des Schreibens/.test(v.fr.fehler), land);
    assert.match(v.sperre, /nicht versandfertig/);
  }
  // Zugang am selben Tag oder später bleibt zulässig
  assert.equal(B.briefDaten('miete-kuendigung', 'AT', { variante_AT: 'unbefristet-monatlich', zugang: '2026-11-03', datum: '2026-11-03' }).fr.termin, '2026-12-31');
  assert.equal(B.briefDaten('verein-austritt', 'CH', { zugang: '2026-11-04', datum: '2026-11-03' }).fr.austritt, '2027-12-31');
  assert.equal(B.briefDaten('verein-austritt', 'DE', { zugang: '2026-11-04', datum: '2026-11-03' }).fr, null);
});
