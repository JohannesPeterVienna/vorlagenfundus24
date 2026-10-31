'use strict';
// Unit-Tests für den Fristen-Rechenkern. Start: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const F = require(path.join(__dirname, '..', 'docs', 'assets', 'js', 'fristen.js'));
const FT = require(path.join(__dirname, '..', 'docs', 'assets', 'data', 'feiertage.json'));

test('Datum parsen und formatieren', () => {
  assert.equal(F.iso(F.parse('2026-02-28')), '2026-02-28');
  assert.throws(() => F.parse('2026-02-30'));
  assert.throws(() => F.parse('31.12.2026'));
  assert.equal(F.formatDE('2027-01-31', 'AT'), '31. Jänner 2027');
  assert.equal(F.formatDE('2027-01-31', 'DE'), '31. Januar 2027');
  assert.equal(F.weekdayDE('2026-10-31'), 'Samstag');
});

test('Ostersonntag', () => {
  assert.equal(F.iso(F.easter(2024)), '2024-03-31');
  assert.equal(F.iso(F.easter(2026)), '2026-04-05');
  assert.equal(F.iso(F.easter(2027)), '2027-03-28');
  assert.equal(F.iso(F.easter(2030)), '2030-04-21');
});

test('Monatsrechnung mit fehlendem Tag (§ 902 Abs. 2 ABGB, § 188 Abs. 3 BGB, Art. 77 OR)', () => {
  assert.equal(F.iso(F.addMonths(F.parse('2026-01-31'), 1)), '2026-02-28');
  assert.equal(F.iso(F.addMonths(F.parse('2024-01-31'), 1)), '2024-02-29');
  assert.equal(F.iso(F.addMonths(F.parse('2026-08-31'), 1)), '2026-09-30');
  assert.equal(F.iso(F.addMonths(F.parse('2026-12-15'), 2)), '2027-02-15');
});

test('Feiertagslisten', () => {
  const at = F.holidaysFor('AT', 2026, FT);
  assert.ok(at['2026-10-26']);
  assert.ok(at['2026-06-04'], 'Fronleichnam 2026');
  assert.ok(at['2026-04-03'], 'Karfreitag als Hemmungstag AT');
  const de = F.holidaysFor('DE', 2026, FT);
  assert.ok(de['2026-10-03']);
  assert.equal(de['2026-06-04'], undefined, 'Fronleichnam ist kein bundesweiter Feiertag');
  const ch = F.holidaysFor('CH', 2026, FT);
  assert.ok(ch['2026-08-01']);
  const opt = F.expandOptional('DE', [2026], FT, ['reform', 'fronleichnam']);
  assert.deepEqual(opt.sort(), ['2026-06-04', '2026-10-31']);
});

test('Fristende nach Tagen, Wochen, Monaten', () => {
  assert.equal(F.fristEnde({ ereignis: '2026-11-02', anzahl: 14, einheit: 'tage' }).ende, '2026-11-16');
  assert.equal(F.fristEnde({ ereignis: '2026-11-02', anzahl: 2, einheit: 'wochen' }).ende, '2026-11-16');
  assert.equal(F.fristEnde({ ereignis: '2026-01-31', anzahl: 1, einheit: 'monate' }).ende, '2026-02-28');
  assert.equal(F.fristEnde({ ereignis: '2026-03-15', anzahl: 1, einheit: 'jahre' }).ende, '2027-03-15');
});

test('Verschiebung auf Werktag: AT über Stefanitag und Wochenende', () => {
  const r = F.fristEnde({ ereignis: '2026-12-12', anzahl: 14, einheit: 'tage', land: 'AT', feiertage: FT });
  assert.equal(r.rohEnde, '2026-12-26');
  assert.equal(r.ende, '2026-12-28');
  assert.equal(r.verschoben.length, 2);
});

test('Verschiebung auf Werktag: DE über Ostern (§ 193 BGB)', () => {
  const r = F.fristEnde({ ereignis: '2026-03-20', anzahl: 14, einheit: 'tage', land: 'DE', feiertage: FT });
  assert.equal(r.rohEnde, '2026-04-03');
  assert.equal(r.ende, '2026-04-07');
});

test('Verschiebung CH: Samstag gleichgestellt, Bundesfeiertag', () => {
  const r = F.fristEnde({ ereignis: '2026-07-18', anzahl: 14, einheit: 'tage', land: 'CH', feiertage: FT });
  assert.equal(r.rohEnde, '2026-08-01');
  assert.equal(r.ende, '2026-08-03');
});

test('Eigene Feiertage werden berücksichtigt', () => {
  const r = F.fristEnde({ ereignis: '2026-10-17', anzahl: 14, einheit: 'tage', land: 'DE', feiertage: FT, eigeneFeiertage: ['2026-10-31'] });
  assert.equal(r.rohEnde, '2026-10-31');
  assert.equal(r.ende, '2026-11-02');
});

test('3. Werktag mit Feiertag (DE, Oktober 2026)', () => {
  assert.equal(F.iso(F.nthWerktag(2026, 9, 3, 'DE', FT, true)), '2026-10-05');
  assert.equal(F.iso(F.nthWerktag(2026, 10, 3, 'DE', FT, true)), '2026-11-04');
  assert.equal(F.iso(F.nthWerktag(2026, 10, 3, 'DE', FT, false)), '2026-11-04');
  assert.equal(F.iso(F.nthWerktag(2026, 9, 3, 'DE', FT, false)), '2026-10-05');
  assert.equal(F.iso(F.nthWerktag(2026, 7, 3, 'DE', FT, true)), '2026-08-04');
  assert.equal(F.iso(F.nthWerktag(2026, 7, 3, 'DE', FT, false)), '2026-08-05');
});

test('Mietkündigung DE § 573c Abs. 1: rechtzeitig und verspätet', () => {
  const a = F.mietKuendigung({ land: 'DE', variante: 'standard', zugang: '2026-11-04', feiertage: FT });
  assert.equal(a.termin, '2027-01-31');
  assert.equal(a.spaetesterZugang, '2026-11-04');
  assert.equal(a.hinweis, null);
  const b = F.mietKuendigung({ land: 'DE', variante: 'standard', zugang: '2026-11-05', feiertage: FT });
  assert.equal(b.termin, '2027-02-28');
  assert.equal(b.spaetesterZugang, '2026-12-03');
  assert.ok(b.hinweis);
});

test('Mietkündigung DE § 573c Abs. 3 (möbliertes Zimmer)', () => {
  assert.equal(F.mietKuendigung({ land: 'DE', variante: 'moebliert', zugang: '2026-11-15', feiertage: FT }).termin, '2026-11-30');
  assert.equal(F.mietKuendigung({ land: 'DE', variante: 'moebliert', zugang: '2026-11-16', feiertage: FT }).termin, '2026-12-31');
});

test('Mietkündigung AT § 560 Abs. 1 Z 2 lit. d ZPO', () => {
  const a = F.mietKuendigung({ land: 'AT', variante: 'unbefristet-monatlich', zugang: '2026-11-10', feiertage: FT });
  assert.equal(a.termin, '2026-12-31');
  assert.equal(a.spaetesterZugang, '2026-11-30');
  const b = F.mietKuendigung({ land: 'AT', variante: 'unbefristet-monatlich', zugang: '2026-12-01', feiertage: FT });
  assert.equal(b.termin, '2027-01-31');
  const c = F.mietKuendigung({ land: 'AT', variante: 'unbefristet-laenger', zugang: '2026-11-10', feiertage: FT });
  assert.equal(c.termin, '2027-02-28');
  assert.equal(c.spaetesterZugang, '2026-11-30');
});

test('Mietkündigung AT befristet § 29 Abs. 2 MRG inkl. erstes Jahr', () => {
  const a = F.mietKuendigung({ land: 'AT', variante: 'befristet', zugang: '2026-11-10', mietbeginn: '2024-03-01', feiertage: FT });
  assert.equal(a.termin, '2027-02-28');
  const b = F.mietKuendigung({ land: 'AT', variante: 'befristet', zugang: '2026-11-10', mietbeginn: '2026-03-01', feiertage: FT });
  assert.ok(b.hinweis);
  assert.equal(b.fruehesterZugang, '2027-03-01');
  assert.equal(b.termin, '2027-06-30');
});

test('Mietkündigung CH Art. 266c OR – ortsübliche Termine', () => {
  const a = F.mietKuendigung({ land: 'CH', variante: 'ortsueblich', terminMonate: [3, 6, 9], zugang: '2026-11-10', feiertage: FT });
  assert.equal(a.termin, '2027-03-31');
  assert.equal(a.spaetesterZugang, '2026-12-31');
  const b = F.mietKuendigung({ land: 'CH', variante: 'ortsueblich', terminMonate: [3, 6, 9], zugang: '2027-01-05', feiertage: FT });
  assert.equal(b.termin, '2027-06-30');
  assert.equal(b.spaetesterZugang, '2027-03-31');
  assert.throws(() => F.mietKuendigung({ land: 'CH', variante: 'ortsueblich', terminMonate: [], zugang: '2027-01-05' }));
});

test('Mietkündigung CH Art. 266c OR – Ende einer dreimonatigen Mietdauer', () => {
  const a = F.mietKuendigung({ land: 'CH', variante: 'mietdauer', mietbeginn: '2026-04-01', zugang: '2026-11-10', feiertage: FT });
  assert.equal(a.termin, '2027-03-31');
  assert.equal(a.spaetesterZugang, '2026-12-31');
});

test('Rücktritt/Widerruf 14 Tage (FAGG / BGB)', () => {
  assert.equal(F.ruecktrittsfrist({ land: 'AT', erhalt: '2026-12-10', feiertage: FT }).ende, '2026-12-24');
  assert.equal(F.ruecktrittsfrist({ land: 'DE', erhalt: '2026-03-20', feiertage: FT }).ende, '2026-04-07');
  assert.throws(() => F.ruecktrittsfrist({ land: 'CH', erhalt: '2026-03-20' }));
});

test('Gewährleistung', () => {
  const at = F.gewaehrleistung({ land: 'AT', uebergabe: '2026-05-15' });
  assert.equal(at.vermutungBis, '2027-05-15');
  assert.equal(at.fristEnde, '2028-05-15');
  assert.equal(at.verjaehrung, '2028-08-15');
  const ch = F.gewaehrleistung({ land: 'CH', uebergabe: '2026-05-15' });
  assert.equal(ch.vermutungBis, null);
  assert.equal(ch.verjaehrung, '2028-05-15');
});

test('Vereinsaustritt CH Art. 70 Abs. 2 ZGB', () => {
  assert.equal(F.vereinAustrittCH({ zugang: '2026-06-30' }).austritt, '2026-12-31');
  assert.equal(F.vereinAustrittCH({ zugang: '2026-07-01' }).austritt, '2027-12-31');
});

test('Puffer in Tagen', () => {
  const a = F.mietKuendigung({ land: 'AT', variante: 'unbefristet-monatlich', zugang: '2026-11-20', feiertage: FT });
  assert.equal(a.puffer, 10);
});

test('Mietkündigung DE: Samstag zählt als Werktag (BGH VIII ZR 206/04)', () => {
  // Juli 2027: Do 1., Fr 2., Sa 3. → dritter Werktag ist Samstag, 3. Juli 2027
  const a = F.mietKuendigung({ land: 'DE', variante: 'standard', zugang: '2027-07-03', feiertage: FT });
  assert.equal(a.spaetesterZugang, '2027-07-03');
  assert.equal(a.termin, '2027-09-30');
  const b = F.mietKuendigung({ land: 'DE', variante: 'standard', zugang: '2027-07-05', feiertage: FT });
  assert.equal(b.termin, '2027-10-31');
});
