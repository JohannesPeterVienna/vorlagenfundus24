/*
 * Vorlagenfundus 24 – Fristen-Rechenkern
 * Reine Datumsfunktionen ohne DOM. Läuft im Browser (window.VFFristen) und in Node (module.exports).
 * Alle Daten sind Kalendertage im Format "JJJJ-MM-TT" und werden intern als UTC-Mitternacht geführt,
 * damit Sommerzeitwechsel keine Tage verschieben.
 *
 * Rechtsgrundlagen der einzelnen Regeln stehen jeweils am Funktionskopf. Stand: Oktober 2026.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.VFFristen = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 86400000;

  function parse(s) {
    if (s instanceof Date) return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
    if (!m) throw new Error('Ungültiges Datum: ' + s);
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (d.getUTCMonth() !== +m[2] - 1) throw new Error('Ungültiges Datum: ' + s);
    return d;
  }
  function iso(d) {
    var y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, da = d.getUTCDate();
    return y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (da < 10 ? '0' : '') + da;
  }
  function addDays(d, n) { return new Date(d.getTime() + n * DAY); }
  function lastOfMonth(y, m0) { return new Date(Date.UTC(y, m0 + 1, 0)); }
  function endOfMonthOffset(d, k) { return lastOfMonth(d.getUTCFullYear(), d.getUTCMonth() + k); }
  function diffDays(a, b) { return Math.round((b.getTime() - a.getTime()) / DAY); }

  /*
   * Monatsrechnung mit "fehlendem Tag": Fällt der entsprechende Tag im Zielmonat aus
   * (z. B. 31. → Februar), gilt der letzte Tag dieses Monats.
   * AT: § 902 Abs. 2 ABGB · DE: § 188 Abs. 3 BGB · CH: Art. 77 Abs. 1 Ziff. 3 OR.
   */
  function addMonths(d, n) {
    var y = d.getUTCFullYear(), m = d.getUTCMonth() + n, day = d.getUTCDate();
    var last = lastOfMonth(y, m).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(day, last)));
  }

  /* Ostersonntag (gregorianisch, Algorithmus nach Meeus/Jones/Butcher). */
  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7,
      m = Math.floor((a + 11 * h + 22 * l) / 451), month = Math.floor((h + l - 7 * m + 114) / 31),
      day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(y, month - 1, day));
  }

  /*
   * Feiertagsdaten: Struktur wie /assets/data/feiertage.json.
   * { fix: ["01-01", ...], ostern: [{offset: 1, name: "Ostermontag"}, ...] }
   */
  var holidayCache = {};
  function holidaysFor(country, year, data, extra) {
    var key = country + year + (extra ? extra.join(',') : '');
    if (holidayCache[key] && !extra) return holidayCache[key];
    var set = {}, def = data && data[country];
    if (def) {
      (def.fix || []).forEach(function (h) { set[year + '-' + h.datum] = h.name; });
      var e = easter(year);
      (def.ostern || []).forEach(function (h) { set[iso(addDays(e, h.offset))] = h.name; });
    }
    (extra || []).forEach(function (s) { if (/^\d{4}-\d{2}-\d{2}$/.test(s)) set[s] = 'Eigener Feiertag'; });
    if (!extra) holidayCache[key] = set;
    return set;
  }
  /* Wählbare Zusatzfeiertage (Bundesland/Kanton) für mehrere Jahre in ISO-Daten auflösen. */
  function expandOptional(country, years, data, ids) {
    var def = data && data[country], out = [];
    if (!def || !ids || !ids.length) return out;
    years.forEach(function (y) {
      (def.optional || []).forEach(function (h) {
        if (ids.indexOf(h.id) === -1) return;
        if (h.datum) out.push(y + '-' + h.datum);
        else if (typeof h.offset === 'number') out.push(iso(addDays(easter(y), h.offset)));
      });
    });
    return out;
  }
  function holidayName(d, country, data, extra) {
    return holidaysFor(country, d.getUTCFullYear(), data, extra)[iso(d)] || null;
  }

  /*
   * Verschiebung des Fristendes auf den nächsten Werktag.
   * AT: § 903 ABGB (Sonntag, anerkannter Feiertag) – für gesetzliche Fristen erweitert durch Art. 5
   *     Europäisches Übereinkommen über die Berechnung von Fristen (BGBl. Nr. 254/1983) auf Samstag;
   *     Karfreitag von Österreich als Feiertag notifiziert. (Das Fristenhemmungsgesetz 1961 ist seit
   *     1.1.2012 aufgehoben.)
   * DE: § 193 BGB (Sonntag, am Erklärungsort staatlich anerkannter Feiertag, Sonnabend).
   * CH: Art. 78 OR (Sonntag, anerkannter Feiertag); Samstag gleichgestellt für gesetzliche Fristen
   *     des Bundesrechts nach SR 173.110.3.
   * Für Kündigungsfristen und -termine verschiebt dieser Rechner bewusst NICHT (Schutzfrist für die
   * Gegenseite); das wird in der Oberfläche erklärt.
   */
  var SHIFT_RULES = {
    AT: { samstag: true, sonntag: true, extraNamen: ['Karfreitag'] },
    DE: { samstag: true, sonntag: true, extraNamen: [] },
    CH: { samstag: true, sonntag: true, extraNamen: [] }
  };
  function isNonWorking(d, country, data, extra) {
    var wd = d.getUTCDay(), r = SHIFT_RULES[country];
    if (wd === 0 && r.sonntag) return 'Sonntag';
    if (wd === 6 && r.samstag) return 'Samstag';
    var h = holidayName(d, country, data, extra);
    if (h) return h;
    return null;
  }
  function shiftToWorkday(d, country, data, extra) {
    var steps = [], cur = d, why;
    for (var guard = 0; guard < 14 && (why = isNonWorking(cur, country, data, extra)); guard++) {
      steps.push({ datum: iso(cur), grund: why });
      cur = addDays(cur, 1);
    }
    return { datum: cur, verschoben: steps };
  }

  /*
   * Allgemeine Fristberechnung (Ereignisfrist): Der Tag des Ereignisses zählt nicht mit.
   * AT § 902 Abs. 1 ABGB · DE § 187 Abs. 1, § 188 BGB · CH Art. 77 OR.
   * einheit: "tage" | "wochen" | "monate" | "jahre"
   */
  function fristEnde(opts) {
    var start = parse(opts.ereignis), n = +opts.anzahl, unit = opts.einheit, raw;
    if (!(n >= 0) || n > 3650) throw new Error('Anzahl außerhalb des Bereichs');
    if (unit === 'tage') raw = addDays(start, n);
    else if (unit === 'wochen') raw = addDays(start, 7 * n);
    else if (unit === 'monate') raw = addMonths(start, n);
    else if (unit === 'jahre') raw = addMonths(start, 12 * n);
    else throw new Error('Unbekannte Einheit');
    var res = { ereignis: iso(start), rohEnde: iso(raw), ende: iso(raw), verschoben: [] };
    if (opts.verschieben !== false && opts.land) {
      var s = shiftToWorkday(raw, opts.land, opts.feiertage, opts.eigeneFeiertage);
      res.ende = iso(s.datum); res.verschoben = s.verschoben;
    }
    return res;
  }

  /* n-ter Werktag eines Monats. Werktag = Montag bis Samstag, ohne Feiertage (samstagIstWerktag steuerbar). */
  function nthWerktag(y, m0, n, country, data, samstagIstWerktag, extra) {
    var d = new Date(Date.UTC(y, m0, 1)), count = 0;
    for (var i = 0; i < 31; i++) {
      var wd = d.getUTCDay();
      var frei = wd === 0 || (wd === 6 && !samstagIstWerktag) || !!holidayName(d, country, data, extra);
      if (!frei) { count++; if (count === n) return d; }
      d = addDays(d, 1);
    }
    return null;
  }

  /*
   * Spätester Zugang für einen Kündigungstermin bei einer Frist von "monate" Monaten,
   * wenn die Frist am Tag nach dem Zugang beginnen und am Termin enden muss:
   * Fristbeginn = Termin + 1 Tag − Monate; Zugang spätestens am Vortag.
   */
  function spaetesterZugangFuerTermin(termin, monate) {
    var t = parse(termin);
    return iso(addDays(addMonths(addDays(t, 1), -monate), -1));
  }

  /*
   * Mietkündigung durch Mieterin/Mieter.
   * opts.land: "AT" | "DE" | "CH"
   * opts.zugang: Datum, an dem das Schreiben voraussichtlich zugeht
   * opts.variante:
   *   AT: "unbefristet-monatlich"  – § 560 Abs. 1 Z 2 lit. d ZPO: zum Monatsletzten, Zustellung
   *                                   spätestens einen Monat vor dem Termin (Zins monatlich).
   *       "unbefristet-laenger"    – dieselbe Norm: drei Monate, wenn Zins in längeren Abständen.
   *       "befristet"              – § 29 Abs. 2 MRG: nach einem Jahr, drei Monate zum Monatsletzten.
   *   DE: "standard"               – § 573c Abs. 1 BGB: spätestens am 3. Werktag eines Monats zum
   *                                   Ablauf des übernächsten Monats.
   *       "moebliert"              – § 573c Abs. 3 BGB: spätestens am 15. zum Monatsende.
   *   CH: "ortsueblich"            – Art. 266c OR: drei Monate auf ortsüblichen Termin
   *                                   (opts.terminMonate: [3,6,9,12] = Monatsende dieser Monate).
   *       "mietdauer"              – Art. 266c OR ohne Ortsgebrauch: Ende einer dreimonatigen
   *                                   Mietdauer, gerechnet ab opts.mietbeginn.
   * Vertragliche Abweichungen (längere Fristen, andere Termine) gehen vor – Hinweis in der Oberfläche.
   */
  function mietKuendigung(opts) {
    var z = parse(opts.zugang), land = opts.land, v = opts.variante, data = opts.feiertage, out;
    if (land === 'DE' && v === 'standard') {
      var samstag = opts.samstagIstWerktag !== false;
      var w3 = nthWerktag(z.getUTCFullYear(), z.getUTCMonth(), 3, 'DE', data, samstag, opts.eigeneFeiertage);
      var rechtzeitig = z.getTime() <= w3.getTime();
      var termin = endOfMonthOffset(z, rechtzeitig ? 2 : 3);
      var stichMonat = rechtzeitig ? z : addMonths(new Date(Date.UTC(z.getUTCFullYear(), z.getUTCMonth(), 1)), 1);
      var stich = nthWerktag(stichMonat.getUTCFullYear(), stichMonat.getUTCMonth(), 3, 'DE', data, samstag, opts.eigeneFeiertage);
      out = { termin: iso(termin), spaetesterZugang: iso(stich), regel: 'DE-573c-1',
        hinweis: rechtzeitig ? null : 'Zugang nach dem 3. Werktag – die Kündigung wirkt erst zum nächsten Termin.' };
    } else if (land === 'DE' && v === 'moebliert') {
      var ok = z.getUTCDate() <= 15;
      var t2 = endOfMonthOffset(z, ok ? 0 : 1);
      out = { termin: iso(t2), spaetesterZugang: iso(new Date(Date.UTC(t2.getUTCFullYear(), t2.getUTCMonth(), 15))), regel: 'DE-573c-3', hinweis: null };
    } else if (land === 'AT' && (v === 'unbefristet-monatlich' || v === 'unbefristet-laenger' || v === 'befristet')) {
      var mon = v === 'unbefristet-monatlich' ? 1 : 3;
      var t3 = endOfMonthOffset(z, mon);
      out = { termin: iso(t3), spaetesterZugang: spaetesterZugangFuerTermin(iso(t3), mon),
        regel: v === 'befristet' ? 'AT-29-2-MRG' : 'AT-560-ZPO', hinweis: null };
      /*
       * § 29 Abs. 2 MRG: Kündigungsrecht erst "nach Ablauf eines Jahres" der (verlängerten) Dauer.
       * jahrStatus: "abgelaufen" (geprüft), "laeuft" (Zugang zu früh → Brief nur als Entwurf ab
       * fruehesterZugang verwendbar), "unbekannt" (Mietbeginn fehlt → nicht prüfbar, kein Versand).
       */
      if (v === 'befristet') {
        if (!opts.mietbeginn) {
          out.jahrStatus = 'unbekannt';
          out.hinweis = 'Ohne Beginn der Vertragsdauer lässt sich nicht prüfen, ob das erste Jahr abgelaufen ist. Erst danach besteht das Kündigungsrecht nach § 29 Abs. 2 MRG.';
        } else {
          var frueh = addMonths(parse(opts.mietbeginn), 12);
          out.jahrEnde = iso(addDays(frueh, -1));
          if (z.getTime() < frueh.getTime()) {
            out.jahrStatus = 'laeuft';
            out.hinweis = 'Das erste Vertragsjahr ist am Zugangstag noch nicht abgelaufen (Ende: ' + out.jahrEnde + '). Das Kündigungsrecht nach § 29 Abs. 2 MRG besteht erst danach; der Brief darf frühestens am ' + iso(frueh) + ' zugehen.';
            out.fruehesterZugang = iso(frueh);
            var t4 = endOfMonthOffset(frueh, 3);
            out.termin = iso(t4); out.spaetesterZugang = spaetesterZugangFuerTermin(iso(t4), 3);
          } else out.jahrStatus = 'abgelaufen';
        }
      }
    } else if (land === 'CH' && v === 'ortsueblich') {
      var months = (opts.terminMonate || []).map(Number).filter(function (x) { return x >= 1 && x <= 12; }).sort(function (a, b) { return a - b; });
      if (!months.length) throw new Error('Bitte mindestens einen ortsüblichen Termin wählen');
      var found = null;
      for (var k = 0; k < 40 && !found; k++) {
        var cand = endOfMonthOffset(z, k);
        if (months.indexOf(cand.getUTCMonth() + 1) === -1) continue;
        if (z.getTime() <= parse(spaetesterZugangFuerTermin(iso(cand), 3)).getTime()) found = cand;
      }
      out = { termin: iso(found), spaetesterZugang: spaetesterZugangFuerTermin(iso(found), 3), regel: 'CH-266c', hinweis: null };
    } else if (land === 'CH' && v === 'mietdauer') {
      if (!opts.mietbeginn) throw new Error('Mietbeginn fehlt');
      var b = parse(opts.mietbeginn), f = null;
      for (var j = 1; j < 400 && !f; j++) {
        var end = addDays(addMonths(b, 3 * j), -1);
        if (z.getTime() <= parse(spaetesterZugangFuerTermin(iso(end), 3)).getTime()) f = end;
      }
      out = { termin: iso(f), spaetesterZugang: spaetesterZugangFuerTermin(iso(f), 3), regel: 'CH-266c', hinweis: null };
    } else {
      throw new Error('Unbekannte Kombination: ' + land + '/' + v);
    }
    out.land = land; out.variante = v; out.zugang = iso(z);
    out.puffer = diffDays(z, parse(out.spaetesterZugang));
    return out;
  }

  /*
   * Rücktritt / Widerruf bei Fernabsatz (Waren): 14 Tage ab Erhalt der (letzten) Ware.
   * AT: § 11 Abs. 1 und 2 Z 2 FAGG; rechtzeitige Absendung genügt (§ 13 Abs. 1 FAGG).
   * DE: § 355 Abs. 2, § 356 Abs. 2 Nr. 1 BGB; rechtzeitige Absendung genügt (§ 355 Abs. 1 BGB).
   * Ohne ordnungsgemäße Belehrung verlängert sich die Frist (AT § 12 FAGG: um zwölf Monate;
   * DE § 356 Abs. 3: spätestens zwölf Monate und 14 Tage) – das gibt der Rechner nur als Hinweis aus.
   */
  function ruecktrittsfrist(opts) {
    if (opts.land !== 'AT' && opts.land !== 'DE') throw new Error('Nur AT/DE: in der Schweiz gibt es kein allgemeines Widerrufsrecht für Online-Käufe');
    var r = fristEnde({ ereignis: opts.erhalt, anzahl: 14, einheit: 'tage', land: opts.land, feiertage: opts.feiertage, eigeneFeiertage: opts.eigeneFeiertage });
    r.regel = opts.land === 'AT' ? 'AT-11-FAGG' : 'DE-355-BGB';
    return r;
  }

  /*
   * Gewährleistung beim Kauf beweglicher Sachen (Verbraucher):
   * AT § 10 Abs. 1 VGG: Mangel muss binnen zwei Jahren ab Übergabe hervorkommen; § 28 Abs. 1 VGG:
   *     Rechte verjähren drei Monate nach Ablauf der Gewährleistungsfrist; § 11 VGG: Vermutung 1 Jahr.
   * DE § 438 Abs. 1 Nr. 3, Abs. 2 BGB: zwei Jahre ab Ablieferung; § 477 Abs. 1 BGB: Vermutung 1 Jahr.
   * CH Art. 210 Abs. 1 OR: zwei Jahre ab Ablieferung; Art. 201 OR: Rüge sofort nach Entdeckung.
   */
  /*
   * Erweiterungen (Stand 31.10.2026, an den Primärquellen geprüft):
   * DE § 475e Abs. 3 BGB: Zeigt sich der Mangel innerhalb der Verjährungsfrist, keine Verjährung vor
   *     Ablauf von vier Monaten ab dem ersten Zeigen (Ablaufhemmung).
   * DE § 475e Abs. 4 BGB: Ware zur Nacherfüllung/Garantie übergeben → keine Verjährung (für diesen
   *     Mangel) vor Ablauf von zwei Monaten nach Rückgabe der nachgebesserten/ersetzten Ware.
   * DE § 475e Abs. 5 BGB: Nacherfüllung durch Nachbesserung → ursprüngliche Verjährungsfrist einmalig
   *     +12 Monate; nur für Kaufverträge ab 31.07.2026 (Art. 229 § 72 EGBGB).
   * AT § 10 Abs. 2a VGG: Verbesserung nach § 12 Abs. 2 → Gewährleistungsfrist einmal +1 Jahr; nur für
   *     Verträge nach dem 30.09.2026 (§ 29 Abs. 4 VGG). § 28 Abs. 1 VGG: Verjährung 3 Monate danach.
   * Nicht erfasst (deshalb nie "endgültiges" Ende): Hemmung durch Verhandlungen/Klage (§§ 203, 204
   * BGB), Arglist, Garantien, vertraglich verkürzte Fristen bei gebrauchten Waren, Rechtsmängel,
   * digitale Elemente (§ 475e Abs. 1, 2 BGB; § 10 Abs. 2 VGG), Bauwerke/Werkverträge.
   * opts: land, uebergabe, vertrag (Kaufdatum, optional), entdeckt (optional),
   *       nachbesserung (bool), rueckerhalt (DE: Ware nach Nacherfüllung zurückerhalten, optional)
   */
  var STICHTAG_REPARATUR = { DE: '2026-07-31', AT: '2026-10-01' }; // Vertrag am/ab diesem Tag
  function gewaehrleistung(opts) {
    var land = opts.land, u = parse(opts.uebergabe), r = { land: land, uebergabe: iso(u), angewandt: [], hinweise: [] };
    var grund = addMonths(u, 24);
    r.vermutungBis = land === 'CH' ? null : iso(addMonths(u, 12));
    r.grundfrist = iso(grund);
    var verl = false;
    if (opts.nachbesserung && STICHTAG_REPARATUR[land]) {
      var stich = parse(STICHTAG_REPARATUR[land]);
      var v = opts.vertrag ? parse(opts.vertrag) : null;
      if (v && v.getTime() >= stich.getTime()) verl = true;
      else if (!v && u.getTime() < stich.getTime()) r.hinweise.push('Die Verlängerung nach einer Reparatur gilt nur für Kaufverträge ab ' + STICHTAG_REPARATUR[land] + '; bei Übergabe vor diesem Tag ist der Vertrag älter.');
      else if (!v) r.hinweise.push('Für die Verlängerung nach einer Reparatur bitte das Kaufdatum eintragen (Verträge ab ' + STICHTAG_REPARATUR[land] + ').');
      else r.hinweise.push('Kaufvertrag vor ' + STICHTAG_REPARATUR[land] + ': keine Verlängerung nach Reparatur.');
    }
    var basis = verl ? addMonths(u, 36) : grund;
    if (verl) r.angewandt.push(land === 'DE' ? 'DE-475e-5' : 'AT-10-2a');
    var e = opts.entdeckt ? parse(opts.entdeckt) : null;
    if (e && e.getTime() < u.getTime()) throw new Error('Das Entdeckungsdatum liegt vor der Übergabe');
    if (land === 'DE') {
      var ende = basis;
      if (e) {
        if (e.getTime() <= basis.getTime()) {
          var h3 = addMonths(e, 4);
          if (h3.getTime() > ende.getTime()) { ende = h3; r.angewandt.push('DE-475e-3'); }
        } else r.hinweise.push('Der Mangel hat sich erst nach Ablauf der berechneten Verjährungsfrist gezeigt.');
      }
      if (opts.rueckerhalt) {
        var h4 = addMonths(parse(opts.rueckerhalt), 2);
        if (h4.getTime() > ende.getTime()) { ende = h4; r.angewandt.push('DE-475e-4'); }
      }
      r.fristEnde = iso(basis);      // Verjährungsfrist (ggf. verlängert), ohne Ablaufhemmung
      r.verjaehrung = iso(ende);     // frühestes Verjährungsende nach den erfassten Regeln
    } else if (land === 'AT') {
      r.fristEnde = iso(basis);
      r.verjaehrung = iso(addMonths(basis, 3));
      if (e && e.getTime() > basis.getTime()) r.hinweise.push('Der Mangel ist erst nach Ablauf der Gewährleistungsfrist hervorgekommen.');
    } else {
      r.fristEnde = iso(grund);
      r.verjaehrung = iso(grund);
    }
    r.nurGrundfrist = r.angewandt.length === 0;
    return r;
  }

  /*
   * Austritt aus einem Verein ohne abweichende Statuten in der Schweiz:
   * Art. 70 Abs. 2 ZGB – halbjährige Frist auf das Ende des Kalenderjahres.
   */
  function vereinAustrittCH(opts) {
    var z = parse(opts.zugang), y = z.getUTCFullYear();
    var stichtag = new Date(Date.UTC(y, 5, 30)); // 30. Juni: Frist 1.7.–31.12.
    var jahr = z.getTime() <= stichtag.getTime() ? y : y + 1;
    return { austritt: jahr + '-12-31', spaetesterZugang: jahr + '-06-30', regel: 'CH-70-ZGB' };
  }

  function formatDE(s, land) {
    var d = parse(s);
    var mon = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    if (land === 'AT') mon[0] = 'Jänner';
    return d.getUTCDate() + '. ' + mon[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  function weekdayDE(s) {
    return ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'][parse(s).getUTCDay()];
  }

  return {
    parse: parse, iso: iso, addDays: addDays, addMonths: addMonths, easter: easter,
    holidaysFor: holidaysFor, expandOptional: expandOptional, shiftToWorkday: shiftToWorkday, fristEnde: fristEnde,
    nthWerktag: nthWerktag, spaetesterZugangFuerTermin: spaetesterZugangFuerTermin,
    mietKuendigung: mietKuendigung, ruecktrittsfrist: ruecktrittsfrist,
    gewaehrleistung: gewaehrleistung, vereinAustrittCH: vereinAustrittCH,
    formatDE: formatDE, weekdayDE: weekdayDE
  };
}));
