/*
 * Vorlagenfundus 24 – Seitenskript: Navigation, Anzeigenplätze, Einwilligung, Statistik.
 * Eigenständige Umsetzung für diese Website. Stand: Oktober 2026.
 */
(function () {
  'use strict';

  /* ---------- Konfiguration ---------- */
  var PUB = 'ca-pub-7811071715414905';
  var GA_ID = 'G-T00HRG2YVF';
  // Slot-IDs aus AdSense eintragen, sobald die Website freigegeben ist. Leer = Platz bleibt unsichtbar.
  var SLOTS = {
    banner: '',      // 728×90 ab 768 px, mobil 320×100
    rectangle: '',   // 300×250 zwischen Abschnitten
    seite: ''        // 300×600 ab 1280 px, 160×600 ab 1024 px (nur Seitenleiste)
  };

  /* ---------- Navigation ---------- */
  var btn = document.querySelector('.nav-btn');
  var nav = document.getElementById('hauptnav');
  if (btn && nav) {
    btn.addEventListener('click', function () {
      var offen = nav.classList.toggle('offen');
      btn.setAttribute('aria-expanded', offen ? 'true' : 'false');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('offen')) {
        nav.classList.remove('offen'); btn.setAttribute('aria-expanded', 'false'); btn.focus();
      }
    });
  }

  /* ---------- Datenschutz-Einstellungen (Widerruf über Googles CMP) ---------- */
  window.googlefc = window.googlefc || {};
  window.googlefc.callbackQueue = window.googlefc.callbackQueue || [];
  Array.prototype.forEach.call(document.querySelectorAll('[data-cmp-widerruf]'), function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      window.googlefc.callbackQueue.push(function () {
        if (window.googlefc && typeof window.googlefc.showRevocationMessage === 'function') window.googlefc.showRevocationMessage();
      });
      var st = document.getElementById('cmp-status');
      if (st) st.textContent = 'Die Einstellungen öffnen sich, sobald das Einwilligungsfenster geladen ist. Falls nichts erscheint, blockiert vermutlich ein Inhaltsblocker das Fenster.';
    });
  });

  /* ---------- Anzeigenplätze ---------- */
  function mq(q) { return window.matchMedia && window.matchMedia(q).matches; }
  function groesse(format) {
    if (format === 'banner') return mq('(min-width: 768px)') ? [728, 90] : [320, 100];
    if (format === 'rectangle') return [300, 250];
    if (format === 'seite') {
      if (!mq('(min-width: 1024px)')) return null;
      return mq('(min-width: 1280px)') ? [300, 600] : [160, 600];
    }
    return null;
  }
  var plaetze = document.querySelectorAll('.anzeige[data-format]');
  var aktiv = 0;
  Array.prototype.forEach.call(plaetze, function (box) {
    var format = box.getAttribute('data-format');
    var slot = SLOTS[format];
    var g = groesse(format);
    if (!slot || !g) return;               // ohne Slot-ID kein reservierter Platz, kein Layoutsprung
    var platz = box.querySelector('.anz-platz');
    var ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'inline-block';
    ins.style.width = g[0] + 'px';
    ins.style.height = g[1] + 'px';
    ins.setAttribute('data-ad-client', PUB);
    ins.setAttribute('data-ad-slot', slot);
    platz.style.minHeight = g[1] + 'px';
    platz.appendChild(ins);
    box.hidden = false;
    aktiv++;
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* Blocker */ }
  });

  /* ---------- Google Analytics 4 erst nach Einwilligung (TCF: Zweck 1 + Anbieter 755) ---------- */
  var gaGeladen = false;
  function ladeGA() {
    if (gaGeladen) return; gaGeladen = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID, { anonymize_ip: true });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
    document.head.appendChild(s);
  }
  function pruefeTCF(tc) {
    if (!tc) return;
    if (tc.gdprApplies === false) { ladeGA(); return; }
    if (tc.eventStatus !== 'tcloaded' && tc.eventStatus !== 'useractioncomplete') return;
    var zweck = tc.purpose && tc.purpose.consents && tc.purpose.consents[1];
    var anbieter = tc.vendor && tc.vendor.consents && tc.vendor.consents[755];
    if (zweck && anbieter) ladeGA();
  }
  var versuche = 0;
  (function warteAufCMP() {
    if (typeof window.__tcfapi === 'function') {
      window.__tcfapi('addEventListener', 2, function (tc, ok) { if (ok) pruefeTCF(tc); });
      return;
    }
    if (++versuche < 40) setTimeout(warteAufCMP, 250);   // max. 10 s; ohne CMP keine Statistik
  }());
})();
