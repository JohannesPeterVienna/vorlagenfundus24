'use strict';
// Laufzettel Statistik in docs/assets/js/site.js – Regeln und Ablauf ohne Browser. Start: node --test tests/*.test.js
// site.js läuft in einer eigenen VM mit einem kleinen Schein-DOM; Uhr und Timer sind künstlich,
// damit „nach 3 s“ und „nach 12 Monaten“ ohne Warten geprüft werden.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const QUELLE = path.join(__dirname, '..', 'docs', 'assets', 'js', 'site.js');
const CODE = fs.readFileSync(QUELLE, 'utf8');
const Z = require(QUELLE);
const GA_AUS = 'ga-disable-G-T00HRG2YVF';
const JETZT = Date.UTC(2026, 10, 5, 10, 0, 0);
const TAG = 864e5;

const HIDDEN = { gdprApplies: true, eventStatus: 'cmpuishown', displayStatus: 'hidden', purpose: { consents: {} }, vendor: { consents: {} } };
const JA_TC = { gdprApplies: true, eventStatus: 'useractioncomplete', tcString: 'CQ-ja', purpose: { consents: { 1: true } }, vendor: { consents: { 755: true } } };
const NEIN_TC = { gdprApplies: true, eventStatus: 'tcloaded', tcString: 'CQ-nein', purpose: { consents: { 1: false } }, vendor: { consents: {} } };

function seite(o = {}) {
  const { tcf, gpc = false, gespeichert, kekse = [], ohneWerbung = false, start = JETZT, speicherGesperrt = false, cm = 1, us } = o;
  const uhr = { jetzt: start, timer: [] };
  const speicher = new Map(gespeichert ? [['vf24-statistik', JSON.stringify(gespeichert)]] : []);
  const jar = new Map(kekse.map(k => [k, '1']));
  const skripte = [];
  const tcfHoerer = [];
  const queue = [];
  let aktiv = null;

  function element(tag) {
    return {
      tagName: tag.toUpperCase(), attrs: {}, hoerer: {}, hidden: false, style: {}, _html: '', parentNode: null, textContent: '',
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null },
      hasAttribute(k) { return k in this.attrs; },
      addEventListener(t, f) { (this.hoerer[t] = this.hoerer[t] || []).push(f); },
      set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
      querySelector(s) { return s === '#vf-zettel-titel' && this._html.includes('id="vf-zettel-titel"') ? titel : null; },
      contains(x) { return x === this || (x === titel && this._html.includes('vf-zettel-titel')); },
      focus() { aktiv = this; },
      getBoundingClientRect() { return { height: 280 }; },
      appendChild(k) { k.parentNode = this; }
    };
  }
  const titel = { focus() { aktiv = titel; } };
  const body = element('body');
  if (ohneWerbung) body.setAttribute('data-ohne-werbung', '');
  const kinder = [];
  body.insertBefore = (k) => { k.parentNode = body; kinder.push(k); };
  body.appendChild = (k) => { k.parentNode = body; kinder.push(k); };
  const skip = element('a'); skip.parentNode = body; skip.nextSibling = {};
  const knopf = element('button'); knopf.setAttribute('data-cmp-widerruf', '');
  const status = element('p');
  const doc = {
    body, head: { appendChild(s) { skripte.push(s.src); } },
    get activeElement() { return aktiv; },
    createElement: element,
    querySelector: s => (s === '.skip' ? skip : null),
    querySelectorAll: s => (s === '[data-cmp-widerruf]' ? [knopf] : []),
    getElementById: id => (id === 'cmp-status' ? status : null),
    contains: x => x === knopf || kinder.includes(x),
    get cookie() { return [...jar].map(([k, v]) => k + '=' + v).join('; '); },
    set cookie(v) {
      const [paar, ...rest] = v.split(';').map(s => s.trim());
      const [k, w] = paar.split('=');
      if (rest.some(r => r === 'max-age=0')) jar.delete(k); else jar.set(k, w);
    }
  };
  const lsGesperrt = () => { throw new Error('SecurityError'); };
  const win = {
    document: doc, navigator: { globalPrivacyControl: gpc }, location: { hostname: 'vorlagenfundus24.de' },
    matchMedia: () => ({ matches: false }), addEventListener() {},
    setTimeout: (f, ms) => { uhr.timer.push({ f, um: uhr.jetzt + (ms || 0) }); return uhr.timer.length; },
    console, encodeURIComponent
  };
  Object.defineProperty(win, 'localStorage', speicherGesperrt ? { get: lsGesperrt } : {
    value: { getItem: k => (speicher.has(k) ? speicher.get(k) : null), setItem: (k, v) => speicher.set(k, String(v)), removeItem: k => speicher.delete(k) }
  });
  let tcAktuell = tcf;
  if (tcf !== undefined) {
    win.__tcfapi = (cmd, v, cb) => { if (cmd === 'addEventListener') { tcfHoerer.push(cb); if (tcAktuell) cb(tcAktuell, true); } };
  }
  win.googlefc = {
    callbackQueue: { push: f => { queue.push(f); if (typeof f === 'function') f(); } },
    getGoogleConsentModeValues: () => ({ analyticsStoragePurposeConsentStatus: cm }),
    usstatesoptout: us === undefined ? undefined : { getInitialUsStatesOptOutStatus: () => us },
    showRevocationMessage() { win.__widerrufGezeigt = (win.__widerrufGezeigt || 0) + 1; }
  };
  win.window = win;
  const ctx = vm.createContext(win);
  ctx.__uhr = uhr;
  vm.runInContext('Date.now = () => __uhr.jetzt; const __D = Date; Date = class extends __D { constructor(...a) { super(...(a.length ? a : [__uhr.jetzt])); } static now() { return __uhr.jetzt; } };', ctx);
  vm.runInContext(CODE, ctx, { filename: 'site.js' });

  const api = {
    win, jar, speicher, skripte, knopf, status, tcfHoerer,
    zettel: () => kinder.find(k => k.attrs.class === undefined && k.className === 'vf-zettel'),
    offen() { const z = api.zettel(); return !!(z && !z.hidden); },
    vergeht(ms) {
      const bis = uhr.jetzt + ms;
      for (;;) {
        uhr.timer.sort((a, b) => a.um - b.um);
        const t = uhr.timer[0];
        if (!t || t.um > bis) break;
        uhr.timer.shift(); uhr.jetzt = t.um; t.f();
      }
      uhr.jetzt = bis;
    },
    melde(tc) { tcAktuell = tc; tcfHoerer.forEach(h => h(tc, true)); },
    klick(wahl) {
      const z = api.zettel();
      const ziel = { closest: () => ({ getAttribute: () => wahl }) };
      z.hoerer.click.forEach(f => f({ target: ziel }));
    },
    taste(key) { api.zettel().hoerer.keydown.forEach(f => f({ key, preventDefault() {} })); },
    einstellungen() { knopf.hoerer.click.forEach(f => f({ preventDefault() {} })); },
    consent() { return JSON.parse(JSON.stringify(win.dataLayer.map(a => Array.from(a)).filter(a => a[0] === 'consent'))); },
    gaLaden() { return skripte.filter(s => /googletagmanager\.com\/gtag\/js/.test(s)).length; },
    gespeichert() { return speicher.has('vf24-statistik') ? JSON.parse(speicher.get('vf24-statistik')) : null; }
  };
  return api;
}

/* ---------- Regeln ohne DOM ---------- */
test('Regel: cmpuishown mit hidden/disabled zählt nicht als gezeigter Dialog', () => {
  assert.equal(Z.googleFragt(HIDDEN), false);
  assert.equal(Z.googleFragt({ eventStatus: 'cmpuishown', displayStatus: 'disabled' }), false);
  assert.equal(Z.googleFragt({ eventStatus: 'cmpuishown', displayStatus: 'visible' }), true);
  assert.equal(Z.googleFragt({ eventStatus: 'cmpuishown' }), true);
  assert.equal(Z.befund({ tc: HIDDEN, jetzt: JETZT }), 'fragen');
  assert.equal(Z.befund({ tc: null, jetzt: JETZT }), 'fragen');
});
test('Regel: echte Entscheidung nur bei useractioncomplete oder tcloaded mit TC-String', () => {
  assert.equal(Z.entschieden(JA_TC), true);
  assert.equal(Z.entschieden(NEIN_TC), true);
  assert.equal(Z.entschieden({ eventStatus: 'tcloaded', tcString: '' }), false);
  assert.equal(Z.befund({ tc: NEIN_TC, eintrag: { v: 1, wahl: 'ja', zeit: JETZT }, jetzt: JETZT }), 'google');
  assert.equal(Z.befund({ tc: { gdprApplies: false }, jetzt: JETZT }), 'google');
  assert.equal(Z.befund({ gpc: true, tc: null, jetzt: JETZT }), 'gpc');
});
test('Regel: Wahl 12 Monate gültig, Zukunft und fremde Versionen verworfen', () => {
  const e = { v: 1, wahl: 'ja', zeit: JETZT };
  assert.equal(Z.gueltigeWahl(e, JETZT + 364 * TAG), 'ja');
  assert.equal(Z.gueltigeWahl(e, Date.UTC(2027, 10, 5, 10, 0, 0)), null);
  assert.equal(Z.gueltigeWahl({ v: 1, wahl: 'ja', zeit: JETZT + 60000 }, JETZT), 'ja');   // 60 s Kulanz für Uhrkorrekturen
  assert.equal(Z.gueltigeWahl({ v: 1, wahl: 'ja', zeit: JETZT + 61000 }, JETZT), null);
  assert.equal(Z.gueltigeWahl({ v: 2, wahl: 'ja', zeit: JETZT }, JETZT), null);
  assert.equal(Z.gueltigeWahl({ v: 1, wahl: 'vielleicht', zeit: JETZT }, JETZT), null);
  assert.equal(Z.gueltigeWahl({ v: 1, wahl: 'nein', zeit: 'gestern' }, JETZT), null);
});
test('Regel: _ga-Cookies und Domain-Varianten', () => {
  assert.deepEqual(Z.gaKekse('_ga=1; _ga_T00HRG2YVF=2; _gid=3; x_ga=4; _gax=5'), ['_ga', '_ga_T00HRG2YVF']);
  assert.deepEqual(Z.domains('www.vorlagenfundus24.de'), ['', 'www.vorlagenfundus24.de', '.www.vorlagenfundus24.de', 'vorlagenfundus24.de', '.vorlagenfundus24.de']);
  assert.deepEqual(Z.domains('127.0.0.1'), ['']);
  assert.deepEqual(Z.domains('localhost'), ['']);
});

/* ---------- Ablauf in der Seite ---------- */
test('CMP lädt, Dialog hidden: Fenster erst nach 3 s, ohne Fokusraub, mit Ansage', () => {
  const s = seite({ tcf: HIDDEN });
  s.vergeht(2900);
  assert.equal(s.offen(), false);
  s.vergeht(200);
  assert.equal(s.offen(), true);
  const z = s.zettel();
  assert.equal(z.attrs.role, 'dialog');
  assert.equal(z.attrs['aria-modal'], 'false');
  assert.match(z.innerHTML, /data-vf-wahl="ja">Zustimmen</);
  assert.match(z.innerHTML, /data-vf-wahl="nein">Ablehnen</);
  assert.match(z.innerHTML, />×<\/button>/);
  assert.match(z.innerHTML, /keine Einwilligung in Werbung/);
  assert.match(z.innerHTML, /href="\/datenschutz\/#statistik-fenster"/);
  assert.equal(s.win.document.activeElement, null);
  s.vergeht(100);
  assert.match(s.status.textContent, /Statistik/);
  assert.equal(s.gaLaden(), 0);
  assert.equal(s.win[GA_AUS], true);
});
test('ohne __tcfapi: Fenster nach 3 s', () => {
  const s = seite();
  s.vergeht(3000);
  assert.equal(s.offen(), true);
});
test('Zustimmen setzt nur analytics_storage, lädt GA einmal, Signale und Werbepersonalisierung aus', () => {
  const s = seite({ tcf: HIDDEN });
  s.vergeht(3000);
  s.klick('ja');
  assert.equal(s.offen(), false);
  const updates = s.consent().filter(a => a[1] === 'update');
  assert.deepEqual(updates.map(a => a[2]), [{ analytics_storage: 'granted' }]);
  assert.equal(s.gaLaden(), 1);
  assert.equal(s.win[GA_AUS], false);
  const cfg = s.win.dataLayer.map(a => Array.from(a)).find(a => a[0] === 'config');
  assert.equal(cfg[2].allow_google_signals, false);
  assert.equal(cfg[2].allow_ad_personalization_signals, false);
  const e = s.gespeichert();
  assert.deepEqual(Object.keys(e).sort(), ['v', 'wahl', 'zeit']);
  assert.equal(e.wahl, 'ja'); assert.equal(e.v, 1); assert.equal(e.zeit, JETZT + 3000);
  // erneutes Öffnen und Zustimmen lädt nicht doppelt
  s.einstellungen(); s.klick('ja');
  assert.equal(s.gaLaden(), 1);
  // kein einziger ad_*-Wert wird je angehoben
  assert(!s.consent().some(a => a[1] === 'update' && ('ad_storage' in a[2] || 'ad_user_data' in a[2] || 'ad_personalization' in a[2])));
});
test('Ablehnen und Widerruf: GA aus, analytics_storage denied, _ga gelöscht', () => {
  const s = seite({ tcf: HIDDEN, kekse: ['_ga', '_ga_T00HRG2YVF', 'andere'] });
  s.vergeht(3000);
  s.klick('ja');
  s.einstellungen();                      // Google-CMP nicht aktiv → Laufzettel
  assert.equal(s.offen(), true);
  assert.equal(s.win.__widerrufGezeigt, undefined);
  assert.match(s.zettel().innerHTML, /zugestimmt/);
  s.klick('nein');
  assert.equal(s.win[GA_AUS], true);
  const letzte = s.consent().pop();
  assert.deepEqual(letzte, ['consent', 'update', { analytics_storage: 'denied' }]);
  assert.deepEqual([...s.jar.keys()], ['andere']);
  assert.equal(s.gespeichert().wahl, 'nein');
});
test('× und Escape: keine Wahl, Statistik bleibt aus, kein Eintrag', () => {
  const s = seite({ tcf: HIDDEN });
  s.vergeht(3000);
  s.klick('zu');
  assert.equal(s.offen(), false);
  assert.equal(s.gespeichert(), null);
  assert.equal(s.gaLaden(), 0);
  s.einstellungen();
  s.taste('Escape');
  assert.equal(s.offen(), false);
  assert.equal(s.gaLaden(), 0);
});
test('gespeichertes Nein beim Laden: kein Fenster, _ga gelöscht', () => {
  const s = seite({ tcf: HIDDEN, gespeichert: { v: 1, wahl: 'nein', zeit: JETZT - 10 * TAG }, kekse: ['_ga'] });
  s.vergeht(3000);
  assert.equal(s.offen(), false);
  assert.equal(s.jar.has('_ga'), false);
  assert.equal(s.gaLaden(), 0);
});
test('gespeichertes Ja: GA nach 3 s ohne Fenster; nach 12 Monaten wird neu gefragt', () => {
  const s = seite({ tcf: HIDDEN, gespeichert: { v: 1, wahl: 'ja', zeit: JETZT - 100 * TAG } });
  s.vergeht(3000);
  assert.equal(s.offen(), false);
  assert.equal(s.gaLaden(), 1);
  const alt = seite({ tcf: HIDDEN, gespeichert: { v: 1, wahl: 'ja', zeit: JETZT - 366 * TAG } });
  alt.vergeht(3000);
  assert.equal(alt.offen(), true);
  assert.equal(alt.gaLaden(), 0);
});
test('Zeitstempel in der Zukunft wird verworfen', () => {
  const s = seite({ tcf: HIDDEN, gespeichert: { v: 1, wahl: 'ja', zeit: JETZT + 30 * TAG } });
  s.vergeht(3000);
  assert.equal(s.offen(), true);
  assert.equal(s.gaLaden(), 0);
});
test('blockierter localStorage wirft nicht; Wahl gilt für diesen Seitenaufruf', () => {
  const s = seite({ tcf: HIDDEN, speicherGesperrt: true });
  s.vergeht(3000);
  assert.equal(s.offen(), true);
  s.klick('ja');
  assert.equal(s.gaLaden(), 1);
  s.einstellungen();
  assert.match(s.zettel().innerHTML, /zugestimmt/);
  s.klick('nein');
  assert.equal(s.win[GA_AUS], true);
});
test('Google-CMP entscheidet beim Laden: kein Fenster', () => {
  const s = seite({ tcf: JA_TC });
  s.vergeht(5000);
  assert.equal(s.offen(), false);
  assert.equal(s.gaLaden(), 1);              // bestehende CMP-Logik: TCF ja + analytics GRANTED
});
test('Google-Dialog sichtbar: kein Fenster', () => {
  const s = seite({ tcf: { gdprApplies: true, eventStatus: 'cmpuishown', displayStatus: 'visible' } });
  s.vergeht(5000);
  assert.equal(s.offen(), false);
  assert.equal(s.gaLaden(), 0);
});
test('gdprApplies false: kein Fenster, eigene Wahl gelöscht', () => {
  const s = seite({ tcf: { gdprApplies: false, eventStatus: 'tcloaded' }, gespeichert: { v: 1, wahl: 'nein', zeit: JETZT - TAG } });
  s.vergeht(5000);
  assert.equal(s.offen(), false);
  assert.equal(s.gespeichert(), null);
});
test('GPC: kein Fenster, kein GA – auch nicht mit gespeichertem Ja oder Google-Zustimmung', () => {
  const s = seite({ tcf: HIDDEN, gpc: true, gespeichert: { v: 1, wahl: 'ja', zeit: JETZT - TAG } });
  s.vergeht(5000);
  assert.equal(s.offen(), false);
  assert.equal(s.gaLaden(), 0);
  s.einstellungen();
  assert.equal(s.zettel().attrs['data-art'], 'gpc');
  assert.doesNotMatch(s.zettel().innerHTML, /data-vf-wahl="ja"/);
  const g = seite({ tcf: JA_TC, gpc: true });
  g.vergeht(5000);
  assert.equal(g.gaLaden(), 0);
});
test('späte Google-Entscheidung hat Vorrang: Fenster schließt, eigene Wahl gelöscht, Google-Nein löscht _ga', () => {
  const s = seite({ tcf: HIDDEN, kekse: [] });
  s.vergeht(3000);
  s.klick('ja');
  assert.equal(s.gaLaden(), 1);
  s.jar.set('_ga', '1'); s.jar.set('_ga_T00HRG2YVF', '1');
  s.einstellungen();
  assert.equal(s.offen(), true);
  s.melde({ ...NEIN_TC, eventStatus: 'useractioncomplete' });
  assert.equal(s.offen(), false);
  assert.equal(s.gespeichert(), null);
  assert.equal(s.win[GA_AUS], true);
  assert.equal(s.jar.size, 0);
  // weitere Klicks auf „Datenschutz-Einstellungen“ öffnen jetzt die Google-CMP
  s.einstellungen();
  assert.equal(s.win.__widerrufGezeigt, 1);
  assert.equal(s.offen(), false);
});
test('Google-Nein aus gespeicherter Entscheidung löscht _ga, auch ohne aktives Fenster', () => {
  const s = seite({ tcf: NEIN_TC, kekse: ['_ga', '_ga_T00HRG2YVF'] });
  assert.equal(s.jar.size, 0);
  s.vergeht(5000);
  assert.equal(s.offen(), false);
});
test('Google-Zustimmung zu TCF, aber Analytics DENIED: kein GA, _ga gelöscht', () => {
  const s = seite({ tcf: JA_TC, cm: 2, kekse: ['_ga'] });
  s.vergeht(5000);
  assert.equal(s.gaLaden(), 0);
  assert.equal(s.jar.has('_ga'), false);
});
test('Seiten ohne Werbung: kein automatisches Fenster, kein GA; Knopf öffnet Laufzettel', () => {
  const s = seite({ ohneWerbung: true, gespeichert: { v: 1, wahl: 'ja', zeit: JETZT - TAG } });
  s.vergeht(10000);
  assert.equal(s.offen(), false);
  assert.equal(s.gaLaden(), 0);
  s.einstellungen();
  assert.equal(s.offen(), true);
  assert.match(s.zettel().innerHTML, /Auf dieser Seite wird nichts gemessen/);
  assert.equal(s.win.document.activeElement !== null, true);   // Fokus auf der Überschrift
  s.klick('nein');
  assert.equal(s.gespeichert().wahl, 'nein');
  assert.equal(s.gaLaden(), 0);
});
test('gespeichertes Nein oder GPC: _ga sofort beim Laden gelöscht, auch auf Seiten ohne Werbung', () => {
  const nein = { v: 1, wahl: 'nein', zeit: JETZT - TAG };
  const a = seite({ ohneWerbung: true, gespeichert: nein, kekse: ['_ga', '_ga_T00HRG2YVF', 'x'] });
  assert.deepEqual([...a.jar.keys()], ['x']);
  const b = seite({ tcf: HIDDEN, gespeichert: nein, kekse: ['_ga'] });
  assert.equal(b.jar.has('_ga'), false);                     // ohne auf den 3-s-Timer zu warten
  const c = seite({ ohneWerbung: true, gpc: true, kekse: ['_ga_T00HRG2YVF'] });
  assert.equal(c.jar.size, 0);
  const d = seite({ tcf: HIDDEN, kekse: ['_ga'] });          // ohne Wahl bleibt _ga unangetastet
  assert.equal(d.jar.has('_ga'), true);
});
test('Seiten ohne Werbung: Knopf „Google-Einstellungen für Werbung“ lädt nur die CMP, Google-Entscheidung hat Vorrang, GA bleibt aus', () => {
  const s = seite({ ohneWerbung: true, gespeichert: { v: 1, wahl: 'ja', zeit: JETZT - TAG }, kekse: ['_ga'] });
  s.vergeht(5000);
  assert.equal(s.skripte.length, 0);                        // vor dem Klick kein Google-Skript
  s.einstellungen();
  assert.match(s.zettel().innerHTML, /data-vf-wahl="google">Google-Einstellungen für Werbung öffnen</);
  s.klick('google');
  assert.equal(s.offen(), false);
  assert.deepEqual(s.skripte, ['https://fundingchoicesmessages.google.com/i/pub-7811071715414905?ers=1']);
  assert(!s.skripte.some(u => /adsbygoogle/.test(u)));
  assert.equal(s.win.__widerrufGezeigt, 1);
  s.win.__tcfapi = (cmd, v, cb) => { if (cmd === 'addEventListener') cb(JA_TC, true); };
  s.vergeht(300);
  assert.equal(s.gespeichert(), null);                      // Google-Entscheidung ersetzt die eigene Wahl
  assert.equal(s.gaLaden(), 0);                             // Pflichtseite: trotzdem kein GA
  assert.equal(s.win[GA_AUS], true);
  s.einstellungen(); s.klick('google');
  assert.equal(s.skripte.length, 1);                        // nicht doppelt geladen
  assert.equal(s.win.__widerrufGezeigt, 2);
});
test('Werbe-Knopf nur auf Seiten ohne Werbung und nur im per Knopf geöffneten Laufzettel', () => {
  const s = seite({ tcf: HIDDEN });
  s.vergeht(3000);
  assert.doesNotMatch(s.zettel().innerHTML, /data-vf-wahl="google"/);
  const g = seite({ ohneWerbung: true, gpc: true });
  g.einstellungen();
  assert.match(g.zettel().innerHTML, /data-vf-wahl="google"/);
});
test('gdprApplies false + gemeldeter US-Opt-out + Analytics GRANTED: kein GA, _ga gelöscht', () => {
  const s = seite({ tcf: { gdprApplies: false, eventStatus: 'tcloaded' }, cm: 1, us: 3, kekse: ['_ga', '_ga_T00HRG2YVF'] });
  s.vergeht(5000);
  assert.equal(s.gaLaden(), 0);
  assert.equal(s.jar.size, 0);
  // US-Status noch nicht gemeldet: GA aus, aber _ga bleibt (sonst ginge es vor der Meldung verloren)
  const w = seite({ tcf: { gdprApplies: false, eventStatus: 'tcloaded' }, cm: 1, kekse: ['_ga'] });
  w.vergeht(5000);
  assert.equal(w.gaLaden(), 0);
  assert.equal(w.jar.has('_ga'), true);
  // kein Opt-out (2): GA läuft, _ga bleibt
  const ok = seite({ tcf: { gdprApplies: false, eventStatus: 'tcloaded' }, cm: 1, us: 2, kekse: ['_ga'] });
  ok.vergeht(5000);
  assert.equal(ok.gaLaden(), 1);
  assert.equal(ok.jar.has('_ga'), true);
});
test('× bei schon gespeicherter Wahl ändert nichts; ohne Wahl wird beim nächsten Aufruf erneut gefragt', () => {
  const s = seite({ tcf: HIDDEN, gespeichert: { v: 1, wahl: 'ja', zeit: JETZT - TAG } });
  s.vergeht(3000);
  s.einstellungen(); s.klick('zu');
  assert.equal(s.gespeichert().wahl, 'ja');
  assert.equal(s.win[GA_AUS], false);
  const n = seite({ tcf: HIDDEN });
  n.vergeht(3000); n.klick('zu');
  const wieder = seite({ tcf: HIDDEN });
  wieder.vergeht(3000);
  assert.equal(wieder.offen(), true);
});
