/*
 * Vorlagenfundus 24 – Seitenskript: Navigation, Anzeigenplätze, Einwilligung, Statistik, Laufzettel Statistik.
 * Eigenständige Umsetzung für diese Website. Stand: 5. November 2026.
 */
(function () {
  'use strict';

  /* ---------- Regeln des Laufzettels Statistik (ohne DOM, geprüft in tests/statistik.test.js) ---------- */
  var ZETTEL = {
    SCHLUESSEL: 'vf24-statistik',
    VERSION: 1,
    FRIST_MS: 3000,          // so lange hat die Google-CMP Zeit, bevor der Laufzettel fragt
    // echte Google-Entscheidung: Nutzeraktion oder geladene, gespeicherte Entscheidung (nicht leerer TC-String)
    entschieden: function (tc) {
      return !!tc && (tc.eventStatus === 'useractioncomplete' ||
        (tc.eventStatus === 'tcloaded' && typeof tc.tcString === 'string' && tc.tcString !== ''));
    },
    // zeigt die Google-CMP gerade ihren Dialog? cmpuishown mit displayStatus hidden/disabled zählt nicht.
    googleFragt: function (tc) {
      if (!tc) return false;
      if (tc.displayStatus === 'visible') return true;
      return tc.eventStatus === 'cmpuishown' && tc.displayStatus !== 'hidden' && tc.displayStatus !== 'disabled';
    },
    ablauf: function (zeit) { var d = new Date(zeit); d.setMonth(d.getMonth() + 12); return d.getTime(); },
    // 'ja' | 'nein' | null (fehlt, falsche Version, abgelaufen nach 12 Monaten, Zeitpunkt in der Zukunft)
    gueltigeWahl: function (e, jetzt) {
      if (!e || typeof e !== 'object' || e.v !== ZETTEL.VERSION) return null;
      if (e.wahl !== 'ja' && e.wahl !== 'nein') return null;
      if (typeof e.zeit !== 'number' || !isFinite(e.zeit) || e.zeit > jetzt) return null;
      return jetzt < ZETTEL.ablauf(e.zeit) ? e.wahl : null;
    },
    // 'gpc' | 'google' (CMP-Logik gilt) | 'warten' (Google-Dialog sichtbar) | 'ja' | 'nein' | 'fragen'
    befund: function (o) {
      if (o.gpc) return 'gpc';
      var tc = o.tc;
      if (tc && tc.gdprApplies === false) return 'google';
      if (ZETTEL.entschieden(tc)) return 'google';
      if (ZETTEL.googleFragt(tc)) return 'warten';
      return ZETTEL.gueltigeWahl(o.eintrag, o.jetzt) || 'fragen';
    },
    gaKekse: function (text) {
      return String(text || '').split(';').map(function (s) { return s.split('=')[0].trim(); })
        .filter(function (n) { return /^_ga(_.+)?$/.test(n); });
    },
    // '' (ohne domain=) plus Host und jede übergeordnete Domain, jeweils mit und ohne führenden Punkt
    domains: function (host) {
      var h = String(host || '').toLowerCase();
      var out = [''];
      if (!h || h.indexOf('.') < 0 || /^[\d.]+$/.test(h) || h.indexOf(':') >= 0) return out;
      var teile = h.split('.');
      for (var i = 0; i < teile.length - 1; i++) {
        var d = teile.slice(i).join('.');
        out.push(d, '.' + d);
      }
      return out;
    }
  };
  if (typeof window === 'undefined') { if (typeof module === 'object') module.exports = ZETTEL; return; }


  /* ---------- Konfiguration ---------- */
  var PUB = 'ca-pub-7811071715414905';
  var GA_ID = 'G-T00HRG2YVF';
  // Slot-IDs aus AdSense eintragen, sobald die Website freigegeben ist. Leer = Platz bleibt unsichtbar.
  // Gemeinsame AdSense-Blöcke „Themen-Websites – …“ (Konto pub-7811071715414905, angelegt 17.10. und 5.11.2026)
  var SLOTS = {
    banner: '5774811012',      // 728×90 ab 768 px (Superbanner); mobil 320×100 → SLOT_MOBIL
    rectangle: '9522484334',   // 300×250 zwischen Abschnitten
    seite: '1292301217'        // 300×600 ab 1280 px (responsiver Block in fester Größe); 160×600 → SLOT_SKY
  };
  var SLOT_MOBIL = '5396758258', SLOT_SKY = '5064364572';

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
   * Der Seitenkopf setzt vor jedem Google-Skript gtag('consent','default', alles 'denied');
   * hier wird zusätzlich window['ga-disable-<ID>'] = true gesetzt. GA4 wird nur geladen bzw. aktiviert,
   *  a) wenn die DSGVO gilt (gdprApplies nicht false): TCF eventStatus tcloaded/useractioncomplete,
   *     Zweck 1 und Anbieter 755 (Google) zugestimmt UND analyticsStoragePurposeConsentStatus === GRANTED (1);
   *  b) wenn die DSGVO laut CMP nicht gilt (gdprApplies === false): Analyticswert GRANTED (1) oder
   *     NOT_APPLICABLE (3) UND die CMP meldet ausdrücklich keinen US-Opt-out
   *     (usstatesoptout.getInitialUsStatesOptOutStatus(): DOES_NOT_APPLY 1 oder NOT_OPTED_OUT 2);
   *  c) im Übergang über den „Laufzettel Statistik“ (siehe unten), solange die Google-CMP nichts entscheidet.
   * Fehlend, UNKNOWN (0), DENIED (2), NOT_CONFIGURED (4) oder ein Fehler einer CMP-Schnittstelle bleiben
   * "nicht erteilt". Ein eindeutiges TCF-Nein sperrt sofort, ohne vorher weitere CMP-Schnittstellen
   * aufzurufen. Fällt die Zustimmung weg (Ablehnen, Widerruf, Änderung), folgt sofort
   * consent update 'denied' und window['ga-disable-<ID>'] = true. Global Privacy Control: nie GA.
   * Quellen: developers.google.com/funding-choices/fc-api-docs,
   *          developers.google.com/tag-platform/security/guides/consent
   */
  var CM_GRANTED = 1, CM_NOT_APPLICABLE = 3;
  // tcf: 'ja' | 'nein' | 'ausserhalb' (DSGVO gilt nicht); cm: letzter gemeldeter analyticsStorage-Status
  var zustand = { tcf: 'nein', cm: null };
  var gaAktiv = false, gaGeladen = false;
  var letzteTC = null;            // letzte TCF-Meldung der Google-CMP (für den Laufzettel)
  var zettelBereit = false;       // erst nach ZETTEL.FRIST_MS (oder einer eigenen Wahl) entscheidet der Laufzettel mit
  var gpc = false;
  try { gpc = navigator.globalPrivacyControl === true; } catch (e) { gpc = false; }
  // Impressum, Datenschutz, Kontakt, Fehlerseite: kein Google-Skript, also auch keine Statistik
  var ohneWerbung = !!(document.body && document.body.hasAttribute('data-ohne-werbung'));
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window['ga-disable-' + GA_ID] = true;
  window.googlefc = window.googlefc || {};
  window.googlefc.callbackQueue = window.googlefc.callbackQueue || [];

  function g() { try { window.gtag.apply(window, arguments); } catch (e) { /* gtag ersetzt oder blockiert */ } }
  function ladeGA() {
    if (gaGeladen) return; gaGeladen = true;
    g('js', new Date());
    g('config', GA_ID, { anonymize_ip: true, allow_google_signals: false, allow_ad_personalization_signals: false });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
    document.head.appendChild(s);
  }
  function ohneUsOptOut() {
    try {
      var u = window.googlefc && window.googlefc.usstatesoptout;
      if (!u || typeof u.getInitialUsStatesOptOutStatus !== 'function') return false;
      var st = u.getInitialUsStatesOptOutStatus();
      return st === 1 || st === 2;
    } catch (e) { return false; }
  }
  function zettelBefund() { return ZETTEL.befund({ tc: letzteTC, gpc: gpc, eintrag: ablage.lesen(), jetzt: Date.now() }); }
  // Der Laufzettel entscheidet nur, wenn die Google-CMP weder entschieden hat noch ihren Dialog zeigt.
  function zettelZustaendig() {
    if (ohneWerbung || !zettelBereit) return false;
    var b = zettelBefund();
    return b === 'ja' || b === 'nein' || b === 'fragen';
  }
  function erteilt() {
    if (gpc || ohneWerbung) return false;
    if (zettelZustaendig()) return zettelBefund() === 'ja';
    if (zustand.tcf === 'ja') return zustand.cm === CM_GRANTED;
    if (zustand.tcf === 'ausserhalb') return (zustand.cm === CM_GRANTED || zustand.cm === CM_NOT_APPLICABLE) && ohneUsOptOut();
    return false;
  }
  function anwenden() {
    if (erteilt()) {
      window['ga-disable-' + GA_ID] = false;
      if (!gaAktiv) { g('consent', 'update', { analytics_storage: 'granted' }); gaAktiv = true; }   // nie ad_*
      ladeGA();
    } else if (gaAktiv || gaGeladen) {
      sperreGA(zettelZustaendig());
    }
  }
  // nurStatistik: Abschaltung über den Laufzettel – die Werbewerte fasst er nie an (sie bleiben 'denied')
  function sperreGA(nurStatistik) {
    window['ga-disable-' + GA_ID] = true;
    g('consent', 'update', nurStatistik ? { analytics_storage: 'denied' }
      : { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });
    gaAktiv = false;
  }
  // Analytics-Cookies (_ga, _ga_<ID>) für alle Domain-Varianten dieser Adresse entfernen
  function gaKekseWeg() {
    var namen;
    try { namen = ZETTEL.gaKekse(document.cookie); } catch (e) { return; }
    var domains = ZETTEL.domains(location.hostname);
    namen.forEach(function (n) {
      domains.forEach(function (d) {
        try { document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0; path=/' + (d ? '; domain=' + d : ''); } catch (e) { /* */ }
      });
    });
  }
  // Google hat (auch beim Laden aus einer gespeicherten Entscheidung) die Statistik abgelehnt → _ga entfernen
  function googleNeinAufraeumen() {
    var tc = letzteTC;
    if (!tc || !(tc.gdprApplies === false || ZETTEL.entschieden(tc)) || erteilt()) return;
    var cmNein = zustand.cm !== null && zustand.cm !== CM_GRANTED && zustand.cm !== CM_NOT_APPLICABLE;
    if (zustand.tcf === 'nein' || cmNein) gaKekseWeg();
  }
  function leseCM() {
    try {
      var gfc = window.googlefc;
      if (gfc && typeof gfc.getGoogleConsentModeValues === 'function') {
        var w = gfc.getGoogleConsentModeValues();
        zustand.cm = w && typeof w.analyticsStoragePurposeConsentStatus === 'number' ? w.analyticsStoragePurposeConsentStatus : null;
      }
    } catch (e) { zustand.cm = null; }
  }
  function pruefeTCF(tc) {
    if (!tc) return;
    if (tc.gdprApplies === false) zustand.tcf = 'ausserhalb';
    else if (tc.eventStatus === 'tcloaded' || tc.eventStatus === 'useractioncomplete') {
      var ok = !!(tc.purpose && tc.purpose.consents && tc.purpose.consents[1] === true &&
                  tc.vendor && tc.vendor.consents && tc.vendor.consents[755] === true);
      zustand.tcf = ok ? 'ja' : 'nein';
    } else if (tc.eventStatus === 'cmpuishown' || tc.gdprApplies !== true) zustand.tcf = 'nein';
    else return;   // Zwischenstände ändern nichts
    if (zustand.tcf === 'nein') { zustand.cm = null; anwenden(); return; }   // sofort sperren, keine CMP-Abfrage
    leseCM();
    anwenden();
  }
  // Jede TCF-Meldung: Eine echte Google-Entscheidung (oder gdprApplies false) hat Vorrang vor dem Laufzettel.
  function tcfMeldung(tc) {
    if (!tc) return;
    letzteTC = tc;
    if (tc.gdprApplies === false || ZETTEL.entschieden(tc)) ablage.loeschen();
    pruefeTCF(tc);
    var b = zettelBefund();
    if ((b === 'google' || b === 'warten') && zettel.offen() && zettel.art !== 'gpc') zettel.schliessen(false);
    googleNeinAufraeumen();
  }
  function neuLesen() { if (zustand.tcf !== 'nein') leseCM(); anwenden(); googleNeinAufraeumen(); }
  window.googlefc.callbackQueue.push({
    CONSENT_MODE_DATA_READY: neuLesen,
    INITIAL_US_STATES_OPT_OUT_DATA_READY: neuLesen
  });
  /* ---------- Laufzettel Statistik (Übergang, Stand 5. November 2026) ----------
   * Zeigt die Google-CMP etwa 3 s nach dem Laden keinen Dialog (kein __tcfapi oder nur displayStatus
   * hidden/disabled) und liefert sie keine Entscheidung (useractioncomplete bzw. tcloaded mit tcString),
   * fragt dieser kleine Zettel selbst – nur nach Google Analytics, nie nach Werbung. Speicherung in
   * localStorage 'vf24-statistik' { v, wahl, zeit }, 12 Monate gültig. Regeln: ZETTEL oben (ohne DOM). */
  var ablage = {
    puffer: null,   // gesperrter Speicher: die Wahl gilt dann nur für diesen Seitenaufruf
    lesen: function () {
      var roh = null;
      try { roh = window.localStorage.getItem(ZETTEL.SCHLUESSEL); } catch (e) { return this.puffer; }
      if (roh === null) return this.puffer;
      try { return JSON.parse(roh); } catch (e) { return null; }
    },
    schreiben: function (eintrag) {
      this.puffer = eintrag;
      try { window.localStorage.setItem(ZETTEL.SCHLUESSEL, JSON.stringify(eintrag)); } catch (e) { /* gesperrt */ }
    },
    loeschen: function () {
      this.puffer = null;
      try { window.localStorage.removeItem(ZETTEL.SCHLUESSEL); } catch (e) { /* gesperrt */ }
    }
  };
  function ansagen(text) {
    var st = document.getElementById('cmp-status');
    if (st) { st.textContent = ''; setTimeout(function () { st.textContent = text; }, 50); }
  }
  var zettel = {
    el: null, art: null, ausloeser: null,
    bauen: function () {
      if (this.el) return this.el;
      var el = document.createElement('section');
      el.className = 'vf-zettel';
      el.id = 'vf-zettel';
      el.hidden = true;
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'false');
      el.setAttribute('aria-labelledby', 'vf-zettel-titel');
      el.setAttribute('aria-describedby', 'vf-zettel-text');
      var self = this;
      el.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); self.schliessen(true); } });
      el.addEventListener('click', function (e) {
        var k = e.target && e.target.closest ? e.target.closest('[data-vf-wahl]') : null;
        if (!k) return;
        var w = k.getAttribute('data-vf-wahl');
        if (w === 'zu') self.schliessen(true); else self.entscheiden(w);
      });
      // früh in der Tab-Reihenfolge (nach „Zum Inhalt springen“), optisch unten fixiert – kein Layout-Shift
      var skip = document.querySelector('.skip');
      if (skip && skip.parentNode === document.body && skip.nextSibling) document.body.insertBefore(el, skip.nextSibling);
      else document.body.appendChild(el);
      this.el = el;
      return el;
    },
    datum: function (ms) {
      try { return new Date(ms).toLocaleDateString('de-AT', { day: 'numeric', month: 'long', year: 'numeric' }); }
      catch (e) { return new Date(ms).toISOString().slice(0, 10); }
    },
    inhalt: function (art) {
      var kopf = '<p class="vf-zettel__kopf" aria-hidden="true">Laufzettel · Statistik</p>' +
                 '<span class="vf-zettel__stempel" aria-hidden="true">nur Statistik</span>';
      var link = '<a href="/datenschutz/#statistik-fenster">Datenschutzerklärung</a>';
      if (art === 'gpc') {
        return kopf + '<h2 id="vf-zettel-titel" tabindex="-1">Statistik bleibt aus</h2>' +
          '<div id="vf-zettel-text"><p>Ihr Browser sendet das Signal „Global Privacy Control“. Daran halten wir uns: Google Analytics bleibt ausgeschaltet, und wir fragen nicht nach. Mehr in der ' + link + '.</p></div>' +
          '<div class="vf-zettel__wahl vf-zettel__wahl--eins"><button type="button" class="vf-zettel__knopf" data-vf-wahl="zu">Schließen</button></div>';
      }
      var eintrag = ablage.lesen();
      var wahl = ZETTEL.gueltigeWahl(eintrag, Date.now());
      var stand = wahl === 'ja' ? 'Ihre Wahl vom ' + this.datum(eintrag.zeit) + ': zugestimmt.'
        : wahl === 'nein' ? 'Ihre Wahl vom ' + this.datum(eintrag.zeit) + ': abgelehnt.'
        : (this.ausloeser ? 'Bisher keine Wahl – die Statistik ist aus.' : '');
      var hier = ohneWerbung ? ' Auf dieser Seite wird nichts gemessen; die Wahl gilt für die übrigen Seiten, solange dort der Einwilligungsdialog von Google nicht selbst entscheidet.' : '';
      var standHtml = (stand || hier) ? '<p class="vf-zettel__stand">' + (stand + hier).replace(/^ /, '') + '</p>' : '';
      return kopf + '<h2 id="vf-zettel-titel" tabindex="-1">Dürfen wir mitzählen?</h2>' +
        '<div id="vf-zettel-text"><p>Mit Google Analytics (Google Ireland Limited) zählen wir, welche Seiten und Vorlagen genutzt werden. Google setzt dafür Cookies; Daten können auch in den USA verarbeitet werden. Ihre Eingaben in den Vorlagen werden nicht übertragen. <strong>Das ist keine Einwilligung in Werbung.</strong></p>' +
        '<p>Widerruf jederzeit unten über „Datenschutz-Einstellungen“. ' + link + '</p></div>' + standHtml +
        '<div class="vf-zettel__wahl"><button type="button" class="vf-zettel__knopf" data-vf-wahl="ja">Zustimmen</button>' +
        '<button type="button" class="vf-zettel__knopf" data-vf-wahl="nein">Ablehnen</button></div>' +
        '<button type="button" class="vf-zettel__zu" data-vf-wahl="zu" aria-label="Schließen ohne Auswahl">×</button>';
    },
    offen: function () { return !!(this.el && !this.el.hidden); },
    // solange der Zettel offen ist, bleibt der Seitenfuß darunter erreichbar
    platz: function () {
      var b = document.body;
      if (!b || !b.style) return;
      if (this.offen()) {
        b.style.paddingBottom = Math.ceil(this.el.getBoundingClientRect().height) + 24 + 'px';
        if (!this.hoertGroesse) { this.hoertGroesse = true; var self = this; window.addEventListener('resize', function () { self.platz(); }); }
      } else b.style.paddingBottom = '';
    },
    zeigen: function (art, ausloeser) {
      if (!document.body) return;
      var el = this.bauen();
      this.art = art;
      this.ausloeser = ausloeser || null;
      el.setAttribute('data-art', art);
      el.innerHTML = this.inhalt(art);
      el.hidden = false;
      this.platz();
      if (this.ausloeser) {
        var t = el.querySelector('#vf-zettel-titel');
        if (t) { try { t.focus({ preventScroll: true }); } catch (e) { t.focus(); } }
      } else if (art === 'frage') {
        ansagen('Unten auf der Seite: Frage zur Statistik mit Google Analytics. Ohne Auswahl bleibt die Statistik aus.');
      }
    },
    schliessen: function (fokusZurueck) {
      if (!this.offen()) return;
      var hatteFokus = this.el.contains(document.activeElement);
      this.el.hidden = true;
      this.platz();
      if (fokusZurueck && hatteFokus && this.ausloeser && document.contains(this.ausloeser)) this.ausloeser.focus();
      this.ausloeser = null;
    },
    entscheiden: function (wahl) {
      if (wahl !== 'ja' && wahl !== 'nein') return;
      if (gpc) { this.schliessen(true); return; }
      ablage.schreiben({ v: ZETTEL.VERSION, wahl: wahl, zeit: Date.now() });
      if (!ohneWerbung) zettelBereit = true;
      anwenden();
      if (wahl === 'nein') gaKekseWeg();
      this.schliessen(true);
      ansagen(wahl === 'nein' ? 'Gespeichert: Die Statistik ist ausgeschaltet.'
        : ohneWerbung ? 'Gespeichert: Zustimmung zur Statistik. Auf dieser Seite wird nichts gemessen.'
        : 'Gespeichert: Die Statistik mit Google Analytics ist eingeschaltet.');
    }
  };
  var versuche = 0;
  (function warteAufCMP() {
    if (ohneWerbung) return;   // hier lädt keine CMP
    if (typeof window.__tcfapi === 'function') {
      window.__tcfapi('addEventListener', 2, function (tc, ok) { if (ok) tcfMeldung(tc); });
      return;
    }
    if (++versuche < 40) setTimeout(warteAufCMP, 250);   // max. 10 s; ohne CMP keine Google-Entscheidung
  }());

  // nach ZETTEL.FRIST_MS: Hat Google weder entschieden noch einen Dialog gezeigt, gilt die eigene Wahl – oder wir fragen
  setTimeout(function () {
    if (ohneWerbung) return;
    zettelBereit = true;
    var b = zettelBefund();
    if (b === 'nein') gaKekseWeg();
    anwenden();
    if (b === 'fragen' && !zettel.offen()) zettel.zeigen('frage', null);
  }, ZETTEL.FRIST_MS);

  /* Datenschutz-Einstellungen: Ist die Google-CMP aktiv, sperrt der Widerruf GA sofort und die CMP zeigt
     ihren Dialog erneut. Sonst öffnet sich der Laufzettel zum Ansehen, Ändern oder Widerrufen. */
  function googleAktiv() {
    var tc = letzteTC;
    return !ohneWerbung && !!tc && (tc.gdprApplies === false || ZETTEL.entschieden(tc) || ZETTEL.googleFragt(tc));
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-cmp-widerruf]'), function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      if (!googleAktiv()) { zettel.zeigen(gpc ? 'gpc' : 'frage', el); return; }
      zustand.tcf = 'nein'; zustand.cm = null; sperreGA(false);
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
    if (format === 'banner') return mq('(min-width: 768px)') ? [728, 90] : (mq('(min-width: 360px)') ? [320, 100] : null); // 320 px Banner braucht Platz für den Seitenrand
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
    if (g && format === 'banner' && g[0] === 320) slot = SLOT_MOBIL;
    if (g && format === 'seite' && g[0] === 160) slot = SLOT_SKY;
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
