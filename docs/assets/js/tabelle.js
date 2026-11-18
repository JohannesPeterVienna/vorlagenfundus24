/*
 * Vorlagenfundus 24 – Fristentabelle: Suche, Filter, CSV-Export, Link zur Auswahl, Druck.
 * Die Tabelle steht vollständig im HTML (funktioniert ohne JavaScript); dieses Skript blendet nur
 * Zeilen aus. Nichts wird übertragen. Der Link zur Auswahl enthält nur Land und Bereich aus festen
 * Listen – nie den Suchtext.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VFTabelle = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LAENDER = ['AT', 'DE', 'CH'];

  /* Vergleichsform für die Suche: Kleinbuchstaben, Umlaute aufgelöst, „§ 573c“ wie „573c“. */
  function norm(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[§.,;:()„“"–—-]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  /* Alle Suchwörter müssen vorkommen (UND-Verknüpfung). */
  function passt(text, suche) {
    var t = norm(text), w = norm(suche).split(' ').filter(Boolean);
    for (var i = 0; i < w.length; i++) if (t.indexOf(w[i]) === -1) return false;
    return true;
  }
  /*
   * Eine CSV-Zelle. Tabellenprogramme führen Zellen aus, die mit = + - @ (oder Tab/Wagenrücklauf)
   * beginnen; solche Zellen bekommen ein Hochkomma vorangestellt. Anführungszeichen werden verdoppelt.
   */
  function csvZelle(s) {
    var t = String(s == null ? '' : s).replace(/\r?\n/g, ' ');
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return '"' + t.replace(/"/g, '""') + '"';
  }
  /* Letzte CSV-Zeile: Herkunft und vollständiges Abrufdatum (z. B. „18. November 2026“). */
  function fusszeile(abruf) {
    return 'Quelle: vorlagenfundus24.de/fristen-tabelle/ – gesetzliche Grundregeln, keine Rechtsberatung.' + (abruf ? ' Gesetzestexte abgerufen am ' + abruf + '.' : '');
  }
  function csv(zeilen) {
    return '﻿' + zeilen.map(function (z) { return z.map(csvZelle).join(';'); }).join('\r\n') + '\r\n';
  }
  /* Auswahl aus dem Teil hinter # lesen: nur bekannte Länder und Bereiche werden übernommen. */
  function auswahlLesen(hash, bereiche) {
    var h = String(hash || '').replace(/^#/, ''), out = { laender: [], bereich: '' };
    if (!h || h.length > 300 || h.indexOf('=') === -1) return out;
    h.split('&').forEach(function (t) {
      var i = t.indexOf('='); if (i < 1) return;
      var k = t.slice(0, i), v; try { v = decodeURIComponent(t.slice(i + 1)); } catch (e) { return; }
      if (k === 'land') out.laender = v.split(',').filter(function (x, j, a) { return LAENDER.indexOf(x) !== -1 && a.indexOf(x) === j; });
      if (k === 'bereich' && (bereiche || []).indexOf(v) !== -1) out.bereich = v;
    });
    return out;
  }
  function auswahlSchreiben(a) {
    var t = [];
    if (a.laender && a.laender.length && a.laender.length < LAENDER.length) t.push('land=' + a.laender.join(','));
    if (a.bereich) t.push('bereich=' + encodeURIComponent(a.bereich));
    return t.length ? '#' + t.join('&') : '';
  }

  function start(doc) {
    var box = doc.querySelector('[data-fristentabelle]'); if (!box) return;
    var zeilen = Array.prototype.slice.call(box.querySelectorAll('tbody tr'));
    var bereiche = []; zeilen.forEach(function (z) { var b = z.getAttribute('data-bereich'); if (bereiche.indexOf(b) === -1) bereiche.push(b); });
    bereiche.sort(function (a, b) { return a.localeCompare(b, 'de'); });
    zeilen.forEach(function (z) { z._text = z.textContent; });

    var form = doc.createElement('form'); form.className = 'ft-filter'; form.setAttribute('role', 'search'); form.setAttribute('aria-label', 'Fristentabelle filtern');
    form.innerHTML =
      '<div class="feld ft-suche"><label for="ft-q">Suche (z. B. Widerruf, Kaution, 573c, Bußgeld)</label><input type="search" id="ft-q" autocomplete="off" spellcheck="false" maxlength="80"></div>' +
      '<fieldset class="ft-land"><legend>Land</legend><div class="wahl">' +
      LAENDER.map(function (l) { return '<label><input type="checkbox" name="land" value="' + l + '" checked> ' + l + '</label>'; }).join('') + '</div></fieldset>' +
      '<div class="feld ft-ber"><label for="ft-b">Bereich</label><select id="ft-b"><option value="">Alle Bereiche</option></select></div>' +
      '<p class="knopfreihe ft-knoepfe"><button type="button" class="knopf leise" data-akt="reset">Filter zurücksetzen</button>' +
      '<button type="button" class="knopf leise" data-akt="csv">Auswahl als CSV speichern</button>' +
      '<button type="button" class="knopf leise" data-akt="link">Link zu dieser Auswahl kopieren</button>' +
      '<button type="button" class="knopf leise" data-akt="druck">Auswahl drucken</button></p>' +
      '<p class="status ft-zahl" role="status" aria-live="polite"></p>';
    var sel = form.querySelector('#ft-b');
    bereiche.forEach(function (b) { var o = doc.createElement('option'); o.value = b; o.textContent = b; sel.appendChild(o); });
    box.insertBefore(form, box.firstChild);
    var leer = doc.createElement('p'); leer.className = 'nok ft-leer'; leer.hidden = true;
    leer.textContent = 'Kein Eintrag passt zu dieser Auswahl. Die Tabelle enthält nur Fristen, die wir im Gesetzestext nachgelesen haben – fehlt etwas, ist es nicht erfasst.';
    box.querySelector('.ft-tab').insertAdjacentElement('afterend', leer);
    var q = form.querySelector('#ft-q'), zahl = form.querySelector('.ft-zahl'), boxen = Array.prototype.slice.call(form.querySelectorAll('input[name=land]'));

    function stand() {
      return { laender: boxen.filter(function (b) { return b.checked; }).map(function (b) { return b.value; }), bereich: sel.value };
    }
    function filtere() {
      var a = stand(), n = 0;
      zeilen.forEach(function (z) {
        var ok = a.laender.indexOf(z.getAttribute('data-land')) !== -1 && (!a.bereich || z.getAttribute('data-bereich') === a.bereich) && passt(z._text, q.value);
        z.hidden = !ok; if (ok) n++;
      });
      leer.hidden = n !== 0;
      zahl.textContent = n + ' von ' + zeilen.length + ' Einträgen';
    }
    function sichtbar() { return zeilen.filter(function (z) { return !z.hidden; }); }
    function zelle(z, i) { return z.children[i]; }
    function ohne(elm, selektor) { var c = elm.cloneNode(true); Array.prototype.slice.call(c.querySelectorAll(selektor)).forEach(function (x) { x.remove(); }); return c.textContent.replace(/\s+/g, ' ').trim(); }
    function exportiere() {
      var out = [['Land', 'Bereich', 'Worum es geht', 'Frist', 'Beginn oder Bezugspunkt', 'Fundstelle', 'Link zum Gesetzestext', 'Fassung', 'Hinweis']];
      sichtbar().forEach(function (z) {
        var a = zelle(z, 4).querySelector('a');
        out.push([z.getAttribute('data-land'), z.getAttribute('data-bereich'), ohne(zelle(z, 1), '.ft-bereich'), zelle(z, 2).textContent.trim(), zelle(z, 3).textContent.trim(),
          a ? a.textContent.trim() : '', a ? a.href : '', ohne(zelle(z, 4), 'a'), ohne(zelle(z, 5), '.ft-akt')]);
      });
      out.push(['', '', fusszeile(box.getAttribute('data-abruf')), '', '', '', '', '', '']);
      var blob = new Blob([csv(out)], { type: 'text/csv;charset=utf-8' }), url = URL.createObjectURL(blob), a2 = doc.createElement('a');
      a2.href = url; a2.download = 'fristentabelle-vorlagenfundus24.csv'; doc.body.appendChild(a2); a2.click(); a2.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      zahl.textContent = sichtbar().length + ' Einträge als CSV gespeichert.';
    }
    function kopiereLink() {
      var link = location.origin + location.pathname + auswahlSchreiben(stand());
      function nein() { zahl.textContent = 'Kopieren wird von diesem Browser nicht erlaubt. Link: ' + link; }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(function () { zahl.textContent = 'Link kopiert. Er enthält Land und Bereich, nicht den Suchtext.'; }, nein);
        else nein();
      } catch (e) { nein(); }
    }
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    form.addEventListener('input', filtere); form.addEventListener('change', filtere);
    form.addEventListener('click', function (e) {
      var k = e.target && e.target.getAttribute ? e.target.getAttribute('data-akt') : null;
      if (k === 'reset') { q.value = ''; sel.value = ''; boxen.forEach(function (b) { b.checked = true; }); filtere(); q.focus(); }
      if (k === 'csv') exportiere();
      if (k === 'link') kopiereLink();
      if (k === 'druck') window.print();
    });
    // Startauswahl aus dem Link (#land=AT,DE&bereich=Kauf); „#f-…“ bleibt ein gewöhnlicher Sprung zur Zeile.
    var a0 = auswahlLesen(location.hash, bereiche);
    if (a0.laender.length) boxen.forEach(function (b) { b.checked = a0.laender.indexOf(b.value) !== -1; });
    if (a0.bereich) sel.value = a0.bereich;
    filtere();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { start(document); });
    else start(document);
  }
  return { norm: norm, passt: passt, csvZelle: csvZelle, csv: csv, fusszeile: fusszeile, auswahlLesen: auswahlLesen, auswahlSchreiben: auswahlSchreiben };
}));
