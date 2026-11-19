// Kopfplatz (oberster Anzeigenplatz) über alle Seiten der Sitemap, bei 1366×768 und 390×844, gefüllt simuliert:
// liegt vollständig im ersten Bildschirm, Überschrift und Einleitung stehen darüber bzw. daneben und sind sichtbar,
// jeder Platz hält ≥ 150 px Abstand zu jedem Bedienelement eines Werkzeugs (Werkzeug ausgefüllt) und ≥ 100 px zur
// Navigation, Werkzeuge beginnen am Desktop im ersten Bildschirm, kein horizontaler Überlauf (auch 360–1280 px),
// keine JS-Fehler, kein Layout-Sprung beim Füllen. Seiten ohne Plätze im Text bleiben ohne Kopfplatz.
// Start: node tests/kopfplatz.js
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { server } = require('./server');
const ROOT = path.join(__dirname, '..', 'docs');
const URLS = [...fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8').matchAll(/<loc>https:\/\/[^/]+([^<]*)<\/loc>/g)].map(m => m[1]);
const OHNE = ['/impressum/', '/datenschutz/', '/kontakt/', '/vorlagen/', '/ueber-uns/'];
const WERKZEUG_MAX_OBEN = 739;   // Stand vor dem Kopfplatz: spätester Werkzeugbeginn am Desktop (Fristenrechner)

function messen(vh) {
  const hauptteil = document.querySelector('main');
  const bedien = [...hauptteil.querySelectorAll('.werkzeug button,.werkzeug input,.werkzeug select,.werkzeug textarea,.werkzeug a,.werkzeug summary,.ft button,.ft input,.ft select,.ft a,[data-fristentabelle] button')]
    .filter(e => e.getClientRects().length).map(e => e.getBoundingClientRect());
  const nav = [...document.querySelectorAll('.kopf a,.kopf button,.register a')].filter(e => e.getClientRects().length).map(e => e.getBoundingClientRect());
  const abstand = (x, l) => l.reduce((m, c) => Math.min(m, Math.hypot(Math.max(0, c.left - x.right, x.left - c.right), Math.max(0, c.top - x.bottom, x.top - c.bottom))), 1e9);
  const r = s => { const e = document.querySelector(s); if (!e) return null; const x = e.getBoundingClientRect(); return { oben: x.top + scrollY, unten: x.bottom + scrollY, links: x.left, rechts: x.right }; };
  const plaetze = [...document.querySelectorAll('.anzeige')].filter(a => getComputedStyle(a).display !== 'none' && a.querySelector('ins')).map(a => {
    const x = a.querySelector('ins').getBoundingClientRect(); const et = a.querySelector('.anz-label').getBoundingClientRect();
    return { format: a.dataset.format, b: Math.round(x.width), h: Math.round(x.height), oben: Math.round(x.top + scrollY), unten: Math.round(x.bottom + scrollY), links: x.left, rechts: x.right,
             etikett: et.height > 0 ? et.top + scrollY : null, etikettText: a.querySelector('.anz-label').textContent,
             zuBedien: Math.round(abstand(x, bedien)), zuNav: Math.round(abstand(x, nav)), erster: x.bottom + scrollY <= vh && x.top >= 0 };
  });
  return { plaetze, h1: r('h1'), lead: r('.lead'), werkzeug: r('.werkzeug'), breite: document.documentElement.scrollWidth, fenster: innerWidth };
}

(async () => {
  const srv = await server(0); const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const bericht = [];
  async function oeffnen(b, h, url) {
    const ctx = await browser.newContext({ viewport: { width: b, height: h } });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '/* Stub */' }));
    const page = await ctx.newPage(); const fehler = [];
    page.on('pageerror', e => fehler.push(e.message));
    await page.addInitScript(() => { window.__cls = 0; try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {} });
    await page.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: 'load' });
    await page.waitForTimeout(350);
    return { ctx, page, fehler };
  }
  const status = (page, st, nur) => page.$$eval('.anzeige ins.adsbygoogle', (l, [st, nur]) => l.forEach(i => { if (!nur || i.closest('.anzeige').dataset.format.startsWith(nur)) i.setAttribute('data-ad-status', st); }), [st, nur || '']);

  for (const [b, h] of [[1366, 768], [390, 844]]) for (const url of URLS) {
    const wo = `${b} px ${url}`;
    const { ctx, page, fehler } = await oeffnen(b, h, url);
    // Werkzeug ausfüllen, damit Ergebnis- und Druck-/Download-Knöpfe mitgemessen werden
    await page.evaluate(() => {
      for (const e of document.querySelectorAll('.werkzeug input, .werkzeug textarea')) {
        if (e.type === 'checkbox' || e.type === 'radio' || e.type === 'file' || e.readOnly || e.disabled) continue;
        if (e.type === 'date') { if (!e.value) e.value = '2026-11-19'; } else if (e.type === 'number') { if (!e.value) e.value = '3'; } else if (!e.value) e.value = 'Muster 1';
        e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(150);
    const vorher = await page.evaluate(() => window.__cls);
    await status(page, 'filled', 'kopf'); await page.waitForTimeout(250);
    const sprung = (await page.evaluate(() => window.__cls)) - vorher;
    await status(page, 'filled');
    const d = await page.evaluate(messen, h);
    assert.deepStrictEqual(fehler, [], wo + ': JS-Fehler');
    assert(d.breite <= d.fenster, `${wo}: horizontaler Überlauf ${d.breite}`);
    assert(d.h1 && d.h1.oben >= 0 && d.h1.unten <= h, wo + ': Überschrift nicht im ersten Bildschirm');
    if (OHNE.includes(url)) { assert.strictEqual(d.plaetze.length, 0, wo + ': Seite soll ohne Anzeigenplatz bleiben'); await ctx.close(); continue; }
    const k = d.plaetze[0];
    assert(k && k.format.startsWith('kopf'), wo + ': oberster Platz ist nicht der Kopfplatz');
    assert.strictEqual(d.plaetze.filter(p => p.format.startsWith('kopf')).length, 1, wo + ': genau ein Kopfplatz');
    const soll = b >= 1024 ? (url === '/' ? '728x90' : '300x250') : '320x100';
    assert.strictEqual(k.b + 'x' + k.h, soll, wo + ': Format');
    assert(k.erster, `${wo}: Kopfplatz nicht vollständig im ersten Bildschirm (${k.oben}–${k.unten})`);
    assert(k.etikett !== null && k.etikett < k.oben && k.etikettText === 'Anzeige', wo + ': Etikett „Anzeige“ fehlt über dem Platz');
    assert(d.lead && d.lead.oben < h && d.h1.unten <= d.lead.oben, wo + ': Einleitung beginnt nicht im ersten Bildschirm');
    if (b < 1024 || url === '/') assert(d.lead.unten <= k.oben && d.h1.unten < k.oben, wo + ': Kopfplatz steht nicht unter Überschrift und Einleitung');
    else assert(k.links >= Math.max(d.h1.rechts, d.lead.rechts) + 24, wo + ': Kopfplatz überdeckt den Seitenkopf');
    assert(sprung < 0.005, `${wo}: Layout-Sprung beim Füllen ${sprung.toFixed(4)}`);
    for (const p of d.plaetze) {
      assert(p.zuBedien >= 150, `${wo}: Platz ${p.format} (${p.oben}) nur ${p.zuBedien} px von einem Bedienelement`);
      assert(p.zuNav >= 100, `${wo}: Platz ${p.format} nur ${p.zuNav} px von der Navigation`);
    }
    if (d.werkzeug) {
      assert(d.werkzeug.oben >= k.unten || k.links >= d.werkzeug.rechts, wo + ': Kopfplatz ragt ins Werkzeug');
      if (b >= 1024) assert(d.werkzeug.oben <= WERKZEUG_MAX_OBEN, `${wo}: Werkzeug beginnt erst bei ${Math.round(d.werkzeug.oben)} px`);
      if (url === '/') assert(d.werkzeug.oben + 60 <= h, wo + ': Rechnerkopf der Startseite nicht im ersten Bildschirm');
    }
    // nicht gefüllt: Platz fällt weg, Sprung bleibt klein
    const v2 = await page.evaluate(() => window.__cls);
    await status(page, 'unfilled', 'kopf'); await page.waitForTimeout(250);
    const weg = (await page.evaluate(() => window.__cls)) - v2;
    assert(weg < 0.1, `${wo}: Layout-Sprung bei „unfilled“ ${weg.toFixed(3)}`);
    assert(await page.$eval('.anzeige[data-format^="kopf"]', a => getComputedStyle(a.querySelector('ins')).display === 'none' && getComputedStyle(a.querySelector('.anz-label')).display === 'none'), wo + ': unfilled nicht ausgeblendet');
    bericht.push(`${String(b).padStart(4)} ${url.padEnd(40)} Kopfplatz ${soll} ${k.oben}–${k.unten}  Bedienelement ≥ ${Math.min(...d.plaetze.map(p => p.zuBedien)) > 1e8 ? '–' : Math.min(...d.plaetze.map(p => p.zuBedien))}  Navigation ${k.zuNav}  Werkzeug ab ${d.werkzeug ? Math.round(d.werkzeug.oben) : '–'}  CLS gefüllt ${sprung.toFixed(3)} / unfilled ${weg.toFixed(3)}`);
    await ctx.close();
  }
  // Zwischenbreiten: kein Überlauf, Kopfplatz überdeckt nichts
  for (const b of [360, 768, 800, 1023, 1024, 1280]) for (const url of ['/', '/wohnung-kuendigen/', '/fristen-tabelle/']) {
    const { ctx, page, fehler } = await oeffnen(b, 800, url);
    await status(page, 'filled');
    const d = await page.evaluate(messen, 800);
    assert.deepStrictEqual(fehler, [], `${b} px ${url}: JS-Fehler`);
    assert(d.breite <= d.fenster, `${b} px ${url}: horizontaler Überlauf ${d.breite}`);
    const k = d.plaetze.find(p => p.format.startsWith('kopf'));
    assert(k && k.links >= 0 && k.rechts <= d.fenster, `${b} px ${url}: Kopfplatz ragt aus dem Fenster`);
    if (k.oben < d.lead.unten) assert(k.links >= d.lead.rechts, `${b} px ${url}: Kopfplatz überdeckt die Einleitung`);
    await ctx.close();
  }
  bericht.push('Zwischenbreiten 360–1280 px: kein Überlauf, keine Überdeckung');
  await browser.close(); srv.close();
  console.log(bericht.join('\n'));
  console.log('Kopfplatztest bestanden.');
})().catch(e => { console.error(e.message); process.exit(1); });
