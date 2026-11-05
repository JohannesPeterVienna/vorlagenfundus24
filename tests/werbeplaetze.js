// Leere Anzeigenplätze: adsbygoogle.js ist ein Stub, der nie eine Anzeige liefert.
// Erwartet bei 390 und 1366 px: kein Anzeigenplatz sichtbar (keine Höhe, kein Abstand, kein Etikett „Anzeige“).
// Setzt man data-ad-status="filled", erscheint der Platz mit Etikett und Mindesthöhe; "unfilled" bleibt zu.
// Start: node tests/werbeplaetze.js
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { server } = require('./server');
const assert = require('assert');

const SEITEN = ['/', '/wohnung-kuendigen/', '/fristenrechner/', '/oenorm-a-1080-din-5008/'];

function sichtbarePlaetze(page) {
  return page.$$eval('.anzeige', l => l.map(b => {
    const cs = getComputedStyle(b);
    if (cs.display === 'none') return null;                    // hidden: auf dieser Breite kein Platz vorgesehen
    const r = b.getBoundingClientRect(); const etikett = b.querySelector('.anz-label');
    return { format: b.dataset.format, hoehe: r.height, oben: parseFloat(cs.marginTop), unten: parseFloat(cs.marginBottom),
             etikett: !!etikett && etikett.getBoundingClientRect().height > 0 && r.height > 0 };
  }).filter(x => x && (x.hoehe > 0 || x.oben > 0 || x.unten > 0 || x.etikett)));
}

(async () => {
  const srv = await server(0); const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const bericht = [];
  async function oeffnen(breite, url) {
    const ctx = await browser.newContext({ viewport: { width: breite, height: 900 } });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '/* Stub: keine Anzeige */' }));
    const page = await ctx.newPage(); const fehler = [];
    page.on('pageerror', e => fehler.push(e.message));
    await page.goto(`http://127.0.0.1:${port}${url}`);
    await page.waitForFunction(() => document.querySelector('.anzeige ins.adsbygoogle'));
    return { ctx, page, fehler };
  }

  for (const breite of [390, 1366]) for (const url of SEITEN) {
    const { ctx, page, fehler } = await oeffnen(breite, url);
    const sichtbar = await sichtbarePlaetze(page);
    assert.deepStrictEqual(sichtbar, [], `${breite} px ${url}: leerer Anzeigenplatz sichtbar ${JSON.stringify(sichtbar)}`);
    assert.deepStrictEqual(fehler, [], `${breite} px ${url}: JS-Fehler`);
    bericht.push(`${breite} px ${url}: ohne Anzeige nichts sichtbar`);
    await ctx.close();
  }

  {
    const { ctx, page } = await oeffnen(1366, '/wohnung-kuendigen/');
    await page.$$eval('.anzeige ins.adsbygoogle', l => l.forEach(i => i.setAttribute('data-ad-status', 'filled')));
    const da = await sichtbarePlaetze(page);
    assert(da.length > 0 && da.every(p => p.etikett && p.hoehe >= 90 && p.oben === 32), 'gefüllte Plätze nicht vollständig sichtbar: ' + JSON.stringify(da));
    assert(await page.$$eval('.anzeige:not([hidden])', l => l.every(b => b.classList.contains('anzeige--gefuellt'))), 'Rückfall-Klasse fehlt');
    bericht.push(`1366 px: ${da.length} gefüllte Plätze mit Etikett „Anzeige“ sichtbar`);
    await ctx.close();
  }
  {
    const { ctx, page } = await oeffnen(390, '/wohnung-kuendigen/');
    await page.$$eval('.anzeige ins.adsbygoogle', l => l.forEach(i => i.setAttribute('data-ad-status', 'unfilled')));
    assert.deepStrictEqual(await sichtbarePlaetze(page), [], 'unfilled sichtbar');
    await page.$eval('.anzeige[data-format="rectangle"] ins.adsbygoogle', i => i.setAttribute('data-ad-status', 'filled'));
    const da = await sichtbarePlaetze(page);
    assert(da.length === 1 && da[0].format === 'rectangle' && da[0].hoehe >= 250, 'nur der gefüllte Platz soll erscheinen: ' + JSON.stringify(da));
    bericht.push('390 px: unfilled bleibt zu, nur der gefüllte Platz erscheint');
    await ctx.close();
  }

  await browser.close(); srv.close();
  console.log(bericht.join('\n'));
  console.log('Werbeplatztest bestanden.');
})().catch(e => { console.error(e.message); process.exit(1); });
