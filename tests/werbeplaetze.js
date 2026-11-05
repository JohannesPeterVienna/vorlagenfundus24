// Leere Anzeigenplätze: adsbygoogle.js ist ein Stub, der nie eine Anzeige liefert.
// Erwartet bei 390 und 1366 px (AdSense-Hilfe 10762946): ohne data-ad-status bleibt das <ins> sichtbar und
// ungeschnitten (display:block, Breite > 0, keine vorab gesetzte Höhe/min-height, kein overflow:hidden – ein Probe-
// kind von 50 px lässt es wachsen), nur Etikett „Anzeige“, Mindesthöhe und Abstände fehlen (Endkontrolle 5.11.2026).
// "unfilled" → ins display:none, kein Beiwerk; "filled"/"unfill-optimized" → Platz mit Etikett und Abstand.
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

function inse(page) {
  return page.$$eval('.anzeige:not([hidden]) ins.adsbygoogle', l => l.map(i => {
    const b = i.closest('.anzeige'), ci = getComputedStyle(i), ri = i.getBoundingClientRect(), et = b.querySelector('.anz-label');
    const zuschnitt = [b, i.parentElement].map(e => { const c = getComputedStyle(e); return c.overflowX + '/' + c.overflowY + '/' + c.visibility + '/' + c.display; });
    const cb = getComputedStyle(b);
    // Probe: wächst das <ins> mit einem 50 px hohen Kind? (nicht versteckt, keine feste Höhe, kein Zuschnitt)
    const probe = document.createElement('div'); probe.style.height = '50px'; i.appendChild(probe);
    const mitProbe = i.getBoundingClientRect().height, boxMitProbe = b.getBoundingClientRect().height; probe.remove();
    return { format: b.dataset.format, display: ci.display, sicht: ci.visibility, breite: ri.width, hoehe: ri.height, mitProbe, boxMitProbe,
             inlineHoehe: i.style.height, inlineMinH: i.parentElement.style.minHeight, adFormat: i.getAttribute('data-ad-format'),
             boxH: b.getBoundingClientRect().height, zuschnitt, etikett: !!et && getComputedStyle(et).display !== 'none',
             abstand: parseFloat(cb.marginTop) + parseFloat(cb.marginBottom) };
  }));
}
function ungeschnitten(l, wo) {
  assert(l.length > 0, wo + ': keine aktiven Plätze');
  for (const x of l) {
    assert(x.display !== 'none' && x.sicht === 'visible' && x.breite > 0, wo + ': ins versteckt ' + JSON.stringify(x));
    assert(x.inlineHoehe === '' && x.inlineMinH === '' && x.adFormat, wo + ': Höhe/min-height vorab gesetzt oder nicht responsiv ' + JSON.stringify(x));
    assert(x.mitProbe >= 50 && x.boxMitProbe >= 50, wo + ': ins wächst nicht mit Inhalt (versteckt/zugeschnitten) ' + JSON.stringify(x));
    assert(x.zuschnitt.every(z => z.startsWith('visible/visible/visible/') && !z.endsWith('/none')), wo + ': Container schneidet ab ' + JSON.stringify(x));
    assert(x.boxH >= x.hoehe, wo + ': Platz niedriger als ins ' + JSON.stringify(x));
  }
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
    const l = await inse(page);
    ungeschnitten(l, `${breite} px ${url}`);
    assert(l.every(x => !x.etikett && x.abstand === 0), `${breite} px ${url}: Beiwerk ohne Status sichtbar ${JSON.stringify(l)}`);
    const sichtbar = await sichtbarePlaetze(page);
    assert.deepStrictEqual(sichtbar.filter(p => p.etikett || p.oben || p.unten), [], `${breite} px ${url}: Etikett/Abstand ohne Anzeige`);
    assert.deepStrictEqual(fehler, [], `${breite} px ${url}: JS-Fehler`);
    bericht.push(`${breite} px ${url}: ohne Status ${l.length} ins sichtbar und ungeschnitten, Etikett/Abstand aus`);
    await ctx.close();
  }

  for (const status of ['filled', 'unfill-optimized']) {
    const { ctx, page } = await oeffnen(1366, '/wohnung-kuendigen/');
    await page.$$eval('.anzeige ins.adsbygoogle', (l, st) => l.forEach(i => i.setAttribute('data-ad-status', st)), status);
    const da = await sichtbarePlaetze(page);
    assert(da.length > 0 && da.every(p => p.etikett && p.hoehe >= 90 && p.oben === 32), status + ': Plätze nicht vollständig sichtbar: ' + JSON.stringify(da));
    assert(await page.$$eval('.anzeige:not([hidden])', l => l.every(b => b.classList.contains('anzeige--gefuellt'))), 'Rückfall-Klasse fehlt');
    bericht.push(`1366 px ${status}: ${da.length} Plätze mit Etikett „Anzeige“ und Abstand sichtbar`);
    await ctx.close();
  }
  {
    const { ctx, page } = await oeffnen(390, '/wohnung-kuendigen/');
    await page.$$eval('.anzeige ins.adsbygoogle', l => l.forEach(i => i.setAttribute('data-ad-status', 'unfilled')));
    assert((await inse(page)).every(x => x.display === 'none' && !x.etikett && x.boxH === 0), 'unfilled: ins nicht display:none');
    assert.deepStrictEqual(await sichtbarePlaetze(page), [], 'unfilled sichtbar');
    await page.$eval('.anzeige[data-format="rectangle"] ins.adsbygoogle', i => i.setAttribute('data-ad-status', 'filled'));
    const da = await sichtbarePlaetze(page);
    assert(da.length === 1 && da[0].format === 'rectangle' && da[0].hoehe >= 250 && da[0].etikett, 'nur der gefüllte Platz soll erscheinen: ' + JSON.stringify(da));
    bericht.push('390 px: unfilled → ins display:none, nur der gefüllte Platz erscheint');
    await ctx.close();
  }
  {
    // Browser ohne :has(): :has()-Regeln entfernen, Rückfall-Klasse erzwingen
    const { ctx, page } = await oeffnen(1366, '/wohnung-kuendigen/');
    await page.evaluate(() => {
      for (const sh of document.styleSheets) { try { for (let k = sh.cssRules.length - 1; k >= 0; k--) if (sh.cssRules[k].cssText.includes(':has(')) sh.deleteRule(k); } catch (e) {} }
      document.documentElement.classList.add('ohne-has');
    });
    let l = await inse(page);
    ungeschnitten(l, 'ohne :has()');
    assert(l.every(x => !x.etikett && x.abstand === 0), 'ohne :has(): Beiwerk ohne Status sichtbar');
    await page.$$eval('.anzeige ins.adsbygoogle', l => l.forEach(i => i.setAttribute('data-ad-status', 'unfill-optimized')));
    l = await inse(page);
    assert(l.every(x => x.etikett && x.abstand > 0), 'ohne :has(): unfill-optimized ohne Etikett');
    bericht.push('ohne :has(): Rückfall-Klassen verhalten sich gleich');
    await ctx.close();
  }

  await browser.close(); srv.close();
  console.log(bericht.join('\n'));
  console.log('Werbeplatztest bestanden.');
})().catch(e => { console.error(e.message); process.exit(1); });
