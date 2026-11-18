// Browsertest für Fristentabelle, Fristenrechner (Beispiele, Link, Unsinnseingaben) und Rechenbeispiele.
// Prüft außerdem alle Sitemap-Seiten bei 390 und 1366 px: keine JS-Fehler, kein Überlauf, keine toten
// internen Links oder Sprungmarken. Start: node tests/eigenwert-browser.js [bildordner]
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { server } = require('./server');
const ROOT = path.join(__dirname, '..', 'docs');
(async () => {
  const srv = await server(0); const port = srv.address().port; const B = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const fehler = []; let dialoge = 0;
  const neu = async (w, h, extra) => {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: w, height: h }, acceptDownloads: true }, extra || {}));
    await ctx.route(/googlesyndication|googletagmanager|fundingchoices|doubleclick/, r => r.abort());
    const page = await ctx.newPage();
    page.on('pageerror', e => fehler.push(page.url() + ': ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) fehler.push(page.url() + ' Konsole: ' + m.text()); });
    page.on('dialog', d => { dialoge++; d.dismiss(); });
    return page;
  };
  try {
    // ---------- 1. Alle Sitemap-Seiten bei 390 und 1366 px ----------
    const urls = [...fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8').matchAll(/<loc>https:\/\/vorlagenfundus24\.de(.*?)<\/loc>/g)].map(m => m[1]);
    assert(urls.includes('/fristen-tabelle/'), 'Fristentabelle fehlt in der Sitemap');
    const links = new Set();
    for (const w of [390, 1366]) {
      const page = await neu(w, 900);
      for (const u of urls) {
        await page.goto(B + u, { waitUntil: 'networkidle' });
        const d = await page.evaluate(() => ({ breite: document.documentElement.scrollWidth, links: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')) }));
        if (d.breite > w) fehler.push(`${u}: Überlauf bei ${w} px (${d.breite})`);
        d.links.filter(h => h.startsWith('/') || h.startsWith('#')).forEach(h => links.add(h.startsWith('#') ? u + h : h));
      }
      await page.context().close();
    }
    for (const l of links) {
      const [p, frag] = l.split('#'); let f = path.join(ROOT, p); if (p.endsWith('/')) f = path.join(f, 'index.html');
      if (!fs.existsSync(f)) { fehler.push('Toter Link: ' + l); continue; }
      if (frag && frag.indexOf('=') === -1 && !new RegExp('id="' + frag.replace(/[^\w-]/g, '') + '"').test(fs.readFileSync(f, 'utf8'))) fehler.push('Sprungmarke fehlt: ' + l);
    }

    // ---------- 2. Fristenrechner ----------
    const page = await neu(1366, 900, { permissions: ['clipboard-read', 'clipboard-write'] });
    await page.goto(B + '/fristenrechner/', { waitUntil: 'networkidle' });
    const chips = await page.locator('.bsp-leiste .chip').count(); assert(chips >= 5, 'Beispiel-Knöpfe fehlen');
    const erwartet = ['28. Dezember 2026', '30. März 2027', '3. August 2026', '28. Februar 2027', '28. Dezember 2026', '28. Dezember 2026'];
    assert.strictEqual(chips, erwartet.length, 'Anzahl Beispiele');
    for (let i = 0; i < chips; i++) {
      await page.locator('.bsp-leiste .chip').nth(i).click();
      const t = await page.textContent('.wz-ausgabe .mark');
      assert(t.includes(erwartet[i]), `Beispiel ${i}: ${t}`);
      assert(await page.locator('.rechenweg li').count() >= 3, 'Rechenweg fehlt');
    }
    // Behördenfrist: 24. Dezember zählt, Rechenweg zitiert das AVG, Link trägt die Verfahrensart
    assert.strictEqual(await page.inputValue('#fr-verfahren'), 'avg');
    const wegAvg = await page.textContent('.rechenweg');
    assert(/24\. Dezember 2026 ist kein Werktag \(24\. Dezember\)/.test(wegAvg) && /§ 33 Abs\. 2 AVG/.test(wegAvg) && !/ABGB/.test(wegAvg), 'AVG-Rechenweg: ' + wegAvg);
    assert(/§§ 32, 33 AVG/.test(await page.textContent('.wz-ausgabe')) && !/Fristenübereinkommen/.test(await page.textContent('.wz-ausgabe .fristkarte')), 'Grundlage nennt nicht das AVG');
    await page.click('[data-akt=link]'); await page.waitForFunction(() => /Link kopiert/.test(document.querySelector('[data-status]').textContent));
    assert((await page.evaluate(() => navigator.clipboard.readText())).endsWith('#land=AT&e=2026-12-10&n=2&u=wochen&v=1&r=avg'));
    await page.selectOption('#fr-verfahren', ''); assert((await page.textContent('.wz-ausgabe .mark')).includes('24. Dezember 2026'), 'Zivilrecht: 24.12. bleibt');
    await page.selectOption('#fr-verfahren', 'zpo'); assert((await page.textContent('.wz-ausgabe .mark')).includes('24. Dezember 2026') && /§ 126 Abs\. 2 ZPO/.test(await page.textContent('.rechenweg')));
    await page.selectOption('#fr-verfahren', 'bao'); assert((await page.textContent('.wz-ausgabe .mark')).includes('28. Dezember 2026') && /§ 108 Abs\. 3 BAO/.test(await page.textContent('.rechenweg')));
    await page.check('input[name=land][value=DE]'); assert(!(await page.isVisible('#fr-verfahren')), 'Verfahrensart außerhalb Österreichs sichtbar');
    assert((await page.textContent('.wz-ausgabe .mark')).includes('24. Dezember 2026') && /§ 193 BGB/.test(await page.textContent('.rechenweg')));
    await page.locator('.bsp-leiste .chip').nth(0).click();
    assert.strictEqual(await page.locator('.kalstreifen li.ziel').count(), 1, 'Kalenderstreifen ohne Zieltag');
    assert.strictEqual(await page.locator('.kalstreifen li.frei').count(), 3, 'Kalenderstreifen: freie Tage');
    await page.click('[data-akt=kopieren]');
    await page.waitForFunction(() => /kopiert/.test(document.querySelector('[data-status]').textContent));
    const kopie = await page.evaluate(() => navigator.clipboard.readText());
    assert(/Letzter Tag der Frist: Montag, 28\. Dezember 2026/.test(kopie) && /§ 187 Abs\. 1 BGB/.test(kopie), 'Kopie unvollständig: ' + kopie);
    await page.click('[data-akt=link]');
    await page.waitForFunction(() => /Link kopiert/.test(document.querySelector('[data-status]').textContent));
    const link = await page.evaluate(() => navigator.clipboard.readText());
    assert(/\/fristenrechner\/#land=DE&e=2026-12-11&n=14&u=tage&v=1$/.test(link), 'Link: ' + link);
    // Link öffnen: Werte übernommen, Adresszeile sofort ohne #
    await page.goto(B + '/', { waitUntil: 'networkidle' });
    await page.goto(link.replace(/^https?:\/\/[^/]+/, B), { waitUntil: 'networkidle' });
    assert((await page.textContent('.wz-ausgabe .mark')).includes('28. Dezember 2026'), 'Link nicht übernommen');
    assert.strictEqual(await page.evaluate(() => location.hash), '', 'Werte bleiben in der Adresszeile');
    assert.strictEqual(await page.inputValue('#fr-ereignis'), '2026-12-11');
    // Tastatur: Beispiel per Enter, Land per Pfeiltaste
    await page.locator('.bsp-leiste .chip').nth(1).focus(); await page.keyboard.press('Enter');
    assert((await page.textContent('.wz-ausgabe .mark')).includes('30. März 2027'), 'Enter auf Beispiel');
    // Unsinn im Link: nichts wird ausgeführt, keine Übernahme
    for (const h of ['#land=<img src=x onerror=alert(1)>&e="><script>alert(1)</script>&n=1e9&u=x&v=7', '#land=DE&opt=<svg/onload=alert(1)>&x=javascript:alert(1)', '#e=%E0%A4%A&n=%', '#land=DE&n=3651&e=2026-02-31']) {
      await page.goto(B + '/', { waitUntil: 'networkidle' });
      await page.goto(B + '/fristenrechner/' + h, { waitUntil: 'networkidle' });
      assert(await page.locator('.wz-ausgabe .mark').count() === 1, 'kein Ergebnis nach Unsinns-Link ' + h);
      assert.strictEqual(await page.locator('.wz-ausgabe img, .wz-ausgabe script, .wz-ausgabe svg').count(), 0, 'Markup aus Link eingeschleust');
    }
    // Unsinn in den Feldern
    await page.goto(B + '/fristenrechner/', { waitUntil: 'networkidle' });
    for (const [feld, wert] of [['#fr-anzahl', '-5'], ['#fr-anzahl', '99999'], ['#fr-anzahl', ''], ['#fr-anzahl', '2.7']]) {
      await page.fill(feld, wert);
      const aus = await page.textContent('.wz-ausgabe');
      if (wert === '2.7') assert(/Letzter Tag der Frist/.test(aus), 'Dezimalzahl wird gerundet');
      else assert(/Dauer zwischen 0 und 3650|Anzahl außerhalb/.test(aus), `Unsinn ${wert}: ${aus.slice(0, 120)}`);
    }
    await page.fill('#fr-anzahl', '14');
    await page.fill('#fr-eigene', '<img src=x onerror=alert(1)>, 2026-99-99; 2027-01-04');
    assert.strictEqual(await page.locator('.wz-ausgabe img').count(), 0);
    await page.fill('#fr-ereignis', '2099-01-01');
    assert(/keine geprüften Feiertagsdaten/.test(await page.textContent('.wz-ausgabe')), 'Jahr außerhalb der Abdeckung muss abgelehnt werden');
    await page.fill('#fr-ereignis', '');
    assert(await page.locator('.wz-ausgabe .mark').count() === 1, 'leeres Datum fällt auf heute zurück');

    // ---------- 3. Startseite: Rechner sofort nutzbar ----------
    await page.goto(B + '/', { waitUntil: 'networkidle' });
    const oben = await page.evaluate(() => document.querySelector('.werkzeug').getBoundingClientRect().top + scrollY);
    assert(oben < 900, 'Rechner steht nicht im ersten Bildschirm: ' + oben);
    await page.locator('.bsp-leiste .chip').nth(2).click();
    assert((await page.textContent('.wz-ausgabe .mark')).includes('3. August 2026'));
    const mob = await neu(390, 844); await mob.goto(B + '/', { waitUntil: 'networkidle' });
    const obenMobil = await mob.evaluate(() => document.querySelector('.werkzeug').getBoundingClientRect().top + scrollY);
    assert(obenMobil < 500, 'Startseite 390 px: Rechner beginnt erst bei ' + obenMobil); await mob.context().close();

    // ---------- 4. Fristentabelle ----------
    await page.goto(B + '/fristen-tabelle/', { waitUntil: 'networkidle' });
    const gesamt = await page.locator('[data-fristentabelle] tbody tr').count(); assert(gesamt >= 80);
    const sichtbar = () => page.locator('[data-fristentabelle] tbody tr:not([hidden])').count();
    assert.strictEqual(await sichtbar(), gesamt);
    await page.fill('#ft-q', 'widerruf'); const nW = await sichtbar(); assert(nW >= 4 && nW < gesamt, 'Suche Widerruf: ' + nW);
    assert((await page.textContent('.ft-zahl')).startsWith(nW + ' von ' + gesamt));
    await page.fill('#ft-q', '573c'); assert.strictEqual(await sichtbar(), 2);
    await page.fill('#ft-q', '<img src=x onerror=alert(1)> =cmd|calc'); assert.strictEqual(await sichtbar(), 0);
    assert(await page.isVisible('.ft-leer')); assert.strictEqual(await page.locator('[data-fristentabelle] img').count(), 0);
    await page.click('[data-akt=reset]'); assert.strictEqual(await sichtbar(), gesamt);
    await page.uncheck('.ft-filter input[value=DE]'); await page.uncheck('.ft-filter input[value=CH]');
    const nAT = await sichtbar(); assert(nAT >= 25 && nAT < gesamt);
    assert.strictEqual(await page.locator('[data-fristentabelle] tbody tr:not([hidden])[data-land=DE]').count(), 0);
    await page.selectOption('#ft-b', 'Kauf'); const nATKauf = await sichtbar(); assert(nATKauf >= 5 && nATKauf < nAT);
    await page.click('[data-akt=link]');
    await page.waitForFunction(() => /Link kopiert/.test(document.querySelector('.ft-zahl').textContent));
    const tlink = await page.evaluate(() => navigator.clipboard.readText());
    assert(tlink.endsWith('/fristen-tabelle/#land=AT&bereich=Kauf'), tlink);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-akt=csv]')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    const zl = csv.trim().split('\r\n');
    assert(csv.charCodeAt(0) === 0xFEFF && zl.length === nATKauf + 2, 'CSV-Zeilen: ' + zl.length);
    assert(zl[zl.length - 1].includes('Gesetzestexte abgerufen am 18. November 2026.'), 'CSV-Fußzeile: ' + zl[zl.length - 1]);
    assert(zl[1].startsWith('"AT";"Kauf";"') && /ris\.bka\.gv\.at/.test(zl[1]), zl[1]);
    for (const z of zl) for (const c of z.split('";"')) assert(!/^"?[=+\-@]/.test(c), 'CSV-Zelle beginnt mit Formelzeichen: ' + c);
    await page.goto(B + '/', { waitUntil: 'networkidle' });
    await page.goto(tlink.replace(/^https?:\/\/[^/]+/, B), { waitUntil: 'networkidle' });
    assert.strictEqual(await sichtbar(), nATKauf, 'Auswahl aus Link');
    await page.goto(B + '/', { waitUntil: 'networkidle' });
    await page.goto(B + '/fristen-tabelle/#land=<script>alert(1)</script>&bereich="><img src=x onerror=alert(1)>', { waitUntil: 'networkidle' });
    assert.strictEqual(await sichtbar(), gesamt); assert.strictEqual(await page.locator('[data-fristentabelle] img').count(), 0);
    // Jeder „Im Fristenrechner öffnen“-Link ergibt eine Rechnung mit dem richtigen Land und der richtigen Dauer
    const rl = await page.evaluate(() => [...document.querySelectorAll('[data-fristentabelle] .ft-akt a[href^="/fristenrechner/#"]')].map(a => a.getAttribute('href')));
    assert(rl.length >= 35, 'Rechner-Links: ' + rl.length);
    for (const h of [...new Set(rl)]) {
      await page.goto(B + '/', { waitUntil: 'networkidle' });
      await page.goto(B + h, { waitUntil: 'networkidle' });
      const q = Object.fromEntries(h.split('#')[1].split('&').map(t => t.split('=')));
      assert.strictEqual(await page.inputValue('#fr-anzahl'), q.n, h); assert.strictEqual(await page.inputValue('#fr-einheit'), q.u, h);
      assert.strictEqual(await page.isChecked(`input[name=land][value=${q.land}]`), true, h);
      assert.strictEqual(await page.isChecked('#fr-verschieben'), q.v === '1', h);
      assert.strictEqual(await page.inputValue('#fr-verfahren'), q.r || '', h);
      if (q.r) assert(new RegExp({ avg: 'AVG', bao: 'BAO', zpo: 'ZPO' }[q.r]).test(await page.textContent('.rechenweg')) && !/ABGB/.test(await page.textContent('.rechenweg')), 'Fundstelle im Rechenweg: ' + h);
      assert(await page.locator('.wz-ausgabe .mark').count() === 1, 'kein Ergebnis: ' + h);
    }
    // Ohne JavaScript bleibt die ganze Tabelle lesbar
    const ohneJs = await browser.newContext({ javaScriptEnabled: false }); const pj = await ohneJs.newPage();
    await pj.goto(B + '/fristen-tabelle/'); assert.strictEqual(await pj.locator('[data-fristentabelle] tbody tr').count(), gesamt); await ohneJs.close();

    // ---------- 5. Rechenbeispiele und Seitenfristen ----------
    for (const [u, n] of [['/wohnung-kuendigen/', 2], ['/ruecktritt-online-kauf/', 1], ['/reklamation-gewaehrleistung/', 1], ['/versicherung-kuendigen/', 1], ['/verein-austritt/', 1], ['/handyvertrag-kuendigen/', 1], ['/maengelanzeige-vermieter/', 1], ['/kaution-zurueckfordern/', 1]]) {
      await page.goto(B + u, { waitUntil: 'networkidle' });
      assert.strictEqual(await page.locator('figure.beispiel svg.zeitstrahl').count(), n, u + ': Beispiele');
      const b = await page.evaluate(() => [...document.querySelectorAll('svg.zeitstrahl')].every(s => { const r = s.getBoundingClientRect(); return r.width > 200 && [...s.querySelectorAll('text')].every(t => t.getBBox().x + t.getBBox().width <= 362); }));
      assert(b, u + ': Text ragt aus dem Zeitstrahl');
    }
    if (process.argv[2]) {
      const m = await neu(390, 844);
      for (const [u, n] of [['/', 'start'], ['/fristen-tabelle/', 'tabelle'], ['/fristenrechner/', 'rechner'], ['/wohnung-kuendigen/', 'wohnung']]) {
        await m.goto(B + u, { waitUntil: 'networkidle' });
        if (n === 'rechner') await m.locator('.bsp-leiste .chip').nth(0).click();
        await m.screenshot({ path: path.join(process.argv[2], n + '-390.png'), fullPage: true });
        await page.goto(B + u, { waitUntil: 'networkidle' });
        if (n === 'rechner') await page.locator('.bsp-leiste .chip').nth(0).click();
        await page.screenshot({ path: path.join(process.argv[2], n + '-1366.png'), fullPage: true });
      }
    }
    assert.strictEqual(dialoge, 0, 'Ein Dialog (alert) wurde ausgelöst');
    if (fehler.length) throw new Error('Fehler:\n' + [...new Set(fehler)].join('\n'));
    console.log(`Eigenwert-Browsertest bestanden: ${urls.length} Seiten × 2 Breiten, ${links.size} interne Links und Sprungmarken, ${rl.length} Rechner-Links.`);
  } finally { await browser.close(); srv.close(); }
})().catch(e => { console.error(e.message || e); process.exit(1); });
