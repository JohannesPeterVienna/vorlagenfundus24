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

  /* ---------- Einwilligung: Google Consent Mode v2 + Google-CMP (TCF) ---------- */
  /*
   * Der Seitenkopf setzt vor jedem Google-Skript gtag('consent','default', alles 'denied').
   * GA4 wird nur geladen bzw. aktiviert, wenn BEIDES von der Google-CMP gemeldet wird:
   *  1. TCF: gdprApplies, eventStatus tcloaded/useractioncomplete, Zweck 1 und Anbieter 755 (Google);
   *  2. Consent-Mode-Wert der CMP: analyticsStoragePurposeConsentStatus === GRANTED (1).
   * UNKNOWN (0), DENIED (2), NOT_APPLICABLE (3), NOT_CONFIGURED (4) oder fehlende Daten bleiben
   * "nicht erteilt". Fällt die Zustimmung weg (Ablehnen, Widerruf, Änderung), folgt sofort
   * consent update 'denied' und window['ga-disable-<ID>'] = true.
   * Quellen: developers.google.com/funding-choices/fc-api-docs,
   *          developers.google.com/tag-platform/security/guides/consent
   */
  var CM_GRANTED = 1;
  var zustand = { tcf: false, cm: null };   // cm: letzter gemeldeter analyticsStorage-Status
  var gaAktiv = false, gaGeladen = false;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.googlefc = window.googlefc || {};
  window.googlefc.callbackQueue = window.googlefc.callbackQueue || [];

  function ladeGA() {
    if (gaGeladen) return; gaGeladen = true;
    window.gtag('js', new Date());
    window.gtag('config', GA_ID, { anonymize_ip: true });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
    document.head.appendChild(s);
  }
  function erteilt() { return zustand.tcf === true && zustand.cm === CM_GRANTED; }
  function anwenden() {
    if (erteilt()) {
      window['ga-disable-' + GA_ID] = false;
      if (!gaAktiv) { window.gtag('consent', 'update', { analytics_storage: 'granted' }); gaAktiv = true; }
      ladeGA();
    } else if (gaAktiv || gaGeladen) {
      sperreGA();
    }
  }
  function sperreGA() {
    window['ga-disable-' + GA_ID] = true;
    window.gtag('consent', 'update', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });
    gaAktiv = false;
  }
  function leseCM() {
    try {
      var g = window.googlefc;
      if (g && typeof g.getGoogleConsentModeValues === 'function') {
        var w = g.getGoogleConsentModeValues();
        zustand.cm = w && typeof w.analyticsStoragePurposeConsentStatus === 'number' ? w.analyticsStoragePurposeConsentStatus : null;
      }
    } catch (e) { zustand.cm = null; }
  }
  function pruefeTCF(tc) {
    var ok = false;
    if (tc && tc.gdprApplies === true && (tc.eventStatus === 'tcloaded' || tc.eventStatus === 'useractioncomplete')) {
      ok = !!(tc.purpose && tc.purpose.consents && tc.purpose.consents[1] === true &&
              tc.vendor && tc.vendor.consents && tc.vendor.consents[755] === true);
    } else if (tc && tc.eventStatus === 'cmpuishown') ok = false;
    else if (tc && tc.gdprApplies === true) return;   // Zwischenstände ändern nichts
    zustand.tcf = ok;
    leseCM();
    anwenden();
  }
  window.googlefc.callbackQueue.push({
    CONSENT_MODE_DATA_READY: function () { leseCM(); anwenden(); }
  });
  var versuche = 0;
  (function warteAufCMP() {
    if (typeof window.__tcfapi === 'function') {
      window.__tcfapi('addEventListener', 2, function (tc, ok) { if (ok) pruefeTCF(tc); });
      return;
    }
    if (++versuche < 40) setTimeout(warteAufCMP, 250);   // max. 10 s; ohne CMP keine Statistik
  }());

  /* Datenschutz-Einstellungen: Widerruf sperrt GA sofort, dann zeigt die CMP ihren Dialog erneut. */
  Array.prototype.forEach.call(document.querySelectorAll('[data-cmp-widerruf]'), function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      zustand.tcf = false; zustand.cm = null; sperreGA();
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

})();
