// Selbsttest Einwilligung (Consent Mode v2 + Google-CMP-Stub): Erstbesuch, Ablehnen, Zustimmen,
// Analytics-Status DENIED trotz TCF-Zustimmung, Widerruf, Wiederbesuch. Protokolliert Google-Anfragen.
// Start: node tests/einwilligung.js
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { server } = require('./server');
const assert = require('assert');

// Stub der Google-CMP: __tcfapi + googlefc (getGoogleConsentModeValues, showRevocationMessage, callbackQueue).
const CMP_STUB = `(function(){
  var st = localStorage.getItem('stub-consent'); var hoerer = [];
  function tc(status){ var g = st === 'granted'; return { gdprApplies: true, eventStatus: status, purpose: { consents: { 1: g } }, vendor: { consents: { 755: g } } }; }
  window.__tcfapi = function(cmd, v, cb){ if (cmd === 'addEventListener') { hoerer.push(cb); cb(st ? tc('tcloaded') : tc('cmpuishown'), true); } };
  var fc = window.googlefc = window.googlefc || {}; var q = fc.callbackQueue || [];
  fc.getGoogleConsentModeValues = function(){ var v = st === 'granted' ? 1 : st === 'denied' ? 2 : 0;
    var a = localStorage.getItem('stub-analytics'); return { adStoragePurposeConsentStatus: v, adUserDataPurposeConsentStatus: v, adPersonalizationPurposeConsentStatus: v, analyticsStoragePurposeConsentStatus: a !== null ? +a : v }; };
  fc.showRevocationMessage = function(){ st = null; localStorage.removeItem('stub-consent'); hoerer.forEach(function(h){ h(tc('cmpuishown'), true); }); };
  window.__entscheide = function(x){ st = x; localStorage.setItem('stub-consent', x); hoerer.forEach(function(h){ h(tc('useractioncomplete'), true); }); };
  function lauf(i){ if (typeof i === 'function') i(); else if (i && i.CONSENT_MODE_DATA_READY) i.CONSENT_MODE_DATA_READY(); }
  q.forEach(lauf); fc.callbackQueue = { push: lauf };
})();`;

(async () => {
  const srv = await server(0); const port = srv.address().port; const url = `http://127.0.0.1:${port}/`;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  const log = [];
  await ctx.route(/googlesyndication\.com|googletagmanager\.com|google-analytics\.com|fundingchoices/, r => {
    const u = r.request().url(); log.push(u);
    if (/adsbygoogle\.js/.test(u)) return r.fulfill({ status: 200, contentType: 'text/javascript', body: CMP_STUB });
    return r.fulfill({ status: 200, contentType: 'text/javascript', body: '/* stub */' });
  });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const ga = () => log.filter(u => /googletagmanager\.com\/gtag\/js/.test(u)).length;
  const zustand = () => page.evaluate(() => ({
    dl: window.dataLayer.map(a => Array.prototype.slice.call(a)).filter(a => a[0] === 'consent'),
    aus: window['ga-disable-G-T00HRG2YVF']
  }));
  const warte = () => page.waitForTimeout(400);
  const bericht = [];

  // 1. Erstbesuch: Default denied vor allen Google-Skripten, kein GA.
  await page.goto(url, { waitUntil: 'networkidle' }); await warte();
  let z = await zustand();
  assert.deepEqual(z.dl[0], ['consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied', wait_for_update: 500 }], 'Default fehlt/falsch');
  const reihenfolge = await page.evaluate(() => { const s = [...document.head.querySelectorAll('script')]; const i = s.findIndex(x => /consent','default/.test(x.textContent)); const j = s.findIndex(x => /adsbygoogle/.test(x.src)); return [i, j]; });
  assert(reihenfolge[0] >= 0 && reihenfolge[0] < reihenfolge[1], 'Default steht nicht vor adsbygoogle.js');
  assert.equal(ga(), 0, 'GA beim Erstbesuch geladen'); bericht.push('Erstbesuch: Default denied vor adsbygoogle.js, 0 GA-Anfragen');

  // 2. Ablehnen.
  await page.evaluate(() => window.__entscheide('denied')); await warte();
  assert.equal(ga(), 0, 'GA nach Ablehnung geladen'); bericht.push('Ablehnen: 0 GA-Anfragen');

  // 3. Wiederbesuch nach Ablehnung.
  await page.reload({ waitUntil: 'networkidle' }); await warte();
  assert.equal(ga(), 0, 'GA beim Wiederbesuch nach Ablehnung'); bericht.push('Wiederbesuch (abgelehnt): 0 GA-Anfragen');

  // 4. TCF-Zustimmung, aber CMP meldet analytics_storage DENIED → kein GA (Codex-Fall).
  await page.evaluate(() => localStorage.setItem('stub-analytics', '2'));
  await page.evaluate(() => window.__entscheide('granted')); await warte();
  assert.equal(ga(), 0, 'GA trotz Analytics DENIED'); bericht.push('TCF ja + Analytics DENIED: 0 GA-Anfragen');
  await page.evaluate(() => localStorage.setItem('stub-analytics', '0'));
  await page.evaluate(() => window.__entscheide('granted')); await warte();
  assert.equal(ga(), 0, 'GA trotz Analytics UNKNOWN'); bericht.push('TCF ja + Analytics UNKNOWN: 0 GA-Anfragen');
  await page.evaluate(() => localStorage.removeItem('stub-analytics'));

  // 5. Zustimmen.
  await page.evaluate(() => window.__entscheide('granted')); await warte();
  z = await zustand();
  assert.equal(ga(), 1, 'GA nach Zustimmung nicht genau einmal geladen');
  assert(z.dl.some(a => a[1] === 'update' && a[2].analytics_storage === 'granted'), 'kein consent update granted');
  assert.equal(z.aus, false); bericht.push('Zustimmen: 1 GA-Anfrage, update analytics_storage=granted');

  // 6. Widerruf über „Datenschutz-Einstellungen“.
  await page.click('[data-cmp-widerruf]'); await warte();
  z = await zustand();
  const letzte = z.dl[z.dl.length - 1];
  assert.equal(letzte[1], 'update'); assert.equal(letzte[2].analytics_storage, 'denied');
  assert.equal(z.aus, true, 'ga-disable nicht gesetzt'); bericht.push('Widerruf: update denied, ga-disable=true');
  await page.evaluate(() => window.__entscheide('denied')); await warte();
  z = await zustand(); assert.equal(z.aus, true);
  assert.equal(ga(), 1, 'nach Widerruf neue GA-Anfrage');

  // 7. Wiederbesuch nach Zustimmung (gespeicherte Entscheidung → tcloaded).
  await page.evaluate(() => window.__entscheide('granted'));
  const vorher = ga();
  await page.reload({ waitUntil: 'networkidle' }); await warte();
  assert.equal(ga(), vorher + 1, 'GA beim Wiederbesuch mit Zustimmung fehlt'); bericht.push('Wiederbesuch (zugestimmt): GA geladen');

  assert(!errs.length, errs.join('|'));
  console.log(bericht.join('\n'));
  console.log('Google-Anfragen (' + log.length + '):\n' + [...new Set(log.map(u => u.split('?')[0]))].map(u => '  ' + u + ' ×' + log.filter(x => x.split('?')[0] === u).length).join('\n'));
  console.log('Einwilligungstest bestanden.');
  await browser.close(); srv.close();
})().catch(e => { console.error(e.message); process.exit(1); });
