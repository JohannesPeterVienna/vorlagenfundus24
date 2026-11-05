// Selbsttest Einwilligung (Consent Mode v2 + Google-CMP-Stub): Erstbesuch, Ablehnen, Zustimmen,
// Analytics-Status DENIED trotz TCF-Zustimmung, Widerruf, Wiederbesuch; danach Laufzettel Statistik bei verborgenem
// Google-Dialog (displayStatus hidden): Erscheinen nach 3 s, CLS, 320 px, Zustimmen/Ablehnen, späte Google-Entscheidung.
// Protokolliert Google-Anfragen.
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

  // 8. Laufzettel Statistik: Google-CMP lädt, zeigt aber nichts (cmpuishown, displayStatus hidden).
  const HIDDEN_STUB = `(function(){ var hoerer = [];
    function tc(s, ent){ return { gdprApplies: true, eventStatus: s, displayStatus: ent ? 'hidden' : 'hidden', tcString: ent ? 'CQ' : '', purpose: { consents: { 1: ent === 'granted' } }, vendor: { consents: { 755: ent === 'granted' } } }; }
    window.__tcfapi = function(cmd, v, cb){ if (cmd === 'addEventListener') { hoerer.push(cb); cb(tc('cmpuishown'), true); } };
    var fc = window.googlefc = window.googlefc || {}; var q = fc.callbackQueue || [];
    fc.getGoogleConsentModeValues = function(){ return { analyticsStoragePurposeConsentStatus: 2 }; };
    window.__entscheide = function(x){ hoerer.forEach(function(h){ h(tc('useractioncomplete', x), true); }); };
    function lauf(i){ if (typeof i === 'function') i(); } q.forEach(lauf); fc.callbackQueue = { push: lauf };
  })();`;
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const log2 = [];
  await ctx2.route(/googlesyndication\.com|googletagmanager\.com|google-analytics\.com|fundingchoices/, r => {
    const u = r.request().url(); log2.push(u);
    return r.fulfill({ status: 200, contentType: 'text/javascript', body: /adsbygoogle\.js/.test(u) ? HIDDEN_STUB : '/* stub */' });
  });
  await ctx2.addInitScript(() => { window.__cls = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
  const p2 = await ctx2.newPage(); p2.on('pageerror', e => errs.push(e.message));
  const ga2 = () => log2.filter(u => /googletagmanager\.com\/gtag\/js/.test(u)).length;
  const sichtbar = () => p2.evaluate(() => { const z = document.getElementById('vf-zettel'); return !!(z && !z.hidden); });
  await p2.goto(url + 'wohnung-kuendigen/', { waitUntil: 'networkidle' });
  await p2.evaluate(() => { document.cookie = '_ga=GA1.1.1.1; path=/'; document.cookie = '_ga_T00HRG2YVF=GS1; path=/'; });
  await p2.waitForTimeout(1500);
  assert.equal(await sichtbar(), false, 'Laufzettel zu früh');
  const clsVorher = await p2.evaluate(() => window.__cls);
  await p2.waitForTimeout(2000);
  assert.equal(await sichtbar(), true, 'Laufzettel fehlt nach 3 s');
  const masse = await p2.evaluate(() => [...document.querySelectorAll('.vf-zettel__knopf, .vf-zettel__zu')].map(b => { const r = b.getBoundingClientRect(); return [b.textContent, Math.round(r.width), Math.round(r.height), getComputedStyle(b).backgroundColor]; }));
  assert.equal(masse[0][1], masse[1][1], 'Knöpfe ungleich breit'); assert.equal(masse[0][3], masse[1][3], 'Knöpfe ungleich gestaltet');
  assert(masse.every(m => m[1] >= 44 && m[2] >= 44), 'Knopf kleiner als 44 px: ' + JSON.stringify(masse));
  const clsZettel = await p2.evaluate(() => window.__cls) - clsVorher;
  assert.equal(clsZettel, 0, 'Layout-Shift durch den Laufzettel: ' + clsZettel);
  assert.equal(await p2.evaluate(() => getComputedStyle(document.getElementById('vf-zettel')).position), 'fixed');
  bericht.push('Laufzettel: erscheint nach 3 s (nicht nach 1,5 s), CLS durch Laufzettel 0 (Seite davor ' + clsVorher.toFixed(3) + '), Knöpfe ' + masse.map(m => m[0] + ' ' + m[1] + '×' + m[2]).join(', '));
  await p2.keyboard.press('Tab');   // nach „Zum Inhalt springen“ folgt der Laufzettel in der Tab-Reihenfolge
  await p2.click('.vf-zettel__knopf[data-vf-wahl="ja"]'); await p2.waitForTimeout(300);
  const dl2 = await p2.evaluate(() => window.dataLayer.map(a => Array.prototype.slice.call(a)).filter(a => a[0] === 'consent' && a[1] === 'update').map(a => a[2]));
  assert.deepEqual(dl2, [{ analytics_storage: 'granted' }], 'Zustimmen setzt mehr als analytics_storage: ' + JSON.stringify(dl2));
  assert.equal(ga2(), 1); assert.equal(await p2.evaluate(() => window['ga-disable-G-T00HRG2YVF']), false);
  bericht.push('Laufzettel Zustimmen: nur analytics_storage=granted, 1 GA-Anfrage');
  await p2.reload({ waitUntil: 'networkidle' }); await p2.waitForTimeout(3400);
  assert.equal(await sichtbar(), false, 'Laufzettel trotz gespeicherter Wahl'); assert.equal(ga2(), 2, 'GA beim Wiederbesuch mit Laufzettel-Ja fehlt');
  await p2.evaluate(() => { document.cookie = '_ga=GA1.1.1.1; path=/'; });
  await p2.click('[data-cmp-widerruf]'); await p2.waitForTimeout(200);
  assert.equal(await sichtbar(), true, 'Datenschutz-Einstellungen öffnen den Laufzettel nicht');
  assert.equal(await p2.evaluate(() => document.activeElement && document.activeElement.id), 'vf-zettel-titel', 'Fokus nicht auf der Überschrift');
  await p2.click('.vf-zettel__knopf[data-vf-wahl="nein"]'); await p2.waitForTimeout(200);
  assert.equal(await p2.evaluate(() => window['ga-disable-G-T00HRG2YVF']), true);
  assert(!/(^|; )_ga=/.test(await p2.evaluate(() => document.cookie)), '_ga nach Ablehnen noch da');
  assert.equal(await p2.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-cmp-widerruf')), true, 'Fokus nicht zurück am Knopf');
  bericht.push('Laufzettel Ablehnen: ga-disable=true, _ga gelöscht, Fokus zurück');
  // 320 px: kein waagrechter Überlauf; Escape schließt ohne Wahl
  await p2.evaluate(() => localStorage.removeItem('vf24-statistik'));
  await p2.setViewportSize({ width: 320, height: 640 });
  await p2.reload({ waitUntil: 'networkidle' }); await p2.waitForTimeout(3400);
  assert.equal(await sichtbar(), true);
  const breite = await p2.evaluate(() => [document.documentElement.scrollWidth, document.getElementById('vf-zettel').getBoundingClientRect().width]);
  assert(breite[0] <= 320 && breite[1] <= 320, 'Überlauf bei 320 px: ' + breite);
  await p2.screenshot({ path: require('path').join(require('os').tmpdir(), 'vf24-zettel-320.png') });
  await p2.focus('#vf-zettel-titel'); await p2.keyboard.press('Escape'); await p2.waitForTimeout(100);
  assert.equal(await sichtbar(), false, 'Escape schließt nicht');
  assert.equal(await p2.evaluate(() => localStorage.getItem('vf24-statistik')), null, 'Escape hat gespeichert');
  bericht.push('Laufzettel 320 px: Seitenbreite ' + breite[0] + ' px, Escape = keine Wahl');
  // späte Google-Entscheidung schließt den Laufzettel und löscht die eigene Wahl
  await p2.setViewportSize({ width: 1280, height: 800 });
  await p2.reload({ waitUntil: 'networkidle' }); await p2.waitForTimeout(3400);
  await p2.click('.vf-zettel__knopf[data-vf-wahl="ja"]');
  await p2.click('[data-cmp-widerruf]'); assert.equal(await sichtbar(), true);
  await p2.evaluate(() => { document.cookie = '_ga=GA1.1.1.1; path=/'; window.__entscheide('denied'); }); await p2.waitForTimeout(200);
  assert.equal(await sichtbar(), false, 'Laufzettel bleibt trotz Google-Entscheidung offen');
  assert.equal(await p2.evaluate(() => localStorage.getItem('vf24-statistik')), null, 'eigene Wahl nach Google-Entscheidung nicht gelöscht');
  assert.equal(await p2.evaluate(() => window['ga-disable-G-T00HRG2YVF']), true);
  assert(!/(^|; )_ga=/.test(await p2.evaluate(() => document.cookie)), '_ga nach Google-Nein noch da');
  bericht.push('Späte Google-Entscheidung: Laufzettel zu, eigene Wahl gelöscht, GA aus, _ga gelöscht');
  // Seiten ohne Werbung: kein Laufzettel von selbst, kein Google-Skript
  const vorDs = log2.length;
  await p2.goto(url + 'datenschutz/', { waitUntil: 'networkidle' }); await p2.waitForTimeout(3400);
  assert.equal(await sichtbar(), false, 'Laufzettel auf Datenschutzseite von selbst');
  assert.equal(log2.length, vorDs, 'Google-Anfrage auf der Datenschutzseite');
  await p2.click('footer [data-cmp-widerruf]'); assert.equal(await sichtbar(), true, 'Knopf auf Datenschutzseite öffnet nichts');
  bericht.push('Datenschutzseite: kein Google-Skript, Laufzettel nur über den Knopf');
  // Druck: ausgeblendet
  await p2.emulateMedia({ media: 'print' });
  assert.equal(await p2.evaluate(() => getComputedStyle(document.getElementById('vf-zettel')).display), 'none', 'Laufzettel im Druck sichtbar');
  await ctx2.close();

  assert(!errs.length, errs.join('|'));
  console.log(bericht.join('\n'));
  console.log('Google-Anfragen (' + log.length + '):\n' + [...new Set(log.map(u => u.split('?')[0]))].map(u => '  ' + u + ' ×' + log.filter(x => x.split('?')[0] === u).length).join('\n'));
  console.log('Einwilligungstest bestanden.');
  await browser.close(); srv.close();
})().catch(e => { console.error(e.message); process.exit(1); });
