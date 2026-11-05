/*
 * Vorlagenfundus 24 – Brief-Assistent, Fristenrechner, Fensterkuvert-Prüfung, Versand-Empfehlung.
 * Läuft vollständig im Browser. Eingaben werden nicht übertragen; Entwürfe nur auf Wunsch im
 * lokalen Speicher dieses Browsers. Stand: Oktober 2026. Keine Rechtsberatung.
 */
(function () {
  'use strict';
  var F = window.VFFristen;
  var FT = null; // Feiertagsdaten
  var HEUTE = F.iso(new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())));

  /* ================= Hilfen ================= */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k === 'class') e.className = attrs[k];
      else if (attrs[k] === true) e.setAttribute(k, '');
      else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function L(land, o) { return o[land] != null ? o[land] : o.DE; }
  function ch(land, s) { return land === 'CH' ? s.replace(/ß/g, 'ss') : s; }
  function datum(s, land) { try { return F.formatDE(s, land); } catch (e) { return '[Datum]'; } }
  function isoText(t, land) { return String(t).replace(/\d{4}-\d{2}-\d{2}/g, function (d) { return datum(d, land); }); }
  function leer(v) { return v == null || String(v).trim() === ''; }
  var SCHUTZ = '\uE000';
  function roh(v) { return String(v || '').trim().replace(/ß/g, SCHUTZ); }
  function oder(v, platz) { return leer(v) ? '[' + platz + ']' : roh(v); }
  function zurueck(s) { return String(s).split(SCHUTZ).join('ß'); }
  function zeilen(v) { return String(v || '').split(/\n+/).map(function (s) { return roh(s); }).filter(Boolean); }
  var speicherOk = (function () { try { var k = '__vf'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch (e) { return false; } }());

  /*
   * Feiertagsdaten laden. Schlägt das fehl, bleibt FT = null: Der Rechenkern gibt dann für alle
   * feiertagsabhängigen Fristen einen Fehler statt eines scheinbar vollständigen Datums aus.
   */
  function ladeFeiertage(cb) {
    if (FT) return cb(FT);
    fetch('/assets/data/feiertage.json', { credentials: 'omit' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { FT = d && F.abdeckung(d) ? d : null; cb(FT); })
      .catch(function () { FT = null; cb(FT); });
  }

  /*
   * Frist im Schreiben (Kaution, Mängelanzeige, Reklamation): an das Datum des Schreibens gebunden.
   * Annahme offengelegt: Datum des Schreibens + Postlaufzeit (Tage) = Zugang; ab dem Tag nach dem
   * Zugang laufen die Fristtage; Ende auf Wochenende/Feiertag → nächster Werktag. Alternativ trägt
   * die Nutzerin das Fristende selbst ein. Ein Fristende vor dem Datum des Schreibens wird abgelehnt.
   */
  function schreibFrist(land, v) {
    var brief = v.datum || HEUTE, b = F.parse(brief);
    if (!leer(v.fristBis)) {
      var e = F.parse(v.fristBis);
      if (e.getTime() < b.getTime()) throw new Error('Das Fristende (' + datum(v.fristBis, land) + ') liegt vor dem Datum des Schreibens (' + datum(brief, land) + '). Bitte ein späteres Fristende eintragen.');
      return { ende: F.iso(e), eigen: true, briefDatum: F.iso(b), verschoben: [] };
    }
    var post = leer(v.postTage) ? 3 : Number(v.postTage);
    if (!(post >= 0 && post <= 30 && Math.floor(post) === post)) throw new Error('Postlaufzeit bitte als ganze Zahl von 0 bis 30 Tagen eintragen.');
    var tage = leer(v.fristTage) ? 14 : Number(v.fristTage);
    if (!(tage >= 1 && tage <= 365 && Math.floor(tage) === tage)) throw new Error('Frist bitte als ganze Zahl von 1 bis 365 Tagen eintragen.');
    var zug = F.iso(F.addDays(b, post));
    var r = F.fristEnde({ ereignis: zug, anzahl: tage, einheit: 'tage', land: land, feiertage: FT });
    r.briefDatum = F.iso(b); r.postTage = post; r.zugangAnnahme = zug; r.fristTage = tage;
    return r;
  }
  /*
   * Kündigung/Austritt: Der Brief kann nicht zugehen, bevor er geschrieben ist. Sind Datum des
   * Schreibens und Zugang beide eingetragen und liegt der Zugang davor, wird kein Termin berechnet.
   */
  function pruefeZugangNachBrief(land, v) {
    if (leer(v.zugang) || leer(v.datum)) return;
    if (F.parse(v.zugang).getTime() < F.parse(v.datum).getTime()) throw new Error('Der Zugang (' + datum(v.zugang, land) + ') liegt vor dem Datum des Schreibens (' + datum(v.datum, land) + '). Bitte einen Zugang am oder nach dem Datum des Schreibens eintragen.');
  }
  function schreibFristHtml(land, r, z) {
    var h = z('Frist im Schreiben', datum(r.ende, land) + ' (' + F.weekdayDE(r.ende) + ')', true);
    if (r.eigen) h += '<p class="fristquelle">Von Ihnen eingetragenes Fristende. Achten Sie darauf, dass der Empfängerseite nach dem Zugang genug Zeit bleibt.</p>';
    else {
      h += '<p class="fristquelle">Annahme: Datum des Schreibens ' + esc(datum(r.briefDatum, land)) + ' + ' + r.postTage + ' Tage Postlaufzeit = Zugang am ' + esc(datum(r.zugangAnnahme, land)) + '; + ' + r.fristTage + ' Tage = ' + esc(datum(r.rohEnde, land)) + '.' +
        (r.verschoben.length ? ' Verschoben auf den nächsten Werktag, weil ' + r.verschoben.map(function (x) { return esc(datum(x.datum, land) + ' (' + x.grund + ')'); }).join(', ') + ' kein Werktag ist.' : '') +
        ' Ändern Sie das Datum des Schreibens, verschiebt sich die Frist mit. Sie können das Fristende auch selbst eintragen.</p>';
    }
    return h;
  }
  var SCHREIBFRIST_FELDER = [
    { id: 'postTage', label: 'Postlaufzeit bis zum Zugang (Tage ab Datum des Schreibens)', typ: 'number', def: '3', hilfe: 'Annahme für die Berechnung: Zugang = Datum des Schreibens + diese Tage.' },
    { id: 'fristBis', label: 'Oder Fristende selbst festlegen (optional)', typ: 'date', hilfe: 'Ersetzt die Berechnung. Darf nicht vor dem Datum des Schreibens liegen.' }
  ];

  /* ================= Quellen ================= */
  var Q = {
    'AT-560-ZPO': ['§ 560 Abs. 1 Z 2 lit. d ZPO', 'https://www.ris.bka.gv.at/eli/rgbl/1895/113/P560/NOR12020706'],
    'AT-33-MRG': ['§ 33 Abs. 1 MRG', 'https://www.ris.bka.gv.at/eli/bgbl/1981/520/P33/NOR40105103'],
    'AT-29-2-MRG': ['§ 29 Abs. 2 MRG', 'https://ris.bka.gv.at/eli/bgbl/1981/520/P29/NOR40273695'],
    'DE-573c-1': ['§ 573c Abs. 1 BGB', 'https://www.gesetze-im-internet.de/bgb/__573c.html'],
    'DE-573c-3': ['§ 573c Abs. 3 BGB', 'https://www.gesetze-im-internet.de/bgb/__573c.html'],
    'DE-573c-4': ['§ 573c Abs. 4 BGB', 'https://www.gesetze-im-internet.de/bgb/__573c.html'],
    'DE-568': ['§ 568 Abs. 1 BGB', 'https://www.gesetze-im-internet.de/bgb/__568.html'],
    'CH-266c': ['Art. 266c OR', 'https://www.fedlex.admin.ch/eli/cc/27/317_321_377/de#art_266_c'],
    'CH-266l': ['Art. 266l OR', 'https://www.fedlex.admin.ch/eli/cc/27/317_321_377/de#art_266_l'],
    'AT-11-FAGG': ['§ 11 FAGG', 'https://www.ris.bka.gv.at/eli/bgbl/i/2014/33/P11/NOR40162337'],
    'DE-355-BGB': ['§ 355 BGB', 'https://www.gesetze-im-internet.de/bgb/__355.html'],
    'AT-VGG': ['§§ 10, 11, 28 VGG', 'https://ris.bka.gv.at/eli/bgbl/i/2021/175/P10/NOR40279639'],
    'DE-438': ['§ 438 BGB', 'https://www.gesetze-im-internet.de/bgb/__438.html'],
    'DE-475e': ['§ 475e BGB', 'https://www.gesetze-im-internet.de/bgb/__475e.html'],
    'CH-210': ['Art. 210 OR', 'https://www.fedlex.admin.ch/eli/cc/27/317_321_377/de#art_210'],
    'CH-70-ZGB': ['Art. 70 Abs. 2 ZGB', 'https://www.fedlex.admin.ch/eli/cc/24/233_245_233/de#art_70'],
    'AT-902': ['§§ 902, 903 ABGB', 'https://www.ris.bka.gv.at/eli/jgs/1811/946/P902/NOR12018626'],
    'DE-187': ['§§ 187, 188, 193 BGB', 'https://www.gesetze-im-internet.de/bgb/__187.html'],
    'CH-77': ['Art. 77, 78 OR', 'https://www.fedlex.admin.ch/eli/cc/27/317_321_377/de#art_77']
  };
  function quelleHtml(key) {
    var q = Q[key]; if (!q) return '';
    return '<a href="' + q[1] + '" rel="noopener" target="_blank">' + esc(q[0]) + '</a>';
  }

  /* ================= Versand-Empfehlung ================= */
  /*
   * art: "frist" (Zugang muss nachweisbar bis zu einem Stichtag erfolgen), "beweis" (Inhalt/Absendung
   * belegen), "behoerde", "info" (keine Frist). puffer: Tage bis zum spätesten Zugang.
   */
  function versandEmpfehlung(land, art, puffer) {
    var r = { titel: '', schritte: [], warnung: null };
    var knapp = typeof puffer === 'number' && puffer < 5;
    if (typeof puffer === 'number' && puffer < 0) {
      r.warnung = 'Der späteste Zugangstag ist bereits vorbei. Prüfen Sie den nächsten möglichen Termin oder holen Sie Rat ein.';
    }
    if (art === 'info') {
      r.titel = 'Normaler Brief oder E-Mail genügt in der Regel';
      r.schritte = ['Kopie des Schreibens aufbewahren.', 'Bei Rückfragen auf das Datum dieses Schreibens verweisen.'];
      return r;
    }
    if (land === 'DE') {
      r.titel = knapp ? 'Persönlich mit Zeugen einwerfen oder Bote' : 'Einschreiben Einwurf, alternativ Bote';
      r.schritte = knapp
        ? ['Brief vor Zeugen kuvertieren und am selben Tag in den Briefkasten der Empfängerseite einwerfen; Zeit und Ort notieren.', 'Der Zeuge sollte den Inhalt kennen (Kopie gegenzeichnen lassen).', 'Zusätzlich vorab per E-Mail oder Kontaktformular senden, sofern der Vertrag das zulässt.']
        : ['Bei der Deutschen Post dokumentiert der Zusteller beim „Einschreiben Einwurf“ den Einwurf in den Briefkasten – kein Abholen nötig.', 'Beim „Einschreiben“ mit Unterschrift kann die Sendung bei Abwesenheit zur Abholung liegen bleiben; das kostet Zeit.', 'Inhalt belegen: Kopie mit Absendevermerk aufheben, idealerweise mit Zeugen kuvertieren.'];
    } else if (land === 'AT') {
      r.titel = knapp ? 'Persönlich übergeben und bestätigen lassen' : 'Eingeschriebener Brief, Kopie aufbewahren';
      r.schritte = knapp
        ? ['Schreiben persönlich übergeben und den Empfang auf einer Kopie mit Datum bestätigen lassen.', 'Alternativ vor Zeugen einwerfen und Zeit, Ort und Zeugen notieren.', 'Vorab per E-Mail senden, wenn der Vertrag elektronische Erklärungen zulässt.']
        : ['Eingeschrieben senden und den Aufgabeschein aufbewahren.', 'Rechnen Sie mit Postlaufzeit und möglicher Hinterlegung, wenn niemand den Brief annimmt.', 'Kopie des Schreibens mit Datum ablegen.'];
    } else {
      r.titel = knapp ? 'Persönlich übergeben oder sofort eingeschrieben' : 'Einschreiben, Kopie aufbewahren';
      r.schritte = knapp
        ? ['Schreiben persönlich übergeben und Empfang quittieren lassen.', 'Eingeschriebene Briefe, die nicht angenommen werden, liegen zur Abholung – das verzögert den Empfang.', 'Für Mietkündigungen und Fristen im Zweifel beim Mieterverband nachfragen.']
        : ['Eingeschrieben senden und den Beleg aufbewahren.', 'Bei Mietsachen gilt: Für die Vermieterseite schreibt das Gesetz ein Formular vor, für Mieterinnen und Mieter genügt ein unterschriebener Brief.', 'Kopie mit Datum ablegen.'];
    }
    if (art === 'behoerde') {
      r.schritte.push(L(land, {
        AT: 'Bei Eingaben an Behörden zählt die Postlaufzeit nicht in die Frist (§ 33 Abs. 3 AVG). Aufgabeschein aufheben.',
        DE: 'Viele Behörden bieten elektronische Wege an; Eingangsbestätigung anfordern.',
        CH: 'Bei Bundesbehörden genügt die Übergabe an die Post am letzten Tag der Frist (Art. 21 VwVG). Beleg aufheben.'
      }));
    }
    return r;
  }

  /* ================= Vorlagen ================= */
  var ANREDE = 'Sehr geehrte Damen und Herren,';
  function gruss(land) { return land === 'CH' ? 'Freundliche Grüsse' : 'Mit freundlichen Grüßen'; }
  function bitte(land) { return L(land, { AT: 'Ich ersuche Sie', DE: 'Ich bitte Sie', CH: 'Ich bitte Sie' }); }

  var VORLAGEN = {
    'miete-kuendigung': {
      titel: 'Kündigung der Wohnung durch die Mieterin oder den Mieter',
      versandArt: 'frist',
      felder: [
        { id: 'objekt', label: 'Adresse der Wohnung', typ: 'text', hilfe: 'Straße, Hausnummer, Tür/Top, PLZ Ort' },
        { id: 'mietbeginn', label: 'Mietbeginn laut Vertrag', typ: 'date', hilfe: 'Bei befristeten Verträgen in Österreich: Beginn der Vertragsdauer bzw. der Verlängerung.' },
        { id: 'variante_AT', nur: 'AT', label: 'Art des Mietvertrags', typ: 'select', optionen: [['unbefristet-monatlich', 'Unbefristet, Miete monatlich'], ['unbefristet-laenger', 'Unbefristet, Miete in längeren Abständen'], ['befristet', 'Befristet (vorzeitige Kündigung nach § 29 Abs. 2 MRG)']] },
        { id: 'variante_DE', nur: 'DE', label: 'Art der Wohnung', typ: 'select', optionen: [['standard', 'Normale Mietwohnung'], ['moebliert', 'Möbliertes Zimmer in der Wohnung der Vermietung (§ 549 Abs. 2 Nr. 2 BGB)']] },
        { id: 'variante_CH', nur: 'CH', label: 'Kündigungstermin', typ: 'select', optionen: [['ortsueblich', 'Ortsübliche Termine (Gemeinde/Kanton)'], ['mietdauer', 'Kein Ortsgebrauch: Ende einer dreimonatigen Mietdauer']] },
        { id: 'termine_CH', nur: 'CH', label: 'Ortsübliche Termine (Monatsende)', typ: 'monate', hilfe: 'Häufig sind es mehrere Monatsenden im Jahr. Den Mietvertrag oder die Gemeinde fragen.' , def: '3,6,9' },
        { id: 'zugang', label: 'Wann geht der Brief voraussichtlich zu?', typ: 'date', hilfe: 'Postlaufzeit einrechnen. Maßgeblich ist der Zugang, nicht das Absendedatum.' },
        { id: 'feiertage_DE', nur: 'DE', label: 'Feiertage am Ort, an dem der Brief zugeht', typ: 'feiertage', land: 'DE', hilfe: 'Landesfeiertage (z. B. Fronleichnam, Reformationstag, Allerheiligen) zählen nicht als Werktag und verschieben den dritten Werktag.' },
        { id: 'vertrag_frist', label: 'Steht im Vertrag eine längere Frist oder ein anderer Termin?', typ: 'check', hilfe: 'Österreich und Schweiz: Dann gilt grundsätzlich der Vertrag, soweit er zulässig ist. Deutschland: Eine Abweichung zu Ihrem Nachteil ist nach § 573c Abs. 4 BGB unwirksam; ein vereinbarter Kündigungsverzicht kann die Kündigung aber zeitweise ausschließen. Der Rechner zeigt nur die gesetzliche Frist.' },
        { id: 'uebergabe', label: 'Terminvorschlag für die Wohnungsübergabe (optional)', typ: 'text' },
        { id: 'iban', label: 'Konto für die Rückzahlung der Kaution (optional)', typ: 'text', hilfe: 'IBAN und Kontoinhaber' },
        { id: 'mitmieter', label: 'Weitere Mieterinnen/Mieter, die mitunterschreiben', typ: 'text', hilfe: 'Alle im Vertrag genannten Personen sollten unterschreiben.' },
        { id: 'familie_CH', nur: 'CH', label: 'Familienwohnung: Zustimmung der Ehegattin/des Ehegatten bzw. eingetragenen Partners liegt vor', typ: 'check', hilfe: 'Art. 266m OR: Bei der Familienwohnung braucht es die ausdrückliche Zustimmung.' }
      ],
      fristen: function (land, v) {
        var opts = { land: land, zugang: v.zugang || HEUTE, feiertage: FT, mietbeginn: v.mietbeginn || null,
          variante: v['variante_' + land] || ({ AT: 'unbefristet-monatlich', DE: 'standard', CH: 'ortsueblich' })[land],
          terminMonate: String(v.termine_CH || '3,6,9').split(',') };
        if (land === 'DE') opts.eigeneFeiertage = landFeiertage('DE', opts.zugang, v.feiertage_DE);
        try { pruefeZugangNachBrief(land, v); return F.mietKuendigung(opts); } catch (e) { return { fehler: e.message }; }
      },
      text: function (land, v, fr) {
        var termin = fr && fr.termin ? datum(fr.termin, land) : '[Termin]';
        var a = [];
        a.push(ch(land, 'hiermit kündige ich ' + (leer(v.mitmieter) ? '' : 'gemeinsam mit ' + roh(v.mitmieter) + ' ') +
          'das Mietverhältnis über die Wohnung ' + oder(v.objekt, 'Adresse der Wohnung') + ' fristgerecht zum ' + termin + ', hilfsweise zum nächstmöglichen Termin.'));
        var sperre = null;
        if (land === 'AT') {
          // Tatsachen im Brief nur aus den geprüften Voraussetzungen (fr.jahrStatus) ableiten.
          var befr = fr && fr.regel === 'AT-29-2-MRG';
          var satz = 'Ich ersuche um eine kurze schriftliche Bestätigung des Kündigungstermins.';
          if (befr && fr.jahrStatus === 'abgelaufen') satz = 'Der Mietvertrag ist befristet. Das erste Jahr der Vertragsdauer ist mit ' + datum(fr.jahrEnde, land) + ' abgelaufen; ich mache daher von meinem Kündigungsrecht nach § 29 Abs. 2 MRG Gebrauch. ' + satz;
          else if (befr) satz = 'Der Mietvertrag ist befristet; ich mache von meinem Kündigungsrecht nach § 29 Abs. 2 MRG Gebrauch. ' + satz;
          if (befr && fr.jahrStatus === 'laeuft') sperre = 'ENTWURF – erst ab ' + datum(fr.fruehesterZugang, land) + ' verwendbar: Das Schreiben darf frühestens an diesem Tag zugehen (§ 29 Abs. 2 MRG, erstes Vertragsjahr endet am ' + datum(fr.jahrEnde, land) + ').';
          if (befr && fr.jahrStatus === 'unbekannt') sperre = 'ENTWURF – nicht versandfertig: Beginn der Vertragsdauer eintragen. Erst dann lässt sich prüfen, ob das erste Vertragsjahr abgelaufen ist (§ 29 Abs. 2 MRG).';
          a.push('Die Kündigung erfolgt schriftlich nach § 33 Abs. 1 MRG. ' + satz);
        }
        if (land === 'DE') a.push('Bitte bestätigen Sie mir den Eingang dieser Kündigung und das Beendigungsdatum schriftlich.');
        if (land === 'CH') a.push(ch(land, 'Bitte bestätigen Sie mir den Eingang dieser Kündigung und den Beendigungstermin schriftlich.' + (v.familie_CH ? ' Die Zustimmung meines Ehegatten bzw. meiner eingetragenen Partnerin oder meines eingetragenen Partners nach Art. 266m OR liegt vor; die Unterschrift steht unten.' : '')));
        if (!leer(v.uebergabe)) a.push(ch(land, 'Für die Übergabe der Wohnung schlage ich folgenden Termin vor: ' + roh(v.uebergabe) + '. ' + bitte(land) + ', mir mitzuteilen, ob der Termin passt.'));
        a.push(ch(land, bitte(land) + ', die Kaution nach Rückgabe der Wohnung ' + (leer(v.iban) ? 'auf das Ihnen bekannte Konto' : 'auf folgendes Konto: ' + roh(v.iban) + ',') + ' zurückzuzahlen' + (land === 'AT' ? ', samt den Zinsen aus ihrer Veranlagung' : '') + '.'));
        // Unterschriften: Mietparteien und Zustimmung (Art. 266m OR) getrennt bestimmen.
        var zusatz = [];
        if (!leer(v.mitmieter)) zusatz.push('Weitere Mieterin/weiterer Mieter: ' + String(v.mitmieter).trim());
        if (land === 'CH' && v.familie_CH) zusatz.push('Zustimmung nach Art. 266m OR (Ehegatte bzw. eingetragene Partnerin/eingetragener Partner)');
        return { betreff: 'Kündigung des Mietvertrags – ' + oder(v.objekt, 'Wohnung'), absaetze: a,
          unterschriften: 1 + zusatz.length, unterschriftZeilen: zusatz, sperre: sperre };
      }
    },

    'kaution': {
      titel: 'Rückforderung der Mietkaution', versandArt: 'beweis',
      felder: [
        { id: 'objekt', label: 'Adresse der Wohnung', typ: 'text' },
        { id: 'ende', label: 'Ende des Mietverhältnisses', typ: 'date' },
        { id: 'rueckgabe', label: 'Tag der Rückgabe (Schlüsselübergabe)', typ: 'date' },
        { id: 'betrag', label: 'Höhe der Kaution', typ: 'text', hilfe: 'z. B. EUR 2.400,– oder CHF 4\'200.–' },
        { id: 'protokoll', label: 'Es gibt ein Übergabeprotokoll ohne offene Mängel', typ: 'check' },
        { id: 'fristTage', label: 'Frist für die Rückzahlung (Tage ab Zugang)', typ: 'number', def: '14' }
      ].concat(SCHREIBFRIST_FELDER, [
        { id: 'iban', label: 'Konto für die Rückzahlung', typ: 'text', hilfe: 'IBAN und Kontoinhaber' }
      ]),
      fristen: function (land, v) {
        try { return schreibFrist(land, v); } catch (e) { return { fehler: e.message }; }
      },
      text: function (land, v, fr) {
        var a = [];
        a.push(ch(land, 'das Mietverhältnis über die Wohnung ' + oder(v.objekt, 'Adresse') + ' endete am ' + (v.ende ? datum(v.ende, land) : '[Datum]') + '. Die Wohnung habe ich am ' + (v.rueckgabe ? datum(v.rueckgabe, land) : '[Datum]') + ' zurückgegeben' + (v.protokoll ? '; das Übergabeprotokoll weist keine offenen Mängel aus.' : '.')));
        if (land === 'AT') a.push('Nach § 16b Abs. 2 MRG ist die Kaution nach Ende des Mietvertrags samt den Zinsen aus ihrer Veranlagung unverzüglich zurückzustellen, soweit sie nicht für berechtigte Forderungen aus dem Mietverhältnis herangezogen wird.');
        if (land === 'DE') a.push('Ich fordere Sie auf, über die Mietsicherheit abzurechnen und den mir zustehenden Betrag einschließlich der angefallenen Zinsen auszuzahlen.');
        if (land === 'CH') a.push(ch(land, 'Die Sicherheit ist nach Art. 257e OR auf einem Konto auf meinen Namen hinterlegt. Ich bitte Sie, der Bank die Freigabe zu erteilen.'));
        a.push(ch(land, bitte(land) + ', die Kaution in Höhe von ' + oder(v.betrag, 'Betrag') + (land === 'CH' ? ' freizugeben' : ' zurückzuzahlen') + (leer(v.iban) ? '' : ' (Konto: ' + roh(v.iban) + ')') + ', und zwar bis ' + (fr && fr.ende ? datum(fr.ende, land) : '[Datum]') + '. Falls Sie Teile zurückbehalten, ' + L(land, { AT: 'ersuche ich', DE: 'bitte ich', CH: 'bitte ich' }) + ' um eine nachvollziehbare Aufstellung mit Belegen.'));
        return { betreff: 'Rückzahlung der Kaution – ' + oder(v.objekt, 'Wohnung'), absaetze: a };
      }
    },

    'maengel': {
      titel: 'Mängelanzeige an die Vermietung', versandArt: 'beweis',
      felder: [
        { id: 'objekt', label: 'Adresse der Wohnung', typ: 'text' },
        { id: 'mangel', label: 'Was ist kaputt? (sachlich, mit Ort)', typ: 'textarea', hilfe: 'z. B. „Heizkörper im Schlafzimmer bleibt kalt, Thermostat auf Stufe 5“' },
        { id: 'seit', label: 'Seit wann besteht der Mangel?', typ: 'date' },
        { id: 'fristTage', label: 'Frist zur Behebung (Tage ab Zugang)', typ: 'number', def: '14' }
      ].concat(SCHREIBFRIST_FELDER, [
        { id: 'zugang_info', label: 'Zugang für Handwerker: erreichbar unter', typ: 'text' },
        { id: 'minderung', label: 'Mietzinsminderung bzw. Zinsbefreiung ausdrücklich vorbehalten', typ: 'check', def: true },
        { id: 'hinterlegung_CH', nur: 'CH', label: 'Hinterlegung künftiger Mietzinse androhen (Art. 259g OR)', typ: 'check' }
      ]),
      fristen: function (land, v) {
        try { return schreibFrist(land, v); } catch (e) { return { fehler: e.message }; }
      },
      text: function (land, v, fr) {
        var a = [], bis = fr && fr.ende ? datum(fr.ende, land) : '[Datum]';
        a.push(ch(land, 'in der von mir gemieteten Wohnung ' + oder(v.objekt, 'Adresse') + ' besteht ' + (v.seit ? 'seit ' + datum(v.seit, land) + ' ' : '') + 'folgender Mangel:'));
        zeilen(v.mangel).forEach(function (z) { a.push('– ' + z); });
        if (!zeilen(v.mangel).length) a.push('– [Beschreibung des Mangels]');
        a.push(ch(land, bitte(land) + ', den Mangel bis ' + bis + ' zu beheben.' + (leer(v.zugang_info) ? '' : ' Für einen Termin bin ich erreichbar unter ' + roh(v.zugang_info) + '.')));
        if (v.minderung) a.push(ch(land, L(land, {
          AT: 'Für die Dauer und im Ausmaß der Beeinträchtigung behalte ich mir die Zinsbefreiung bzw. -minderung nach § 1096 ABGB vor.',
          DE: 'Für die Zeit der Beeinträchtigung behalte ich mir die Minderung der Miete nach § 536 BGB vor.',
          CH: 'Ich behalte mir eine verhältnismässige Herabsetzung des Mietzinses nach Art. 259a OR vor.'
        })));
        if (land === 'CH' && v.hinterlegung_CH) a.push('Sollte der Mangel bis zum genannten Datum nicht beseitigt sein, werde ich künftig fällige Mietzinse bei der vom Kanton bezeichneten Stelle hinterlegen (Art. 259g OR).');
        a.push('Fotos des Mangels liegen bei.');
        return { betreff: ch(land, 'Mängelanzeige – ' + oder(v.objekt, 'Wohnung')), absaetze: a, anlagen: ['Fotos'] };
      }
    },

    'ruecktritt': {
      titel: 'Rücktritt bzw. Widerruf nach einem Online-Kauf', versandArt: 'frist',
      felder: [
        { id: 'bestellnr', label: 'Bestellnummer', typ: 'text' },
        { id: 'bestellt', label: 'Bestellt am', typ: 'date' },
        { id: 'erhalt', label: 'Ware erhalten am (bei Teillieferungen: letzte Lieferung)', typ: 'date' },
        { id: 'waren', label: 'Welche Waren?', typ: 'textarea' },
        { id: 'iban', label: 'Konto für die Rückzahlung (optional)', typ: 'text' }
      ],
      fristen: function (land, v) {
        if (land === 'CH') return { hinweisCH: true };
        try { return F.ruecktrittsfrist({ land: land, erhalt: v.erhalt || HEUTE, feiertage: FT }); } catch (e) { return { fehler: e.message }; }
      },
      text: function (land, v) {
        var a = [];
        if (land === 'CH') {
          a.push(ch(land, 'am ' + (v.bestellt ? datum(v.bestellt, land) : '[Datum]') + ' habe ich bei Ihnen bestellt (Bestellnummer ' + oder(v.bestellnr, 'Nummer') + '). Ich möchte die folgenden Artikel zurückgeben:'));
          (zeilen(v.waren).length ? zeilen(v.waren) : ['[Artikel]']).forEach(function (z) { a.push('– ' + z); });
          a.push(ch(land, 'Ihre Bedingungen sehen ein Rückgaberecht vor bzw. ich bitte Sie um Rücknahme aus Kulanz. Bitte teilen Sie mir mit, wie die Rücksendung abläuft' + (leer(v.iban) ? '' : ', und erstatten Sie den Betrag auf das Konto ' + roh(v.iban)) + '.'));
          return { betreff: 'Rückgabe – Bestellung ' + oder(v.bestellnr, 'Nummer'), absaetze: a };
        }
        a.push(L(land, { AT: 'hiermit trete ich von dem von mir abgeschlossenen Vertrag über den Kauf der folgenden Waren zurück:', DE: 'hiermit widerrufe ich den von mir abgeschlossenen Vertrag über den Kauf der folgenden Waren:' }));
        (zeilen(v.waren).length ? zeilen(v.waren) : ['[Artikel]']).forEach(function (z) { a.push('– ' + z); });
        a.push('Bestellt am ' + (v.bestellt ? datum(v.bestellt, land) : '[Datum]') + ', erhalten am ' + (v.erhalt ? datum(v.erhalt, land) : '[Datum]') + ', Bestellnummer ' + oder(v.bestellnr, 'Nummer') + '.');
        a.push(L(land, { AT: 'Ich ersuche um Rückzahlung aller Zahlungen einschließlich der Standardlieferkosten', DE: 'Bitte erstatten Sie alle Zahlungen einschließlich der Standardlieferkosten' }) + (leer(v.iban) ? ' über das ursprüngliche Zahlungsmittel' : ' auf das Konto ' + roh(v.iban)) + ' und um Mitteilung, wohin ich die Ware zurücksenden kann.');
        return { betreff: L(land, { AT: 'Rücktritt vom Vertrag – Bestellung ', DE: 'Widerruf – Bestellung ' }) + oder(v.bestellnr, 'Nummer'), absaetze: a };
      }
    },

    'reklamation': {
      titel: 'Reklamation wegen eines Mangels (Gewährleistung)', versandArt: 'beweis',
      felder: [
        { id: 'ware', label: 'Gekaufte Sache', typ: 'text' },
        { id: 'uebergabe', label: 'Übergabe bzw. Lieferung am', typ: 'date' },
        { id: 'beleg', label: 'Rechnungs- oder Bestellnummer', typ: 'text' },
        { id: 'mangel', label: 'Beschreibung des Mangels', typ: 'textarea' },
        { id: 'vertrag', label: 'Kaufvertrag geschlossen am (Bestelldatum)', typ: 'date', hilfe: 'Wichtig für die Verlängerung nach einer Reparatur (DE: Verträge ab 31.07.2026, AT: ab 01.10.2026).' },
        { id: 'entdeckt', label: 'Mangel entdeckt am', typ: 'date' },
        { id: 'nachbesserung', nur: 'AT,DE', label: 'Der Verkäufer hat den Mangel bereits im Rahmen der Gewährleistung repariert', typ: 'check', hilfe: 'DE: § 475e Abs. 5 BGB, AT: § 10 Abs. 2a VGG – einmalige Verlängerung um ein Jahr.' },
        { id: 'rueckerhalt', nur: 'DE', label: 'Ware nach Reparatur oder Austausch zurückerhalten am (optional)', typ: 'date', hilfe: '§ 475e Abs. 4 BGB: frühestens zwei Monate danach verjähren die Ansprüche wegen dieses Mangels.' },
        { id: 'wunsch', label: 'Was verlangen Sie zuerst?', typ: 'select', optionen: [['reparatur', 'Reparatur'], ['austausch', 'Austausch gegen eine mangelfreie Sache']] },
        { id: 'fristTage', label: 'Frist (Tage ab Zugang)', typ: 'number', def: '14' }
      ].concat(SCHREIBFRIST_FELDER),
      fristen: function (land, v) {
        try {
          var g = F.gewaehrleistung({ land: land, uebergabe: v.uebergabe || HEUTE, vertrag: v.vertrag || null, entdeckt: v.entdeckt || null,
            nachbesserung: land !== 'CH' && !!v.nachbesserung, rueckerhalt: land === 'DE' ? v.rueckerhalt || null : null });
          try { g.antwort = schreibFrist(land, v); g.antwortBis = g.antwort.ende; } catch (e2) { g.fristFehler = e2.message; }
          return g;
        } catch (e) { return { fehler: e.message }; }
      },
      text: function (land, v, fr) {
        var a = [], bis = fr && fr.antwortBis ? datum(fr.antwortBis, land) : '[Datum]';
        a.push(ch(land, 'am ' + (v.uebergabe ? datum(v.uebergabe, land) : '[Datum]') + ' habe ich von Ihnen ' + oder(v.ware, 'Sache') + ' erhalten (' + oder(v.beleg, 'Rechnungsnummer') + '). ' + (v.entdeckt ? 'Am ' + datum(v.entdeckt, land) + ' habe ich folgenden Mangel festgestellt:' : 'Die Sache weist folgenden Mangel auf:')));
        (zeilen(v.mangel).length ? zeilen(v.mangel) : ['[Beschreibung]']).forEach(function (z) { a.push('– ' + z); });
        var w = v.wunsch === 'austausch';
        a.push(ch(land, L(land, {
          AT: 'Im Rahmen der gesetzlichen Gewährleistung ersuche ich um ' + (w ? 'Austausch' : 'Verbesserung (Reparatur)') + ' bis ' + bis + '.',
          DE: 'Im Rahmen der gesetzlichen Mängelrechte verlange ich Nacherfüllung durch ' + (w ? 'Lieferung einer mangelfreien Sache' : 'Beseitigung des Mangels') + ' bis ' + bis + ' (§ 439 BGB).',
          CH: 'Ich zeige Ihnen den Mangel hiermit nach Art. 201 OR an und bitte um ' + (w ? 'Ersatz durch eine mangelfreie Sache' : 'Reparatur') + ' bis ' + bis + '. Meine weiteren gesetzlichen Rechte behalte ich mir vor.'
        })));
        if (land !== 'CH') a.push(L(land, { AT: 'Die Kosten dafür sind von Ihnen zu tragen. Sollte das nicht möglich sein, behalte ich mir Preisminderung oder Vertragsauflösung vor.', DE: 'Die dafür erforderlichen Aufwendungen tragen Sie. Für den Fall, dass die Nacherfüllung scheitert, behalte ich mir Rücktritt oder Minderung vor.' }));
        a.push('Eine Kopie des Kaufbelegs liegt bei.');
        return { betreff: ch(land, 'Mängelrüge – ' + oder(v.ware, 'Sache') + ', ' + oder(v.beleg, 'Beleg')), absaetze: a, anlagen: ['Kopie des Kaufbelegs', 'Fotos'] };
      }
    },

    'handy': {
      titel: 'Kündigung eines Handy- oder Internetvertrags', versandArt: 'frist',
      felder: [
        { id: 'produkt', label: 'Tarif bzw. Produkt', typ: 'text' },
        { id: 'kundennr', label: 'Kunden- oder Vertragsnummer', typ: 'text' },
        { id: 'rufnr', label: 'Rufnummer bzw. Anschlusskennung', typ: 'text' },
        { id: 'beginn', label: 'Vertragsbeginn', typ: 'date' },
        { id: 'mindest', label: 'Vereinbarte Mindestlaufzeit (Monate)', typ: 'number', def: '24' },
        { id: 'portierung', label: 'Rufnummer zu einem anderen Anbieter mitnehmen', typ: 'check' }
      ],
      fristen: function (land, v) {
        if (!v.beginn) return { leer: true };
        try {
          var ende = F.addDays(F.addMonths(F.parse(v.beginn), +v.mindest || 24), -1);
          var r = { mindestEnde: F.iso(ende) };
          if (land === 'DE' || land === 'AT') {
            var zugang = F.addDays(F.parse(v.datum || HEUTE), 3); // Annahme: Zugang 3 Tage nach dem Datum des Schreibens
            r.fruehestens = F.iso(zugang.getTime() > ende.getTime() ? F.addMonths(zugang, 1) : ende);
          }
          return r;
        } catch (e) { return { fehler: e.message }; }
      },
      text: function (land, v) {
        var a = [];
        a.push(ch(land, 'hiermit kündige ich meinen Vertrag ' + oder(v.produkt, 'Tarif') + ' (Kundennummer ' + oder(v.kundennr, 'Nummer') + (leer(v.rufnr) ? '' : ', Rufnummer ' + roh(v.rufnr)) + ') zum nächstmöglichen Termin.'));
        if (land === 'DE') a.push('Sofern die anfängliche Mindestlaufzeit bereits abgelaufen ist, gilt nach § 56 Abs. 3 TKG eine Kündigungsfrist von einem Monat.');
        if (land === 'AT') a.push('Ich ersuche um Beendigung unter Einhaltung der einmonatigen Kündigungsfrist nach § 135 Abs. 5 TKG 2021 bzw. zum Ende einer allenfalls noch laufenden Mindestvertragsdauer.');
        if (v.portierung) a.push(ch(land, L(land, { AT: 'Ich möchte meine Rufnummer zu einem anderen Anbieter mitnehmen und ersuche um die dafür nötigen Angaben.', DE: 'Ich möchte meine Rufnummer zu einem anderen Anbieter mitnehmen. Bitte senden Sie mir die erforderlichen Angaben.', CH: 'Ich möchte meine Rufnummer zu einem anderen Anbieter mitnehmen. Bitte teilen Sie mir das Vorgehen mit.' })));
        a.push(ch(land, bitte(land) + ', mir die Kündigung und das genaue Vertragsende schriftlich zu bestätigen und Leihgeräte samt Rücksendeweg zu nennen.'));
        return { betreff: ch(land, 'Kündigung – Kundennummer ' + oder(v.kundennr, 'Nummer')), absaetze: a };
      }
    },

    'fitness': {
      titel: 'Kündigung einer Mitgliedschaft im Fitnessstudio', versandArt: 'frist',
      felder: [
        { id: 'studio', label: 'Studio und Standort', typ: 'text' },
        { id: 'mitgliednr', label: 'Mitgliedsnummer', typ: 'text' },
        { id: 'beginn', label: 'Vertragsbeginn', typ: 'date' },
        { id: 'art', label: 'Art der Kündigung', typ: 'select', optionen: [['ordentlich', 'Ordentlich zum nächstmöglichen Termin'], ['wichtig', 'Aus wichtigem Grund (z. B. ärztlich belegte Sportunfähigkeit)']] },
        { id: 'grund', label: 'Kurze Begründung (nur bei wichtigem Grund)', typ: 'textarea' },
        { id: 'abbuchung', label: 'Einzugsermächtigung bzw. Lastschrift für die Zeit nach Vertragsende widerrufen', typ: 'check', def: true }
      ],
      fristen: function () { return null; },
      text: function (land, v) {
        var a = [], w = v.art === 'wichtig';
        a.push(ch(land, 'hiermit kündige ich meine Mitgliedschaft (Mitgliedsnummer ' + oder(v.mitgliednr, 'Nummer') + ') ' + (w ? 'aus wichtigem Grund mit sofortiger Wirkung, hilfsweise zum nächstmöglichen Termin.' : 'zum nächstmöglichen Termin.')));
        if (w) { a.push(ch(land, 'Begründung: ' + oder(v.grund, 'Grund') + (land === 'DE' ? ' Die Fortsetzung des Vertrags ist mir nicht zumutbar (§ 314 BGB).' : ''))); a.push('Einen Nachweis lege ich bei; Diagnosen gebe ich nicht bekannt.'); }
        if (v.abbuchung) a.push(ch(land, 'Für die Zeit nach dem Vertragsende widerrufe ich meine Einzugsermächtigung.'));
        a.push(ch(land, bitte(land) + ', mir die Kündigung und das Vertragsende schriftlich zu bestätigen.'));
        return { betreff: ch(land, 'Kündigung der Mitgliedschaft – ' + oder(v.mitgliednr, 'Mitgliedsnummer')), absaetze: a, anlagen: w ? ['Nachweis'] : [] };
      }
    },

    'versicherung': {
      titel: 'Kündigung eines Versicherungsvertrags', versandArt: 'frist',
      felder: [
        { id: 'sparte', label: 'Versicherung (Sparte)', typ: 'text', hilfe: 'z. B. Haushaltsversicherung, Hausrat, Rechtsschutz' },
        { id: 'polizze', label: L('AT', { AT: 'Polizzennummer / Versicherungsscheinnummer' }), typ: 'text' },
        { id: 'ablauf', label: 'Ende der laufenden Versicherungsperiode', typ: 'date', hilfe: 'Steht meist auf der letzten Prämienrechnung.' },
        { id: 'fristMonate', label: 'Kündigungsfrist laut Vertrag (Monate)', typ: 'number', def: '1' },
        { id: 'grund', label: 'Anlass', typ: 'select', optionen: [['ordentlich', 'Ordentlich zum Ablauf'], ['schaden', 'Nach einem Schadensfall (Vertrag prüfen)'], ['praemie', 'Wegen einer Prämien- bzw. Beitragserhöhung (Vertrag prüfen)']] }
      ],
      fristen: function (land, v) {
        if (!v.ablauf) return { leer: true };
        try { return { spaetesterZugang: F.spaetesterZugangFuerTermin(v.ablauf, +v.fristMonate || 1), termin: v.ablauf }; } catch (e) { return { fehler: e.message }; }
      },
      text: function (land, v, fr) {
        var a = [], g = v.grund;
        a.push(ch(land, 'hiermit kündige ich den Vertrag ' + oder(v.sparte, 'Versicherung') + ', ' + L(land, { AT: 'Polizzennummer ', DE: 'Versicherungsscheinnummer ', CH: 'Policennummer ' }) + oder(v.polizze, 'Nummer') + (g === 'ordentlich' ? ', zum Ende der laufenden Versicherungsperiode am ' + (v.ablauf ? datum(v.ablauf, land) : '[Datum]') + ', hilfsweise zum nächstmöglichen Termin.' : ', zum nächstmöglichen Termin.')));
        if (g === 'schaden') a.push(ch(land, 'Die Kündigung stütze ich auf das Kündigungsrecht nach Eintritt des Versicherungsfalls, wie es Gesetz und Versicherungsbedingungen vorsehen.'));
        if (g === 'praemie') a.push(ch(land, 'Anlass ist die mitgeteilte Erhöhung der Prämie. Ich mache von dem Kündigungsrecht Gebrauch, das mir die Versicherungsbedingungen dafür einräumen.'));
        a.push(ch(land, bitte(land) + ', mir die Kündigung und das Vertragsende schriftlich zu bestätigen und zu viel bezahlte Prämien zu erstatten.'));
        return { betreff: ch(land, 'Kündigung – ' + oder(v.polizze, 'Vertragsnummer')), absaetze: a };
      }
    },

    'vollmacht-post': {
      titel: 'Vollmacht für die Abholung von Briefen und Paketen', versandArt: 'info', keinEmpfaengerPflicht: true,
      felder: [
        { id: 'bev_name', label: 'Name der bevollmächtigten Person', typ: 'text' },
        { id: 'bev_geb', label: 'Geburtsdatum der bevollmächtigten Person', typ: 'date' },
        { id: 'bev_adr', label: 'Anschrift der bevollmächtigten Person', typ: 'text' },
        { id: 'umfang', label: 'Umfang', typ: 'select', optionen: [['alles', 'Briefe, eingeschriebene Sendungen und Pakete'], ['pakete', 'Nur Pakete und Päckchen'], ['einzeln', 'Nur eine bestimmte Sendung']] },
        { id: 'sendung', label: 'Sendungsnummer (bei einer bestimmten Sendung)', typ: 'text' },
        { id: 'von', label: 'Gültig ab', typ: 'date' },
        { id: 'bis', label: 'Gültig bis', typ: 'date' }
      ],
      fristen: function () { return null; },
      text: function (land, v) {
        var u = { alles: 'Briefe, eingeschriebene Sendungen und Pakete, die an mich adressiert sind', pakete: 'Pakete und Päckchen, die an mich adressiert sind', einzeln: 'die Sendung mit der Nummer ' + oder(v.sendung, 'Sendungsnummer') }[v.umfang || 'alles'];
        var a = [];
        a.push(ch(land, 'ich bevollmächtige hiermit ' + oder(v.bev_name, 'Name') + (v.bev_geb ? ', geboren am ' + datum(v.bev_geb, land) : '') + (leer(v.bev_adr) ? '' : ', wohnhaft ' + roh(v.bev_adr)) + ', ' + u + ' in meinem Namen entgegenzunehmen, abzuholen und den Empfang zu bestätigen.'));
        a.push('Die Vollmacht gilt ' + (v.von ? 'ab ' + datum(v.von, land) + ' ' : '') + (v.bis ? 'bis einschließlich ' + datum(v.bis, land) : 'bis auf Widerruf') + '.');
        if (land === 'AT') a.push('Hinweis für Sendungen von Behörden und Gerichten: Dokumente mit dem Vermerk „Nicht an Postbevollmächtigte“ und manche eigenhändig zuzustellenden Schriftstücke dürfen nur mir persönlich übergeben werden.');
        a.push(ch(land, 'Die bevollmächtigte Person weist sich mit einem amtlichen Lichtbildausweis aus. Eine Kopie meines Ausweises liegt bei.'));
        return { betreff: 'Vollmacht zur Entgegennahme von Postsendungen', absaetze: a, anlagen: ['Kopie meines Ausweises'], unterschriften: 1, keineAnrede: true };
      }
    },

    'vollmacht-behoerde': {
      titel: 'Vollmacht für einen Behördenweg', versandArt: 'behoerde',
      felder: [
        { id: 'bev_name', label: 'Name der bevollmächtigten Person', typ: 'text' },
        { id: 'bev_geb', label: 'Geburtsdatum der bevollmächtigten Person', typ: 'date' },
        { id: 'bev_adr', label: 'Anschrift der bevollmächtigten Person', typ: 'text' },
        { id: 'behoerde', label: 'Behörde bzw. Amt', typ: 'text' },
        { id: 'sache', label: 'Angelegenheit (möglichst genau, mit Aktenzeichen)', typ: 'textarea' },
        { id: 'zustellung', label: 'Schriftstücke sollen an die bevollmächtigte Person zugestellt werden', typ: 'check' },
        { id: 'bis', label: 'Gültig bis (optional)', typ: 'date' }
      ],
      fristen: function () { return null; },
      text: function (land, v) {
        var a = [];
        a.push(ch(land, 'ich bevollmächtige hiermit ' + oder(v.bev_name, 'Name') + (v.bev_geb ? ', geboren am ' + datum(v.bev_geb, land) : '') + (leer(v.bev_adr) ? '' : ', wohnhaft ' + roh(v.bev_adr)) + ', mich gegenüber ' + oder(v.behoerde, 'Behörde') + ' in folgender Angelegenheit zu vertreten:'));
        (zeilen(v.sache).length ? zeilen(v.sache) : ['[Angelegenheit, Aktenzeichen]']).forEach(function (z) { a.push('– ' + z); });
        a.push(ch(land, 'Die Vollmacht umfasst das Stellen von Anträgen, die Akteneinsicht, die Abgabe und Entgegennahme von Erklärungen sowie die Vorlage und Abholung von Unterlagen in dieser Angelegenheit.' + (v.zustellung ? ' Schriftstücke ' + L(land, { AT: 'ersuche ich', DE: 'bitte ich', CH: 'bitte ich' }) + ' an die bevollmächtigte Person zuzustellen.' : '')));
        a.push('Die Vollmacht gilt ' + (v.bis ? 'bis einschließlich ' + datum(v.bis, land) : 'bis auf Widerruf') + '. Persönliches Erscheinen, wo es gesetzlich vorgeschrieben ist, ersetzt sie nicht.');
        return { betreff: 'Vollmacht – ' + oder(v.behoerde, 'Behörde'), absaetze: a, anlagen: ['Kopie meines Ausweises'], keineAnrede: true };
      }
    },

    'verein-austritt': {
      titel: 'Austritt aus einem Verein', versandArt: 'frist',
      felder: [
        { id: 'verein', label: 'Name des Vereins', typ: 'text' },
        { id: 'mitgliednr', label: 'Mitgliedsnummer (falls vorhanden)', typ: 'text' },
        { id: 'zugang', label: 'Voraussichtlicher Zugang beim Verein', typ: 'date' },
        { id: 'statuten', label: 'Die Statuten/Satzung regeln Frist oder Termin', typ: 'check', hilfe: 'Dann gelten diese Regeln. Ohne Regel siehe Erklärteil unten.' },
        { id: 'abbuchung', label: 'Einzugsermächtigung nach dem Austritt widerrufen', typ: 'check', def: true }
      ],
      fristen: function (land, v) {
        try { pruefeZugangNachBrief(land, v); } catch (e) { return { fehler: e.message }; }
        if (land === 'CH' && !v.statuten) { try { return F.vereinAustrittCH({ zugang: v.zugang || HEUTE }); } catch (e) { return { fehler: e.message }; } }
        return null;
      },
      text: function (land, v, fr) {
        var a = [];
        var zum = land === 'CH' && fr && fr.austritt && !v.statuten ? 'auf den ' + datum(fr.austritt, land) + ', hilfsweise auf den nächstmöglichen Termin' : 'zum nächstmöglichen Termin';
        a.push(ch(land, 'hiermit erkläre ich meinen Austritt aus dem Verein ' + oder(v.verein, 'Verein') + (leer(v.mitgliednr) ? '' : ' (Mitgliedsnummer ' + roh(v.mitgliednr) + ')') + ' ' + zum + '.'));
        if (v.abbuchung) a.push('Für die Zeit nach dem Austritt widerrufe ich meine Einzugsermächtigung.');
        a.push(ch(land, bitte(land) + ', mir den Austritt und das Datum, ab dem keine Beiträge mehr fällig werden, schriftlich zu bestätigen.'));
        return { betreff: ch(land, 'Austritt aus dem Verein' + (leer(v.mitgliednr) ? '' : ' – Mitgliedsnummer ' + roh(v.mitgliednr))), absaetze: a };
      }
    },

    'verein-einladung': {
      titel: 'Einladung zur Mitgliederversammlung', versandArt: 'info', keinEmpfaengerPflicht: true,
      felder: [
        { id: 'verein', label: 'Name des Vereins', typ: 'text' },
        { id: 'termin', label: 'Datum der Versammlung', typ: 'date' },
        { id: 'uhrzeit', label: 'Uhrzeit', typ: 'text', def: '19:00 Uhr' },
        { id: 'ortv', label: 'Ort (oder Hinweis auf Online-Teilnahme)', typ: 'text' },
        { id: 'top', label: 'Tagesordnung (ein Punkt pro Zeile)', typ: 'textarea', def: 'Begrüßung und Feststellung der Beschlussfähigkeit\nBericht des Vorstands\nBericht der Rechnungsprüfung\nEntlastung des Vorstands\nWahlen\nAllfälliges' },
        { id: 'antraege', label: 'Anträge bis (Datum, laut Statuten)', typ: 'date' },
        { id: 'unterzeichnet', label: 'Unterzeichnet von (Funktion und Name)', typ: 'text' }
      ],
      fristen: function () { return null; },
      text: function (land, v) {
        var a = [];
        a.push(ch(land, 'der Vorstand lädt alle Mitglieder des Vereins ' + oder(v.verein, 'Verein') + ' herzlich zur ordentlichen Mitgliederversammlung ein:'));
        a.push(ch(land, (v.termin ? F.weekdayDE(v.termin) + ', ' + datum(v.termin, land) : '[Datum]') + ', ' + oder(v.uhrzeit, 'Uhrzeit') + ', ' + oder(v.ortv, 'Ort')));
        a.push('Tagesordnung:');
        (zeilen(v.top).length ? zeilen(v.top) : ['[Tagesordnungspunkt]']).forEach(function (z, i) { a.push((i + 1) + '. ' + ch(land, land === 'CH' ? z.replace(/^Allfälliges$/, 'Varia') : z)); });
        if (v.antraege) a.push(ch(land, 'Anträge zur Tagesordnung reichen Sie bitte bis ' + datum(v.antraege, land) + ' schriftlich beim Vorstand ein. Über Gegenstände, die nicht angekündigt sind, kann nur beschlossen werden, soweit Gesetz und Statuten das zulassen.'));
        a.push('Wir freuen uns auf Ihre Teilnahme.');
        return { betreff: ch(land, 'Einladung zur Mitgliederversammlung ' + (v.termin ? F.parse(v.termin).getUTCFullYear() : '')), absaetze: a, anrede: 'Liebe Mitglieder,', signatur: oder(v.unterzeichnet, 'Funktion und Name') };
      }
    },

    'leer': {
      titel: 'Leerer Brief', versandArt: 'info',
      felder: [
        { id: 'betreff', label: 'Betreff', typ: 'text' },
        { id: 'anrede_frei', label: 'Anrede', typ: 'text', def: 'Sehr geehrte Damen und Herren,' },
        { id: 'inhalt', label: 'Text (Absätze mit Leerzeile trennen)', typ: 'textarea' },
        { id: 'anlagen_frei', label: 'Anlagen (eine pro Zeile)', typ: 'textarea' }
      ],
      fristen: function () { return null; },
      text: function (land, v) {
        var abs = String(v.inhalt || '').split(/\n\s*\n/).map(function (s) { return s.replace(/\s*\n\s*/g, ' ').trim(); }).filter(Boolean);
        return { betreff: oder(v.betreff, 'Betreff'), absaetze: abs.length ? abs : ['[Ihr Text]'], anrede: leer(v.anrede_frei) ? ANREDE : v.anrede_frei.trim(), anlagen: zeilen(v.anlagen_frei) };
      }
    }
  };

  /* ================= Fristen-Anzeige im Brief-Assistenten ================= */
  function fristenHtml(id, land, fr) {
    if (!fr) return '';
    if (fr.fehler) return '<p class="nok">' + esc(isoText(fr.fehler, land)) + '</p>';
    var z = function (label, wert, mark) { return '<div class="fristzeile"><span>' + esc(label) + '</span><b' + (mark ? ' class="mark"' : '') + '>' + esc(wert) + '</b></div>'; };
    var h = '';
    if (id === 'miete-kuendigung') {
      if (fr.fruehesterZugang) h += z('Frühester zulässiger Zugang (§ 29 Abs. 2 MRG)', datum(fr.fruehesterZugang, land) + ' (' + F.weekdayDE(fr.fruehesterZugang) + ')', true);
      h += z('Kündigungstermin (Ende des Mietverhältnisses)', datum(fr.termin, land), true);
      h += z('Spätester Zugang beim Empfänger', datum(fr.spaetesterZugang, land) + ' (' + F.weekdayDE(fr.spaetesterZugang) + ')', true);
      h += z('Puffer bis dahin', fr.puffer >= 0 ? fr.puffer + ' Tage' : 'überschritten');
      if (fr.hinweis) h += '<p class="fristquelle">' + esc(fr.hinweis.replace(/\d{4}-\d{2}-\d{2}/g, function (d) { return datum(d, land); })) + '</p>';
      h += '<p class="fristquelle">Grundlage: ' + quelleHtml(fr.regel) + (land === 'AT' ? ', Form: ' + quelleHtml('AT-33-MRG') : land === 'DE' ? ', Form: ' + quelleHtml('DE-568') : ', Form: ' + quelleHtml('CH-266l')) + '. Vertragliche Abweichungen gehen vor, soweit sie zulässig sind.</p>';
    } else if (id === 'ruecktritt') {
      if (fr.hinweisCH) return '<p>In der Schweiz gibt es kein allgemeines gesetzliches Widerrufsrecht für Online-Käufe. Maßgeblich sind die Bedingungen des Shops. Das Schreiben ist deshalb als Rückgabe- bzw. Kulanzanfrage formuliert.</p>';
      h += z('Letzter Tag für die Absendung', datum(fr.ende, land), true);
      if (fr.verschoben.length) h += '<p class="fristquelle">Verschoben, weil ' + fr.verschoben.map(function (s) { return datum(s.datum, land) + ' (' + s.grund + ')'; }).join(', ') + ' kein Werktag ist.</p>';
      h += '<p class="fristquelle">Grundlage: ' + quelleHtml(fr.regel) + '. Es genügt, die Erklärung innerhalb der Frist abzusenden.</p>';
    } else if (id === 'reklamation') {
      h += gewaehrleistungHtml(land, fr, z);
      if (fr.fristFehler) h += '<p class="nok">' + esc(fr.fristFehler) + '</p>';
      else h += schreibFristHtml(land, fr.antwort, z);
    } else if (id === 'kaution' || id === 'maengel') {
      h += schreibFristHtml(land, fr, z);
      h += '<p class="fristquelle">Eine angemessene Frist setzen Sie selbst; sie ist im Gesetz nicht in Tagen festgelegt. Fristende auf Wochenende oder Feiertag wird auf den nächsten Werktag gelegt.</p>';
    } else if (id === 'handy') {
      if (fr.leer) return '<p>Tragen Sie den Vertragsbeginn ein, um das Ende der Mindestlaufzeit zu sehen.</p>';
      h += z('Ende der Mindestlaufzeit', datum(fr.mindestEnde, land), true);
      if (fr.fruehestens) h += z('Frühestmögliches Vertragsende bei Zugang 3 Tage nach dem Datum des Schreibens', datum(fr.fruehestens, land), true);
      h += '<p class="fristquelle">' + (land === 'DE' ? 'Nach der Mindestlaufzeit: Kündigung jederzeit mit einem Monat Frist (<a href="https://www.gesetze-im-internet.de/tkg_2021/__56.html" rel="noopener" target="_blank">§ 56 Abs. 3 TKG</a>).' : land === 'AT' ? 'Kündigungsfrist ein Monat, Mindestvertragsdauer bleibt unberührt (<a href="https://www.ris.bka.gv.at/eli/bgbl/i/2021/190/P135/NOR40238593" rel="noopener" target="_blank">§ 135 Abs. 5 TKG 2021</a>).' : 'In der Schweiz regeln die Vertragsbedingungen des Anbieters Laufzeit und Frist.') + '</p>';
    } else if (id === 'versicherung') {
      if (fr.leer) return '<p>Tragen Sie das Ende der Versicherungsperiode ein.</p>';
      h += z('Vertragsende', datum(fr.termin, land));
      h += z('Spätester Zugang beim Versicherer', datum(fr.spaetesterZugang, land), true);
      h += '<p class="fristquelle">Berechnet mit der Frist aus Ihrem Vertrag. Gesetzliche Rahmen: ' + (land === 'AT' ? '<a href="https://www.ris.bka.gv.at/eli/bgbl/1959/2/P8/NOR40138452" rel="noopener" target="_blank">§ 8 VersVG</a>' : land === 'DE' ? '<a href="https://www.gesetze-im-internet.de/vvg_2008/__11.html" rel="noopener" target="_blank">§ 11 VVG</a>' : '<a href="https://www.fedlex.admin.ch/eli/cc/24/719_735_717/de#art_35_a" rel="noopener" target="_blank">Art. 35a VVG</a>') + '.</p>';
    } else if (id === 'verein-austritt') {
      h += z('Austritt wirksam auf', datum(fr.austritt, land), true);
      h += z('Spätester Zugang beim Verein', datum(fr.spaetesterZugang, land), true);
      h += '<p class="fristquelle">Nur ohne abweichende Statuten: ' + quelleHtml('CH-70-ZGB') + '.</p>';
    }
    return h;
  }

  /*
   * Gewährleistung: Anzeige nur aus dem Ergebnis von F.gewaehrleistung. Nie als endgültiges Ende der
   * Ansprüche beschriften – ohne Sonderregel heißt der Wert "Grundfrist".
   */
  var GW_REGEL = {
    'DE-475e-3': 'Ablaufhemmung: vier Monate ab dem ersten Zeigen des Mangels (§ 475e Abs. 3 BGB)',
    'DE-475e-4': 'zwei Monate ab Rückerhalt nach Nacherfüllung (§ 475e Abs. 4 BGB)',
    'DE-475e-5': 'Verlängerung um zwölf Monate nach Nachbesserung (§ 475e Abs. 5 BGB)',
    'AT-10-2a': 'Verlängerung um ein Jahr nach Verbesserung (§ 10 Abs. 2a VGG)'
  };
  function gewaehrleistungHtml(land, fr, z) {
    var h = '';
    if (fr.vermutungBis) h += z('Vermutung, dass der Mangel schon bei Übergabe bestand, bis', datum(fr.vermutungBis, land));
    h += z('Grundfrist (zwei Jahre ab Übergabe)', datum(fr.grundfrist, land), fr.nurGrundfrist);
    if (land === 'AT') {
      if (fr.fristEnde !== fr.grundfrist) h += z('Verlängerte Gewährleistungsfrist (Mangel muss hervorkommen bis)', datum(fr.fristEnde, land), true);
      h += z('Verjährung frühestens (gerichtlich geltend machen bis)', datum(fr.verjaehrung, land), true);
    } else if (land === 'DE' && !fr.nurGrundfrist) {
      h += z('Verjährung frühestens am (nach den erfassten Regeln)', datum(fr.verjaehrung, land), true);
    }
    if (fr.angewandt.length) h += '<p class="fristquelle">Berücksichtigt: ' + fr.angewandt.map(function (k) { return esc(GW_REGEL[k]); }).join('; ') + '.</p>';
    fr.hinweise.forEach(function (t) { h += '<p class="fristquelle">' + esc(t) + '</p>'; });
    h += '<p class="fristquelle">Kein endgültiges Ende Ihrer Ansprüche: ' + L(land, {
      DE: 'Nicht eingerechnet sind etwa die Hemmung durch Verhandlungen oder Klage (§§ 203, 204 BGB), Arglist, Garantien und digitale Elemente.',
      AT: 'Nicht eingerechnet sind etwa Garantien, Rechtsmängel und digitale Leistungen. Haben Sie den Mangel innerhalb der Frist angezeigt, bleibt die Einrede nach § 28 Abs. 3 VGG.',
      CH: 'Nicht eingerechnet sind etwa absichtliche Täuschung (Art. 210 Abs. 6 OR), Garantien und abweichende Vereinbarungen bei gebrauchten Sachen. Mängel sind sofort nach Entdeckung zu rügen (Art. 201 OR).'
    }) + ' Grundlage: ' + quelleHtml(land === 'AT' ? 'AT-VGG' : land === 'DE' ? 'DE-438' : 'CH-210') + (land === 'DE' ? ', ' + quelleHtml('DE-475e') : '') + ' (Kauf neuer Waren durch Verbraucher).</p>';
    return h;
  }

  /* Landes-/Ortsfeiertage aus der Auswahl für das Zugangsjahr und das Folgejahr auflösen. */
  function landFeiertage(land, zugang, ids) {
    var liste = String(ids || '').split(',').filter(Boolean);
    if (!liste.length) return [];
    var y; try { y = F.parse(zugang).getUTCFullYear(); } catch (e) { return []; }
    return F.expandOptional(land, [y, y + 1], FT, liste);
  }

  /* ================= A4-Vorschau ================= */
  function briefDaten(id, land, v) {
    var vor = VORLAGEN[id], fr = vor.fristen ? vor.fristen(land, v) : null;
    var t = vor.text(land, v, fr);
    // Fehlt eine Eingabe oder ist eine Frist nicht sicher berechenbar, ist der Brief nicht versandfertig.
    var grund = fr && (fr.fehler || fr.fristFehler);
    if (grund && !t.sperre) t.sperre = ch(land, 'ENTWURF – nicht versandfertig: ' + isoText(grund, land));
    var abs = [v.abs_name, v.abs_strasse, v.abs_ort].map(function (s) { return (s || '').trim(); }).filter(Boolean);
    var emp = [v.emp_name, v.emp_zusatz, v.emp_strasse, v.emp_ort, v.emp_land ? String(v.emp_land).toUpperCase() : ''].map(function (s) { return (s || '').trim(); }).filter(Boolean);
    return {
      land: land, fr: fr, vor: vor, abs: abs, absMail: (v.abs_mail || '').trim(), emp: emp,
      vermerk: v.vermerk || '', ort: (v.ort || '').trim(), datum: v.datum || HEUTE,
      betreff: zurueck(t.betreff), anrede: t.keineAnrede ? '' : zurueck(t.anrede || ANREDE), absaetze: t.absaetze.map(zurueck), gruss: gruss(land),
      anlagen: t.anlagen || [], unterschriften: t.unterschriften || 1, signatur: zurueck(t.signatur || (v.abs_name || '').trim()),
      unterschriftZeilen: t.unterschriftZeilen || (t.unterschriften > 1 ? ['weitere Unterschrift(en)'] : []), sperre: t.sperre || null,
      fensterRechts: !!v.fenster_rechts
    };
  }

  /*
   * Gespeicherte Entwürfe: Beim Speichern wird der Kern der berechneten Fristen mitgespeichert.
   * Beim Wiederherstellen wird nichts still neu berechnet: Weicht das Ergebnis ab, bleibt bei
   * Schreiben mit eigener Frist das gespeicherte Fristende (als eigenes Datum eingetragen),
   * sonst wird die Abweichung deutlich angezeigt. Ein vergangenes Datum des Schreibens wird
   * unverändert übernommen und markiert.
   */
  var KERN = [['ende', 'Fristende'], ['antwortBis', 'Frist im Schreiben'], ['termin', 'Termin'], ['spaetesterZugang', 'spätester Zugang'],
    ['fruehesterZugang', 'frühester Zugang'], ['austritt', 'Austritt'], ['fruehestens', 'frühestes Vertragsende'], ['mindestEnde', 'Ende der Mindestlaufzeit'],
    ['fristEnde', 'Gewährleistungsfrist'], ['verjaehrung', 'Verjährung']];
  function fristKern(fr) {
    if (!fr || fr.fehler) return null;
    var k = {}, n = 0;
    KERN.forEach(function (x) { if (typeof fr[x[0]] === 'string') { k[x[0]] = fr[x[0]]; n++; } });
    return n ? k : null;
  }
  function kernText(k, land) {
    return KERN.filter(function (x) { return k && k[x[0]]; }).map(function (x) { return x[1] + ' ' + datum(k[x[0]], land); }).join(', ');
  }
  function wiederherstellPruefung(id, land, v, heute) {
    var out = { fristBis: null, hinweise: [] }, alt = v.__frist || null;
    var jetzt = fristKern(briefDaten(id, land, v).fr);
    if (alt && jetzt && JSON.stringify(alt) !== JSON.stringify(jetzt)) {
      var eigen = VORLAGEN[id].felder.some(function (f) { return f.id === 'fristBis'; });
      var altEnde = alt.antwortBis || alt.ende;
      if (eigen && leer(v.fristBis) && altEnde) {
        out.fristBis = altEnde;
        out.hinweise.push('Gespeicherte Frist beibehalten: ' + datum(altEnde, land) + ' (als eigenes Fristende eingetragen). Nach den aktuellen Angaben ergäbe sich ' + kernText(jetzt, land) + '. Bitte prüfen, welches Datum gelten soll.');
      } else {
        out.hinweise.push('Achtung: Beim Speichern des Entwurfs ergab sich ' + kernText(alt, land) + ', jetzt ' + kernText(jetzt, land) + '. Bitte die Angaben prüfen.');
      }
    } else if (!alt && jetzt) {
      out.hinweise.push('Entwurf aus einer früheren Version ohne gespeicherte Frist: Die angezeigten Fristen sind aus den gespeicherten Angaben neu berechnet. Bitte prüfen.');
    }
    if (v.datum && v.datum < heute) out.hinweise.push('Das Datum des Schreibens aus dem Entwurf (' + datum(v.datum, land) + ') wurde unverändert übernommen; die Fristen beziehen sich darauf. Wenn Sie später versenden, passen Sie das Datum an.');
    return out;
  }

  function erstAbsatz(b) {
    // Nach der Anrede mit Komma beginnt der erste Satz klein; ohne Anrede groß.
    var a = b.absaetze.slice();
    if (!b.anrede && a.length) a[0] = a[0].charAt(0).toUpperCase() + a[0].slice(1);
    return a;
  }

  function blattHtml(b) {
    var h = '';
    h += '<span class="marke-falz" style="top:105mm" aria-hidden="true"></span><span class="marke-loch" aria-hidden="true"></span><span class="marke-falz" style="top:210mm" aria-hidden="true"></span>';
    h += '<div class="zone absender">' + b.abs.map(esc).join('<br>') + (b.absMail ? '<br>' + esc(b.absMail) : '') + '</div>';
    h += '<div class="zone anschrift"><div class="ruecksende">' + esc(b.abs.join(', ')) + '</div><div class="vermerk">' + (b.vermerk ? esc(b.vermerk) : '') + '</div>' +
      (b.emp.length ? b.emp.map(esc).join('<br>') : '<span style="color:#888">[Empfänger]</span>') + '</div>';
    h += '<div class="zone info">' + esc((b.ort ? b.ort + ', ' : '') + datum(b.datum, b.land)) + '</div>';
    h += '<div class="zone text">' + (b.sperre ? '<p class="sperre" role="alert">' + esc(b.sperre) + '</p>' : '') + '<p class="betreff">' + esc(b.betreff) + '</p>';
    if (b.anrede) h += '<p>' + esc(b.anrede) + '</p>';
    erstAbsatz(b).forEach(function (p) { h += '<p>' + esc(p) + '</p>'; });
    h += '<p class="gruss">' + esc(b.gruss) + '</p><div class="unterschrift"></div>';
    h += '<p>' + esc(b.signatur || '') + '</p>';
    b.unterschriftZeilen.forEach(function (t) { h += '<p class="weitere-unterschrift" style="margin-top:12mm">______________________________<br><small>' + esc(t) + '</small></p>'; });
    if (b.anlagen.length) h += '<p class="anlagen">Anlage' + (b.anlagen.length > 1 ? 'n' : '') + ':<br>' + b.anlagen.map(esc).join('<br>') + '</p>';
    h += '</div><div class="ueberlauf">Der Text ist länger als eine Seite. Die Vorschau zeigt nur Seite 1; beim Drucken und in der Word-Datei läuft er vollständig auf Seite 2 weiter.</div><div class="fensterlage" aria-hidden="true"></div>';
    return h;
  }

  function skaliere(rahmen, blatt) {
    var w = rahmen.clientWidth; if (!w) return;
    var nat = blatt.offsetWidth || 793.7;
    var s = Math.min(1, w / nat);
    blatt.style.transform = 'scale(' + s + ')';
    rahmen.style.height = Math.ceil((blatt.offsetHeight || 1122.5) * s) + 'px';
  }

  /* ================= Druck ================= */
  function drucke(blatt) {
    var bereich = $('#druckbereich');
    if (!bereich) { bereich = el('div', { id: 'druckbereich', class: 'druckbereich' }); document.body.appendChild(bereich); }
    bereich.innerHTML = '';
    var k = blatt.cloneNode(true); k.classList.remove('zeigeraster'); k.style.transform = 'none';
    bereich.appendChild(k);
    document.body.classList.add('druck-brief');
    var fertig = function () { document.body.classList.remove('druck-brief'); window.removeEventListener('afterprint', fertig); };
    window.addEventListener('afterprint', fertig);
    window.print();
    setTimeout(fertig, 1500);
  }

  /* ================= Eigener .docx-Export (ZIP ohne Kompression) ================= */
  var CRC = (function () { var t = [], c; for (var n = 0; n < 256; n++) { c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; }());
  function crc32(u8) { var c = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    var enc = new TextEncoder(), teile = [], zentral = [], off = 0;
    function u16(n) { return [n & 255, (n >>> 8) & 255]; }
    function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
      var kopf = [].concat([0x50, 0x4B, 0x03, 0x04], u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      teile.push(new Uint8Array(kopf), name, data);
      zentral.push({ name: name, crc: crc, len: data.length, off: off });
      off += kopf.length + name.length + data.length;
    });
    var start = off, cd = [];
    zentral.forEach(function (z) {
      var e = [].concat([0x50, 0x4B, 0x01, 0x02], u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(z.crc), u32(z.len), u32(z.len), u16(z.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(z.off));
      cd.push(new Uint8Array(e), z.name); off += e.length + z.name.length;
    });
    var ende = new Uint8Array([].concat([0x50, 0x4B, 0x05, 0x06], u16(0), u16(0), u16(zentral.length), u16(zentral.length), u32(off - start), u32(start), u16(0)));
    return new Blob(teile.concat(cd, [ende]), { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }
  function xml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function docx(b) {
    var mm = function (x) { return Math.round(x * 56.6929); }; // twips
    function p(text, o) {
      o = o || {};
      var pp = '<w:pPr>' + (o.rechts ? '<w:jc w:val="right"/>' : '') + '<w:spacing w:before="' + (o.vor || 0) + '" w:after="' + (o.nach == null ? 160 : o.nach) + '"/></w:pPr>';
      var runs = String(text).split('\n').map(function (t, i) { return (i ? '<w:r><w:br/></w:r>' : '') + '<w:r><w:rPr>' + (o.fett ? '<w:b/>' : '') + '<w:sz w:val="' + (o.gr || 22) + '"/></w:rPr><w:t xml:space="preserve">' + xml(t) + '</w:t></w:r>'; }).join('');
      return '<w:p>' + pp + runs + '</w:p>';
    }
    var body = '';
    body += p(b.abs.join('\n') + (b.absMail ? '\n' + b.absMail : ''), { gr: 18, nach: mm(8) });
    body += p(b.abs.join(', '), { gr: 14, nach: 60 });
    if (b.vermerk) body += p(b.vermerk.toUpperCase(), { gr: 16, nach: 60 });
    body += p(b.emp.join('\n') || '[Empfänger]', { nach: mm(10) });
    body += p((b.ort ? b.ort + ', ' : '') + datum(b.datum, b.land), { rechts: true, nach: mm(8) });
    if (b.sperre) body += p(b.sperre, { fett: true, nach: 200 });
    body += p(b.betreff, { fett: true, nach: 280 });
    if (b.anrede) body += p(b.anrede);
    erstAbsatz(b).forEach(function (a) { body += p(a); });
    body += p(b.gruss, { vor: 200, nach: mm(14) });
    body += p(b.signatur || '');
    b.unterschriftZeilen.forEach(function (t) { body += p('______________________________\n' + t, { vor: mm(12), gr: 18 }); });
    if (b.anlagen.length) body += p('Anlage' + (b.anlagen.length > 1 ? 'n' : '') + ':\n' + b.anlagen.join('\n'), { vor: 240, gr: 20 });
    var doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="' + mm(15) + '" w:right="' + mm(20) + '" w:bottom="' + mm(20) + '" w:left="' + mm(25) + '" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>';
    var files = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
      { name: 'word/document.xml', data: doc }
    ];
    return zip(files);
  }
  function speichereDatei(blob, name) {
    var a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ================= Formularbau ================= */
  var BASIS = [
    { gruppe: 'Absender', felder: [
      { id: 'abs_name', label: 'Ihr Name', typ: 'text', ac: 'name' },
      { id: 'abs_strasse', label: 'Straße und Hausnummer', typ: 'text', ac: 'street-address' },
      { id: 'abs_ort', label: 'PLZ und Ort', typ: 'text' },
      { id: 'abs_mail', label: 'E-Mail (optional)', typ: 'email', ac: 'email' }
    ] },
    { gruppe: 'Empfänger', felder: [
      { id: 'emp_name', label: 'Name bzw. Firma', typ: 'text' },
      { id: 'emp_zusatz', label: 'Zusatz (z. B. Abteilung, z. H.)', typ: 'text' },
      { id: 'emp_strasse', label: 'Straße und Hausnummer oder Postfach', typ: 'text' },
      { id: 'emp_ort', label: 'PLZ und Ort', typ: 'text' },
      { id: 'emp_land', label: 'Land (nur bei Auslandsbrief)', typ: 'text', hilfe: 'Wird in Großbuchstaben als letzte Zeile gesetzt.' }
    ] },
    { gruppe: 'Ort, Datum, Versand', felder: [
      { id: 'ort', label: 'Ort', typ: 'text' },
      { id: 'datum', label: 'Datum des Schreibens', typ: 'date' },
      { id: 'vermerk', label: 'Versandvermerk über der Anschrift', typ: 'select', optionen: [['', 'kein Vermerk'], ['Einschreiben', 'Einschreiben'], ['Einschreiben mit Rückschein', 'Einschreiben mit Rückschein'], ['Persönlich übergeben', 'Persönlich übergeben']] },
      { id: 'fenster_rechts', label: 'Anschriftfeld rechts (für Kuverts mit Fenster rechts)', typ: 'check' }
    ] }
  ];

  function feldBauen(f, prefix, land) {
    var id = prefix + f.id, wrap;
    if (f.typ === 'check') {
      var cb = el('input', { type: 'checkbox', id: id, name: f.id });
      if (f.def === true) cb.checked = true;
      wrap = el('div', { class: 'check' }, [cb, el('label', { for: id, text: f.label })]);
      if (f.hilfe) wrap.appendChild(el('span', { class: 'visually-hidden', text: f.hilfe }));
      if (f.hilfe) { var hp = el('small', { class: 'hilfe', id: id + '-h', text: f.hilfe }); cb.setAttribute('aria-describedby', id + '-h'); return el('div', { class: 'feld' }, [wrap, hp]); }
      return el('div', { class: 'feld' }, [wrap]);
    }
    var inp;
    if (f.typ === 'textarea') inp = el('textarea', { id: id, name: f.id, rows: 4 });
    else if (f.typ === 'select') {
      inp = el('select', { id: id, name: f.id });
      f.optionen.forEach(function (o) { inp.appendChild(el('option', { value: o[0], text: o[1] })); });
    } else if (f.typ === 'feiertage') {
      var fbox = el('div', { class: 'wahl', role: 'group', 'aria-labelledby': id + '-l' });
      ((FT && FT[f.land] && FT[f.land].optional) || []).forEach(function (h) {
        fbox.appendChild(el('label', {}, [el('input', { type: 'checkbox', name: f.id, value: h.id }), ' ' + h.name]));
      });
      var fw = el('div', { class: 'feld' }, [el('span', { id: id + '-l', class: 'feldtitel', style: 'display:block;font-weight:600;font-size:.92rem;margin-bottom:.25rem', text: f.label }), fbox]);
      if (f.hilfe) fw.appendChild(el('small', { class: 'hilfe', text: f.hilfe }));
      return fw;
    } else if (f.typ === 'monate') {
      var box = el('div', { class: 'wahl', role: 'group', 'aria-labelledby': id + '-l' });
      var mon = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
      var def = String(f.def || '').split(',');
      mon.forEach(function (m, i) {
        var c = el('input', { type: 'checkbox', name: f.id, value: String(i + 1) });
        if (def.indexOf(String(i + 1)) !== -1) c.checked = true;
        box.appendChild(el('label', {}, [c, ' Ende ' + m]));
      });
      var w = el('div', { class: 'feld' }, [el('span', { id: id + '-l', class: 'feldtitel', style: 'display:block;font-weight:600;font-size:.92rem;margin-bottom:.25rem', text: f.label }), box]);
      if (f.hilfe) w.appendChild(el('small', { class: 'hilfe', text: f.hilfe }));
      return w;
    } else {
      inp = el('input', { type: f.typ === 'number' ? 'number' : f.typ === 'date' ? 'date' : f.typ === 'email' ? 'email' : 'text', id: id, name: f.id, autocomplete: f.ac || 'off' });
      if (f.typ === 'number') { inp.min = '0'; inp.max = '365'; inp.inputMode = 'numeric'; }
    }
    if (f.def != null && f.typ !== 'monate') inp.value = f.def;
    var kids = [el('label', { for: id, text: f.label }), inp];
    if (f.hilfe) { inp.setAttribute('aria-describedby', id + '-h'); kids.push(el('small', { class: 'hilfe', id: id + '-h', text: f.hilfe })); }
    return el('div', { class: 'feld' }, kids);
  }

  function werte(form) {
    var v = {};
    $all('input,select,textarea', form).forEach(function (e) {
      if (!e.name) return;
      if (e.type === 'checkbox' && e.closest('.wahl')) { if (e.checked) v[e.name] = (v[e.name] ? v[e.name] + ',' : '') + e.value; return; }
      if (e.type === 'checkbox') v[e.name] = e.checked; else if (e.type === 'radio') { if (e.checked) v[e.name] = e.value; }
      else v[e.name] = e.value;
    });
    return v;
  }
  function setzeWerte(form, v) {
    $all('input,select,textarea', form).forEach(function (e) {
      if (!e.name || !(e.name in v)) return;
      if (e.type === 'checkbox' && e.closest('.wahl')) e.checked = String(v[e.name]).split(',').indexOf(e.value) !== -1;
      else if (e.type === 'checkbox') e.checked = !!v[e.name];
      else if (e.type === 'radio') e.checked = e.value === v[e.name];
      else e.value = v[e.name];
    });
  }

  function briefAssistent(root) {
    var id = root.getAttribute('data-vorlage'), vor = VORLAGEN[id];
    if (!vor) return;
    var prefix = 'b-' + id + '-';
    var landStart = root.getAttribute('data-land') || 'AT';
    var form = el('form', { class: 'wz-eingabe', novalidate: true, 'aria-label': 'Angaben für den Brief' });
    form.addEventListener('submit', function (e) { e.preventDefault(); });

    var landBox = el('fieldset', {}, [el('legend', { text: 'Land' })]);
    var wahl = el('div', { class: 'wahl' });
    [['AT', 'Österreich'], ['DE', 'Deutschland'], ['CH', 'Schweiz']].forEach(function (l) {
      var r = el('input', { type: 'radio', name: 'land', value: l[0] });
      if (l[0] === landStart) r.checked = true;
      wahl.appendChild(el('label', {}, [r, l[1]]));
    });
    landBox.appendChild(wahl); form.appendChild(landBox);

    var spezial = el('fieldset', {}, [el('legend', { text: 'Angaben zum Schreiben' })]);
    vor.felder.forEach(function (f) {
      var n = feldBauen(f, prefix);
      if (f.nur) n.setAttribute('data-nur', f.nur);
      spezial.appendChild(n);
    });
    form.appendChild(spezial);
    BASIS.forEach(function (g) {
      var fs = el('fieldset', {}, [el('legend', { text: g.gruppe })]);
      var grid = el('div', { class: 'zwei' });
      g.felder.forEach(function (f) { grid.appendChild(feldBauen(f, prefix)); });
      fs.appendChild(grid); form.appendChild(fs);
    });
    var speicherBox = el('div', { class: 'feld' });
    if (speicherOk) {
      var sp = el('input', { type: 'checkbox', id: prefix + 'merken' });
      speicherBox.appendChild(el('div', { class: 'check' }, [sp, el('label', { for: prefix + 'merken', text: 'Entwurf in diesem Browser merken (lokal, jederzeit löschbar)' })]));
      form.appendChild(speicherBox);
    }

    var aus = el('div', { class: 'wz-ausgabe', 'aria-live': 'polite' });
    var fristBox = el('section', { class: 'fristkarte', 'aria-label': 'Berechnete Fristen' });
    var versandBox = el('section', { class: 'versand', 'aria-label': 'Versand-Empfehlung' });
    var leiste = el('div', { class: 'vorschau-leiste' }, [el('span', { class: 'mono', text: 'A4-Vorschau · Maßstab angepasst' })]);
    var rahmen = el('div', { class: 'vorschau-rahmen' });
    var blatt = el('div', { class: 'blatt', role: 'document', 'aria-label': 'Vorschau des Briefes' });
    rahmen.appendChild(blatt);
    var knoepfe = el('div', { class: 'knopfreihe' });
    var bDruck = el('button', { type: 'button', class: 'knopf gruen', text: 'Drucken oder als PDF sichern' });
    var bDocx = el('button', { type: 'button', class: 'knopf leise', text: 'Als Word-Datei (.docx)' });
    var bText = el('button', { type: 'button', class: 'knopf leise', text: 'Text kopieren' });
    var bLoesch = el('button', { type: 'button', class: 'knopf leise', text: 'Eingaben löschen' });
    var bIcs = el('button', { type: 'button', class: 'knopf leise', text: 'Frist in den Kalender (.ics)' });
    var bProt = el('button', { type: 'button', class: 'knopf leise', text: 'Versand-Protokoll drucken' });
    knoepfe.appendChild(bDruck); knoepfe.appendChild(bDocx); knoepfe.appendChild(bIcs); knoepfe.appendChild(bProt); knoepfe.appendChild(bText); knoepfe.appendChild(bLoesch);
    var stempel = el('div', { class: 'frist-stempel', 'aria-hidden': 'true' }); stempel.hidden = true;
    var status = el('p', { class: 'status', role: 'status' });
    aus.appendChild(fristBox); aus.appendChild(versandBox); aus.appendChild(leiste); aus.appendChild(rahmen); aus.appendChild(knoepfe); aus.appendChild(status);

    rahmen.appendChild(stempel);
    var raster = el('div', { class: 'wz-raster' }, [form, aus]);
    root.innerHTML = '';
    root.appendChild(raster);

    var dKey = 'vf24-entwurf-' + id, gespeichert = null, ladeHinweise = [];
    if (speicherOk) {
      try {
        var alt = localStorage.getItem(dKey);
        if (alt) { gespeichert = JSON.parse(alt); setzeWerte(form, gespeichert); $('#' + prefix + 'merken').checked = true; }
      } catch (e) { gespeichert = null; }
    }
    if (!$('#' + prefix + 'datum').value) $('#' + prefix + 'datum').value = HEUTE;
    var zf = $('#' + prefix + 'zugang');
    if (zf && !zf.value) zf.value = F.iso(F.addDays(F.parse(HEUTE), 3));
    if (gespeichert) {
      try {
        var gv = werte(form); gv.__frist = gespeichert.__frist || null;
        var wp = wiederherstellPruefung(id, gv.land || 'AT', gv, HEUTE);
        if (wp.fristBis && $('#' + prefix + 'fristBis')) $('#' + prefix + 'fristBis').value = wp.fristBis;
        ladeHinweise = wp.hinweise;
      } catch (e) { ladeHinweise = []; }
    }

    var letzte = null;
    function aktualisiere() {
      var v = werte(form), land = v.land || 'AT';
      $all('[data-nur]', form).forEach(function (n) { n.hidden = n.getAttribute('data-nur').split(',').indexOf(land) === -1; });
      var b = briefDaten(id, land, v); letzte = b;
      var fh = fristenHtml(id, land, b.fr);
      if (ladeHinweise.length) fh = ladeHinweise.map(function (t) { return '<p class="nok" data-entwurf-hinweis>' + esc(t) + '</p>'; }).join('') + fh;
      fristBox.hidden = !fh;
      fristBox.innerHTML = fh ? '<h3>Fristen für ' + ({ AT: 'Österreich', DE: 'Deutschland', CH: 'die Schweiz' })[land] + '</h3>' + fh : '';
      var ve = versandEmpfehlung(land, vor.versandArt, b.fr && typeof b.fr.puffer === 'number' ? b.fr.puffer : null);
      if (b.sperre) ve.warnung = b.sperre;
      var ziel = zielFrist(b.fr);
      var strahl = '';
      if (ziel) {
        var tage = Math.round((F.parse(ziel.datum) - F.parse(HEUTE)) / 864e5);
        strahl = '<div class="zeitstrahl" aria-label="Zeitstrahl bis zur Frist"><span class="etikett">Heute ' + esc(datum(HEUTE, land)) + '</span><span class="linie"></span>' +
          '<span class="tage">' + (tage >= 0 ? tage + (tage === 1 ? ' Tag' : ' Tage') : 'überschritten') + '</span><span class="linie"></span>' +
          '<span class="etikett ziel">' + esc(ziel.label) + ' ' + esc(datum(ziel.datum, land)) + '</span></div>';
        stempel.innerHTML = esc(ziel.label) + '<b>' + esc(datum(ziel.datum, land)) + '</b>';
      }
      stempel.hidden = !ziel;
      versandBox.innerHTML = '<h3>Versand: ' + esc(ve.titel) + '</h3>' + strahl + (ve.warnung ? '<p class="nok">' + esc(ve.warnung) + '</p>' : '') + '<ol>' + ve.schritte.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
      blatt.className = 'blatt' + (b.fensterRechts ? ' fenster-rechts' : '');
      blatt.innerHTML = blattHtml(b);
      skaliere(rahmen, blatt);
      var text = $('.text', blatt);
      blatt.classList.toggle('zu-lang', text.scrollHeight > text.clientHeight + 2);
      // Solange Hinweise zum geladenen Entwurf offen sind, wird der Entwurf nicht still überschrieben.
      if (speicherOk && !ladeHinweise.length && $('#' + prefix + 'merken') && $('#' + prefix + 'merken').checked) {
        try { v.__frist = fristKern(b.fr); localStorage.setItem(dKey, JSON.stringify(v)); } catch (e) { /* voll */ }
      }
    }
    form.addEventListener('input', function () { ladeHinweise = []; aktualisiere(); });
    form.addEventListener('change', function (e) {
      if (e.isTrusted) ladeHinweise = [];
      if (e.target.id === prefix + 'merken' && !e.target.checked) { try { localStorage.removeItem(dKey); } catch (x) { /* */ } status.textContent = 'Gespeicherter Entwurf gelöscht.'; }
      aktualisiere();
    });
    window.addEventListener('resize', function () { skaliere(rahmen, blatt); });
    bDruck.addEventListener('click', function () { zaehlen('brief_drucken', { vorlage: id }); drucke(blatt); });
    bIcs.addEventListener('click', function () {
      if (!letzte) return;
      var k = fristKern(letzte.fr), n = 0;
      var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
      var L2 = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vorlagenfundus 24//Fristen//DE', 'CALSCALE:GREGORIAN'];
      KERN.forEach(function (x) {
        var d = k && k[x[0]]; if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
        var tag = d.replace(/-/g, ''), nach = F.iso(F.addDays(F.parse(d), 1)).replace(/-/g, '');
        L2.push('BEGIN:VEVENT', 'UID:' + id + '-' + x[0] + '-' + tag + '@vorlagenfundus24.de', 'DTSTAMP:' + stamp, 'DTSTART;VALUE=DATE:' + tag, 'DTEND;VALUE=DATE:' + nach,
          'SUMMARY:' + icsText(x[1] + ': ' + letzte.betreff), 'DESCRIPTION:' + icsText('Berechnet mit vorlagenfundus24.de – ohne Gewähr, keine Rechtsberatung.'),
          'BEGIN:VALARM', 'TRIGGER:-P2D', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsText('In 2 Tagen: ' + x[1]), 'END:VALARM', 'END:VEVENT');
        n++;
      });
      L2.push('END:VCALENDAR');
      if (!n) { status.textContent = 'Für dieses Schreiben gibt es keine berechnete Frist.'; return; }
      speichereDatei(new Blob([L2.join('\r\n')], { type: 'text/calendar' }), 'frist-' + id + '.ics');
      status.textContent = n + (n === 1 ? ' Termin' : ' Termine') + ' als Kalenderdatei gespeichert – mit Erinnerung zwei Tage vorher.';
      zaehlen('frist_kalender', { vorlage: id });
    });
    bProt.addEventListener('click', function () {
      if (!letzte) return;
      var k = fristKern(letzte.fr), zeilenF = KERN.filter(function (x) { return k && k[x[0]]; }).map(function (x) { return '<tr><td>' + esc(x[1]) + '</td><td class="frist">' + esc(datum(k[x[0]], letzte.land)) + '</td></tr>'; }).join('');
      var leer = function (t) { return '<tr><td>' + esc(t) + '</td><td class="leer"></td></tr>'; };
      var p = el('div', { class: 'protokoll' });
      p.innerHTML = '<h1>Versand-Protokoll</h1><p class="meta">' + esc(letzte.betreff) + ' · Schreiben vom ' + esc(datum(letzte.datum, letzte.land)) + '</p>' +
        '<table><tr><td>Absender</td><td>' + letzte.abs.map(esc).join('<br>') + '</td></tr><tr><td>Empfänger</td><td>' + (letzte.emp.length ? letzte.emp.map(esc).join('<br>') : '&nbsp;') + '</td></tr>' + zeilenF + '</table>' +
        '<table>' + leer('Aufgegeben am (Datum, Uhrzeit)') + leer('Versandart (z. B. Einschreiben, Einwurf, Bote)') + leer('Einschreibe- bzw. Sendungsnummer') + leer('Postfiliale bzw. Ort des Einwurfs') + leer('Zeugin oder Zeuge (Name, Anschrift)') + leer('Zugang bestätigt am') + leer('Unterschrift') + '</table>' +
        '<p class="klein">Bitte Aufgabeschein bzw. Einlieferungsbeleg an dieses Blatt heften und gemeinsam mit einer Kopie des Schreibens aufbewahren. Erstellt mit vorlagenfundus24.de – keine Rechtsberatung.</p>';
      zaehlen('versand_protokoll', { vorlage: id });
      drucke(p);
    });
    bDocx.addEventListener('click', function () {
      if (!letzte) return;
      speichereDatei(docx(letzte), id + '-' + letzte.land.toLowerCase() + '.docx');
      status.textContent = 'Word-Datei erstellt. Das Layout ist vereinfacht; bitte vor dem Versand prüfen.';
    });
    bText.addEventListener('click', function () {
      if (!letzte) return;
      var t = (letzte.sperre ? [letzte.sperre, ''] : []).concat([letzte.betreff, '', letzte.anrede]).concat(erstAbsatz(letzte)).concat(['', letzte.gruss, '', letzte.signatur])
        .concat(letzte.unterschriftZeilen.map(function (z) { return '\n______________________________\n' + z; })).join('\n');
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { status.textContent = 'Text in die Zwischenablage kopiert.'; }, function () { status.textContent = 'Kopieren nicht möglich.'; });
    });
    bLoesch.addEventListener('click', function () {
      form.reset(); ladeHinweise = [];
      try { localStorage.removeItem(dKey); } catch (e) { /* */ }
      $('#' + prefix + 'datum').value = HEUTE;
      if (zf) zf.value = F.iso(F.addDays(F.parse(HEUTE), 3));
      status.textContent = 'Alle Eingaben gelöscht.';
      aktualisiere();
    });
    aktualisiere();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(aktualisiere);
  }

  /* Wichtigste Frist für Stempel und Zeitstrahl: spätester Zugang > Absenden bis > Frist im Schreiben > Termin */
  function zielFrist(fr) {
    if (!fr || fr.fehler) return null;
    var reihe = [['spaetesterZugang', 'Zugang bis'], ['ende', 'Frist bis'], ['antwortBis', 'Frist bis'], ['austritt', 'Austritt zum'], ['termin', 'Termin']];
    for (var i = 0; i < reihe.length; i++) if (typeof fr[reihe[i][0]] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fr[reihe[i][0]])) return { label: reihe[i][1], datum: fr[reihe[i][0]] };
    return null;
  }
  function icsText(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  /* Ereignis an Google Analytics – wirkt nur nach Einwilligung (site.js) */
  function zaehlen(name, p) { try { if (typeof window.gtag === 'function') window.gtag('event', name, p || {}); } catch (e) { /* */ } }

  /* ================= Fristenrechner (eigenständig) ================= */
  function fristenrechner(root) {
    var modus = root.getAttribute('data-modus') || 'allgemein';
    var form = el('form', { class: 'wz-eingabe', novalidate: true, 'aria-label': 'Eingaben für den Fristenrechner' });
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    var aus = el('div', { class: 'wz-ausgabe', 'aria-live': 'polite' });
    if (modus === 'vergleich') {
      form.innerHTML =
        '<fieldset><legend>Ihre Situation</legend>' +
        '<div class="feld"><label for="fv-zugang">Zugang der Kündigung beim Vermieter</label><input type="date" id="fv-zugang" name="zugang"><small class="hilfe">Derselbe Tag wird für alle drei Länder gerechnet.</small></div>' +
        '<div class="feld"><label for="fv-beginn">Mietbeginn (für CH ohne Ortsgebrauch und AT befristet)</label><input type="date" id="fv-beginn" name="beginn"></div>' +
        '<div class="feld"><label for="fv-at">Österreich: Vertragsart</label><select id="fv-at" name="at"><option value="unbefristet-monatlich">Unbefristet, Miete monatlich</option><option value="unbefristet-laenger">Unbefristet, Miete in längeren Abständen</option><option value="befristet">Befristet, nach dem ersten Jahr</option></select></div>' +
        '<div class="feld"><label for="fv-ch">Schweiz: Termine</label><select id="fv-ch" name="ch"><option value="ortsueblich">Ortsübliche Termine Ende März, Juni, September</option><option value="mietdauer">Ohne Ortsgebrauch: Ende einer dreimonatigen Mietdauer</option></select><small class="hilfe">Ortsübliche Termine unterscheiden sich je nach Gemeinde. Dieses Beispiel nimmt drei Termine an.</small></div>' +
        '</fieldset>';
    } else {
      form.innerHTML =
        '<fieldset><legend>Land</legend><div class="wahl"><label><input type="radio" name="land" value="AT" checked> Österreich</label><label><input type="radio" name="land" value="DE"> Deutschland</label><label><input type="radio" name="land" value="CH"> Schweiz</label></div></fieldset>' +
        '<fieldset><legend>Frist</legend><div class="feld"><label for="fr-ereignis">Ereignis (z. B. Zugang eines Schreibens, Erhalt der Ware)</label><input type="date" id="fr-ereignis" name="ereignis"></div>' +
        '<div class="zwei"><div class="feld"><label for="fr-anzahl">Dauer</label><input type="number" id="fr-anzahl" name="anzahl" value="14" min="0" max="3650" inputmode="numeric"></div>' +
        '<div class="feld"><label for="fr-einheit">Einheit</label><select id="fr-einheit" name="einheit"><option value="tage">Tage</option><option value="wochen">Wochen</option><option value="monate">Monate</option><option value="jahre">Jahre</option></select></div></div>' +
        '<div class="check"><input type="checkbox" id="fr-verschieben" name="verschieben" checked><label for="fr-verschieben">Fristende auf den nächsten Werktag verschieben, wenn es auf Samstag, Sonntag oder Feiertag fällt</label></div></fieldset>' +
        '<fieldset><legend>Regionale Feiertage</legend><div id="fr-optional" class="wahl"></div><div class="feld" style="margin-top:.6rem"><label for="fr-eigene">Weitere freie Tage (JJJJ-MM-TT, durch Komma getrennt)</label><input type="text" id="fr-eigene" name="eigene" inputmode="numeric" placeholder="2026-12-24"></div></fieldset>';
    }
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'wz-raster' }, [form, aus]));
    var startDatum = F.iso(F.addDays(F.parse(HEUTE), 3));
    var e1 = $('#fv-zugang', form) || $('#fr-ereignis', form); if (e1) e1.value = modus === 'vergleich' ? startDatum : HEUTE;

    function optionalBauen(land) {
      var box = $('#fr-optional', form); if (!box) return;
      var def = FT && FT[land] ? FT[land].optional || [] : [];
      box.innerHTML = def.length ? '' : '<span class="hilfe">Für dieses Land sind nur bundesweite Feiertage hinterlegt.</span>';
      def.forEach(function (h) { box.appendChild(el('label', {}, [el('input', { type: 'checkbox', name: 'opt', value: h.id }), ' ' + h.name])); });
    }
    function rechne() {
      var v = {}; $all('input,select', form).forEach(function (e) {
        if (e.type === 'radio') { if (e.checked) v[e.name] = e.value; }
        else if (e.type === 'checkbox' && e.name === 'opt') { if (e.checked) (v.opt = v.opt || []).push(e.value); }
        else if (e.type === 'checkbox') v[e.name] = e.checked;
        else v[e.name] = e.value;
      });
      try {
        if (modus === 'vergleich') {
          var z = v.zugang || startDatum, karten = '';
          F.parse(z);
          // Jede Karte einzeln: Fehlt eine Angabe (z. B. Mietbeginn für CH ohne Ortsgebrauch), wird
          // nichts erfunden – die Karte nennt die fehlende Angabe und zeigt kein Datum.
          var rechneKarte = function (o) { try { return F.mietKuendigung(o); } catch (e) { return { fehler: e.message }; } };
          var at = rechneKarte({ land: 'AT', variante: v.at, zugang: z, mietbeginn: v.beginn || null, feiertage: FT });
          var de = rechneKarte({ land: 'DE', variante: 'standard', zugang: z, feiertage: FT });
          var chx = rechneKarte({ land: 'CH', variante: v.ch, zugang: z, terminMonate: [3, 6, 9], mietbeginn: v.beginn || null, feiertage: FT });
          [['Österreich', 'AT', at], ['Deutschland', 'DE', de], ['Schweiz', 'CH', chx]].forEach(function (x) {
            var r = x[2];
            if (r.fehler) { karten += '<section class="fristkarte"><h3>' + x[0] + '</h3><p class="nok">' + esc(r.fehler) + '</p></section>'; return; }
            karten += '<section class="fristkarte"><h3>' + x[0] + '</h3>' +
              '<div class="fristzeile"><span>Mietende</span><b class="mark">' + esc(datum(r.termin, x[1])) + '</b></div>' +
              '<div class="fristzeile"><span>Spätester Zugang</span><b>' + esc(datum(r.spaetesterZugang, x[1])) + '</b></div>' +
              '<div class="fristzeile"><span>Puffer</span><b>' + (r.puffer >= 0 ? r.puffer + ' Tage' : '–') + '</b></div>' +
              (r.hinweis ? '<p class="fristquelle">' + esc(r.hinweis.replace(/\d{4}-\d{2}-\d{2}/g, function (d) { return datum(d, x[1]); })) + '</p>' : '') +
              '<p class="fristquelle">' + quelleHtml(r.regel) + '</p></section>';
          });
          aus.innerHTML = '<h3 style="margin-top:0">Zugang am ' + esc(datum(z, 'DE')) + ' (' + F.weekdayDE(z) + ')</h3><div class="vergleich">' + karten + '</div><p class="fristquelle">Gesetzliche Mindestregeln für Mieterinnen und Mieter. Deutschland: nur bundesweite Feiertage – Landesfeiertage können den dritten Werktag verschieben; sie lassen sich im Brief-Assistenten auf der Seite „Wohnung kündigen“ anhaken. Vertragliche Abweichungen: In Österreich und der Schweiz können Verträge längere Fristen oder weitere Termine vorsehen, soweit zulässig. In Deutschland ist eine Vereinbarung, die von der gesetzlichen Frist zum Nachteil der Mieterin oder des Mieters abweicht, nach ' + quelleHtml('DE-573c-4') + ' unwirksam; ein vereinbarter Kündigungsverzicht oder ein Zeitmietvertrag kann die Kündigung aber zeitweise ausschließen, und für ältere Verträge gelten Übergangsregeln – Vertrag prüfen. Keine Rechtsberatung.</p>';
        } else {
          var land = v.land || 'AT';
          var eigene = String(v.eigene || '').split(/[,;\s]+/).filter(function (s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); });
          // Regionale Feiertage löst der Rechenkern für das Jahr des Fristendes auf (nicht nur für die
          // ersten Jahre ab dem Ereignis) und prüft die Abdeckung der Feiertagsdaten.
          var r = F.fristEnde({ ereignis: v.ereignis || HEUTE, anzahl: +v.anzahl, einheit: v.einheit, land: land, feiertage: FT, verschieben: !!v.verschieben, eigeneFeiertage: eigene, optional: v.opt || [] });
          var q = land === 'AT' ? 'AT-902' : land === 'DE' ? 'DE-187' : 'CH-77';
          aus.innerHTML = '<section class="fristkarte"><h3>Ergebnis</h3>' +
            '<div class="fristzeile"><span>Ereignis</span><b>' + esc(datum(r.ereignis, land)) + ' (' + F.weekdayDE(r.ereignis) + ')</b></div>' +
            '<div class="fristzeile"><span>Rechnerisches Fristende</span><b>' + esc(datum(r.rohEnde, land)) + ' (' + F.weekdayDE(r.rohEnde) + ')</b></div>' +
            '<div class="fristzeile"><span>Letzter Tag der Frist</span><b class="mark">' + esc(datum(r.ende, land)) + ' (' + F.weekdayDE(r.ende) + ')</b></div>' +
            (r.verschoben.length ? '<p class="fristquelle">Verschoben wegen: ' + r.verschoben.map(function (s) { return esc(datum(s.datum, land) + ' – ' + s.grund); }).join('; ') + '</p>' : '') +
            '<p class="fristquelle">Der Tag des Ereignisses zählt nicht mit. Grundlage: ' + quelleHtml(q) + (land === 'AT' ? ', Samstag und Karfreitag nach <a href="https://www.ris.bka.gv.at/eli/bgbl/1983/254/A5/NOR12010626" rel="noopener" target="_blank">Art. 5 Europäisches Fristenübereinkommen</a>' : land === 'CH' ? ', Samstag nach <a href="https://www.fedlex.admin.ch/eli/cc/1963/819_815_843/de" rel="noopener" target="_blank">SR 173.110.3</a>' : '') + '.</p></section>' +
            '<div class="hinweis"><strong>Wichtig</strong><p>Kündigungsfristen und -termine werden nicht verschoben: Wer zu einem Monatsende kündigt, muss rechtzeitig vorher zugehen lassen. Für Kündigungen nutzen Sie die Rechner auf den jeweiligen Vorlagenseiten.</p></div>';
        }
      } catch (e) { aus.innerHTML = '<p class="nok">' + esc(isoText(e.message, v.land || 'DE')) + '</p>'; }
    }
    form.addEventListener('input', rechne);
    form.addEventListener('change', function (e) { if (e.target.name === 'land') optionalBauen(e.target.value); rechne(); });
    optionalBauen('AT');
    rechne();
  }

  /* ================= Fensterkuvert-Prüfung ================= */
  /*
   * Geometrie: Das gefaltete Blatt liegt mit der Fläche (0..bw) × (0..bh) vorn im Kuvert (B × H).
   * Es kann um (B − bw) waagrecht und (H − bh) senkrecht rutschen. Geprüft wird, ob die Anschrift
   * in jeder Lage vollständig im Fenster liegt und 3 mm Abstand zum Fensterrand hält
   * (Vorgabe der Deutschen Post für Sendungen mit Fenster).
   */
  var KUVERTS = {
    DL: { name: 'DL (110 × 220 mm), Blatt zweimal quer gefaltet', B: 220, H: 110, bw: 210, bh: 105, fx: 20, fy: 50, fw: 90, fh: 45 },
    C5_6: { name: 'C6/5 (114 × 229 mm), Blatt zweimal quer gefaltet', B: 229, H: 114, bw: 210, bh: 105, fx: 20, fy: 52, fw: 90, fh: 45 },
    C5: { name: 'C5 (162 × 229 mm), Blatt einmal quer gefaltet', B: 229, H: 162, bw: 210, bh: 148.5, fx: 20, fy: 50, fw: 100, fh: 50 },
    C6: { name: 'C6 (114 × 162 mm), Blatt zweimal gefaltet (quer und längs)', B: 162, H: 114, bw: 105, bh: 148.5, fx: 15, fy: 50, fw: 90, fh: 45 }
  };
  function kuvertPruefung(root) {
    var form = el('form', { class: 'wz-eingabe', novalidate: true, 'aria-label': 'Maße für die Fensterkuvert-Prüfung' });
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    var opts = Object.keys(KUVERTS).map(function (k) { return '<option value="' + k + '">' + esc(KUVERTS[k].name) + '</option>'; }).join('');
    form.innerHTML =
      '<fieldset><legend>Kuvert</legend><div class="feld"><label for="kv-typ">Format</label><select id="kv-typ" name="typ">' + opts + '</select><small class="hilfe">Die Fenstermaße sind Startwerte. Messen Sie Ihr Kuvert nach – Hersteller weichen ab.</small></div>' +
      '<div class="zwei"><div class="feld"><label for="kv-fx">Fenster: Abstand vom linken Rand (mm)</label><input type="number" step="0.5" id="kv-fx" name="fx"></div>' +
      '<div class="feld"><label for="kv-fy">Fenster: Abstand vom oberen Rand (mm)</label><input type="number" step="0.5" id="kv-fy" name="fy"></div>' +
      '<div class="feld"><label for="kv-fw">Fensterbreite (mm)</label><input type="number" step="0.5" id="kv-fw" name="fw"></div>' +
      '<div class="feld"><label for="kv-fh">Fensterhöhe (mm)</label><input type="number" step="0.5" id="kv-fh" name="fh"></div></div>' +
      '<div class="check"><input type="checkbox" id="kv-rechts" name="rechts"><label for="kv-rechts">Fenster rechts statt links (Abstand dann vom rechten Rand)</label></div></fieldset>' +
      '<fieldset><legend>Anschrift auf dem Blatt</legend><div class="zwei">' +
      '<div class="feld"><label for="kv-ax">Abstand vom linken Blattrand (mm)</label><input type="number" step="0.5" id="kv-ax" name="ax" value="25"><small class="hilfe">Beginn des Textes, nicht des Feldes</small></div>' +
      '<div class="feld"><label for="kv-ay">Erste Zeile ab oberem Blattrand (mm)</label><input type="number" step="0.1" id="kv-ay" name="ay" value="62.7"><small class="hilfe">DIN 5008 Form B: Anschriftzone ab 62,7 mm (45 mm Feldbeginn + 17,7 mm Zusatz- und Vermerkzone)</small></div>' +
      '<div class="feld"><label for="kv-aw">Breite der längsten Zeile (mm)</label><input type="number" step="0.5" id="kv-aw" name="aw" value="70"></div>' +
      '<div class="feld"><label for="kv-ah">Höhe des Anschriftblocks (mm)</label><input type="number" step="0.5" id="kv-ah" name="ah" value="20"><small class="hilfe">Vierzeilige Anschrift ≈ 20 mm. Rücksendezeile und Vermerk mitzählen (und erste Zeile entsprechend höher), wenn sie sichtbar sein sollen</small></div></div></fieldset>';
    var aus = el('div', { class: 'wz-ausgabe', 'aria-live': 'polite' });
    root.innerHTML = ''; root.appendChild(el('div', { class: 'wz-raster' }, [form, aus]));
    function vorbelegen() {
      var k = KUVERTS[$('#kv-typ', form).value];
      ['fx', 'fy', 'fw', 'fh'].forEach(function (x) { $('#kv-' + x, form).value = k[x]; });
    }
    function pruefe() {
      var k = KUVERTS[$('#kv-typ', form).value], n = function (x) { return parseFloat($('#kv-' + x, form).value); };
      var fx = n('fx'), fy = n('fy'), fw = n('fw'), fh = n('fh'), ax = n('ax'), ay = n('ay'), aw = n('aw'), ah = n('ah');
      if ([fx, fy, fw, fh, ax, ay, aw, ah].some(isNaN)) { aus.innerHTML = '<p>Bitte alle Maße eintragen.</p>'; return; }
      if ($('#kv-rechts', form).checked) fx = k.B - fx - fw;
      var spielX = Math.max(0, k.B - k.bw), spielY = Math.max(0, k.H - k.bh), RAND = 3;
      // schlechteste Lagen
      var links = (ax + 0) - fx, rechts = (fx + fw) - (ax + aw + spielX);
      var oben = ay - fy, unten = (fy + fh) - (ay + ah + spielY);
      var werteR = [['links', links], ['rechts', rechts], ['oben', oben], ['unten', unten]];
      var ok = werteR.every(function (w) { return w[1] >= RAND; });
      var sc = 1.6, W = k.B * sc, H = k.H * sc;
      var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Kuvert mit Fenster und den beiden äußersten Lagen der Anschrift"><rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" fill="#F7F4EC" stroke="#1F2A44" stroke-width="2"/>' +
        '<rect x="' + fx * sc + '" y="' + fy * sc + '" width="' + fw * sc + '" height="' + fh * sc + '" rx="4" fill="#fff" stroke="#2F6B4F" stroke-width="2"/>' +
        '<rect x="' + ax * sc + '" y="' + ay * sc + '" width="' + aw * sc + '" height="' + ah * sc + '" fill="rgba(31,42,68,.18)" stroke="#1F2A44" stroke-dasharray="4 3"/>' +
        '<rect x="' + (ax + spielX) * sc + '" y="' + (ay + spielY) * sc + '" width="' + aw * sc + '" height="' + ah * sc + '" fill="rgba(242,214,75,.35)" stroke="#8A6D00" stroke-dasharray="4 3"/>' +
        '<text x="' + 8 + '" y="' + (H - 10) + '" font-family="IBM Plex Mono, monospace" font-size="12" fill="#1F2A44">' + esc(k.name.split(',')[0]) + ' · Spiel ' + spielX + ' × ' + spielY + ' mm</text></svg>';
      aus.innerHTML = '<div class="kuvert-grafik">' + svg + '</div>' +
        '<p class="' + (ok ? 'ok' : 'nok') + '" style="margin-top:1rem">' + (ok ? 'Passt: Die Anschrift bleibt in jeder Lage mindestens 3 mm im Fenster.' : 'Passt nicht sicher: In mindestens einer Lage rückt die Anschrift näher als 3 mm an den Fensterrand oder verschwindet.') + '</p>' +
        '<ul class="kuvert-ergebnis">' + werteR.map(function (w) { return '<li>Abstand ' + w[0] + ' im ungünstigsten Fall: <b class="' + (w[1] >= RAND ? 'ok' : 'nok') + '">' + w[1].toFixed(1).replace('.', ',') + ' mm</b></li>'; }).join('') + '</ul>' +
        '<p class="fristquelle">Dunkel gestrichelt: Blatt ganz oben links im Kuvert. Gelb: Blatt ganz unten rechts. Das Blatt rutscht um ' + spielX + ' mm waagrecht und ' + spielY + ' mm senkrecht.</p>';
    }
    form.addEventListener('input', pruefe);
    form.addEventListener('change', function (e) { if (e.target.id === 'kv-typ') vorbelegen(); pruefe(); });
    vorbelegen(); pruefe();
  }

  /* ================= Versand-Berater (eigenständig) ================= */
  function versandBerater(root) {
    var form = el('form', { class: 'wz-eingabe', novalidate: true, 'aria-label': 'Angaben für die Versand-Empfehlung' });
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    form.innerHTML =
      '<fieldset><legend>Land der Empfängerseite</legend><div class="wahl"><label><input type="radio" name="land" value="AT" checked> Österreich</label><label><input type="radio" name="land" value="DE"> Deutschland</label><label><input type="radio" name="land" value="CH"> Schweiz</label></div></fieldset>' +
      '<fieldset><legend>Worum geht es?</legend><div class="feld"><label for="vb-art">Art des Schreibens</label><select id="vb-art" name="art"><option value="frist">Kündigung oder Erklärung mit Frist</option><option value="beweis">Reklamation, Mängelanzeige, Mahnung</option><option value="behoerde">Eingabe an eine Behörde</option><option value="info">Information ohne Frist</option></select></div>' +
      '<div class="feld"><label for="vb-stichtag">Spätester Zugang bzw. letzter Tag der Frist</label><input type="date" id="vb-stichtag" name="stichtag"><small class="hilfe">Leer lassen, wenn es keine Frist gibt.</small></div></fieldset>';
    var aus = el('div', { class: 'wz-ausgabe', 'aria-live': 'polite' });
    root.innerHTML = ''; root.appendChild(el('div', { class: 'wz-raster' }, [form, aus]));
    function zeige() {
      var land = (form.querySelector('input[name=land]:checked') || {}).value || 'AT';
      var art = $('#vb-art', form).value, st = $('#vb-stichtag', form).value;
      var puffer = null;
      if (st) { try { puffer = Math.round((F.parse(st) - F.parse(HEUTE)) / 86400000); } catch (e) { puffer = null; } }
      var r = versandEmpfehlung(land, art, puffer);
      aus.innerHTML = '<section class="versand"><h3>' + esc(r.titel) + '</h3>' + (puffer != null ? '<p>Noch <b>' + puffer + ' Tage</b> bis zum Stichtag.</p>' : '') + (r.warnung ? '<p class="nok">' + esc(r.warnung) + '</p>' : '') + '<ol>' + r.schritte.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol></section><p class="fristquelle">Allgemeine Orientierung, keine Rechtsberatung. Die Erklärungen unten nennen die Rechtsgrundlagen.</p>';
    }
    form.addEventListener('input', zeige); form.addEventListener('change', zeige); zeige();
  }

  /* ================= Start ================= */
  ladeFeiertage(function () {
    $all('[data-werkzeug="brief"]').forEach(briefAssistent);
    $all('[data-werkzeug="fristen"]').forEach(fristenrechner);
    $all('[data-werkzeug="kuvert"]').forEach(kuvertPruefung);
    $all('[data-werkzeug="versand"]').forEach(versandBerater);
  });

  // für Tests
  window.VFBrief = { versandEmpfehlung: versandEmpfehlung, VORLAGEN: VORLAGEN, crc32: crc32, briefDaten: briefDaten, blattHtml: blattHtml,
    fristenHtml: fristenHtml, wiederherstellPruefung: wiederherstellPruefung, fristKern: fristKern, setzeFeiertage: function (d) { FT = d; } };
})();
